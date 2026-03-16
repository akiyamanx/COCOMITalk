// voice-input.js v2.1
// 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS）
// UI→voice-ui.js / 送信→voice-sender.js（mixin）
// v2.0 方針F: バッファ蓄積＋2.5秒待機＋ノイズフィルタ＋確認アニメ
// v2.1 改修: continuous:true対応（STT再スタート不要→ピコン音は起動時の1回だけ）

/** VoiceController - 音声会話の全体フロー制御（マイク→STT→バッファ→確認→送信→TTS） */
class VoiceController {
  constructor() {
    this._stt = new WebSpeechProvider();
    this._playback = new AudioPlaybackManager();
    this._ui = new VoiceUI();
    // 音声モードが有効か（一度でもマイクを押したらtrue）
    this._enabled = false;
    // 現在の姉妹ID
    this._currentSisterId = 'koko';
    // 音声設定
    this._speed = 1.25;
    this._autoListen = false;
    // v2.0: バッファ方式 — STTのonEndで即送信せずバッファに蓄積
    this._buffer = '';           // 蓄積中のテキスト
    this._bufferTimer = null;    // バッファ送信タイマー
    this._confirmTimer = null;   // 確認アニメタイマー
    this._lastBufferText = '';   // ノイズフィルタ: 直前のバッファ追加テキスト
    this._BUFFER_DELAY = 2500;   // 新テキストが来なければ送信までの待機（2.5秒）
    this._CONFIRM_DELAY = 500;   // 確認アニメ表示時間（0.5秒）
    // v2.0: ノイズフィルタ設定
    this._NOISE_MIN_LENGTH = 2;  // これ以下の文字数は無視（ピコン「あ」「ん」対策）
    // 最後に受け取ったテキスト（interim表示用）
    this._lastText = '';
    this._sttStartTime = 0;

    this._setupVoiceCommand();
    this._setupCallbacks();
  }

