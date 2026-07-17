// whisper-provider.js v1.10
// このファイルはOpenAI Whisper APIによるSTT実装
// SpeechProviderインターフェースに準拠（web-speech-provider.jsの代替）
// ハイブリッド方式: 無音検出で区切り＋最大25秒で強制送信
// v1.10 2026-07-17 - 無音セグメント連続送信ループ修正（継続録音のhasVoiceStarted維持を廃止）＋
//   無発話50秒で予防グラフ張替（maxVol>0で生存判定なのに感度低下する「半死」対策）
// v1.9 2026-07-17 - 段階復帰はしご（resume待機張替/ctx作直し/フル再取得）＋番犬再武装＋
//   recorder世代ガード・ハンドラ切断（webm破損根治）＋resume timeout化＋track観測
// v1.8 2026-07-16 - resumeガード期間中のpause/stop追い越し防止
// v1.7 2026-04-05 - resume後AudioContext suspend対策
// v1.4〜v1.6: 履歴省略（ハルシネーションフィルタ/最大録音25秒延長）
// v1.0〜v1.3: 履歴省略（Whisper STT/sessionIDガード/resumeガード期間/DebugLogger）

/**
 * Whisper APIプロバイダー
 * MediaRecorder + Web Audio API(無音検出) + Worker /whisper エンドポイント
 */
class WhisperProvider extends SpeechProvider {
  constructor() {
    super('Whisper API');
    this._listening = false;
    this._stream = null;
    this._recorder = null;
    this._audioCtx = null;
    this._analyser = null;
    this._chunks = [];
    this._silenceTimer = null;
    this._maxTimer = null;
    this._volumeCheckInterval = null;
    this._hasVoiceStarted = false;
    this._processing = false;
    this._paused = false;
    this._currentSessionId = 0;

    this._SILENCE_THRESHOLD = 35;
    this._SILENCE_DURATION = 3000;
    // v1.6変更 - 15秒→25秒に延長（長めの発話でも途中で切られないように）
    // 短い発話は_SILENCE_DURATION（3秒無音）で自動区切りされるので影響なし
    this._MAX_RECORD_TIME = 25000;
    this._MIN_RECORD_TIME = 800;
    this._VOLUME_CHECK_MS = 100;
    this._VOICE_START_COUNT = 3;
    this._voiceCount = 0;
    // v1.7追加 - AudioContext suspend検出カウンター
    this._zeroVolumeCount = 0;
    this._ZERO_VOLUME_THRESHOLD = 50; // 5秒間（100ms×50回）連続ゼロで復帰はしご発火
    // v1.9追加 - 段階復帰はしごの状態
    this._recoveryAttempts = 0;    // 連続復帰試行回数（実音声観測でリセット）
    this._recovering = false;      // 復帰処理中フラグ（処理中は監視を一時停止）
    this._recorderGen = 0;         // recorder世代番号（旧チャンク混入防止）
    this._sourceNode = null;       // MediaStreamSource（張替時にdisconnectするため保持）
    this._lastSuspendResumeAt = 0; // suspended即応resumeのスロットル
    this._noVoiceSegments = 0;     // v1.10追加 - 無発話セグメント連続数（予防はしご用）

    this._debugVisible = false;
    this._debugEl = null;
    this._debugLogs = [];
    this._initDebugUI();
  }

  _initDebugUI() {
    const existing = document.getElementById('whisper-debug-panel');
    if (existing) { this._debugEl = existing; return; }
    const el = document.createElement('div');
    el.id = 'whisper-debug-panel';
    el.style.cssText = 'position:fixed;bottom:80px;left:4px;right:4px;' +
      'max-height:200px;overflow-y:auto;background:rgba(0,0,0,0.85);' +
      'color:#0ff;font-size:11px;font-family:monospace;padding:6px;' +
      'border-radius:8px;z-index:99999;display:none;white-space:pre-wrap;';
    document.body.appendChild(el);
    this._debugEl = el;
  }

