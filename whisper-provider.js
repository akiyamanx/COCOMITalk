// whisper-provider.js v1.3
// このファイルはOpenAI Whisper APIによるSTT実装
// SpeechProviderインターフェースに準拠（web-speech-provider.jsの代替）
// ハイブリッド方式: 無音検出で区切り＋最大10秒で強制送信
// ピコン音なし・高精度・ブラウザ非依存
// v1.3 2026-03-19 - DebugLoggerフック追加（_debugLogからログファイル出力に連携）

// v1.0 新規作成 - Whisper API STT（パターンCハイブリッド方式）
// v1.1 追加 - sessionIDガード（三姉妹会議決定: 古い応答を世界から無効にする）
// v1.2 修正 - resume()にTTS尾音ガード期間追加（300ms待機＋チャンク破棄）

/**
 * Whisper APIプロバイダー
 * MediaRecorder + Web Audio API(無音検出) + Worker /whisper エンドポイント
 */
class WhisperProvider extends SpeechProvider {
  constructor() {
    super('Whisper API');
    this._listening = false;
    this._stream = null;           // マイクMediaStream
    this._recorder = null;         // MediaRecorder
    this._audioCtx = null;         // AudioContext（無音検出用）
    this._analyser = null;         // AnalyserNode
    this._chunks = [];             // 録音チャンク蓄積
    this._silenceTimer = null;     // 無音検出タイマー
    this._maxTimer = null;         // 最大録音時間タイマー
    this._volumeCheckInterval = null; // 音量監視インターバル
    this._hasVoiceStarted = false; // 発話開始検出フラグ
    this._processing = false;      // API送信中フラグ
    this._paused = false;          // TTS再生中の一時停止フラグ
    // v1.1追加 - sessionIDガード（voice-state.jsから同期される）
    this._currentSessionId = 0;    // 現在のsessionId

    // 設定値
    this._SILENCE_THRESHOLD = 35;    // 無音判定の音量閾値（0-255、環境音を除外するため高め）
    this._SILENCE_DURATION = 2500;   // 無音継続でAPI送信（ms）— 息継ぎ1〜2秒を吸収
    this._MAX_RECORD_TIME = 15000;   // 最大録音時間（ms）— 長話でも余裕
    this._MIN_RECORD_TIME = 800;     // 最小録音時間（ms）— 短すぎる音声を無視
    this._VOLUME_CHECK_MS = 100;     // 音量チェック間隔（ms）
    this._VOICE_START_COUNT = 3;     // 発話開始に必要な連続検出回数（300ms）
    this._voiceCount = 0;            // 連続発話カウンター

    // デバッグ
    this._debugVisible = false;
    this._debugEl = null;
    this._debugLogs = [];
    this._initDebugUI();
  }

  // ═══════════════════════════════════════════
  // デバッグUI（web-speech-provider.jsと同じ仕組み）
  // ═══════════════════════════════════════════

