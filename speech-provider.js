// speech-provider.js v1.0
// このファイルはSTT（音声→テキスト）の抽象インターフェースを定義する
// 現在はWeb Speech API（無料・ブラウザ内蔵）のみだが、
// 将来Whisper APIやGoogle Speech-to-Text等に差し替え可能にする設計

// v1.0 新規作成 - Step 5b STT抽象層

/**
 * SpeechProvider 抽象クラス
 * 全STTプロバイダーはこのインターフェースに準拠する
 *
 * イベントコールバック:
 * - onInterim(text)     : 途中経過テキスト（リアルタイム表示用）
 * - onFinal(text)       : 確定テキスト
 * - onStart()           : 認識開始
 * - onEnd()             : 認識終了
 * - onError(error)      : エラー発生
 */
class SpeechProvider {
  constructor(name) {
    this.name = name;
    // イベントコールバック（使う側がセットする）
    this.onInterim = null;
    this.onFinal = null;
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
  }

  /**
   * 音声認識を開始する
   * @param {object} options - { language: string }
   */
  start(options = {}) {
    throw new Error(`${this.name}: start() が未実装です`);
  }

  /**
   * 音声認識を停止する
   */
  stop() {
    throw new Error(`${this.name}: stop() が未実装です`);
  }

  /**
   * プロバイダーが利用可能かチェック
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }

  /**
   * 現在認識中かどうか
   * @returns {boolean}
   */
  isListening() {
    return false;
  }
}

// グローバルに公開
window.SpeechProvider = SpeechProvider;
