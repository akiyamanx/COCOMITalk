// voice-input.js v2.3.0
// 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS）
// UI→voice-ui.js / 送信→voice-sender.js（mixin） / 状態→voice-state.js
// v2.0 方針F: バッファ蓄積＋2.5秒待機＋ノイズフィルタ＋確認アニメ
// v2.1 修正 - TTS途中切れバグ修正（TTS待機フラグ＋STT再開抑制）
// v2.2 改修 - voice-state.js連携（三姉妹会議決定: ステートマシン＋sessionID＋自己修復）
// v2.2.2 修正 - _restartSTT()にTTS再生状態チェック追加（フィードバックループ対策）
// v2.2.3 追加 - #77 吹き出しタップ読み上げ（speakBubbleメソッド追加。マイクOFF時も動作）
// v2.3.0 修正 - TTS生成待ち中のSTT誤起動防止（_waitingForTTSフラグ＋復帰待機延長1500ms）

/** VoiceController - 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS） */
class VoiceController {
  constructor() {
    // v2.2追加 - voice-state.jsのシングルトンを参照
    this._voiceState = window.voiceState;
    // v2.1追加 - STTプロバイダー切替（設定から読み取り）
    this._stt = this._createSTTProvider();
    this._playback = new AudioPlaybackManager();
    this._ui = new VoiceUI();
    this._enabled = false;
    this._currentSisterId = 'koko';
    this._speed = 1.25;
    this._autoListen = false;
    // v2.0: バッファ方式
    this._buffer = '';
    this._bufferTimer = null;
    this._confirmTimer = null;
    this._lastBufferText = '';
    this._BUFFER_DELAY = 3500;
    this._CONFIRM_DELAY = 500;
    this._NOISE_MIN_LENGTH = 2;
    this._lastText = '';
    this._sttStartTime = 0;
    this._sttRetryCount = 0;
    this._STT_MIN_DURATION = 500;
    this._STT_MAX_RETRY = 2;
    // v2.3.0追加 - TTS生成待ちフラグ（送信後〜TTS再生開始までの隙間でSTT誤起動を防ぐ）
    this._waitingForTTS = false;

    this._setupVoiceCommand();
    this._setupCallbacks();
    this._setupStateListener();
  }

  _setupVoiceCommand() {
    if (typeof VoiceCommand === 'undefined') {
      console.warn('[Voice] VoiceCommandが未定義 — 音声コマンド無効');
      this._voiceCmd = null;
      return;
    }
    const resumeAfter = (ms = 800) => { if (this._enabled) setTimeout(() => this.startListening(), ms); };
    this._voiceCmd = new VoiceCommand({
      onStop: () => { this._playback.stop(); this._enabled = false; this._forceIdleState(); },
      onResume: () => { this._forceIdleState(); resumeAfter(500); },
      onSwitchSister: (key, name) => {
        if (typeof window.switchToSister !== 'function') return;
        window.switchToSister(key); this._currentSisterId = key;
        this._forceIdleState(); this._ui.showStatus(`🔄 ${name}に切り替えました`, 'success'); resumeAfter();
      },
      onSwitchGroup: () => {
        if (typeof window.switchToGroup !== 'function') return;
        window.switchToGroup(); this._forceIdleState();
        this._ui.showStatus('👥 グループモードに切り替えました', 'success'); resumeAfter();
      },
      onSpeedChange: (newSpeed) => { this._speed = newSpeed; resumeAfter(500); },
      onStatus: (msg, type) => { this._forceIdleState(); this._ui.showStatus(msg, type); resumeAfter(); },
      onSaveMemory: () => {
        this._forceIdleState();
        if (typeof ChatMemory !== 'undefined' && typeof ChatCore !== 'undefined') {
          const ctx = ChatCore.getGroupContext();
          ChatMemory.manualSave(ctx.currentSister, ctx.chatHistories[ctx.currentSister]);
          this._ui.showStatus('💾 覚えたよ！', 'success');
        } else { this._ui.showStatus('💾 記憶機能が未準備です', 'warning'); }
        resumeAfter();
      },
      onCancel: () => {
        this._clearAllTimers(); this._buffer = ''; this._lastBufferText = '';
        this._ui.hideConfirm(); this._forceIdleState();
        this._ui.showStatus('⏹ キャンセルしました', 'info'); resumeAfter();
      }
    });
  }

