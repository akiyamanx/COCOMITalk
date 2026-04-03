// whisper-provider.js v1.6
// このファイルはOpenAI Whisper APIによるSTT実装
// SpeechProviderインターフェースに準拠（web-speech-provider.jsの代替）
// ハイブリッド方式: 無音検出で区切り＋最大25秒で強制送信
// ピコン音なし・高精度・ブラウザ非依存
// v1.6 2026-04-04 - 最大録音時間を15秒→25秒に延長（長めの発話対応）
// v1.5 2026-04-04 - ハルシネーションフィルタ追加（「以上で終わりです」等）
// v1.4 2026-03-27 - ハルシネーションフィルタ追加（おやすみなさい等）＋無音判定2500→3000ms延長

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
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      source.connect(this._analyser);
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

  async resume() {
    if (!this._listening || !this._stream) return;
    this._paused = false;
    this._debugLog('再開（ガード期間付き）');
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    await new Promise(r => setTimeout(r, 300));
    this._chunks = [];
    this._hasVoiceStarted = false;
    this._voiceCount = 0;
    this._startRecording(false);
    if (this.onStart) this.onStart();
    this._debugLog('ガード期間完了 — MediaRecorder再起動＋発話検出リセット');
  }

  stopAndGetText() { this.stop(); return ''; }

  _startRecording(isContinuation = false) {
    if (this._recorder && this._recorder.state !== 'inactive') {
      try { this._recorder.stop(); } catch (e) { /* ignore */ }
    }
    if (this._silenceTimer) { clearTimeout(this._silenceTimer); this._silenceTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    if (this._volumeCheckInterval) { clearInterval(this._volumeCheckInterval); this._volumeCheckInterval = null; }
    this._chunks = [];
    this._processing = false;
    if (!isContinuation) { this._hasVoiceStarted = false; this._voiceCount = 0; }
    const mimeType = this._getSupportedMimeType();
    this._debugLog(`MIMEタイプ: ${mimeType}`);
    this._recorder = new MediaRecorder(this._stream, { mimeType: mimeType, audioBitsPerSecond: 32000 });
    this._recorder.ondataavailable = (e) => { if (e.data.size > 0) this._chunks.push(e.data); };
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
    if (this._recorder && this._recorder.state !== 'inactive') { this._recorder.stop(); }
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
    this._analyser = null; this._recorder = null; this._chunks = [];
  }

  _startVolumeMonitor() {
    if (!this._analyser) return;
    const dataArray = new Uint8Array(this._analyser.frequencyBinCount);
    this._volumeCheckInterval = setInterval(() => {
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avgVolume = sum / dataArray.length;
      if (avgVolume > this._SILENCE_THRESHOLD) {
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
        if (this._hasVoiceStarted && !this._silenceTimer && !this._processing) {
          this._silenceTimer = setTimeout(() => {
            this._debugLog(`無音${this._SILENCE_DURATION}ms検出 → セグメント送信`);
            this._onSegmentEnd();
          }, this._SILENCE_DURATION);
        }
      }
    }, this._VOLUME_CHECK_MS);
  }

  _onSegmentEnd() {
    if (this._processing) return;
    this._processing = true;
    this._stopRecording(true);
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
    if (this._listening && this._stream) { this._startRecording(true); }
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
