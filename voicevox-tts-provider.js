// voicevox-tts-provider.js v1.1
// このファイルはVOICEVOX（tts.quest非公式Web API）でTTS再生するプロバイダー
// TTSProviderインターフェースに準拠。Worker不要でフロントから直接APIを呼ぶ
// VOICEVOXの利用規約に従うこと（クレジット表記等）

// v1.0 新規作成 - VOICEVOX tts.quest API対応
// v1.1 追加 - 長文分割再生（文単位で分割→連続再生）

/**
 * VOICEVOX TTSプロバイダー
 * tts.quest非公式Web APIを使用して音声合成を行う
 */
class VoicevoxTTSProvider extends TTSProvider {
  constructor() {
    super('VOICEVOX');
    this._apiBase = 'https://api.tts.quest/v3/voicevox/synthesis';
    this._apiKey = '';
    // 1チャンクの最大文字数（tts.questの安定範囲）
    this._chunkMaxLen = 100;
    this._loadApiKey();
  }

  // LocalStorageからAPIキーを読み込む
  _loadApiKey() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.vvApiKey) this._apiKey = s.vvApiKey;
      }
    } catch (e) { console.warn('[VOICEVOX] APIキー読み込みエラー:', e); }
  }

  setApiKey(key) { this._apiKey = key || ''; }

  getAvailableVoices() {
    return [
      { id: '1',  name: 'ずんだもん（あまあま）', description: '甘え上手な声' },
      { id: '3',  name: 'ずんだもん（ノーマル）', description: '定番の可愛い声' },
      { id: '22', name: '春日部つむぎ',           description: '明るく元気' },
      { id: '2',  name: '四国めたん（ノーマル）', description: '落ち着いた大人声' },
      { id: '4',  name: '四国めたん（セクシー）', description: '大人っぽい声' },
      { id: '16', name: '九州そら（ノーマル）',   description: '知的で清楚' },
      { id: '14', name: '冥鳴ひまり',             description: '落ち着いた優しい声' },
      { id: '0',  name: '四国めたん（あまあま）', description: '甘めのお姉さん声' },
      { id: '6',  name: 'ずんだもん（ツンツン）', description: 'ツンデレ系' },
      { id: '46', name: 'WhiteCUL（ノーマル）',   description: 'クールで知的' },
    ];
  }

  isAvailable() { return true; }

  /**
   * テキストを文単位で分割する
   * 句点（。）、感嘆符（！!）、疑問符（？?）、改行で区切る
   * @param {string} text
   * @returns {string[]}
   */
  _splitText(text) {
    // 句読点・感嘆符・疑問符・改行で分割（区切り文字は前のチャンクに含める）
    const raw = text.split(/(?<=[。！！？？\n])/);
    const chunks = [];
    let buf = '';
    for (const part of raw) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // バッファに追加してもチャンク上限以内ならまとめる
      if (buf.length + trimmed.length <= this._chunkMaxLen) {
        buf += trimmed;
      } else {
        if (buf) chunks.push(buf);
        // 単体でも上限超えなら強制カット
        if (trimmed.length > this._chunkMaxLen) {
          for (let i = 0; i < trimmed.length; i += this._chunkMaxLen) {
            chunks.push(trimmed.substring(i, i + this._chunkMaxLen));
          }
          buf = '';
        } else {
          buf = trimmed;
        }
      }
    }
    if (buf) chunks.push(buf);
    return chunks.length > 0 ? chunks : [text.substring(0, this._chunkMaxLen)];
  }

  /**
   * 1チャンクの音声URLを取得する（内部用）
   * @param {string} text - チャンクテキスト
   * @param {number} speakerId - 話者ID
   * @param {string} apiKey - APIキー
   * @returns {Promise<string>} - 音声URL
   */
  async _fetchChunkUrl(text, speakerId, apiKey) {
    let url = `${this._apiBase}?speaker=${speakerId}&text=${encodeURIComponent(text)}`;
    if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tts.quest API HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`VOICEVOX: ${data.error}`);
    if (!data.mp3StreamingUrl && !data.mp3DownloadUrl) {
      throw new Error('音声URLが取得できませんでした');
    }
    return apiKey
      ? (data.mp3StreamingUrl || data.mp3DownloadUrl)
      : (data.mp3DownloadUrl || data.mp3StreamingUrl);
  }

  /**
   * synthesize — 短文はそのまま、長文は最初のチャンクだけ返す
   * （TTSProviderインターフェース互換）
   */
  async synthesize(text, voice, options = {}) {
    if (!text || text.trim().length === 0) throw new Error('テキストが空です');
    const speakerId = parseInt(voice, 10);
    if (isNaN(speakerId)) throw new Error(`不正な話者ID: ${voice}`);
    const apiKey = options.key || this._apiKey;
    const chunks = this._splitText(text);
    const startTime = performance.now();
    console.log(`[VOICEVOX] 生成開始: speaker=${speakerId}, chunks=${chunks.length}`);
    const audioUrl = await this._fetchChunkUrl(chunks[0], speakerId, apiKey);
    const audio = new Audio(audioUrl);
    audio._ttsLatency = Math.round(performance.now() - startTime);
    audio._ttsVoice = voice;
    audio._ttsProvider = 'voicevox';
    // 残りチャンク情報を付与（voice-output.jsが連続再生に使う）
    audio._vvRemainingChunks = chunks.slice(1);
    audio._vvSpeakerId = speakerId;
    audio._vvApiKey = apiKey;
    return audio;
  }

  /**
   * 残りチャンクの音声URLを取得してAudioを返す
   * voice-output.jsから呼ばれる
   * @param {string} chunkText
   * @param {number} speakerId
   * @param {string} apiKey
   * @returns {Promise<HTMLAudioElement>}
   */
  async synthesizeChunk(chunkText, speakerId, apiKey) {
    const audioUrl = await this._fetchChunkUrl(chunkText, speakerId, apiKey);
    return new Audio(audioUrl);
  }
}

// グローバルに公開
window.VoicevoxTTSProvider = VoicevoxTTSProvider;