  _setupCallbacks() {
    this._hasFinalText = false;
    this._finalText = '';

    this._stt.onStart = () => {
      this._voiceState.transition('listening');
      if (this._buffer) {
        this._ui.showInterim(this._buffer + ' 🎤...');
      } else {
        this._ui.showInterim('🎤 聞いてるよ...');
      }
      this._lastText = '';
      this._finalText = '';
      this._hasFinalText = false;
      this._sttStartTime = Date.now();
    };

    this._stt.onInterim = (text) => {
      if (this._hasFinalText) return;
      const display = this._buffer ? this._buffer + ' ' + text : text;
      this._ui.showInterim(display);
      if (!text.startsWith('🎤')) this._lastText = text;
      if (this._bufferTimer) this._resetBufferTimer();
    };

    this._stt.onFinal = (text) => {
      if (this._hasFinalText && !(this._stt instanceof WhisperProvider)) {
        console.log(`[Voice] final重複無視: "${text}"`);
        return;
      }
      console.log(`[Voice] 確定テキスト: "${text}"`);
      this._finalText = text;
      this._hasFinalText = true;
      this._lastText = text;
      const display = this._buffer ? this._buffer + ' ' + text : text;
      this._ui.showInterim(display);
      if (this._stt instanceof WhisperProvider) {
        if (text.trim() && !this._isNoise(text.trim())) this._appendBuffer(text.trim());
      }
    };

    // v2.3.0修正 - onEndガードに_waitingForTTSチェック追加
    this._stt.onEnd = () => {
      if (this._waitingForTTS || this._voiceState.isSpeaking()
          || this._playback.isPlaying() || this._playback.isQueuePlaying()) {
        console.log('[Voice] onEnd: TTS待ち/再生中 → STT再開を抑制');
        return;
      }
      const duration = Date.now() - this._sttStartTime;
      const hasText = this._hasFinalText || (this._lastText && this._lastText.trim().length > 0);

      if (duration < this._STT_MIN_DURATION && !hasText && this._sttRetryCount < this._STT_MAX_RETRY) {
        this._sttRetryCount++;
        console.log(`[Voice] STT即終了(${duration}ms) → リトライ ${this._sttRetryCount}/${this._STT_MAX_RETRY}`);
        setTimeout(() => {
          if (this._enabled && !this._waitingForTTS) this._stt.start({ language: 'ja-JP' });
        }, 300);
        return;
      }
      this._sttRetryCount = 0;

      const text = this._hasFinalText
        ? this._finalText
        : (this._stt.stopAndGetText() || this._lastText);
      console.log(`[Voice] onEnd: hasFinal=${this._hasFinalText} text="${text}" dur=${duration}ms buf="${this._buffer}"`);

      if (text && text.trim().length > 0) {
        if (!this._isNoise(text.trim())) {
          this._appendBuffer(text.trim());
        } else {
          console.log(`[Voice] ノイズフィルタ除外: "${text.trim()}"`);
        }
        this._restartSTT();
      } else {
        if (this._buffer) {
          this._restartSTT();
        } else if (this._enabled) {
          this._ui.showInterim('🎤 話しかけてね...');
          this._restartSTT();
        } else {
          this._voiceState.transition('idle');
        }
      }
    };

    this._stt.onError = (error) => {
      this._sttRetryCount = 0;
      this._clearAllTimers();
      this._voiceState.transition('error');
      this._ui.showStatus(error, 'error');
      setTimeout(() => {
        this._voiceState.forceReset();
      }, 2000);
    };

    // v2.3.0修正 - onPlayStartでTTS待ちフラグをOFF（speakingステートに移行するのでフラグ不要に）
    this._playback.onPlayStart = (sisterId) => {
      this._waitingForTTS = false;
      const newId = this._voiceState.newSession();
      this._voiceState.transition('speaking');
      if (this._stt instanceof WhisperProvider) {
        this._stt.setSessionId(newId);
      }
      this._ui.highlightSister(sisterId, true);
      this._buffer = '';
      this._lastBufferText = '';
      this._clearAllTimers();
      if (this._stt.isListening()) {
        if (typeof this._stt.pause === 'function') { this._stt.pause(); }
        else { this._stt.stop(); }
        this._lastText = '';
      }
    };

    // v2.3.0修正 - onPlayEndでTTS待ちフラグをOFF（安全策）
    this._playback.onPlayEnd = (sisterId) => {
      this._waitingForTTS = false;
      this._ui.highlightSister(sisterId, false);
      if (this._playback.isQueuePlaying()) return;
      this._voiceState.transition('recovering_input');
      if (this._enabled) this._resumeSTTAfterTTS();
    };

    // v2.3.0修正 - onQueueEndでTTS待ちフラグをOFF（安全策）
    this._playback.onQueueEnd = () => {
      this._waitingForTTS = false;
      this._voiceState.transition('recovering_input');
      if (this._enabled) this._resumeSTTAfterTTS();
    };

    // v2.3.0修正 - onPlayErrorでTTS待ちフラグをOFF（安全策）
    this._playback.onPlayError = (error, sisterId) => {
      this._waitingForTTS = false;
      this._ui.highlightSister(sisterId, false);
      this._ui.showStatus(error, 'error');
      this._voiceState.forceReset();
    };

    this._playback.onFallback = (message) => {
      this._ui.showStatus(message, 'info');
    };
  }

