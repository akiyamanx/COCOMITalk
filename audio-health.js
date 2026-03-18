// audio-health.js v1.0
// AudioContext健全性チェック＋段階的自己修復
// whisper-provider.jsのAudioContext/AnalyserNode/MediaRecorder/MediaStreamTrackを検査・修復する
// 三姉妹会議決定: AudioContextはモバイルChromeで壊れる前提で扱い、検知→再構築が正解

// v1.0 新規作成 - 実装指示書 Step 2

/**
 * AudioHealthChecker
 * AudioContextの健全性を検査し、問題があれば段階的に自己修復を試みる
 *
 * 健全性チェック項目（設計書 1-7 テーブル準拠）:
 *   audioContext.state === 'running'
 *   mediaRecorder.state === 'recording' or 'paused'
 *   track.readyState === 'live'
 *   track.enabled === true
 *   AnalyserNode最大値 > 0（500ms以内に1回以上）
 *
 * 復旧レベル（設計書 1-8 テーブル準拠）:
 *   Level 1: audioContext.resume()（1000ms, 2回リトライ）
 *   Level 2: AnalyserNode再生成・再接続（1500ms, 1回）
 *   Level 3: MediaRecorder再生成（2000ms, 1回）
 *   Level 4: getUserMedia()再取得（3000ms, 1回）
 */
class AudioHealthChecker {
  constructor() {
    // 復旧処理中フラグ（二重実行防止）
    this._recovering = false;
  }

  // ═══════════════════════════════════════════
  // 健全性チェック（設計書 1-7）
  // ═══════════════════════════════════════════

  /**
   * AudioContext周りの健全性を一括チェックする
   * @param {AudioContext} audioCtx - 検査対象のAudioContext
   * @param {MediaRecorder} recorder - 検査対象のMediaRecorder（null可）
   * @param {MediaStream} stream - 検査対象のMediaStream
   * @param {AnalyserNode} analyser - 検査対象のAnalyserNode
   * @returns {Promise<object>} 各項目の合否 + allPassed
   */
  async checkHealth(audioCtx, recorder, stream, analyser) {
    const track = stream?.getTracks()?.[0] || null;

    const results = {
      audioCtxState: audioCtx?.state === 'running',
      // recorderは録音停止中（pause後等）もありえるので、inactiveでなければOK
      recorderState: recorder ? recorder.state !== 'inactive' : true,
      trackReady: track?.readyState === 'live',
      trackEnabled: track?.enabled === true,
      analyserAlive: false,
    };

    // AnalyserNode実測チェック: 500ms以内に最大値 > 0 が検出されれば合格
    if (analyser && audioCtx?.state === 'running') {
      results.analyserAlive = await this._checkAnalyserAlive(analyser, 500);
    }

    // 全項目合格判定
    results.allPassed = results.audioCtxState
      && results.recorderState
      && results.trackReady
      && results.trackEnabled
      && results.analyserAlive;

    this._log('info', 'ヘルスチェック結果', results);
    return results;
  }

