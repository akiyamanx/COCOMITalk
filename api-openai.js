// COCOMITalk - OpenAI API接続（Worker中継版）
// このファイルはお姉ちゃん（GPT）APIとの通信をWorker経由で管理する
// v0.5 Step 2 - 新規作成

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

    // OpenAI形式のメッセージ配列を構築
    const messages = _buildMessages(userMessage, systemPrompt, history);

    // リクエストボディ
    const body = {
      model: modelName,
      messages: messages,
      temperature: 0.5,
      max_tokens: 1024,
    };

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
   * OpenAI形式のメッセージ配列を構築
   */
  function _buildMessages(userMessage, systemPrompt, history) {
    const messages = [];

    // システムプロンプト
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 会話履歴（直近10ターン = 20メッセージ）
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // 現在のユーザーメッセージ
    messages.push({ role: 'user', content: userMessage });

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
