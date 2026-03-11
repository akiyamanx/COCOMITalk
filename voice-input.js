// voice-input.js v1.8
// このファイルは音声会話の全体フロー制御を担当する
// マイクボタン→STT→自動送信→TTS再生のフローを管理
// UI操作はvoice-ui.jsのVoiceUIクラスに委譲する

// v1.0 新規作成 - Step 5b 音声会話フロー制御
// v1.1 修正 - 自動送信＋息継ぎ1.5秒待機＋セレクタバグ修正
// v1.2 修正 - STT繰り返し問題対策: finalText優先＋interim蓄積防止
// v1.3 追加 - Step 5c: 会議モード音声入力対応（マイクボタン＋会議入力欄送信）
// v1.5 追加 - Step 5e: 音声コマンド対応（ストップ・姉妹切替・スピード調整）
// v1.7 修正 - コマンド処理を内蔵に戻し確実に動作。部分一致＋正規化強化＋try-catch
// v1.8 修正 - 3バグ全修正: コマンド→VoiceCommand分離 / 送信→VoiceSend分離 / STT即終了リトライ

/** VoiceController - 音声会話の全体フロー制御（マイク→STT→送信→TTS→マイク待機） */
class VoiceController {
  constructor() {
    this._stt = new WebSpeechProvider();
    this._playback = new AudioPlaybackManager();
    this._ui = new VoiceUI();
    this._sender = new VoiceSend(); // v1.8追加: 送信処理モジュール
    // 音声モードが有効か（一度でもマイクを押したらtrue）
    this._enabled = false;
    // 現在の姉妹ID
    this._currentSisterId = 'koko';
    // 音声設定
    this._speed = 1.0;
    this._autoListen = false;
    // 息継ぎ対策: 無音タイマー
    this._silenceTimer = null;
    // v1.5改善: ハンズフリー時は長め（運転中は考えながら話す）
    this._SILENCE_DELAY = 3500;
    this._SILENCE_DELAY_HANDSFREE = 5000;
    // 最後に受け取ったテキスト（タイマー用）
    this._lastText = '';
    // v1.8追加: STT即終了リトライ用
    this._sttStartTime = 0;
    this._sttRetryCount = 0;
    this._STT_MIN_DURATION = 500; // STTが500ms未満で終了したら誤終了と判断
    this._STT_MAX_RETRY = 2;     // リトライは最大2回まで

    this._setupVoiceCommand(); // v1.8: VoiceCommandモジュール初期化
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
          this._ui.showStatus(`🔄 ${name}に切り替えました`, 'success');
          this._forceIdleState();
          if (this._autoListen) setTimeout(() => this.startListening(), 800);
        }
      },
      onSwitchGroup: () => {
        if (typeof window.switchToGroup === 'function') {
          window.switchToGroup();
          this._ui.showStatus('👥 グループモードに切り替えました', 'success');
          this._forceIdleState();
          if (this._autoListen) setTimeout(() => this.startListening(), 800);
        }
      },
      onSpeedChange: (newSpeed) => {
        this._speed = newSpeed;
      },
      onStatus: (msg, type) => {
        this._ui.showStatus(msg, type);
        this._forceIdleState();
      }
    });
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // --- STTコールバック ---
    this._hasFinalText = false;
    this._finalText = '';

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._updateMeetingMicState('listening');
      this._ui.showInterim('🎤 聞いてるよ...');
      this._lastText = '';
      this._finalText = '';
      this._hasFinalText = false;
      this._clearSilenceTimer();
      this._sttStartTime = Date.now(); // v1.8: STT開始時刻を記録
    };

    this._stt.onInterim = (text) => {
      if (this._hasFinalText) return;
      this._ui.showInterim(text);
      this._lastText = text;
      // v1.5追加: interimが来てる=まだ話し中。タイマーリセットして延長
      if (this._silenceTimer) { this._clearSilenceTimer(); this._resetSilenceTimer(); }
    };

    this._stt.onFinal = (text) => {
      if (this._hasFinalText) {
        console.log(`[Voice] final重複無視: "${text}"`);
        return;
      }
      console.log(`[Voice] 確定テキスト: "${text}"`);
      this._finalText = text;
      this._hasFinalText = true;
      this._lastText = text;
      this._ui.showInterim(text);
    };

    this._stt.onEnd = () => {
      // v1.8追加: STT即終了リトライ判定
      const duration = Date.now() - this._sttStartTime;
      const hasText = this._hasFinalText || (this._lastText && this._lastText.trim().length > 0);

      if (duration < this._STT_MIN_DURATION && !hasText && this._sttRetryCount < this._STT_MAX_RETRY) {
        this._sttRetryCount++;
        console.log(`[Voice] STT即終了(${duration}ms) → リトライ ${this._sttRetryCount}/${this._STT_MAX_RETRY}`);
        setTimeout(() => {
          if (this._enabled) {
            this._stt.start({ language: 'ja-JP' });
          }
        }, 300);
        return;
      }
      // リトライカウントをリセット（正常終了 or リトライ上限）
      this._sttRetryCount = 0;

      const text = this._hasFinalText
        ? this._finalText
        : (this._stt.stopAndGetText() || this._lastText);
      console.log(`[Voice] onEnd: hasFinal=${this._hasFinalText} text="${text}" duration=${duration}ms`);

      if (text && text.trim().length > 0) {
        this._lastText = text;
        this._ui.showInterim(text + ' ⏳ 送信中...');
        this._clearSilenceTimer();
        this._resetSilenceTimer();
      } else {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle');
        this._ui.hideInterim();
      }
    };

    this._stt.onError = (error) => {
      this._sttRetryCount = 0; // v1.8: エラー時はリトライカウントをリセット
      this._clearSilenceTimer();
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
      // ハウリング防止 — TTS再生開始時にSTTを強制停止
      if (this._stt.isListening()) {
        this._clearSilenceTimer();
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
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 1200);
      }
    };

    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      if (this._autoListen && this._enabled) {
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
  // 息継ぎ対策タイマー
  // ═══════════════════════════════════════════

  /** 無音タイマーをリセット v1.5改修 - ハンズフリー時は長めに待つ */
  _resetSilenceTimer() {
    this._clearSilenceTimer();
    const text = (this._lastText || '').trim();
    const baseDelay = this._autoListen ? this._SILENCE_DELAY_HANDSFREE : this._SILENCE_DELAY;
    const delay = (text.length < 5) ? baseDelay + 1500 : baseDelay;
    this._silenceTimer = setTimeout(() => {
      this._silenceTimer = null;
      const finalText = this._lastText.trim();
      if (finalText) {
        console.log(`[Voice] ${delay}ms無音 → 自動送信: "${finalText}"`);
        this._stt.stop();
        this._sendVoiceMessage(finalText);
      }
    }, delay);
  }

  /** 無音タイマーをクリア */
  _clearSilenceTimer() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
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
    console.log(`[Voice] 音声モード初期化完了（v1.8） cmd=${!!this._voiceCmd} sender=${!!this._sender}`);
  }

  /** マイクボタン押下時の処理 */
  toggleListening() {
    if (this._stt.isListening() || this._silenceTimer !== null) {
      this._clearSilenceTimer();
      const text = (this._lastText || '').trim();
      this._stt.stop();
      this._lastText = '';
      if (text) {
        this._sendVoiceMessage(text);
      } else {
        this._forceIdleState();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      this._playback.stop();
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
  }

  /** 音声認識を開始 */
  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._sttRetryCount = 0; // v1.8: リトライカウントリセット
    this._clearSilenceTimer();
    this._stt.start({ language: 'ja-JP' });
  }

  /** 音声認識を停止 */
  stopListening() {
    this._clearSilenceTimer();
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
    this._clearSilenceTimer();
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
  }

  // ═══════════════════════════════════════════
  // 送信処理 v1.8改修 — VoiceCommand + VoiceSend に委譲
  // ═══════════════════════════════════════════

  /** 音声メッセージの送信（コマンド判定→送信） */
  _sendVoiceMessage(text) {
    try {
      // ★デバッグ: タブタイトルで確認（原因特定後に削除）
      document.title = `CMD: "${text}" vc=${!!this._voiceCmd}`;

      // 音声コマンドチェック
      if (this._voiceCmd && this._voiceCmd.handle(text)) return;

      // 通常メッセージ送信
      this._ui.hideInterim();
      this._lastText = '';

      this._sender.send(text, {
        onComplete: () => {
          this._ui.updateMicState('idle');
          this._updateMeetingMicState('idle');
        },
        onError: (msg) => {
          console.error('[Voice] 送信エラー:', msg);
          this._forceIdleState();
          this._ui.showStatus(msg, 'error');
        }
      });
    } catch (e) {
      console.error('[Voice] _sendVoiceMessage エラー:', e);
      this._forceIdleState();
      this._ui.showStatus('送信エラーが発生しました', 'error');
    }
  }

  /** 会議マイクボタンのUI状態を同期更新 */
  _updateMeetingMicState(state) {
    const btn = document.getElementById('btn-meeting-mic');
    if (!btn) return;
    const styles = {
      idle:      { bg: 'white', border: 'var(--active-primary,#6c5ce7)', icon: '🎤' },
      listening: { bg: '#e74c3c', border: '#e74c3c', icon: '🎤' },
      speaking:  { bg: 'var(--active-primary,#6c5ce7)', border: 'var(--active-primary,#6c5ce7)', icon: '🔊' },
      error:     { bg: '#e74c3c', border: '#e74c3c', icon: '⚠️' },
    };
    const s = styles[state] || styles.idle;
    btn.style.background = s.bg;
    btn.style.borderColor = s.border;
    btn.innerHTML = s.icon;
    btn.style.animation = state === 'listening'
      ? 'cocomi-mic-pulse 1s ease-in-out infinite' : 'none';
  }
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