  _appendBuffer(text) {
    // v2.3.0修正 - TTS待ち中もバッファ追記を拒否
    if (this._waitingForTTS || this._voiceState.isSpeaking()) {
      console.log(`[Voice] TTS待ち/speaking中のバッファ追記を拒否: "${text}"`);
      return;
    }
    this._buffer = this._buffer ? this._buffer + ' ' + text : text;
    this._lastBufferText = text;
    this._ui.showInterim(this._buffer + ' 🎤...');
    console.log(`[Voice] バッファ追記: "${text}" → 全体: "${this._buffer}"`);
    this._resetBufferTimer();
  }

  _resetBufferTimer() {
    if (this._bufferTimer) { clearTimeout(this._bufferTimer); this._bufferTimer = null; }
    this._bufferTimer = setTimeout(() => {
      this._bufferTimer = null;
      if (!this._buffer) return;
      if (this._waitingForTTS || this._voiceState.isSpeaking()) {
        console.log('[Voice] TTS待ち/speaking中 → バッファタイマー発火を無視');
        return;
      }
      if (this._stt.isListening()) this._stt.stop();
      console.log(`[Voice] ${this._BUFFER_DELAY}ms無音 → 確認アニメ開始: "${this._buffer}"`);
      this._startConfirmAndSend();
    }, this._BUFFER_DELAY);
  }

  _startConfirmAndSend() {
    const text = this._buffer.trim();
    if (!text) return;
    this._ui.showSendCountdown(text);
    this._confirmTimer = setTimeout(() => {
      this._confirmTimer = null;
      this._ui.hideSendCountdown();
      const sendText = this._buffer.trim();
      this._buffer = '';
      this._lastBufferText = '';
      this._lastText = '';
      this._hasFinalText = false;
      this._finalText = '';
      if (sendText) {
        console.log(`[Voice] 確認完了 → 送信: "${sendText}"`);
        // v2.3.0追加 - 送信時にTTS待ちフラグON（TTS生成API応答待ちの隙間でSTT誤起動を防ぐ）
        this._waitingForTTS = true;
        this._sendVoiceMessage(sendText);
      }
    }, this._CONFIRM_DELAY);
  }