  _initDebugUI() {
    // v1.1修正: 既存divがあれば再利用（プロバイダー再生成時の重複防止）
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
    // v1.3追加 - DebugLoggerにもログを送信（ファイル出力用）
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
        // v1.1修正: ONにした時に既存ログを即表示
        this._debugEl.style.display = 'block';
        this._debugEl.textContent = this._debugLogs.join('\n');
        this._debugEl.scrollTop = this._debugEl.scrollHeight;
      } else {
        this._debugEl.style.display = 'none';
      }
    }
  }

  // ═══════════════════════════════════════════
  // SpeechProviderインターフェース実装
  // ═══════════════════════════════════════════

  /** Whisper APIが利用可能か（マイク＋Worker URL必須） */
  isAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** 現在録音中か */
  isListening() {
    return this._listening;
  }

  /**
   * 音声認識を開始（マイク取得→録音→無音検出→API送信ループ）
   * @param {object} options - { language: string }（Whisperではlanguageパラメータとして使用）
   */
  async start(options = {}) {
    if (this._listening) {
      this._debugLog('既に録音中 → スキップ');
      return;
    }
    this._paused = false;

    try {
      // マイク取得
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // AudioContext＋AnalyserNode（無音検出用）
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      source.connect(this._analyser);

      // 録音開始
      this._startRecording();
      this._listening = true;
      this._debugLog('=== Whisper録音開始 ===');
      if (this.onStart) this.onStart();

    } catch (err) {
      this._debugLog(`マイク取得エラー: ${err.message}`);
      if (this.onError) this.onError(`マイクが使えません: ${err.message}`);
    }
  }

  /** 音声認識を停止（完全停止 — マイク解放） */
  stop() {
    if (!this._listening) return;
    this._debugLog('停止要求');
    this._stopRecording(false);
    this._cleanup();
    this._listening = false;
    if (this.onEnd) this.onEnd();
  }

  /** 録音を一時停止（TTS再生中用 — マイクは維持） */
  pause() {
    if (!this._listening) return;
    this._paused = true;
    this._debugLog('一時停止（TTS再生中）');
    this._stopRecording(false);
  }

  // v1.2修正 - TTS後の再開にガード期間追加（尾音/残響の誤検出防止）
  async resume() {
    if (!this._listening || !this._stream) return;
    this._paused = false;
    this._debugLog('再開（ガード期間付き）');
    // TTS後は新しい発話待ち
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    // ① 録音を開始（この時点からMediaRecorderがマイク音を拾い始める）
    this._startRecording(false);
    // UI更新のためonStartを通知
    if (this.onStart) this.onStart();
    // ② ガード期間: 300ms待ってから蓄積チャンクを破棄（TTS尾音/スピーカー残響を排除）
    await new Promise(r => setTimeout(r, 300));
    this._chunks = [];
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    this._debugLog('ガード期間完了 — チャンク破棄＋発話検出リセット');
  }

  /** 停止して確定テキストを返す（互換用 — Whisperでは空文字を返す） */
  stopAndGetText() {
    this.stop();
    return '';
  }

  // ═══════════════════════════════════════════
  // 録音制御
  // ═══════════════════════════════════════════

  /** MediaRecorderで録音を開始＋無音監視＋最大時間タイマー */
  _startRecording(isContinuation = false) {
    this._chunks = [];
    this._processing = false;
    // 初回はリセット、セグメント継続時は発話状態を維持
    if (!isContinuation) {
      this._hasVoiceStarted = false;
      this._voiceCount = 0;
    }

    // MediaRecorder設定（webm/opusが軽量でWhisper対応）
    const mimeType = this._getSupportedMimeType();
    this._debugLog(`MIMEタイプ: ${mimeType}`);

    this._recorder = new MediaRecorder(this._stream, {
      mimeType: mimeType,
      audioBitsPerSecond: 32000 // v1.0: 32kbpsで十分（音声認識用途）
    });

    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };

    // 100msごとにデータを取得（細かく区切って送信可能に）
    this._recorder.start(100);
    this._recordStartTime = Date.now();

    // 無音監視開始
    this._startVolumeMonitor();

    // 最大録音時間タイマー（長話対策）
    this._maxTimer = setTimeout(() => {
      this._debugLog(`最大${this._MAX_RECORD_TIME}ms → 強制送信`);
      this._onSegmentEnd();
    }, this._MAX_RECORD_TIME);
  }

  /** 録音を停止（セグメント区切り or 完全停止） */
  _stopRecording(sendRemaining = true) {
    // タイマー全クリア
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    if (this._volumeCheckInterval) { clearInterval(this._volumeCheckInterval); this._volumeCheckInterval = null; }

    if (this._recorder && this._recorder.state !== 'inactive') {
      this._recorder.stop();
    }

    // 残りの音声をAPI送信（セグメント区切りの場合）
    if (sendRemaining && this._chunks.length > 0 && this._hasVoiceStarted) {
      const duration = Date.now() - (this._recordStartTime || Date.now());
      if (duration >= this._MIN_RECORD_TIME) {
        this._sendToWhisper();
      } else {
        this._debugLog(`短すぎる音声（${duration}ms）→ スキップ`);
      }
    }
  }

  /** リソース解放 */
  _cleanup() {
    this._stopRecording(false);
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._analyser = null;
    this._recorder = null;
    this._chunks = [];
  }

  // ═══════════════════════════════════════════
  // 無音検出（ハイブリッド方式のコア）
  // ═══════════════════════════════════════════

  /** 音量を定期監視して無音を検出する */
  _startVolumeMonitor() {
    if (!this._analyser) return;

    const dataArray = new Uint8Array(this._analyser.frequencyBinCount);

    this._volumeCheckInterval = setInterval(() => {
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(dataArray);

      // 平均音量を計算
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avgVolume = sum / dataArray.length;

      // 発話検出（連続_VOICE_START_COUNT回で確定 — 環境音の一瞬の音を除外）
      if (avgVolume > this._SILENCE_THRESHOLD) {
        if (!this._hasVoiceStarted) {
          this._voiceCount++;
          if (this._voiceCount >= this._VOICE_START_COUNT) {
            this._hasVoiceStarted = true;
            this._debugLog(`発話開始検出（${this._voiceCount}回連続, avg=${avgVolume.toFixed(0)}）`);
          }
        }
        // 無音タイマーリセット
        if (this._silenceTimer) {
          clearTimeout(this._silenceTimer);
          this._silenceTimer = null;
        }
        if (this._hasVoiceStarted && this.onInterim) this.onInterim('🎤 ...');
      } else {
        // 閾値以下 → 連続カウンターリセット
        this._voiceCount = 0;
        if (this._hasVoiceStarted && !this._silenceTimer && !this._processing) {
          // 発話開始後に無音になった → 無音タイマー開始
          this._silenceTimer = setTimeout(() => {
            this._debugLog(`無音${this._SILENCE_DURATION}ms検出 → セグメント送信`);
            this._onSegmentEnd();
          }, this._SILENCE_DURATION);
        }
      }
    }, this._VOLUME_CHECK_MS);
  }

  /** 1セグメント終了 — 録音を区切ってAPIに送信し、次のセグメントを開始 */
  _onSegmentEnd() {
    if (this._processing) return; // 二重送信防止
    this._processing = true;

    // 現在の録音を停止（残りを送信）
    this._stopRecording(true);

    // 録音を継続する場合は新しいセグメントを開始
    // _sendToWhisperの完了後に次のセグメントを開始する
  }

  // ═══════════════════════════════════════════
  // Whisper API送信
  // ═══════════════════════════════════════════

  /** 蓄積した音声チャンクをWorker /whisper に送信 */
  async _sendToWhisper() {
    if (this._chunks.length === 0) {
      this._debugLog('チャンクが空 → スキップ');
      this._afterWhisperResponse();
      return;
    }

    const mimeType = this._getSupportedMimeType();
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
    const blob = new Blob(this._chunks, { type: mimeType });
    this._chunks = [];
    this._debugLog(`API送信: ${(blob.size / 1024).toFixed(1)}KB (${ext})`);

    // 小さすぎる音声データはスキップ（無音に近い→ハルシネーション防止）
    if (blob.size < 3000) {
      this._debugLog(`データ小さすぎ（${blob.size}B）→ スキップ`);
      this._afterWhisperResponse();
      return;
    }

    // v1.1追加 - 送信前のsessionIdを保存（await後に一致チェック用）
    const sentSessionId = this._currentSessionId;

    try {
      const formData = new FormData();
      formData.append('file', blob, `audio.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'ja');
      // ハルシネーション抑制: promptでコンテキストを与える
      formData.append('prompt', 'COCOMITalkでの日常会話。');

      const result = await ApiCommon.callAPI('whisper', formData, { isFormData: true });

      // v1.1追加 - sessionIDガード: TTS開始等でsessionが変わっていたら応答を破棄
      if (sentSessionId !== this._currentSessionId) {
        this._debugLog(`旧session応答を破棄 (sent=${sentSessionId}, current=${this._currentSessionId})`);
        this._afterWhisperResponse();
        return;
      }

      if (result.text && result.text.trim()) {
        const text = result.text.trim();
        // Whisperハルシネーション（無音時に定型文を生成する既知の癖）をフィルタ
        if (this._isHallucination(text)) {
          this._debugLog(`ハルシネーション除外: "${text}"`);
        } else {
          this._debugLog(`認識結果: "${text}" [session=${sentSessionId}]`);
          if (this.onFinal) this.onFinal(text);
        }
      } else {
        this._debugLog('認識結果: 空（無音と判定）');
      }
    } catch (err) {
      this._debugLog(`API送信エラー: ${err.message}`);
    }

    this._afterWhisperResponse();
  }

  /** Whisper応答後 — 録音を継続するなら次のセグメントを開始 */
  _afterWhisperResponse() {
    this._processing = false;
    // pause中は録音再開しない（TTS再生中にWhisper応答が返ってきた場合）
    if (this._paused) {
      this._debugLog('pause中 → 録音再開スキップ');
      return;
    }
    // v1.1追加 - voice-state.jsの状態もチェック（speaking中は録音再開しない）
    if (window.voiceState && window.voiceState.isSpeaking()) {
      this._debugLog('speaking中 → 録音再開スキップ（voiceState）');
      return;
    }
    if (this._listening && this._stream) {
      this._startRecording(true);
    } else {
      if (this.onEnd) this.onEnd();
    }
  }

  // ═══════════════════════════════════════════
  // ユーティリティ
  // ═══════════════════════════════════════════

  /**
   * v1.1追加 - sessionIdを外部から設定する
   * voice-input.jsがvoice-state.jsのnewSession()後に呼び出す
   * @param {number} id - 新しいsessionId
   */
  setSessionId(id) {
    this._currentSessionId = id;
    this._debugLog(`sessionId更新: ${id}`);
  }

  /** Whisperのハルシネーション（無音時に勝手に生成される定型文）を判定 */
  _isHallucination(text) {
    const patterns = [
      /ご視聴/, /ご清聴/, /ご覧いただき/, /チャンネル登録/, /高評価/,
      /お願いします$/, /ありがとうございました$/, /ありがとうございます$/,
      /字幕/, /翻訳/, /エンディング/, /提供/, /次回/, /おわり/,
      /BGM/, /Music/, /Subtitles/i, /Subscribe/i, /Thank you/i,
      /^\s*[.。…\s]+\s*$/, // ドットや省略記号のみ
    ];
    return patterns.some(p => p.test(text));
  }

  /** ブラウザがサポートするMIMEタイプを取得 */
  _getSupportedMimeType() {
    // webm/opusが最優先（軽量＋Whisper対応）
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    // フォールバック（MediaRecorderのデフォルト）
    return '';
  }
}

// グローバルに公開
window.WhisperProvider = WhisperProvider;
