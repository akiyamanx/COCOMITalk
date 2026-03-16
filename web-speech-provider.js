// web-speech-provider.js v1.3
// このファイルはWeb Speech API（ブラウザ内蔵・無料）によるSTT実装
// SpeechProviderインターフェースに準拠
// v1.0 新規作成 - Step 5b Web Speech API STT実装
// v1.1 修正 - continuous:false + 上書き方式
// v1.2 修正 - デバッグログ大量追加＋画面表示＋onresult重複防止強化
// v1.3 改修 - continuous:true（ピコン音削減）＋finalを毎回コールバック

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
    // v1.2追加 - デバッグ用カウンター
    this._resultCount = 0;
    // v1.2追加 - 画面デバッグログ（デフォルト非表示）
    this._debugEl = null;
    this._debugLogs = [];
    this._debugVisible = false;
    this._initDebugUI();
    this._initRecognition();
  }

  // v1.2追加 - 画面上にデバッグログを表示するUI
  _initDebugUI() {
    const el = document.createElement('div');
    el.id = 'stt-debug-panel';
    el.style.cssText = 'position:fixed;bottom:80px;left:4px;right:4px;' +
      'max-height:200px;overflow-y:auto;background:rgba(0,0,0,0.85);' +
      'color:#0f0;font-size:11px;font-family:monospace;padding:6px;' +
      'border-radius:8px;z-index:99999;display:none;white-space:pre-wrap;';
    document.body.appendChild(el);
    this._debugEl = el;
  }

  // v1.2追加 - デバッグログを画面に追加（_debugVisible=trueの時のみ表示）
  _debugLog(msg) {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const line = `[${ts}] ${msg}`;
    console.log(`[STT-DEBUG] ${msg}`);
    this._debugLogs.push(line);
    if (this._debugLogs.length > 20) this._debugLogs.shift();
    if (this._debugEl && this._debugVisible) {
      this._debugEl.style.display = 'block';
      this._debugEl.textContent = this._debugLogs.join('\n');
      this._debugEl.scrollTop = this._debugEl.scrollHeight;
    }
  }

  /**
   * SpeechRecognitionオブジェクトの初期化
   */
  _initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[STT] このブラウザはWeb Speech APIに対応していません');
      return;
    }

    const recognition = new SpeechRecognition();

    // 設定
    recognition.lang = 'ja-JP';
    // v1.3変更: continuous:true — STTを止めずに複数発話を受け取る
    // ピコン音はstart()時に1回だけ鳴る（再スタート不要なので以降鳴らない）
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // --- イベントハンドラ ---
    recognition.onstart = () => {
      this._listening = true;
      this._finalTranscript = '';
      this._resultCount = 0;
      this._debugLog('=== 認識開始 (continuous:true) ===');
      if (this.onStart) this.onStart();
    };

    recognition.onend = () => {
      this._listening = false;
      this._debugLog(`=== 認識終了 === final="${this._finalTranscript}" resultCount=${this._resultCount}`);
      if (this.onEnd) this.onEnd();
    };

    recognition.onerror = (event) => {
      this._debugLog(`ERROR: ${event.error}`);
      // v1.3: no-speechはcontinuous:trueでも発生しうる — 致命的ではない
      if (event.error === 'no-speech') {
        this._debugLog('no-speech — 継続中');
        return;
      }
      this._listening = false;
      const errorMessages = {
        'audio-capture': 'マイクが使えません。ブラウザの設定を確認してください',
        'not-allowed': 'マイクの使用が許可されていません',
        'network': 'ネットワークエラーが発生しました',
        'aborted': '音声認識が中断されました',
        'service-not-available': '音声認識サービスが利用できません'
      };
      const message = errorMessages[event.error] || `音声認識エラー: ${event.error}`;
      if (this.onError) this.onError(message);
    };

    // v1.3改修: continuous:trueではfinalが複数回来る — 毎回コールバック
    recognition.onresult = (event) => {
      this._resultCount++;
      this._debugLog(`--- onresult #${this._resultCount} ---`);
      this._debugLog(`  resultIndex=${event.resultIndex} results.length=${event.results.length}`);

      // デバッグ: 全resultの中身を表示
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const txt = r[0].transcript;
        const conf = r[0].confidence.toFixed(3);
        this._debugLog(`  [${i}] isFinal=${r.isFinal} conf=${conf} "${txt}"`);
      }

      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          // v1.3: finalは毎回採用（continuous:trueでは発話区切りごとに来る）
          this._finalTranscript = result[0].transcript;
          this._debugLog(`  >>> FINAL採用: "${this._finalTranscript}"`);
          if (this.onFinal) this.onFinal(this._finalTranscript);
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // 途中経過コールバック
      if (interimTranscript && this.onInterim) {
        this.onInterim(interimTranscript);
      }
    };

    this._recognition = recognition;
  }

  /** 利用可能チェック */
  isAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /** 現在認識中か */
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
      this._debugLog('既に認識中 → スキップ');
      return;
    }

    if (options.language) {
      this._recognition.lang = options.language;
    }

    this._finalTranscript = '';
    this._resultCount = 0;

    try {
      this._recognition.start();
    } catch (e) {
      this._debugLog(`start()例外: ${e.message}`);
    }
  }

  /** 音声認識を停止 */
  stop() {
    if (!this._recognition) return;
    if (this._listening) {
      this._recognition.stop();
      this._debugLog('停止要求');
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

  /** v1.2追加 - デバッグパネルの表示/非表示切替 */
  toggleDebug() {
    if (this._debugEl) {
      const isVisible = this._debugEl.style.display !== 'none';
      this._debugEl.style.display = isVisible ? 'none' : 'block';
    }
  }

  /** v1.2追加 - デバッグパネルの表示/非表示を設定（設定画面から呼ばれる） */
  setDebugVisible(visible) {
    this._debugVisible = !!visible;
    if (this._debugEl) {
      // 非表示設定の場合はパネルを消す、表示設定の場合はログがあれば表示
      if (!visible) {
        this._debugEl.style.display = 'none';
      }
    }
  }
}

// グローバルに公開
window.WebSpeechProvider = WebSpeechProvider;