  _isNoise(text) {
    if (text.length <= this._NOISE_MIN_LENGTH) return true;
    if (this._lastBufferText && text === this._lastBufferText) return true;
    return false;
  }
  // v2.3.0修正 - _restartSTTガードに_waitingForTTSチェック追加
  _restartSTT() {
    setTimeout(() => {
      if (this._enabled
          && !this._waitingForTTS
          && !this._voiceState.isSpeaking()
          && !this._playback.isPlaying()
          && !this._playback.isQueuePlaying()) {
        this._stt.start({ language: 'ja-JP' });
      }
    }, 800);
  }

  // v2.3.0修正 - 復帰待機を1000ms→1500msに延長（VOICEVOXチャンク間ネットワーク遅延対策）
  async _resumeSTTAfterTTS() {
    await new Promise(r => setTimeout(r, 1500));
    if (this._waitingForTTS || this._voiceState.isSpeaking()
        || this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      console.log('[Voice] _resumeSTTAfterTTS: TTS待ち/speaking/再生中 → 復帰中止');
      return;
    }
    if (this._stt instanceof WhisperProvider && window.audioHealth) {
      const health = await window.audioHealth.checkHealth(
        this._stt._audioCtx, this._stt._recorder, this._stt._stream, this._stt._analyser
      );
      if (!health.allPassed) {
        console.log('[Voice] AudioContext異常 → 自己修復開始');
        const result = await window.audioHealth.recover(
          this._stt._audioCtx, this._stt._recorder, this._stt._stream, this._stt._analyser,
          () => navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          })
        );
        if (!result.success) { return; }
        if (result.newAudioCtx) this._stt._audioCtx = result.newAudioCtx;
        if (result.newAnalyser) this._stt._analyser = result.newAnalyser;
        if (result.newRecorder) this._stt._recorder = result.newRecorder;
        if (result.newStream) this._stt._stream = result.newStream;
        console.log(`[Voice] 自己修復成功（Level ${result.level}）`);
      }
      if (this._waitingForTTS || this._voiceState.isSpeaking()) { return; }
    }
    this._voiceState.transition('listening');
    if (typeof this._stt.resume === 'function') { this._stt.resume(); }
    else { this.startListening(); }
  }

  _setupStateListener() {
    if (!this._voiceState) return;
    this._voiceState.onStateChange((newState, prevState, sessionId) => {
      const uiMap = {
        'idle': 'idle', 'listening': 'listening', 'transcribing': 'listening',
        'speaking': 'speaking', 'recovering_input': 'recovering',
        'blocked-needs-tap': 'blocked', 'error': 'error',
      };
      const uiState = uiMap[newState] || 'idle';
      this._ui.updateMicState(uiState);
      this._updateMeetingMicState(uiState);
      if (newState === 'idle') this._ui.hideInterim();
      if (newState === 'recovering_input') this._ui.showInterim('🔄 マイク復帰中...');
      if (newState === 'blocked-needs-tap') this._ui.showInterim('👆 マイクボタンをタップしてね');
    });
  }

  _clearAllTimers() {
    if (this._bufferTimer) { clearTimeout(this._bufferTimer); this._bufferTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    this._ui.hideSendCountdown();
  }

  _createSTTProvider() {
    try {
      const s = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}');
      if (s.sttProvider === 'whisper' && typeof WhisperProvider !== 'undefined') {
        console.log('[Voice] STTプロバイダー: Whisper API');
        return new WhisperProvider();
      }
    } catch (e) { /* ignore */ }
    console.log('[Voice] STTプロバイダー: Web Speech API');
    return new WebSpeechProvider();
  }

  switchSTTProvider(providerName) {
    const wasEnabled = this._enabled;
    if (wasEnabled) this.stopListening();
    this._stt = providerName === 'whisper' && typeof WhisperProvider !== 'undefined'
      ? new WhisperProvider() : new WebSpeechProvider();
    this._setupCallbacks();
    try {
      const s = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}');
      if (s.sttDebug) this._stt.setDebugVisible(true);
    } catch (e) { /* ignore */ }
    console.log(`[Voice] STT切替: ${this._stt.name}`);
    if (wasEnabled) setTimeout(() => this.startListening(), 500);
  }

  init() {
    this._ui.init(() => this.toggleListening());
    const meetingMic = document.getElementById('btn-meeting-mic');
    if (meetingMic) meetingMic.addEventListener('click', () => this.toggleListening());
    if (!this._stt.isAvailable()) {
      this._ui.showStatus('このブラウザは音声入力に対応していません', 'error');
      this._ui.disableMic();
      if (meetingMic) { meetingMic.disabled = true; meetingMic.style.opacity = '0.4'; }
      return;
    }
    console.log(`[Voice] 初期化完了（v2.3.0） stt=${this._stt.name} cmd=${!!this._voiceCmd}`);
  }

  toggleListening() {
    if (this._voiceState.isBlockedNeedsTap()) {
      console.log('[Voice] blocked-needs-tap → タップ復帰試行');
      this._resumeSTTAfterTTS();
      return;
    }
    if (this._confirmTimer) {
      console.log('[Voice] 確認中にタップ → キャンセル');
      this._clearAllTimers();
      this._buffer = '';
      this._lastBufferText = '';
      this._forceIdleState();
      this._ui.showStatus('⏹ キャンセルしました', 'info');
      if (this._enabled) setTimeout(() => this.startListening(), 800);
      return;
    }
    if (this._stt.isListening() || this._bufferTimer !== null) {
      this._clearAllTimers();
      const bufText = this._buffer.trim();
      const curText = (this._lastText || '').trim();
      const allText = bufText ? bufText + (curText ? ' ' + curText : '') : curText;
      this._enabled = false;
      this._stt.stop();
      this._buffer = '';
      this._lastBufferText = '';
      this._lastText = '';
      if (allText) {
        this._enabled = true;
        // v2.3.0追加 - マイクタップ即送信時もTTS待ちフラグON
        this._waitingForTTS = true;
        this._sendVoiceMessage(allText);
      } else {
        this._forceIdleState();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      this._playback.stop();
      this._enabled = false;
      this._waitingForTTS = false;
      this._forceIdleState();
    } else {
      this.startListening();
    }
  }

  _forceIdleState() {
    this._waitingForTTS = false;
    this._voiceState.forceReset();
    this._ui.hideSendCountdown();
  }

  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._sttRetryCount = 0;
    this._stt.start({ language: 'ja-JP' });
  }

  stopListening() {
    this._clearAllTimers();
    this._stt.stop();
  }

  /** AI応答を声で再生する */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /** v2.2.3追加 - 吹き出しタップ読み上げ（#77）マイクOFFでも使える */
  async speakBubble(text, sisterId) {
    if (!this._playback) return;
    await this._playback.speak(text, sisterId, { speed: this._speed || 1.25 });
  }

  /** 複数の姉妹の応答を順番に再生 */
  async speakQueue(items) {
    if (!this._enabled) return;
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }
  setSpeed(speed) {
    this._speed = Math.max(0.5, Math.min(1.5, speed));
    if (this._voiceCmd) this._voiceCmd.setSpeed(this._speed);
  }
  setAutoListen(enabled) {
    this._autoListen = !!enabled;
    console.log(`[Voice] ハンズフリー: ${this._autoListen ? 'ON' : 'OFF'}`);
  }
  setDebugVisible(visible) {
    if (this._stt && typeof this._stt.setDebugVisible === 'function') this._stt.setDebugVisible(visible);
  }
  isEnabled() { return this._enabled; }

  destroy() {
    this._enabled = false;
    this._waitingForTTS = false;
    this._clearAllTimers();
    this._buffer = '';
    this._lastBufferText = '';
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
    this._ui.hideSendCountdown();
    if (this._voiceState) this._voiceState.destroy();
  }
  // 送信処理はvoice-sender.js v1.0にmixin分離（VoiceController.prototypeに注入）
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
