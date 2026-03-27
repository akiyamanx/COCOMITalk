// openai-tts-provider.js v1.1
// このファイルはOpenAI TTS APIをcocomi-api-relay Worker経由で呼び出す
// TTSProviderインターフェースに準拠した実装
// /tts エンドポイント（Step 5aで実装済み）を使用する

// v1.0 新規作成 - Step 5b OpenAI TTS実装
// v1.1 修正 - #77改善: テキスト長制限を500→4000文字に緩和（voice-output v1.5チャンク分割と連携）

/**
 * OpenAI TTSプロバイダー
 * cocomi-api-relay Worker経由でOpenAI TTS APIを呼び出す
 */
class OpenAITTSProvider extends TTSProvider {
  constructor() {
    super('OpenAI TTS');
    // Worker URLと認証トークンはapi-common.jsのgetApiConfig()から取得
    this._model = 'tts-1';
    this._defaultSpeed = 1.0;
  }

  /**
   * 利用可能な声の一覧
   */
  getAvailableVoices() {
    return [
      { id: 'alloy',   name: 'Alloy',   description: 'ニュートラルでクリア' },
      { id: 'echo',    name: 'Echo',    description: '低めで落ち着いた声' },
      { id: 'fable',   name: 'Fable',   description: '表現力のある声' },
      { id: 'onyx',    name: 'Onyx',    description: '深く重厚な声' },
      { id: 'nova',    name: 'Nova',    description: '落ち着いた温かみ' },
      { id: 'shimmer', name: 'Shimmer', description: '柔らかく明るい声' }
    ];
  }

  /**
   * 利用可能チェック（認証トークンが設定されているか）
   * api-common.jsのApiCommonモジュールを使用
   */
  isAvailable() {
    return (typeof ApiCommon !== 'undefined') && ApiCommon.hasAuthToken();
  }

  /**
   * テキストを音声に変換
   * @param {string} text - 読み上げるテキスト
   * @param {string} voice - 声ID（alloy/echo/fable/onyx/nova/shimmer）
   * @param {object} options - { speed: number, model: string }
   * @returns {Promise<HTMLAudioElement>}
   */
  async synthesize(text, voice, options = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('テキストが空です');
    }

    // v1.1修正 - テキスト長制限をOpenAI TTS APIの上限に合わせて緩和
    // voice-output.js v1.5のチャンク分割（450文字以下）と連携するため
    // プロバイダー側は4000文字まで許可（APIの4096文字制限に安全マージン）
    const MAX_TEXT_LENGTH = 4000;
    let truncatedText = text;
    if (text.length > MAX_TEXT_LENGTH) {
      console.warn(`[TTS] テキストが${MAX_TEXT_LENGTH}文字を超過（${text.length}文字）→ 切り詰め`);
      truncatedText = text.substring(0, MAX_TEXT_LENGTH);
    }

    // api-common.jsからWorker URL/認証トークンを取得
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      throw new Error('Worker URLまたは認証トークンが未設定です');
    }

    const speed = options.speed || this._defaultSpeed;
    const model = options.model || this._model;

    // Worker経由でOpenAI TTS APIを呼び出し
    const url = `${ApiCommon.getWorkerURL()}/tts`;
    const startTime = performance.now();

    console.log(`[TTS] 生成開始: voice=${voice}, text="${truncatedText.substring(0, 30)}..." (${truncatedText.length}文字), speed=${speed}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-COCOMI-AUTH': ApiCommon.getAuthToken()
      },
      body: JSON.stringify({
        text: truncatedText,
        voice: voice,
        speed: speed,
        model: model
      })
    });

    if (!response.ok) {
      // エラー時はJSONでメッセージが返る
      let errorMsg = `TTS API エラー: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch {
        // JSONパース失敗時はステータスコードのまま
      }
      throw new Error(errorMsg);
    }

    // 音声バイナリをBlobとして受け取り → Audio生成
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    const latency = Math.round(performance.now() - startTime);
    console.log(`[TTS] 生成完了: ${latency}ms, voice=${voice}`);

    // メモリリーク防止: 再生完了時にObjectURLを解放
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl);
      console.log(`[TTS] ObjectURL解放: voice=${voice}`);
    });

    // エラー時もObjectURLを解放
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(audioUrl);
      console.warn(`[TTS] 再生エラー、ObjectURL解放: voice=${voice}`);
    });

    // レイテンシ情報を付与（UI表示用）
    audio._ttsLatency = latency;
    audio._ttsVoice = voice;

    return audio;
  }
}

// グローバルに公開
window.OpenAITTSProvider = OpenAITTSProvider;
