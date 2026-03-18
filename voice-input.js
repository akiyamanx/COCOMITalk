// voice-input.js v2.1
// 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS）
// UI→voice-ui.js / 送信→voice-sender.js（mixin）
// v2.0 方針F: バッファ蓄積＋2.5秒待機＋ノイズフィルタ＋確認アニメ
// v2.1 修正 - TTS途中切れバグ修正（TTS待機フラグ＋STT再開抑制）

/** VoiceController - 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS） */
class VoiceController {
  constructor() {
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
    this._BUFFER_DELAY = 3500;   // v2.0: 3.5秒待機（息継ぎ吸収）
    this._CONFIRM_DELAY = 500;
    this._NOISE_MIN_LENGTH = 2;
    this._lastText = '';
    this._sttStartTime = 0;
    this._sttRetryCount = 0;
    this._STT_MIN_DURATION = 500;
    this._STT_MAX_RETRY = 2;
    // v2.1追加 - TTS待機フラグ（送信→TTS開始の間STTを抑制）
    this._waitingForTTS = false;
    this._waitingForTTSTimer = null;

    this._setupVoiceCommand();
    this._setupCallbacks();
  }

  // v1.8 VoiceCommandモジュール初期化
  _setupVoiceCommand() {
    if (typeof VoiceCommand === 'undefined') {
      console.warn('[Voice] VoiceCommandが未定義 — 音声コマンド無効');
      this._voiceCmd = null;
      return;
    }
    this._voiceCmd = new VoiceCommand({
      onStop: () => {
        this._playback.stop();
        this._enabled = false; // v1.8.3: ストップだけは明示的停止
        this._forceIdleState();
      },
      onResume: () => {
        this._forceIdleState();
        setTimeout(() => this.startListening(), 500);
      },
      onSwitchSister: (key, name) => {
        if (typeof window.switchToSister === 'function') {
          window.switchToSister(key);
          this._currentSisterId = key;
          // v1.9.2修正: _forceIdleState→showStatusの順（hideInterimで消される対策）
          this._forceIdleState();
          this._ui.showStatus(`🔄 ${name}に切り替えました`, 'success');
          if (this._enabled) setTimeout(() => this.startListening(), 800);
        }
      },
      onSwitchGroup: () => {
        if (typeof window.switchToGroup === 'function') {
          window.switchToGroup();
          this._forceIdleState();
          this._ui.showStatus('👥 グループモードに切り替えました', 'success');
          if (this._enabled) setTimeout(() => this.startListening(), 800);
        }
      },
      onSpeedChange: (newSpeed) => {
        this._speed = newSpeed;
        if (this._enabled) setTimeout(() => this.startListening(), 500);
      },
      onStatus: (msg, type) => {
        this._forceIdleState();
        this._ui.showStatus(msg, type);
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      },
      // v1.9.1追加: 「覚えて」コマンドでチャット記憶を手動保存
      onSaveMemory: () => {
        this._forceIdleState();
        if (typeof ChatMemory !== 'undefined' && typeof ChatCore !== 'undefined') {
          const ctx = ChatCore.getGroupContext();
          const history = ctx.chatHistories[ctx.currentSister];
          ChatMemory.manualSave(ctx.currentSister, history);
          this._ui.showStatus('💾 覚えたよ！', 'success');
        } else {
          this._ui.showStatus('💾 記憶機能が未準備です', 'warning');
        }
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      },
      // v2.0追加: キャンセルコマンドでバッファもクリア
      onCancel: () => {
        this._clearAllTimers();
        this._buffer = '';
        this._lastBufferText = '';
        this._ui.hideConfirm();
        this._forceIdleState();
        this._ui.showStatus('⏹ キャンセルしました', 'info');
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      }
    });
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // --- STTコールバック（v2.0: バッファ方式） ---
    this._hasFinalText = false;
    this._finalText = '';

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._updateMeetingMicState('listening');
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
      // 表示用マーカー（🎤）は_lastTextに入れない（送信防止）
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
      // v2.1 - WhisperはonEnd不要、onFinalで直接バッファ蓄積
      if (this._stt instanceof WhisperProvider) {
        if (text.trim() && !this._isNoise(text.trim())) this._appendBuffer(text.trim());
      }
    };

    this._stt.onEnd = () => {
      if (this._waitingForTTS || this._playback.isPlaying() || this._playback.isQueuePlaying()) return;
      const duration = Date.now() - this._sttStartTime;
      const hasText = this._hasFinalText || (this._lastText && this._lastText.trim().length > 0);

      if (duration < this._STT_MIN_DURATION && !hasText && this._sttRetryCount < this._STT_MAX_RETRY) {
        this._sttRetryCount++;
        console.log(`[Voice] STT即終了(${duration}ms) → リトライ ${this._sttRetryCount}/${this._STT_MAX_RETRY}`);
        setTimeout(() => {
          if (this._enabled) this._stt.start({ language: 'ja-JP' });
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
          console.log('[Voice] 無音終了 → 自動リスタート待機');
          this._ui.showInterim('🎤 話しかけてね...');
          this._restartSTT();
        } else {
          this._ui.updateMicState('idle');
          this._updateMeetingMicState('idle');
          this._ui.hideInterim();
        }
      }
    };

    this._stt.onError = (error) => {
      this._sttRetryCount = 0;
      this._clearAllTimers();
      this._ui.updateMicState('error');
      this._updateMeetingMicState('error');
      this._ui.showStatus(error, 'error');
      setTimeout(() => {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle');
      }, 2000);
    };

    // --- TTS再生コールバック ---
    this._playback.onPlayStart = (sisterId) => {
      this._clearWaitingForTTS();
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
      this._updateMeetingMicState('speaking');
      if (this._stt.isListening()) {
        this._clearAllTimers();
        if (typeof this._stt.pause === 'function') { this._stt.pause(); }
        else { this._stt.stop(); }
        this._lastText = '';
      }
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      if (this._playback.isQueuePlaying()) return;
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      if (this._enabled) this._resumeSTTAfterTTS();
    };

    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      if (this._enabled) this._resumeSTTAfterTTS();
    };

