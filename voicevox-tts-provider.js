// voicevox-tts-provider.js v1.0
// このファイルはVOICEVOX（tts.quest非公式Web API）でTTS再生するプロバイダー
// TTSProviderインターフェースに準拠。Worker不要でフロントから直接APIを呼ぶ
// VOICEVOXの利用規約に従うこと（クレジット表記等）

// v1.0 新規作成 - VOICEVOX tts.quest API対応

/**
 * VOICEVOX TTSプロバイダー
 * tts.quest非公式Web APIを使用して音声合成を行う
 *
 * 特徴:
 * - Worker不要（フロントから直接アクセス）
 * - APIキーなしでも使える（低速モード）
 * - APIキーありで高速合成
 * - 40キャラ以上の日本語ネイティブ音声
 */
class VoicevoxTTSProvider extends TTSProvider {
  constructor() {
    super('VOICEVOX');
    // tts.quest APIエンドポイント
    this._apiBase = 'https://api.tts.quest/v3/voicevox/synthesis';
    // APIキー（任意・LocalStorageから読み込み）
    this._apiKey = '';
    // テキスト長制限（tts.questの制限に合わせて短めに）
    this._maxTextLength = 200;
    // APIキーをLocalStorageから復元
    this._loadApiKey();
  }

  /**
   * LocalStorageからAPIキーを読み込む
   */
  _loadApiKey() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (saved) {
        const settings = JSON.parse(saved);
        if (settings.vvApiKey) this._apiKey = settings.vvApiKey;
      }
    } catch (e) {
      console.warn('[VOICEVOX] APIキー読み込みエラー:', e);
    }
  }

  /**
   * APIキーを設定する
   * @param {string} key - tts.quest APIキー
   */
  setApiKey(key) {
    this._apiKey = key || '';
  }

  /**
   * 利用可能な声の一覧（三姉妹候補の厳選版）
   * 全話者はtts.quest APIから動的取得可能
   */
  getAvailableVoices() {
    return [
      // ここちゃん候補（可愛い・元気系）
      { id: '3',  name: 'ずんだもん（ノーマル）', description: '定番の可愛い声' },
      { id: '1',  name: 'ずんだもん（あまあま）', description: '甘え上手な声' },
      { id: '22', name: '春日部つむぎ',           description: '明るく元気' },
      { id: '10', name: 'ナースロボ＿タイプＴ',   description: '優しく穏やか' },
      // お姉ちゃん候補（知的・落ち着き系）
      { id: '2',  name: '四国めたん（ノーマル）', description: '落ち着いた大人声' },
      { id: '4',  name: '四国めたん（セクシー）', description: '大人っぽい声' },
      { id: '16', name: '九州そら（ノーマル）',   description: '知的で清楚' },
      { id: '14', name: '冥鳴ひまり',             description: '落ち着いた優しい声' },
      // クロちゃん候補（クール・個性的系）
      { id: '0',  name: '四国めたん（あまあま）', description: '甘めのお姉さん声' },
      { id: '6',  name: 'ずんだもん（ツンツン）', description: 'ツンデレ系' },
      { id: '23', name: '猫使アル（ノーマル）',   description: 'ミステリアス系' },
      { id: '46', name: 'WhiteCUL（ノーマル）',   description: 'クールで知的' },
    ];
  }

  /**
   * 利用可能チェック（tts.questはキー不要でも使えるので常にtrue）
   */
  isAvailable() {
    return true;
  }

  /**
   * テキストを音声に変換してAudioオブジェクトを返す
   * @param {string} text - 読み上げるテキスト
   * @param {string} voice - 話者ID（文字列の数値、例: "3"）
   * @param {object} options - { key: string }（APIキー上書き用）
   * @returns {Promise<HTMLAudioElement>}
   */
  async synthesize(text, voice, options = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('テキストが空です');
    }

    // テキスト長制限（安全ガイド準拠 - コスト安全策）
    const truncatedText = text.length > this._maxTextLength
      ? text.substring(0, this._maxTextLength) + '...'
      : text;

    const speakerId = parseInt(voice, 10);
    if (isNaN(speakerId)) {
      throw new Error(`不正な話者ID: ${voice}`);
    }

    const apiKey = options.key || this._apiKey;
    const startTime = performance.now();

    console.log(`[VOICEVOX] 生成開始: speaker=${speakerId}, text="${truncatedText.substring(0, 30)}..."`);

    // tts.quest API呼び出し
    let url = `${this._apiBase}?speaker=${speakerId}&text=${encodeURIComponent(truncatedText)}`;
    if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`tts.quest API HTTP ${response.status}`);
    }

    const data = await response.json();

    // エラーチェック
    if (data.error) {
      throw new Error(`VOICEVOX: ${data.error}`);
    }
    if (!data.mp3StreamingUrl && !data.mp3DownloadUrl) {
      throw new Error('音声URLが取得できませんでした');
    }

    // mp3DownloadUrlを優先（全生成後に再生→途切れ防止）
    // APIキーありなら生成も速いので待ち時間も短い
    const audioUrl = data.mp3DownloadUrl || data.mp3StreamingUrl;

    // 音声を全てダウンロードしてからAudioオブジェクトを生成（途切れ完全防止）
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`音声ダウンロード失敗: HTTP ${audioRes.status}`);
    const audioBlob = await audioRes.blob();
    const blobUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(blobUrl);

    // メモリリーク防止: 再生完了時にBlobURLを解放
    audio.addEventListener('ended', () => URL.revokeObjectURL(blobUrl));
    audio.addEventListener('error', () => URL.revokeObjectURL(blobUrl));

    const latency = Math.round(performance.now() - startTime);
    console.log(`[VOICEVOX] 生成完了: ${latency}ms, speaker=${speakerId}`);

    // レイテンシ情報を付与（UI表示用）
    audio._ttsLatency = latency;
    audio._ttsVoice = voice;
    audio._ttsProvider = 'voicevox';

    return audio;
  }
}

// グローバルに公開
window.VoicevoxTTSProvider = VoicevoxTTSProvider;
