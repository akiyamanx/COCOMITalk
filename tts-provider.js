// tts-provider.js v1.1
// このファイルはTTS（テキスト→音声）の抽象インターフェースを定義する
// 将来ElevenLabsやVOICEVOXに差し替える際、このインターフェースに準拠した
// プロバイダーを作るだけで切り替え可能にする設計

// v1.0 新規作成 - Step 5b TTS抽象層
// v1.1 追加 - VOICEVOX声割り当て＋プロバイダー切替機能

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

// 三姉妹の声割り当て設定（v1.1 VOICEVOX対応版）
// provider切替で OpenAI / VOICEVOX を選べる
const SISTER_VOICE_MAP = {
  koko: {
    openai:   { voice: 'nova',  label: '🌸 ここちゃん' },
    voicevox: { voice: '3',     label: '🌸 ここちゃん' }  // ずんだもん（ノーマル）
  },
  gpt: {
    openai:   { voice: 'shimmer', label: '🌙 お姉ちゃん' },
    voicevox: { voice: '2',       label: '🌙 お姉ちゃん' }  // 四国めたん（ノーマル）
  },
  claude: {
    openai:   { voice: 'alloy',  label: '🔮 クロちゃん' },
    voicevox: { voice: '0',      label: '🔮 クロちゃん' }  // 四国めたん（あまあま）
  }
};

// v1.1追加 - 現在のTTSプロバイダー名（'openai' or 'voicevox'）
let _currentTTSProvider = 'openai';

/**
 * TTSプロバイダーを切り替える
 * @param {string} providerName - 'openai' | 'voicevox'
 */
function setTTSProviderName(providerName) {
  if (providerName === 'openai' || providerName === 'voicevox') {
    _currentTTSProvider = providerName;
    console.log(`[TTS] プロバイダー切替: ${providerName}`);
  } else {
    console.warn(`[TTS] 不明なプロバイダー: ${providerName}`);
  }
}

/**
 * 現在のTTSプロバイダー名を取得
 * @returns {string}
 */
function getTTSProviderName() {
  return _currentTTSProvider;
}

/**
 * 姉妹IDから現在のプロバイダーに応じた声設定を取得するヘルパー
 * @param {string} sisterId - 'koko' | 'gpt' | 'claude'
 * @returns {{voice: string, provider: string, label: string}}
 */
function getSisterVoice(sisterId) {
  const sisterConfig = SISTER_VOICE_MAP[sisterId];
  if (!sisterConfig) {
    console.warn(`[TTS] 不明な姉妹ID: ${sisterId}、デフォルトを使用`);
    return { voice: 'alloy', provider: 'openai', label: '不明' };
  }
  const config = sisterConfig[_currentTTSProvider];
  if (!config) {
    // フォールバック: OpenAI
    const fallback = sisterConfig.openai;
    return { ...fallback, provider: 'openai' };
  }
  return { ...config, provider: _currentTTSProvider };
}

/**
 * VOICEVOX用の話者IDを個別に変更する（聴き比べ後に確定する用）
 * @param {string} sisterId - 'koko' | 'gpt' | 'claude'
 * @param {string} voiceId - 話者ID（文字列の数値）
 */
function setVoicevoxSpeaker(sisterId, voiceId) {
  if (SISTER_VOICE_MAP[sisterId] && SISTER_VOICE_MAP[sisterId].voicevox) {
    SISTER_VOICE_MAP[sisterId].voicevox.voice = voiceId;
    console.log(`[TTS] ${sisterId}のVOICEVOX話者をID:${voiceId}に変更`);
  }
}

// グローバルに公開
window.TTSProvider = TTSProvider;
window.SISTER_VOICE_MAP = SISTER_VOICE_MAP;
window.getSisterVoice = getSisterVoice;
// v1.1追加
window.setTTSProviderName = setTTSProviderName;
window.getTTSProviderName = getTTSProviderName;
window.setVoicevoxSpeaker = setVoicevoxSpeaker;
