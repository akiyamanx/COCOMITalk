// voice-input.js v1.2
// このファイルは音声会話の全体フロー制御を担当する
// マイクボタン→STT→自動送信→TTS再生のフローを管理
// UI操作はvoice-ui.jsのVoiceUIクラスに委譲する

// v1.0 新規作成 - Step 5b 音声会話フロー制御
// v1.1 修正 - 自動送信＋息継ぎ1.5秒待機＋セレクタバグ修正
// v1.2 修正 - STT繰り返し問題対策: finalText優先＋interim蓄積防止

/**
 * VoiceController
 * 音声会話の全体フロー制御
 *
 * フロー:
 * ① マイクボタン押す → 🎤赤く光る
 * ② 話し始める → リアルタイムで途中テキスト表示
 * ③ 話し終わる → 1.5秒待ってから自動送信（息継ぎで切れない）
 * ④ AI応答テキスト着信 → テキスト表示
 * ⑤ TTS変換＋音声再生 → キャラアイコン発光
 * ⑥ 再生完了 → マイクボタン待機状態
 */
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
    this._speed = 1.0;
    this._autoListen = false;
    // 息継ぎ対策: 無音タイマー（1.5秒待ってから送信）
    this._silenceTimer = null;
    this._SILENCE_DELAY = 1500; // ミリ秒
    // 最後に受け取ったテキスト（タイマー用）
    this._lastText = '';

    this._setupCallbacks();
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // --- STTコールバック ---
    // v1.2追加 - finalテキストを確定済みフラグで管理
    this._hasFinalText = false;
    this._finalText = '';

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._ui.showInterim('🎤 聞いてるよ...');
      this._lastText = '';
      this._finalText = '';
      this._hasFinalText = false;
      this._clearSilenceTimer();
    };

    this._stt.onInterim = (text) => {
      // v1.2: finalが来た後のinterimは無視（モバイル二重発火対策）
      if (this._hasFinalText) return;
      this._ui.showInterim(text);
      this._lastText = text;
    };

    this._stt.onFinal = (text) => {
      // v1.2: finalは1回だけ採用。2回目以降は無視
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
      // v1.2: finalTextを最優先、なければlastText（interim）をフォールバック
      const text = this._hasFinalText
        ? this._finalText
        : (this._stt.stopAndGetText() || this._lastText);
      console.log(`[Voice] onEnd: hasFinal=${this._hasFinalText} text="${text}"`);
      if (text && text.trim().length > 0) {
        this._lastText = text;
        this._ui.showInterim(text + ' ⏳ 送信中...');
        this._clearSilenceTimer();
        this._resetSilenceTimer();
      } else {
        this._ui.updateMicState('idle');
        this._ui.hideInterim();
      }
    };

    this._stt.onError = (error) => {
      this._clearSilenceTimer();
      this._ui.updateMicState('error');
      this._ui.showStatus(error, 'error');
      setTimeout(() => this._ui.updateMicState('idle'), 2000);
    };

    // --- TTS再生コールバック ---
    this._playback.onPlayStart = (sisterId) => {
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      // v1.2修正: キュー再生中は自動マイク再開しない（次の姉妹の番）
      if (this._playback.isQueuePlaying()) return;
      this._ui.updateMicState('idle');
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 500);
      }
    };

    // v1.2追加: キュー全体が完了した時のコールバック
    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
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
  // 息継ぎ対策タイマー
  // ═══════════════════════════════════════════

  /**
   * 無音タイマーをリセット（新しい音声入力があるたびに呼ぶ）
   * 最後の入力から1.5秒経ったら自動送信
   */
  _resetSilenceTimer() {
    this._clearSilenceTimer();
    this._silenceTimer = setTimeout(() => {
      this._silenceTimer = null;
      const text = this._lastText.trim();
      if (text) {
        console.log(`[Voice] ${this._SILENCE_DELAY}ms無音 → 自動送信: "${text}"`);
        this._stt.stop();
        this._sendVoiceMessage(text);
      }
    }, this._SILENCE_DELAY);
  }

  /**
   * 無音タイマーをクリア
   */
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

  /** マイクボタン押下時の処理 */
  toggleListening() {
    if (this._stt.isListening()) {
      // 認識中 → 停止して今あるテキストを即送信
      this._clearSilenceTimer();
      const text = (this._lastText || '').trim();
      this._stt.stop();
      if (text) {
        this._sendVoiceMessage(text);
      } else {
        this._ui.updateMicState('idle');
        this._ui.hideInterim();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      // 再生中（キュー含む）→ 割り込み停止
      this._playback.stop();
      this._ui.updateMicState('idle');
    } else {
      this.startListening();
    }
  }

  /** 音声認識を開始 */
  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._clearSilenceTimer();
    this._stt.start({ language: 'ja-JP' });
  }

  /** 音声認識を停止 */
  stopListening() {
    this._clearSilenceTimer();
    this._stt.stop();
  }

  /**
   * AI応答を声で再生する（chat-core.jsから呼ばれる）
   * @param {string} responseText - AI応答テキスト
   * @param {string} sisterId - 'koko' | 'gpt' | 'claude'
   */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /**
   * v1.2追加 - 複数の姉妹の応答を順番に再生（chat-group.jsから呼ばれる）
   * @param {Array<{text: string, sisterId: string}>} items - 再生キュー
   */
  async speakQueue(items) {
    if (!this._enabled) return;
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  /** 現在の姉妹IDを設定 */
  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }

  /** 音声速度を設定（0.75〜1.25） */
  setSpeed(speed) { this._speed = Math.max(0.75, Math.min(1.25, speed)); }

  /**
   * v1.2追加 - ハンズフリーモード切替（設定画面から呼ばれる）
   * @param {boolean} enabled - true=TTS完了後に自動マイク再開
   */
  setAutoListen(enabled) {
    this._autoListen = !!enabled;
    console.log(`[Voice] ハンズフリー: ${this._autoListen ? 'ON' : 'OFF'}`);
  }

  /**
   * v1.2追加 - STTデバッグパネル表示切替（設定画面から呼ばれる）
   * @param {boolean} visible - true=デバッグパネル表示
   */
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
  // 送信処理
  // ═══════════════════════════════════════════

  /**
   * 音声メッセージを自動送信（既存のチャット送信フローに合流）
   * v1.1修正: セレクタをCOCOMITalkの実際のID（#msg-input, #btn-send）に修正
   */
  _sendVoiceMessage(text) {
    this._ui.hideInterim();
    this._lastText = '';

    // COCOMITalkのチャット入力欄にテキストをセット
    const input = document.getElementById('msg-input');
    if (!input) {
      console.error('[Voice] #msg-input が見つかりません');
      this._ui.updateMicState('idle');
      return;
    }

    input.value = text;
    // textareaのinputイベントを発火（送信ボタンのdisabled解除のため）
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // 少し待ってから送信（inputイベント処理を完了させる）
    setTimeout(() => {
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        console.log('[Voice] 音声メッセージ送信完了');
      } else {
        // ボタンがまだdisabledなら直接Enterキーで送信
        const event = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter',
          keyCode: 13, which: 13, bubbles: true
        });
        input.dispatchEvent(event);
        console.log('[Voice] Enterキーで送信');
      }
      this._ui.updateMicState('idle');
    }, 50);
  }
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
