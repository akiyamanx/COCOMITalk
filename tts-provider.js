// tts-provider.js v1.0
// このファイルはTTS（テキスト→音声）の抽象インターフェースを定義する
// 将来ElevenLabsやVOICEVOXに差し替える際、このインターフェースに準拠した
// プロバイダーを作るだけで切り替え可能にする設計

// v1.0 新規作成 - Step 5b TTS抽象層

/**
 * TTSProvider 抽象クラス
 * 全TTSプロバイダーはこのインターフェースに準拠する
 */
class TTSProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * テキストを音声に変換してAudioオブジェクトを返す
   * @param {string} text - 読み上げるテキスト
   * @param {string} voice - 声の識別子
   * @param {object} options - 追加オプション（speed等）
   * @returns {Promise<HTMLAudioElement>} - 再生可能なAudioオブジェクト
   */
  async synthesize(text, voice, options = {}) {
    throw new Error(`${this.name}: synthesize() が未実装です`);
  }

  /**
   * 利用可能な声の一覧を返す
   * @returns {Array<{id: string, name: string, description: string}>}
   */
  getAvailableVoices() {
    throw new Error(`${this.name}: getAvailableVoices() が未実装です`);
  }

  /**
   * プロバイダーが利用可能かチェック
   * @returns {boolean}
   */
  isAvailable() {
    return false;
  }
}

// 三姉妹の声割り当て設定（v1.0 確定版）
// 変更する場合はここだけ修正すればOK
const SISTER_VOICE_MAP = {
  koko:    { voice: 'nova',    provider: 'openai', label: '🌸 ここちゃん' },
  gpt:     { voice: 'shimmer', provider: 'openai', label: '🌙 お姉ちゃん' },
  claude:  { voice: 'alloy',   provider: 'openai', label: '🔮 クロちゃん' }
};

/**
 * 姉妹IDから声設定を取得するヘルパー
 * @param {string} sisterId - 'gemini' | 'openai' | 'claude'
 * @returns {{voice: string, provider: string, label: string}}
 */
function getSisterVoice(sisterId) {
  const config = SISTER_VOICE_MAP[sisterId];
  if (!config) {
    console.warn(`[TTS] 不明な姉妹ID: ${sisterId}、デフォルトalloyを使用`);
    return { voice: 'alloy', provider: 'openai', label: '不明' };
  }
  return config;
}

// グローバルに公開
window.TTSProvider = TTSProvider;
window.SISTER_VOICE_MAP = SISTER_VOICE_MAP;
window.getSisterVoice = getSisterVoice;
