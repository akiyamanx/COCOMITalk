// COCOMITalk - OpenAI API接続（Worker中継版）
// このファイルはお姉ちゃん（GPT）APIとの通信をWorker経由で管理する
// v0.5 Step 2 - 新規作成
// v1.1 - GPT-5系のmax_completion_tokens対応（バグ修正）

'use strict';

/**
 * OpenAI API接続モジュール（Worker中継版）
 * お姉ちゃん（GPT）との会話を担当
 */
const ApiOpenAI = (() => {

  // --- モデル定義 ---
  const MODELS = {
    'mini': 'gpt-4o-mini',
    'gpt4o': 'gpt-4o',
    'gpt54': 'gpt-5.4',       // v1.0追加 - 会議モード最上位
  };

  // デフォルトモデル（コスト安全: まず安いモデルでテスト）
  const DEFAULT_MODEL = 'mini';

  /**
   * OpenAI APIにメッセージを送信
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴（{role, content}の配列）
   * @param {Object} options - オプション
   * @param {string} options.model - モデルキー（mini/gpt4o）
   * @returns {Promise<string>} AIの返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面からトークンを入力してください。');
    }

    const modelKey = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];

    // OpenAI形式のメッセージ配列を構築（v1.0変更 - 添付ファイル対応）
    const messages = _buildMessages(userMessage, systemPrompt, history, options.attachment);

    // リクエストボディ
    const body = {
      model: modelName,
      messages: messages,
      temperature: 0.5,
    };
    // v1.1修正 - GPT-5系はmax_completion_tokens、旧モデル（4o系）はmax_tokens
    if (modelName.startsWith('gpt-5')) {
      body.max_completion_tokens = options.maxTokens || 1024;
    } else {
      body.max_tokens = options.maxTokens || 1024;
    }

    try {
      // v0.5 - Worker経由でリクエスト
      const data = await ApiCommon.callAPI('openai', body);

      // レスポンスからテキスト抽出
      const text = _extractText(data);

      // トークン使用量を記録
      const usage = data?.usage;
      if (usage && typeof TokenMonitor !== 'undefined') {
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;
        TokenMonitor.record(modelName, inputTokens, outputTokens);
      }

      return text;

    } catch (error) {
      console.error('[ApiOpenAI] 通信エラー:', error);
      throw error;
    }
  }

  /**
   * OpenAI形式のメッセージ配列を構築（v1.0変更 - 添付ファイル対応）
   */
  function _buildMessages(userMessage, systemPrompt, history, attachment) {
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // v1.0追加 - 添付ファイル対応
    if (attachment && attachment.type === 'image') {
      // OpenAI Vision形式（content配列）
      messages.push({ role: 'user', content: [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.content}` } },
      ]});
    } else if (attachment && attachment.type === 'text') {
      messages.push({ role: 'user', content: `【添付ファイル: ${attachment.name}】\n${attachment.content}\n\n${userMessage}` });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }

  /**
   * レスポンスからテキストを抽出
   */
  function _extractText(data) {
    const choices = data?.choices;
    if (!choices || choices.length === 0) {
      return 'あれ？お姉ちゃんから返事が来なかった…もう一回話しかけてみて！';
    }

    const content = choices[0]?.message?.content;
    if (!content) {
      return 'うーん、お姉ちゃんの言葉がうまく届かなかった…もう一回お願い！';
    }

    return content;
  }

  /**
   * 認証トークンが設定されているか確認
   */
  function hasApiKey() {
    return ApiCommon.hasAuthToken();
  }

  /**
   * 利用可能なモデル一覧を取得
   */
  function getModels() {
    return { ...MODELS };
  }

  return {
    sendMessage,
    hasApiKey,
    getModels,
    DEFAULT_MODEL,
  };
})();
