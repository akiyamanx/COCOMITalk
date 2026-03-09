// web-speech-provider.js v1.0
// このファイルはWeb Speech API（ブラウザ内蔵・無料）によるSTT実装
// SpeechProviderインターフェースに準拠
// Galaxy S22 UltraのChrome/Samsung Browserで動作確認想定

// v1.0 新規作成 - Step 5b Web Speech API STT実装

/**
 * Web Speech APIプロバイダー
 * ブラウザの SpeechRecognition API を使用（無料・オフライン可能）
 */
class WebSpeechProvider extends SpeechProvider {
  constructor() {
    super('Web Speech API');
    this._recognition = null;
    this._listening = false;
    this._finalTranscript = '';
    this._initRecognition();
  }

  /**
   * SpeechRecognitionオブジェクトの初期化
   */
  _initRecognition() {
    // ブラウザ互換性チェック
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[STT] このブラウザはWeb Speech APIに対応していません');
      return;
    }

    const recognition = new SpeechRecognition();

    // 設定
    recognition.lang = 'ja-JP';          // 日本語
    recognition.continuous = true;        // 連続認識（途中で止まらない）
    recognition.interimResults = true;    // 途中経過を返す
    recognition.maxAlternatives = 1;      // 候補は1つでOK

    // イベントハンドラ
    recognition.onstart = () => {
      this._listening = true;
      this._finalTranscript = '';
      console.log('[STT] 認識開始');
      if (this.onStart) this.onStart();
    };

    recognition.onend = () => {
      this._listening = false;
      console.log('[STT] 認識終了');
      if (this.onEnd) this.onEnd();
    };

    recognition.onerror = (event) => {
      console.warn(`[STT] エラー: ${event.error}`);
      this._listening = false;

      // ユーザーに分かりやすいエラーメッセージ
      const errorMessages = {
        'no-speech': 'マイクに声が入りませんでした',
        'audio-capture': 'マイクが使えません。ブラウザの設定を確認してください',
        'not-allowed': 'マイクの使用が許可されていません',
        'network': 'ネットワークエラーが発生しました',
        'aborted': '音声認識が中断されました',
        'service-not-available': '音声認識サービスが利用できません'
      };
      const message = errorMessages[event.error] || `音声認識エラー: ${event.error}`;

      if (this.onError) this.onError(message);
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';

      // 結果の処理
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          // 確定テキスト
          this._finalTranscript += result[0].transcript;
          console.log(`[STT] 確定: "${result[0].transcript}"`);
        } else {
          // 途中経過
          interimTranscript += result[0].transcript;
        }
      }

      // 途中経過コールバック（リアルタイム表示用）
      if (interimTranscript && this.onInterim) {
        this.onInterim(this._finalTranscript + interimTranscript);
      }

      // 確定テキストコールバック
      if (this._finalTranscript && this.onFinal) {
        this.onFinal(this._finalTranscript);
      }
    };

    this._recognition = recognition;
  }

  /**
   * 利用可能チェック
   */
  isAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * 現在認識中か
   */
  isListening() {
    return this._listening;
  }

  /**
   * 音声認識を開始
   * @param {object} options - { language: string }
   */
  start(options = {}) {
    if (!this._recognition) {
      const msg = 'このブラウザは音声認識に対応していません';
      if (this.onError) this.onError(msg);
      return;
    }

    if (this._listening) {
      console.log('[STT] 既に認識中です');
      return;
    }

    // 言語設定の上書き（デフォルトはja-JP）
    if (options.language) {
      this._recognition.lang = options.language;
    }

    this._finalTranscript = '';

    try {
      this._recognition.start();
    } catch (e) {
      // 既にstart済みの場合のエラーを無視
      console.warn('[STT] start()例外:', e.message);
    }
  }

  /**
   * 音声認識を停止
   */
  stop() {
    if (!this._recognition) return;

    if (this._listening) {
      this._recognition.stop();
      console.log('[STT] 停止要求');
    }
  }

  /**
   * 認識中なら停止して、累積した確定テキストを返す
   * @returns {string} 確定テキスト
   */
  stopAndGetText() {
    this.stop();
    return this._finalTranscript;
  }
}

// グローバルに公開
window.WebSpeechProvider = WebSpeechProvider;