    this._playback.onPlayError = (error, sisterId) => {
      this._ui.highlightSister(sisterId, false);
      this._ui.showStatus(error, 'error');
      this._ui.updateMicState('idle');
    };

    // TTSフォールバック通知
    this._playback.onFallback = (message) => {
      this._ui.showStatus(message, 'info');
    };
  }

  // v2.0: バッファ方式＋ノイズフィルタ＋確認送信
  _appendBuffer(text) {
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
        // v2.1追加 - 送信→TTS開始までSTT再開を抑制
        this._setWaitingForTTS();
        this._sendVoiceMessage(sendText);
      }
    }, this._CONFIRM_DELAY);
  }

  _isNoise(text) {
    if (text.length <= this._NOISE_MIN_LENGTH) {
      console.log(`[Voice] ノイズ判定: "${text}" (${text.length}文字≦${this._NOISE_MIN_LENGTH})`);
      return true;
    }
    if (this._lastBufferText && text === this._lastBufferText) {
      console.log(`[Voice] ノイズ判定: 直前と同じ "${text}"`);
      return true;
    }
    return false;
  }

  _restartSTT() {
    setTimeout(() => {
      if (this._enabled && !this._waitingForTTS && !this._playback.isPlaying() && !this._playback.isQueuePlaying()) {
        this._stt.start({ language: 'ja-JP' });
      }
    }, 400);
  }

  // v2.1追加 - TTS待機フラグON（15秒安全タイムアウト付き）
  _setWaitingForTTS() {
    this._waitingForTTS = true;
    if (this._waitingForTTSTimer) clearTimeout(this._waitingForTTSTimer);
    this._waitingForTTSTimer = setTimeout(() => {
      if (this._waitingForTTS) {
        console.log('[Voice] TTS待機タイムアウト（15秒）→ フラグ解除');
        this._waitingForTTS = false;
        if (this._enabled) this.startListening();
      }
    }, 15000);
  }

  // v2.1追加 - TTS待機フラグ＋タイマーをクリア
  _clearWaitingForTTS() {
    this._waitingForTTS = false;
    if (this._waitingForTTSTimer) { clearTimeout(this._waitingForTTSTimer); this._waitingForTTSTimer = null; }
  }

  // v2.1 - TTS再生完了後にSTTを再開（Whisper=resume / WebSpeech=start）
  _resumeSTTAfterTTS() {
    setTimeout(() => {
      if (typeof this._stt.resume === 'function') { this._stt.resume(); }
      else { this.startListening(); }
    }, 1200);
  }

  _clearAllTimers() {
    if (this._bufferTimer) { clearTimeout(this._bufferTimer); this._bufferTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    this._ui.hideSendCountdown();
  }

  // 公開API

  // v2.1追加 - STTプロバイダーを設定から生成
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

  /** STTプロバイダーを切り替える（設定画面から呼ばれる） */
  switchSTTProvider(providerName) {
    const wasEnabled = this._enabled;
    if (wasEnabled) this.stopListening();
    this._stt = providerName === 'whisper' && typeof WhisperProvider !== 'undefined'
      ? new WhisperProvider() : new WebSpeechProvider();
    this._setupCallbacks();
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
    console.log(`[Voice] 初期化完了（v2.1） stt=${this._stt.name} cmd=${!!this._voiceCmd}`);
  }

  toggleListening() {
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
        // v2.1追加 - 即送信時もTTS待機フラグON
        this._setWaitingForTTS();
        this._sendVoiceMessage(allText);
      } else {
        this._forceIdleState();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      this._playback.stop();
      this._enabled = false;
      this._forceIdleState();
    } else {
      this.startListening();
    }
  }

  _forceIdleState() {
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
    this._ui.hideInterim();
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
    this._clearWaitingForTTS();
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /** 複数の姉妹の応答を順番に再生 */
  async speakQueue(items) {
    if (!this._enabled) return;
    this._clearWaitingForTTS();
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  /** 現在の姉妹IDを設定 */
  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }

  /** 音声速度を設定（0.5〜1.5） */
  setSpeed(speed) {
    this._speed = Math.max(0.5, Math.min(1.5, speed));
    if (this._voiceCmd) this._voiceCmd.setSpeed(this._speed);
  }

  /** ハンズフリーモード切替 */
  setAutoListen(enabled) {
    this._autoListen = !!enabled;
    console.log(`[Voice] ハンズフリー: ${this._autoListen ? 'ON' : 'OFF'}`);
  }

  /** STTデバッグパネル表示切替 */
  setDebugVisible(visible) {
    if (this._stt && typeof this._stt.setDebugVisible === 'function') {
      this._stt.setDebugVisible(visible);
    }
  }

  /** 音声モードが有効かどうか */
  isEnabled() { return this._enabled; }

  destroy() {
    this._enabled = false;
    this._clearAllTimers();
    this._clearWaitingForTTS();
    this._buffer = '';
    this._lastBufferText = '';
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
    this._ui.hideSendCountdown();
  }

  // 送信処理はvoice-sender.js v1.0にmixin分離（VoiceController.prototypeに注入）
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