  /**
   * AnalyserNodeが実際にデータを返しているか確認する
   * 完全ゼロ配列が続く場合はAudioContextが壊れている可能性が高い
   * @param {AnalyserNode} analyser
   * @param {number} timeoutMs - チェック期間（ms）
   * @returns {Promise<boolean>} 期間内に非ゼロデータがあればtrue
   */
  _checkAnalyserAlive(analyser, timeoutMs) {
    return new Promise((resolve) => {
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const startTime = Date.now();
      // 100msごとにチェック
      const checkInterval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        // 最大値を取得
        let maxVal = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > maxVal) maxVal = dataArray[i];
        }
        // 非ゼロデータ検出 → 合格
        if (maxVal > 0) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }
        // タイムアウト → 不合格
        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(checkInterval);
          this._log('warn', `AnalyserNode ${timeoutMs}ms間ゼロ配列 → 不合格`);
          resolve(false);
        }
      }, 100);
    });
  }

  // ═══════════════════════════════════════════
  // 段階的自己修復（設計書 1-8）
  // ═══════════════════════════════════════════

  /**
   * AudioContextを段階的に修復する
   * Level 1→2→3→4 の順に試行し、成功した時点で終了する
   * @param {AudioContext} audioCtx
   * @param {MediaRecorder} recorder
   * @param {MediaStream} stream
   * @param {AnalyserNode} analyser
   * @param {function} getUserMediaFn - () => Promise<MediaStream>（Level 4用）
   * @returns {Promise<object>} { success, level, newAudioCtx?, newAnalyser?, newRecorder?, newStream? }
   */
  async recover(audioCtx, recorder, stream, analyser, getUserMediaFn) {
    // 二重実行防止
    if (this._recovering) {
      this._log('warn', '復旧処理が既に実行中 → スキップ');
      return { success: false, level: 'skipped' };
    }
    this._recovering = true;
    this._log('info', '=== 段階的復旧開始 ===');

    // voice-state.jsの状態を更新（recovering_inputへ）
    if (window.voiceState) {
      window.voiceState.transition('recovering_input');
    }

    try {
      // Level 1: audioContext.resume()（1000ms, 2回リトライ）
      const level1 = await this._recoverLevel1(audioCtx);
      if (level1.success) {
        // resume成功後にAnalyserが生きているか再確認
        if (analyser) {
          const alive = await this._checkAnalyserAlive(analyser, 500);
          if (alive) {
            this._log('info', 'Level 1 成功: resume()で復帰');
            return { success: true, level: 1 };
          }
          this._log('info', 'Level 1: resume()成功だがAnalyser不活性 → Level 2へ');
        } else {
          this._log('info', 'Level 1 成功: resume()で復帰（Analyserなし）');
          return { success: true, level: 1 };
        }
      }

      // Level 2: AnalyserNode再生成・再接続（1500ms, 1回）
      const level2 = await this._recoverLevel2(audioCtx, stream);
      if (level2.success) {
        this._log('info', 'Level 2 成功: AnalyserNode再生成で復帰');
        return { success: true, level: 2, newAnalyser: level2.newAnalyser };
      }

      // Level 3: MediaRecorder再生成（2000ms, 1回）
      const level3 = await this._recoverLevel3(stream);
      if (level3.success) {
        this._log('info', 'Level 3 成功: MediaRecorder再生成で復帰');
        return { success: true, level: 3, newRecorder: level3.newRecorder };
      }

      // Level 4: getUserMedia()再取得（3000ms, 1回）
      if (getUserMediaFn) {
        const level4 = await this._recoverLevel4(getUserMediaFn);
        if (level4.success) {
          this._log('info', 'Level 4 成功: getUserMedia()再取得で復帰');
          return {
            success: true, level: 4,
            newStream: level4.newStream,
            newAudioCtx: level4.newAudioCtx,
            newAnalyser: level4.newAnalyser,
          };
        }
      }

      // 全レベル失敗 → blocked-needs-tap へ遷移
      this._log('error', '全レベル失敗 → blocked-needs-tap');
      if (window.voiceState) {
        window.voiceState.transition('blocked-needs-tap');
      }
      return { success: false, level: 'blocked-needs-tap' };

    } finally {
      this._recovering = false;
    }
  }

  // --- Level 1: audioContext.resume()（1000ms, 2回リトライ） ---
  async _recoverLevel1(audioCtx) {
    if (!audioCtx) return { success: false };
    this._log('info', 'Level 1: audioContext.resume() 試行');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // resume()を試行
        await Promise.race([
          audioCtx.resume(),
          this._timeout(1000),
        ]);
        // 成功チェック
        if (audioCtx.state === 'running') {
          return { success: true };
        }
        this._log('warn', `Level 1 attempt ${attempt + 1}: resume()後もstate=${audioCtx.state}`);
      } catch (e) {
        this._log('warn', `Level 1 attempt ${attempt + 1}: エラー: ${e.message}`);
      }
    }
    return { success: false };
  }

  // --- Level 2: AnalyserNode再生成・再接続（1500ms, 1回） ---
  async _recoverLevel2(audioCtx, stream) {
    if (!audioCtx || !stream || audioCtx.state !== 'running') return { success: false };
    this._log('info', 'Level 2: AnalyserNode再生成 試行');

    try {
      const result = await Promise.race([
        this._createNewAnalyser(audioCtx, stream),
        this._timeout(1500),
      ]);
      if (result && result.analyser) {
        // 新AnalyserNodeが実データを返すか確認
        const alive = await this._checkAnalyserAlive(result.analyser, 500);
        if (alive) return { success: true, newAnalyser: result.analyser };
      }
    } catch (e) {
      this._log('warn', `Level 2 エラー: ${e.message}`);
    }
    return { success: false };
  }

  // --- Level 3: MediaRecorder再生成（2000ms, 1回） ---
  async _recoverLevel3(stream) {
    if (!stream) return { success: false };
    this._log('info', 'Level 3: MediaRecorder再生成 試行');

    try {
      const result = await Promise.race([
        this._createNewRecorder(stream),
        this._timeout(2000),
      ]);
      if (result && result.recorder) {
        return { success: true, newRecorder: result.recorder };
      }
    } catch (e) {
      this._log('warn', `Level 3 エラー: ${e.message}`);
    }
    return { success: false };
  }

  // --- Level 4: getUserMedia()再取得（3000ms, 1回） ---
  async _recoverLevel4(getUserMediaFn) {
    this._log('info', 'Level 4: getUserMedia()再取得 試行');

    try {
      const result = await Promise.race([
        this._fullReinitialize(getUserMediaFn),
        this._timeout(3000),
      ]);
      if (result && result.stream) {
        return {
          success: true,
          newStream: result.stream,
          newAudioCtx: result.audioCtx,
          newAnalyser: result.analyser,
        };
      }
    } catch (e) {
      this._log('warn', `Level 4 エラー: ${e.message}`);
    }
    return { success: false };
  }

  // ═══════════════════════════════════════════
  // 内部ヘルパー
  // ═══════════════════════════════════════════

  /** AnalyserNode再生成（Level 2用） */
  async _createNewAnalyser(audioCtx, stream) {
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    return { analyser };
  }

  /** MediaRecorder再生成（Level 3用） */
  async _createNewRecorder(stream) {
    // Whisper用MIME検出（whisper-provider.jsと同じ優先順位）
    const mime = this._getSupportedMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      audioBitsPerSecond: 32000,
    });
    return { recorder };
  }

  /** 完全再初期化（Level 4用） */
  async _fullReinitialize(getUserMediaFn) {
    // 新しいマイクストリーム取得
    const stream = await getUserMediaFn();
    // 新しいAudioContext
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    return { stream, audioCtx, analyser };
  }

  /** タイムアウト用Promise */
  _timeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`タイムアウト(${ms}ms)`)), ms)
    );
  }

  /** ブラウザがサポートするMIMEタイプ取得（whisper-provider.jsと同じロジック） */
  _getSupportedMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  /** 復旧処理中かどうか */
  isRecovering() {
    return this._recovering;
  }

  // ═══════════════════════════════════════════
  // ログ
  // ═══════════════════════════════════════════

  /** ログ出力 */
  _log(level, message, data = null) {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const entry = `[${ts}][AudioHealth][${level}] ${message}`;
    if (level === 'error') {
      console.error(entry, data || '');
    } else if (level === 'warn') {
      console.warn(entry, data || '');
    } else {
      console.log(entry, data || '');
    }
  }
}

// ═══════════════════════════════════════════
// グローバル公開 + シングルトン
// ═══════════════════════════════════════════

window.AudioHealthChecker = AudioHealthChecker;
window.audioHealth = new AudioHealthChecker();