  _debugLog(msg) {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(`[Whisper-DEBUG] ${msg}`);
    if (window.DebugLogger) window.DebugLogger.addLog(line);
    this._debugLogs.push(line);
    if (this._debugLogs.length > 30) this._debugLogs.shift();
    if (this._debugEl && this._debugVisible) {
      this._debugEl.style.display = 'block';
      this._debugEl.textContent = this._debugLogs.join('\n');
      this._debugEl.scrollTop = this._debugEl.scrollHeight;
    }
  }

  setDebugVisible(visible) {
    this._debugVisible = !!visible;
    if (this._debugEl) {
      if (visible) {
        this._debugEl.style.display = 'block';
        this._debugEl.textContent = this._debugLogs.join('\n');
        this._debugEl.scrollTop = this._debugEl.scrollHeight;
      } else {
        this._debugEl.style.display = 'none';
      }
    }
  }

  isAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  isListening() { return this._listening; }

  async start(options = {}) {
    if (this._listening) { this._debugLog('既に録音中 → スキップ'); return; }
    this._paused = false;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._sourceNode = null;
      this._rewireAnalyser(); // v1.9変更 - source/analyser構築を共通化（張替と同一経路）
      // v1.9追加 - trackのmute/ended観測（OS側ミュートの現行犯確保）
      const track = this._stream.getAudioTracks()[0];
      if (track) {
        track.onmute = () => this._debugLog('🔇 audio trackがmute（OS/ブラウザ側）');
        track.onunmute = () => this._debugLog('🔊 audio trackがunmute');
        track.onended = () => this._debugLog('⛔ audio trackがended');
      }
      this._startRecording();
      this._listening = true;
      this._debugLog('=== Whisper録音開始 ===');
      if (this.onStart) this.onStart();
    } catch (err) {
      this._debugLog(`マイク取得エラー: ${err.message}`);
      if (this.onError) this.onError(`マイクが使えません: ${err.message}`);
    }
  }

  stop() {
    if (!this._listening) return;
    this._debugLog('停止要求');
    this._stopRecording(false);
    this._cleanup();
    this._listening = false;
    if (this.onEnd) this.onEnd();
  }

  pause() {
    if (!this._listening) return;
    this._paused = true;
    this._debugLog('一時停止（TTS再生中）');
    this._stopRecording(false);
  }

  // v1.7修正 - resume時にAudioContext.resume()を強制呼び出し（モバイルChrome suspend対策）
  async resume() {
    if (!this._listening || !this._stream) return;
    this._paused = false;
    this._debugLog('再開（ガード期間付き）');
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    this._zeroVolumeCount = 0; // v1.7追加 - ゼロカウンターリセット

    // v1.7追加 - AudioContextがsuspendedなら強制resume
    if (this._audioCtx && this._audioCtx.state !== 'running') {
      this._debugLog(`AudioContext状態: ${this._audioCtx.state} → resume()試行`);
      try {
        // v1.9変更 - resumeがpendingのまま返らない端末でresume()全体が固まるのを防止（1.5秒で見切り）
        await Promise.race([
          this._audioCtx.resume(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 1500ms')), 1500)),
        ]);
        this._debugLog(`AudioContext復帰成功: ${this._audioCtx.state}`);
      } catch (e) {
        this._debugLog(`AudioContext resume失敗/未完: ${e.message}（番犬はしごに委ねて続行）`);
      }
    }

    await new Promise(r => setTimeout(r, 300));
    // v1.8追加 - ガード期間中にpause()/stop()が来ていたら録音再開を中止（追い越し防止）
    if (this._paused || !this._listening) {
      this._debugLog('ガード期間中にpause/stop検出 → 録音再開を中止');
      return;
    }
    this._chunks = [];
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    this._startRecording(false);
    if (this.onStart) this.onStart();
    this._debugLog('ガード期間完了 — MediaRecorder再起動＋発話検出リセット');
  }

  stopAndGetText() { this.stop(); return ''; }

  _startRecording(isContinuation = false) {
    this._detachRecorder(); // v1.9変更 - ハンドラ切断してから停止（旧チャンクの次世代混入＝webm破損防止）
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    if (this._volumeCheckInterval) { clearInterval(this._volumeCheckInterval); this._volumeCheckInterval = null; }
    this._chunks = [];
    this._processing = false;
    if (!isContinuation) { this._hasVoiceStarted = false; this._voiceCount = 0; }
    this._zeroVolumeCount = 0; // v1.7追加 - 録音開始時にゼロカウンターリセット
    const mimeType = this._getSupportedMimeType();
    this._debugLog(`MIMEタイプ: ${mimeType}`);
    const gen = ++this._recorderGen; // v1.9追加 - recorder世代番号
    this._recorder = new MediaRecorder(this._stream, { mimeType: mimeType, audioBitsPerSecond: 32000 });
    this._recorder.ondataavailable = (e) => {
      // v1.9追加 - 世代ガード（旧recorderの遅延チャンク混入＝Invalid file format根治の二重防御）
      if (gen !== this._recorderGen) { if (e.data.size > 0) this._debugLog(`🧟 旧recorder(gen${gen})残チャンク破棄 ${e.data.size}B`); return; }
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.start(100);
    this._recordStartTime = Date.now();
    this._startVolumeMonitor();
    this._maxTimer = setTimeout(() => {
      this._debugLog(`最大${this._MAX_RECORD_TIME}ms → 強制送信`);
      this._onSegmentEnd();
    }, this._MAX_RECORD_TIME);
  }

  _stopRecording(sendRemaining = true) {
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    if (this._volumeCheckInterval) { clearInterval(this._volumeCheckInterval); this._volumeCheckInterval = null; }
    this._detachRecorder(); // v1.9変更 - ハンドラ切断してから停止（stop後の遅延flushが次のchunksを汚染していた）
    if (sendRemaining && this._chunks.length > 0 && this._hasVoiceStarted) {
      const duration = Date.now() - (this._recordStartTime || Date.now());
      if (duration >= this._MIN_RECORD_TIME) { this._sendToWhisper(); }
      else { this._debugLog(`短すぎる音声（${duration}ms）→ スキップ`); }
    }
  }

  _cleanup() {
    this._stopRecording(false);
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._audioCtx && this._audioCtx.state !== 'closed') { this._audioCtx.close().catch(() => {}); this._audioCtx = null; }
    this._analyser = null; this._sourceNode = null; this._recorder = null; this._chunks = [];
  }

  // v1.9全面改修 - 番犬の再武装＋段階復帰はしご（穴1: ===50一発判定→>=＋同期リセット /
  //   穴2: resume直後の同期state判定で張替スキップ→await後に張替 / 穴3: running詐称・凍結値→段階エスカレーション）
  _startVolumeMonitor() {
    if (!this._analyser) return;
    const dataArray = new Uint8Array(this._analyser.frequencyBinCount);
    this._volumeCheckInterval = setInterval(() => {
      if (!this._analyser || this._recovering) return;

      // v1.9変更 - ctxがrunning以外なら読まずに死亡疑い扱い（suspend中の凍結値を「静か」と誤読しない）
      const ctxDead = !this._audioCtx || this._audioCtx.state !== 'running';

      // v1.9変更 - suspendedは即resume試行（1秒スロットル）。ただしreturnせず、はしごカウントも並行して進める
      //   （v1.7はここでreturnしていたため、resumeが効かない端末で2段目以降へ永遠に進めなかった）
      if (ctxDead && this._audioCtx && this._audioCtx.state === 'suspended') {
        const now = Date.now();
        if (now - this._lastSuspendResumeAt > 1000) {
          this._lastSuspendResumeAt = now;
          this._debugLog('AudioContext suspended検出 → resume()試行');
          this._audioCtx.resume().then(() => {
            this._debugLog(`AudioContext復帰: ${this._audioCtx.state}`);
          }).catch(e => { this._debugLog(`AudioContext resume失敗: ${e.message}`); });
        }
      }

      let avgVolume = 0;
      let maxVolume = 0;
      if (!ctxDead) {
        this._analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
          if (dataArray[i] > maxVolume) maxVolume = dataArray[i];
        }
        avgVolume = sum / dataArray.length;
      }

      if (!ctxDead && avgVolume > this._SILENCE_THRESHOLD) {
        this._zeroVolumeCount = 0;
        if (this._recoveryAttempts > 0) {
          this._debugLog(`✅ 実音声観測 → はしごリセット（${this._recoveryAttempts}段目で復活）`);
          this._recoveryAttempts = 0;
        }
        if (!this._hasVoiceStarted) {
          this._voiceCount++;
          if (this._voiceCount >= this._VOICE_START_COUNT) {
            this._hasVoiceStarted = true;
            this._debugLog(`発話開始検出（${this._voiceCount}回連続, avg=${avgVolume.toFixed(0)}）`);
          }
        }
        if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
        if (this._hasVoiceStarted && this.onInterim) this.onInterim('🎤 ...');
      } else {
        this._voiceCount = 0;

        if (ctxDead || maxVolume === 0) {
          // v1.9変更 - 死亡疑いカウント（>=判定＋同期リセット＝再武装できる番犬）
          this._zeroVolumeCount++;
          if (this._zeroVolumeCount >= this._ZERO_VOLUME_THRESHOLD) {
            this._zeroVolumeCount = 0;
            this._climbRecoveryLadder(ctxDead ? `ctx=${this._audioCtx ? this._audioCtx.state : 'null'}` : 'maxVol=0');
          }
        } else {
          // maxVolume > 0 だけどavgが閾値以下 = 本当に静かなだけ（正常）
          this._zeroVolumeCount = 0;
          if (this._recoveryAttempts > 0) {
            this._debugLog(`✅ 音響グラフ生存確認 → はしごリセット（${this._recoveryAttempts}段目で復活）`);
            this._recoveryAttempts = 0;
          }
        }

        if (this._hasVoiceStarted && !this._silenceTimer && !this._processing) {
          this._silenceTimer = setTimeout(() => {
            this._debugLog(`無音${this._SILENCE_DURATION}ms検出 → セグメント送信`);
            this._onSegmentEnd();
          }, this._SILENCE_DURATION);
        }
      }
    }, this._VOLUME_CHECK_MS);
  }

  // v1.9追加 - 段階復帰はしご本体（1段=resume待機+張替 / 2段=ctx作直し / 3段=streamフル再取得）
  _climbRecoveryLadder(reason) {
    this._recoveryAttempts++;
    const stage = Math.min(this._recoveryAttempts, 3);
    this._debugLog(`🪜 復帰はしご${stage}段目 発火（${reason}, 通算${this._recoveryAttempts}回）`);
    this._recovering = true;
    const safety = setTimeout(() => { this._recovering = false; }, 8000); // 宙吊り保険
    const done = () => { clearTimeout(safety); this._recovering = false; };
    if (stage === 1) {
      this._recoverStage1().catch(e => this._debugLog(`1段目エラー: ${e.message}`)).finally(done);
    } else if (stage === 2) {
      this._rebuildAudioGraph().catch(e => this._debugLog(`2段目エラー: ${e.message}`)).finally(done);
    } else {
      this._fullRestart().catch(e => this._debugLog(`3段目エラー: ${e.message}`)).finally(done);
    }
  }

  // v1.9追加 - はしご1段目: resume完了をtimeout付きで待ってからAnalyser張替
  async _recoverStage1() {
    if (!this._audioCtx || this._audioCtx.state === 'closed') return;
    try {
      await Promise.race([
        this._audioCtx.resume(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 1000ms')), 1000)),
      ]);
      this._debugLog(`1段目: resume完了 state=${this._audioCtx.state}`);
    } catch (e) {
      this._debugLog(`1段目: resume未完（${e.message}）`);
    }
    if (this._stream && this._audioCtx && this._audioCtx.state === 'running') this._rewireAnalyser();
  }

  // v1.9追加 - 現在のctx上でsource/analyserを張替（旧sourceはdisconnectしてノードリーク防止）
  _rewireAnalyser() {
    try {
      if (this._sourceNode) { try { this._sourceNode.disconnect(); } catch (e) { /* ignore */ } }
      this._sourceNode = this._audioCtx.createMediaStreamSource(this._stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 512;
      this._sourceNode.connect(analyser);
      this._analyser = analyser;
      this._debugLog('Analyser張替完了');
    } catch (e) {
      this._debugLog(`Analyser張替エラー: ${e.message}`);
    }
  }

  // v1.9追加 - はしご2段目: AudioContextごと作り直し（running詐称＝stateは正常なのにグラフ死亡へ対応）
  async _rebuildAudioGraph() {
    if (!this._stream) return;
    this._debugLog('2段目: AudioContext作り直し');
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      try { await this._audioCtx.close(); } catch (e) { /* ignore */ }
    }
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._sourceNode = null;
    this._rewireAnalyser();
    this._debugLog(`2段目: 再構築完了 state=${this._audioCtx.state}`);
  }

  // v1.9追加 - はしご3段目: getUserMediaからフル再取得（最終段）。
  //   pause/stop割込時は見送り＝TTS後はvoice-input側の「stream死亡→フル再起動」既存経路が受け止める
  async _fullRestart() {
    if (!this._listening || this._paused) { this._debugLog('3段目: pause/stop中 → 見送り'); return; }
    this._debugLog('3段目: streamごとフル再取得');
    this._stopRecording(false);
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      try { await this._audioCtx.close(); } catch (e) { /* ignore */ }
    }
    this._audioCtx = null;
    this._analyser = null;
    this._sourceNode = null;
    if (!this._listening) { this._debugLog('3段目: stop検出 → 見送り'); return; }
    if (this._paused) { this._debugLog('3段目: pause検出 → 見送り（TTS後の復帰に委ねる）'); return; }
    this._listening = false; // start()の二重起動ガードを通すため一旦落とす
    await this.start({ language: 'ja-JP' });
  }

  // v1.9追加 - recorderのハンドラを差し替えてから停止（遅延チャンクは破棄しつつ🧟ログで現行犯観測）
  _detachRecorder() {
    if (!this._recorder) return;
    const gen = this._recorderGen;
    this._recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this._debugLog(`🧟 旧recorder(gen${gen})の遅延チャンク破棄 ${e.data.size}B`);
    };
    if (this._recorder.state !== 'inactive') { try { this._recorder.stop(); } catch (e) { /* ignore */ } }
  }

  // v1.7修正 - _onSegmentEnd後に_afterWhisperResponseが確実に呼ばれるようにする
  _onSegmentEnd() {
    if (this._processing) return;
    this._processing = true;
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    if (this._volumeCheckInterval) { clearInterval(this._volumeCheckInterval); this._volumeCheckInterval = null; }

    this._detachRecorder(); // v1.9変更 - ハンドラ切断してから停止

    // v1.7修正 - _hasVoiceStartedに関わらず_afterWhisperResponseを呼ぶ
    // （無音のまま_maxTimerが到達した場合も録音を再起動するため）
    if (this._chunks.length > 0 && this._hasVoiceStarted) {
      const duration = Date.now() - (this._recordStartTime || Date.now());
      if (duration >= this._MIN_RECORD_TIME) {
        this._noVoiceSegments = 0; this._sendToWhisper(); // v1.10 - 発話ありセグメントでカウンタリセット
        return; // _sendToWhisper内で_afterWhisperResponseが呼ばれる
      }
    }
    // v1.7追加 - 発話なし/短すぎの場合も録音を再起動
    this._debugLog('セグメント終了（発話なし/短すぎ）→ 録音再起動');
    // v1.10追加 - 無発話2連続（約50秒）で予防張替＝maxVol>0で生存判定なのに感度低下する「半死」対策
    if (++this._noVoiceSegments >= 2) {
      this._noVoiceSegments = 0;
      this._debugLog('🔎 無発話50秒 → 予防はしご（1段目のみ）');
      this._recoverStage1().catch(e => this._debugLog(`予防はしごNG: ${e.message}`));
    }
    this._afterWhisperResponse();
  }

  async _sendToWhisper() {
    if (this._chunks.length === 0) { this._debugLog('チャンクが空 → スキップ'); this._afterWhisperResponse(); return; }
    const mimeType = this._getSupportedMimeType();
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
    const blob = new Blob(this._chunks, { type: mimeType });
    this._chunks = [];
    this._debugLog(`API送信: ${(blob.size / 1024).toFixed(1)}KB (${ext})`);
    if (blob.size < 3000) { this._debugLog(`データ小さすぎ（${blob.size}B）→ スキップ`); this._afterWhisperResponse(); return; }
    const sentSessionId = this._currentSessionId;
    try {
      const formData = new FormData();
      formData.append('file', blob, `audio.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'ja');
      formData.append('prompt', 'COCOMITalkでの日常会話。');
      const result = await ApiCommon.callAPI('whisper', formData, { isFormData: true });
      if (sentSessionId !== this._currentSessionId) {
        this._debugLog(`旧session応答を破棄 (sent=${sentSessionId}, current=${this._currentSessionId})`);
        this._afterWhisperResponse(); return;
      }
      if (result.text && result.text.trim()) {
        const text = result.text.trim();
        if (this._isHallucination(text)) { this._debugLog(`ハルシネーション除外: "${text}"`); }
        else { this._debugLog(`認識結果: "${text}" [session=${sentSessionId}]`); if (this.onFinal) this.onFinal(text); }
      } else { this._debugLog('認識結果: 空（無音と判定）'); }
    } catch (err) { this._debugLog(`API送信エラー: ${err.message}`); }
    this._afterWhisperResponse();
  }

  _afterWhisperResponse() {
    this._processing = false;
    if (this._paused) { this._debugLog('pause中 → 録音再開スキップ'); return; }
    if (window.voiceState && window.voiceState.isSpeaking()) { this._debugLog('speaking中 → 録音再開スキップ（voiceState）'); return; }
    // v1.10変更 - 継続でも発話検出をリセット（維持すると沈黙中3秒毎に無音送信ループ＝実測7連発の修正）
    if (this._listening && this._stream) { this._startRecording(false); }
    else { if (this.onEnd) this.onEnd(); }
  }

  setSessionId(id) { this._currentSessionId = id; this._debugLog(`sessionId更新: ${id}`); }

  // v1.5更新 - ハルシネーションフィルタ（「以上で終わりです」等を追加）
  _isHallucination(text) {
    const patterns = [
      /ご視聴/, /ご清聴/, /ご覧いただき/, /チャンネル登録/, /高評価/,
      /お願いします$/, /ありがとうございました$/, /ありがとうございます$/,
      /字幕/, /翻訳/, /エンディング/, /提供/, /次回/, /おわり/,
      /BGM/, /Music/, /Subtitles/i, /Subscribe/i, /Thank you/i,
      /^\s*[.。…\s]+\s*$/,
      /^おやすみなさい[。.]?$/,
      /これからもお楽しみに/,
      /次の動画でお会いしましょう/,
      /^以上です[。.]?$/,
      /^以上で[。.]?$/,
      /以上で(終わり|おわり)/,
    ];
    return patterns.some(p => p.test(text));
  }

  _getSupportedMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (const mime of candidates) { if (MediaRecorder.isTypeSupported(mime)) return mime; }
    return '';
  }
}

window.WhisperProvider = WhisperProvider;