  // ═══════════════════════════════════════════
  // v1.8 VoiceCommandモジュール初期化
  // ═══════════════════════════════════════════

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
    // --- STTコールバック（v2.1: continuous:true対応） ---

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._updateMeetingMicState('listening');
      if (this._buffer) {
        this._ui.showInterim(this._buffer + ' 🎤...');
      } else {
        this._ui.showInterim('🎤 聞いてるよ...');
      }
      this._lastText = '';
      this._sttStartTime = Date.now();
    };

    this._stt.onInterim = (text) => {
      // v2.1: continuous:trueではinterimが常に来る。バッファ＋interimを表示
      const display = this._buffer ? this._buffer + ' ' + text : text;
      this._ui.showInterim(display);
      this._lastText = text;
      // interimが来てる=まだ話し中。バッファタイマーをリセット
      if (this._bufferTimer) this._resetBufferTimer();
    };

    // v2.1: continuous:trueではonFinalが発話区切りごとに来る（核心部分）
    this._stt.onFinal = (text) => {
      console.log(`[Voice] 確定テキスト: "${text}"`);
      // ノイズフィルタ
      if (this._isNoise(text.trim())) {
        console.log(`[Voice] ノイズフィルタ除外: "${text.trim()}"`);
        return;
      }
      // バッファに追記＋タイマーリセット
      this._appendBuffer(text.trim());
    };

    // v2.1: continuous:trueではonEndは明示的stop()時のみ発火
    this._stt.onEnd = () => {
      console.log(`[Voice] onEnd: buf="${this._buffer}" enabled=${this._enabled}`);
      // バッファにテキストがあれば送信タイマーは既に動いてるのでそのまま
      if (!this._buffer && !this._bufferTimer) {
        if (this._enabled) {
          // v2.1: 予期せぬSTT終了（ネットワーク切断等）→ 再スタート
          console.log('[Voice] 予期せぬSTT終了 → 再スタート');
          this._ui.showInterim('🎤 話しかけてね...');
          setTimeout(() => {
            if (this._enabled && !this._playback.isPlaying() && !this._playback.isQueuePlaying()) {
              this._stt.start({ language: 'ja-JP' });
            }
          }, 500);
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
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
      this._updateMeetingMicState('speaking');
      // ハウリング防止 — TTS再生開始時にSTTとバッファタイマーを強制停止
      if (this._stt.isListening()) {
        this._clearAllTimers();
        this._stt.stop();
        this._lastText = '';
        console.log('[Voice] ハウリング防止: TTS再生中にSTT停止');
      }
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      if (this._playback.isQueuePlaying()) return;
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      // v2.0: TTS終了後は常にSTT自動リスタート（ハンズフリー体験）
      if (this._enabled) {
        setTimeout(() => this.startListening(), 1200);
      }
    };

    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      // v2.0: キュー全終了後もSTT自動リスタート
      if (this._enabled) {
        setTimeout(() => this.startListening(), 1200);
      }
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

  // ═══════════════════════════════════════════
  // v2.0: バッファ方式＋ノイズフィルタ＋確認送信
  // ═══════════════════════════════════════════

  /** バッファにテキストを追記＋バッファタイマーをリセット */
  _appendBuffer(text) {
    this._buffer = this._buffer ? this._buffer + ' ' + text : text;
    this._lastBufferText = text;
    this._ui.showInterim(this._buffer + ' 🎤...');
    console.log(`[Voice] バッファ追記: "${text}" → 全体: "${this._buffer}"`);
    this._resetBufferTimer();
  }

  /** バッファタイマーをリセット（2.5秒後に確認→送信） */
  _resetBufferTimer() {
    if (this._bufferTimer) { clearTimeout(this._bufferTimer); this._bufferTimer = null; }
    this._bufferTimer = setTimeout(() => {
      this._bufferTimer = null;
      if (!this._buffer) return;
      // STTが動いてたら止める
      if (this._stt.isListening()) this._stt.stop();
      console.log(`[Voice] ${this._BUFFER_DELAY}ms無音 → 確認アニメ開始: "${this._buffer}"`);
      this._startConfirmAndSend();
    }, this._BUFFER_DELAY);
  }

  /** 確認アニメ（0.5秒光る）→ 送信 */
  _startConfirmAndSend() {
    const text = this._buffer.trim();
    if (!text) return;
    // v2.1: 送信前にSTTを停止（送信中に新テキストが入るのを防ぐ）
    if (this._stt.isListening()) this._stt.stop();
    // 確認アニメ表示
    this._ui.showSendCountdown(text);
    this._confirmTimer = setTimeout(() => {
      this._confirmTimer = null;
      this._ui.hideSendCountdown();
      // バッファクリアして送信
      const sendText = this._buffer.trim();
      this._buffer = '';
      this._lastBufferText = '';
      this._lastText = '';
      if (sendText) {
        console.log(`[Voice] 確認完了 → 送信: "${sendText}"`);
        this._sendVoiceMessage(sendText);
      }
    }, this._CONFIRM_DELAY);
  }

  /** v2.0: ノイズフィルタ — ピコン音のテキスト誤認識を除外 */
  _isNoise(text) {
    // 2文字以下は無視（ピコン「あ」「ん」「は」等）
    if (text.length <= this._NOISE_MIN_LENGTH) {
      console.log(`[Voice] ノイズ判定: "${text}" (${text.length}文字≦${this._NOISE_MIN_LENGTH})`);
      return true;
    }
    // 直前のバッファ追加テキストと完全一致は無視（ピコン繰り返し対策）
    if (this._lastBufferText && text === this._lastBufferText) {
      console.log(`[Voice] ノイズ判定: 直前と同じ "${text}"`);
      return true;
    }
    return false;
  }

  /** 全タイマーをクリア */
  _clearAllTimers() {
    if (this._bufferTimer) { clearTimeout(this._bufferTimer); this._bufferTimer = null; }
    if (this._confirmTimer) { clearTimeout(this._confirmTimer); this._confirmTimer = null; }
    this._ui.hideSendCountdown();
  }

  // ═══════════════════════════════════════════
  // 公開API
  // ═══════════════════════════════════════════

  /** 音声モードを初期化（app.jsの初期化時に呼ぶ） */
  init() {
    this._ui.init(() => this.toggleListening());

    const meetingMic = document.getElementById('btn-meeting-mic');
    if (meetingMic) {
      meetingMic.addEventListener('click', () => this.toggleListening());
    }

    if (!this._stt.isAvailable()) {
      this._ui.showStatus('このブラウザは音声入力に対応していません', 'error');
      this._ui.disableMic();
      if (meetingMic) { meetingMic.disabled = true; meetingMic.style.opacity = '0.4'; }
      return;
    }

    if (!this._playback._ttsProvider.isAvailable()) {
      console.warn('[Voice] TTS未設定（Worker URL/認証トークンが必要）');
    }
    console.log(`[Voice] 音声モード初期化完了（v2.1 continuous:true） cmd=${!!this._voiceCmd}`);
  }

  /** マイクボタン押下時の処理 v2.0対応 */
  toggleListening() {
    // v2.0: 確認アニメ中にタップ → キャンセル
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

  /** 全マイクUIを確実にidle状態に戻す */
  _forceIdleState() {
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
    this._ui.hideInterim();
    this._ui.hideSendCountdown();
  }

  /** 音声認識を開始 v2.0: バッファクリアはしない（継続蓄積を許可） */
  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._sttRetryCount = 0;
    this._stt.start({ language: 'ja-JP' });
  }

  /** 音声認識を停止 */
  stopListening() {
    this._clearAllTimers();
    this._stt.stop();
  }

  /** AI応答を声で再生する */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /** 複数の姉妹の応答を順番に再生 */
  async speakQueue(items) {
    if (!this._enabled) return;
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

  /** 音声モードを完全停止 */
  destroy() {
    this._enabled = false;
    this._clearAllTimers();
    this._buffer = '';
    this._lastBufferText = '';
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
    this._ui.hideSendCountdown();
  }

  // ═══════════════════════════════════════════
  // 送信処理はvoice-sender.js v1.0にmixin分離
  // VoiceController.prototypeに_sendVoiceMessage等を注入
  // ═══════════════════════════════════════════
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
