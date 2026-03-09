// voice-input.js v1.0
// このファイルは音声会話の全体フロー制御を担当する
// マイクボタン→STT→送信→TTS再生の8ステップフローを管理
// UI操作はvoice-ui.jsのVoiceUIクラスに委譲する
// speech-provider.js + voice-output.js + voice-ui.js と連携

// v1.0 新規作成 - Step 5b 音声会話フロー制御

/**
 * VoiceController
 * 音声会話の全体フロー制御
 *
 * 8ステップフロー（実行計画書 Step 5b準拠）:
 * ① マイクボタン押す → 🎤赤く光る
 * ② 話し始める → Web Speech API interim表示
 * ③ 話し終わる → テキスト確定
 * ④ テキスト送信 → 「考えてる...」表示
 * ⑤ AI応答テキスト着信 → テキスト表示
 * ⑥ TTS変換 → Worker経由OpenAI TTS
 * ⑦ 音声再生 → キャラアイコン発光
 * ⑧ 再生完了 → マイクボタン待機状態
 */
class VoiceController {
  constructor() {
    // STTプロバイダー
    this._stt = new WebSpeechProvider();
    // TTS再生管理
    this._playback = new AudioPlaybackManager();
    // UI制御
    this._ui = new VoiceUI();
    // 音声モードが有効か
    this._enabled = false;
    // 確認待ち状態か（送信猶予UI — お姉ちゃん提案）
    this._confirmPending = false;
    this._pendingText = '';
    // 現在の姉妹ID（1対1チャット用）
    this._currentSisterId = 'koko';
    // 音声設定
    this._speed = 1.0;
    this._autoListen = false; // 再生完了後に自動マイク再開（将来のハンズフリー用）

    this._setupCallbacks();
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // STTコールバック
    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._ui.showInterim('');
    };

    this._stt.onInterim = (text) => {
      this._ui.showInterim(text);
    };

    this._stt.onFinal = (text) => {
      console.log(`[Voice] 確定テキスト: "${text}"`);
    };

    this._stt.onEnd = () => {
      const text = this._stt.stopAndGetText();
      if (text && text.trim().length > 0) {
        this._showConfirmUI(text);
      } else {
        this._ui.updateMicState('idle');
        this._ui.hideInterim();
      }
    };

    this._stt.onError = (error) => {
      this._ui.updateMicState('error');
      this._ui.showStatus(error, 'error');
      setTimeout(() => this._ui.updateMicState('idle'), 2000);
    };

    // TTS再生コールバック
    this._playback.onPlayStart = (sisterId) => {
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      this._ui.updateMicState('idle');
      // 自動リスニング（ハンズフリー用 — 将来拡張）
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 500);
      }
    };

    this._playback.onPlayError = (error, sisterId) => {
      this._ui.highlightSister(sisterId, false);
      this._ui.showStatus(error, 'error');
      this._ui.updateMicState('idle');
    };
  }

  // ═══════════════════════════════════════════
  // 公開API
  // ═══════════════════════════════════════════

  /**
   * 音声モードを初期化（DOM要素のバインド）
   * app.jsの初期化時に呼ぶ
   */
  init() {
    this._ui.init(() => this.toggleListening());

    if (!this._stt.isAvailable()) {
      this._ui.showStatus('このブラウザは音声入力に対応していません', 'error');
      this._ui.disableMic();
      return;
    }

    if (!this._playback._ttsProvider.isAvailable()) {
      console.warn('[Voice] TTS未設定（Worker URL/認証トークンが必要）');
    }

    console.log('[Voice] 音声モード初期化完了');
  }

  /**
   * マイクボタン押下時の処理
   */
  toggleListening() {
    if (this._stt.isListening()) {
      this.stopListening();
    } else if (this._playback.isPlaying()) {
      this._playback.stop();
      this._ui.updateMicState('idle');
    } else if (this._confirmPending) {
      this._cancelConfirm();
    } else {
      this.startListening();
    }
  }

  /**
   * 音声認識を開始
   */
  startListening() {
    this._enabled = true;
    this._stt.start({ language: 'ja-JP' });
  }

  /**
   * 音声認識を停止
   */
  stopListening() {
    this._stt.stop();
  }

  /**
   * AI応答を声で再生する
   * チャット送信後にapp.jsから呼ぶ
   * @param {string} responseText - AI応答テキスト
   * @param {string} sisterId - 'gemini' | 'openai' | 'claude'
   */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;

    await this._playback.speak(responseText, sisterId, {
      speed: this._speed
    });
  }

  /**
   * 現在の姉妹IDを設定（モード切り替え時）
   */
  setCurrentSister(sisterId) {
    this._currentSisterId = sisterId;
  }

  /**
   * 音声速度を設定
   * @param {number} speed - 0.75〜1.25
   */
  setSpeed(speed) {
    this._speed = Math.max(0.75, Math.min(1.25, speed));
  }

  /**
   * 音声モードが有効かどうか
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * 音声モードを完全停止
   */
  destroy() {
    this._enabled = false;
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
    this._ui.hideConfirm();
  }

  // ═══════════════════════════════════════════
  // 内部メソッド
  // ═══════════════════════════════════════════

  /**
   * 送信確認UIを表示（お姉ちゃん提案の送信猶予UI）
   */
  _showConfirmUI(text) {
    this._confirmPending = true;
    this._pendingText = text;

    this._ui.showConfirm(
      text,
      () => this._sendVoiceMessage(text),
      () => this._cancelConfirm(),
      () => {
        this._cancelConfirm();
        this.startListening();
      }
    );

    this._ui.updateMicState('idle');
  }

  /**
   * 送信確認をキャンセル
   */
  _cancelConfirm() {
    this._confirmPending = false;
    this._pendingText = '';
    this._ui.hideConfirm();
    this._ui.updateMicState('idle');
  }

  /**
   * 音声メッセージを送信（既存のチャット送信フローに合流）
   */
  _sendVoiceMessage(text) {
    this._confirmPending = false;
    this._ui.hideConfirm();

    // 既存のチャット入力欄にテキストをセットして送信
    const input = document.querySelector('#chat-input')
      || document.querySelector('.chat-input')
      || document.querySelector('textarea');

    if (input) {
      input.value = text;
      const sendBtn = document.querySelector('#send-btn')
        || document.querySelector('.send-btn')
        || document.querySelector('button[type="submit"]');
      if (sendBtn) {
        sendBtn.click();
      } else {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', bubbles: true
        });
        input.dispatchEvent(event);
      }
    }

    this._ui.updateMicState('idle');
  }
}

// グローバルに公開
window.VoiceController = VoiceController;

// シングルトンインスタンス（app.jsから参照用）
window.voiceController = null;
