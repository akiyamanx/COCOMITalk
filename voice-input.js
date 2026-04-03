// voice-input.js v2.4.1
// 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS）
// UI→voice-ui.js / 送信→voice-sender.js（mixin） / 状態→voice-state.js
// v2.0〜v2.3.0: 履歴省略（バッファ方式/TTS待機フラグ/voice-state連携/吹き出し読み上げ）
// v2.4.0 修正 - speakQueueマイク復帰バグ修正（onSisterChange/フェイルセーフ/ガード緩和）
// v2.4.1 修正 - pause済みWhisperのhealthCheckスキップ（recorder=inactive誤判定回避）

class VoiceController {
  constructor() {
    this._voiceState = window.voiceState;
    this._stt = this._createSTTProvider();
    this._playback = new AudioPlaybackManager();
    this._ui = new VoiceUI();
    this._enabled = false;
    this._currentSisterId = 'koko';
    this._speed = 1.25;
    this._autoListen = false;
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
    this._waitingForTTS = false;
    this._recoverySafetyTimer = null;

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

    // onEnd: STT終了 → バッファ追記→再開 or 送信
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

    // onPlayStart: TTS再生開始 → speaking遷移＋STT停止
    this._playback.onPlayStart = (sisterId) => {
      this._waitingForTTS = false;
      this._clearRecoverySafetyTimer();
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

    // v2.4.0追加 - キュー中の姉妹切替（アイコン発光のみ）
    this._playback.onSisterChange = (sisterId) => {
      ['koko', 'gpt', 'claude'].forEach(id => this._ui.highlightSister(id, false));
      this._ui.highlightSister(sisterId, true);
    };

    // onPlayEnd: 単発TTS完了 → recovering_input遷移＋STT復帰
    this._playback.onPlayEnd = (sisterId) => {
      this._waitingForTTS = false;
      this._ui.highlightSister(sisterId, false);
      this._voiceState.transition('recovering_input');
      if (this._enabled) this._resumeSTTAfterTTS();
    };

    // onQueueEnd: キュー全完了 → フラグクリア＋全姉妹消灯＋フェイルセーフ付き復帰
    this._playback.onQueueEnd = () => {
      this._waitingForTTS = false;
      ['koko', 'gpt', 'claude'].forEach(id => this._ui.highlightSister(id, false));
      this._voiceState.transition('recovering_input');
      if (this._enabled) {
        this._resumeSTTAfterTTS();
        this._startRecoverySafetyTimer();
      }
    };

    // onPlayError: TTS生成/再生エラー → idle復帰
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

  // v2.4.1修正 - pause済みWhisperはhealthCheckスキップ（recorder=inactiveは正常）
  async _resumeSTTAfterTTS() {
    await new Promise(r => setTimeout(r, 1500));
    if (this._waitingForTTS || this._voiceState.isSpeaking() || this._playback.isQueuePlaying()) {
      console.log(`[Voice] _resumeSTTAfterTTS: 復帰中止 (waitTTS=${this._waitingForTTS}, speaking=${this._voiceState.isSpeaking()}, queue=${this._playback.isQueuePlaying()})`);
      return;
    }
    // v2.4.1変更: Whisperがpause済みの場合、resume()が自前で録音再開するのでhealthCheckは不要。
    // healthCheckはpause/resume機能を持たないWebSpeechProvider用、またはWhisperのstreamが完全に死んだ場合のみ必要。
    if (this._stt instanceof WhisperProvider) {
      // Whisperはresume()で自力復帰する。streamが死んでるかだけ簡易チェック。
      const track = this._stt._stream?.getTracks()?.[0];
      if (!track || track.readyState !== 'live') {
        console.log('[Voice] Whisper stream死亡 → startListeningでフル再起動');
        this._voiceState.transition('listening');
        this.startListening();
        return;
      }
      if (this._waitingForTTS || this._voiceState.isSpeaking()) { return; }
      this._voiceState.transition('listening');
      this._stt.resume();
      return;
    }
    // WebSpeechProvider等: startListeningフロー
    this._voiceState.transition('listening');
    this.startListening();
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
      if (s.sttProvider === 'whisper' && typeof WhisperProvider !== 'undefined') return new WhisperProvider();
    } catch (e) { /* ignore */ }
    return new WebSpeechProvider();
  }

  switchSTTProvider(providerName) {
    const wasEnabled = this._enabled;
    if (wasEnabled) this.stopListening();
    this._stt = providerName === 'whisper' && typeof WhisperProvider !== 'undefined'
      ? new WhisperProvider() : new WebSpeechProvider();
    this._setupCallbacks();
    try { const s = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}'); if (s.sttDebug) this._stt.setDebugVisible(true); } catch (e) {}
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
    console.log(`[Voice] 初期化完了（v2.4.1） stt=${this._stt.name} cmd=${!!this._voiceCmd}`);
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
    this._clearRecoverySafetyTimer();
    this._voiceState.forceReset();
    this._ui.hideSendCountdown();
  }

  // v2.4.0追加 - recovering_input 7秒超過で強制STT復帰
  _startRecoverySafetyTimer() {
    this._clearRecoverySafetyTimer();
    this._recoverySafetyTimer = setTimeout(() => {
      this._recoverySafetyTimer = null;
      if (this._voiceState.isRecovering() && this._enabled) {
        console.warn('[Voice] フェイルセーフ発動: recovering 7秒超過 → 強制STT再開');
        this._waitingForTTS = false;
        ['koko', 'gpt', 'claude'].forEach(id => this._ui.highlightSister(id, false));
        this._voiceState.forceReset();
        this._voiceState.transition('listening');
        this.startListening();
      }
    }, 7000);
  }

  _clearRecoverySafetyTimer() {
    if (this._recoverySafetyTimer) { clearTimeout(this._recoverySafetyTimer); this._recoverySafetyTimer = null; }
  }

  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._sttRetryCount = 0;
    this._stt.start({ language: 'ja-JP' });
  }

  stopListening() { this._clearAllTimers(); this._stt.stop(); }

  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  async speakBubble(text, sisterId) {
    if (!this._playback) return;
    await this._playback.speak(text, sisterId, { speed: this._speed || 1.25 });
  }

  async speakQueue(items) {
    if (!this._enabled) return;
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }
  setSpeed(speed) { this._speed = Math.max(0.5, Math.min(1.5, speed)); if (this._voiceCmd) this._voiceCmd.setSpeed(this._speed); }
  setAutoListen(enabled) { this._autoListen = !!enabled; }
  setDebugVisible(visible) { if (this._stt && typeof this._stt.setDebugVisible === 'function') this._stt.setDebugVisible(visible); }
  isEnabled() { return this._enabled; }

  destroy() {
    this._enabled = false;
    this._waitingForTTS = false;
    this._clearAllTimers();
    this._clearRecoverySafetyTimer();
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
