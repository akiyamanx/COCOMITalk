// tts-provider.js v1.4
// このファイルはTTS（テキスト→音声）の抽象インターフェースを定義する
// 将来ElevenLabsやVOICEVOXに差し替える際、このインターフェースに準拠した
// プロバイダーを作るだけで切り替え可能にする設計

// v1.0 新規作成 - Step 5b TTS抽象層
// v1.1 追加 - VOICEVOX声割り当て＋プロバイダー切替機能
// v1.2 2026-10-28 - Gemini TTS追加（声は未割り当て=''。オーナーが後で決める。空のときは再生側がOpenAIへ戻す）
// v1.3 2026-10-28 - Gemini TTSの声を割り当て（澪=Despina / クロ=Achernar / ここ=Autonoe / 葵=Leda / キミ=Zephyr）。葵・キミ用の枠を追加（Geminiの声のみ）
// v1.4 2026-10-28 - 既定の読み上げをGeminiに変更（TTS_DEFAULT_PROVIDER）。旧設定(未設定/openai)を一度だけgeminiへ移す migrateTTSProviderDefault() 追加
// v1.5 2026-10-29 - kimi の表示ラベルを「きみちゃん」（ひらがな）に統一
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29

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
    voicevox: { voice: '1',     label: '🌸 ここちゃん' },  // ずんだもん（あまあま）
    gemini:   { voice: 'Autonoe', label: '🌸 ここちゃん' }
  },
  gpt: {
    openai:   { voice: 'shimmer', label: '🌙 お姉ちゃん' },
    voicevox: { voice: '4',       label: '🌙 お姉ちゃん' },  // 四国めたん（セクシー）
    gemini:   { voice: 'Despina', label: '🌙 お姉ちゃん' }
  },
  claude: {
    openai:   { voice: 'alloy',  label: '🔮 クロちゃん' },
    voicevox: { voice: '46',     label: '🔮 クロちゃん' },  // WhiteCUL（ノーマル）
    gemini:   { voice: 'Achernar', label: '🔮 クロちゃん' }
  },
  // 葵・きみ: Geminiの声だけ決定済み。OpenAI/VOICEVOXの声は未決定→getSisterVoiceが既定('alloy')に戻す（2026-10-30 札に絵文字を付けて三姉妹と揃えた）
  aoi:  { gemini: { voice: 'Leda',   label: '🦋 葵ちゃん' } },
  kimi: { gemini: { voice: 'Zephyr', label: '🌟 きみちゃん' } }
};

// v1.1追加 - 現在のTTSプロバイダー名（'gemini' | 'openai' | 'voicevox'）。v1.4から既定はgemini（openai/voicevoxは選べる控え兼、失敗時の自動戻し先）
const TTS_DEFAULT_PROVIDER = 'gemini';
let _currentTTSProvider = TTS_DEFAULT_PROVIDER;

/**
 * TTSプロバイダーを切り替える
 * @param {string} providerName - 'openai' | 'voicevox' | 'gemini'
 */
function setTTSProviderName(providerName) {
  if (providerName === 'openai' || providerName === 'voicevox' || providerName === 'gemini') {
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
 * 一度だけ、保存済み設定の読み上げプロバイダーが未設定/openai ならgeminiへ移す（voicevoxは本人の選択として残す）
 * 印(cocomitalk-tts-gemini-default-v1)は新規インストールでも付ける → 後から自分でOpenAIを選んでも戻されない
 * @returns {{changed: boolean}} 壊れた設定は触らない
 */
const TTS_MIGRATION_KEY = 'cocomitalk-tts-gemini-default-v1';
function migrateTTSProviderDefault() {
  try {
    if (localStorage.getItem(TTS_MIGRATION_KEY)) return { changed: false };
    const raw = localStorage.getItem('cocomitalk-settings');
    let changed = false;
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === 'object' && (!s.ttsProvider || s.ttsProvider === 'openai')) {
        s.ttsProvider = TTS_DEFAULT_PROVIDER;
        localStorage.setItem('cocomitalk-settings', JSON.stringify(s));
        changed = true;
      }
    }
    localStorage.setItem(TTS_MIGRATION_KEY, '1');
    return { changed };
  } catch (e) {
    return { changed: false };
  }
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
    // フォールバック: OpenAI（葵・キミのようにOpenAIの声が無い人は 'alloy'）
    const fallback = sisterConfig.openai || { voice: 'alloy', label: sisterConfig.gemini ? sisterConfig.gemini.label : '不明' };
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
