// このファイルはお姉ちゃん（GPT）APIとの通信をWorker経由で管理する
// v1.0 2026-03-08 - 初期作成
// v1.1 2026-03-08 - GPT-5系はmax_completion_tokens対応（バグ修正）
// v1.2 2026-03-08 - モデル名をgpt-5.4に統一、max_completion_tokens分岐修正
// v1.3 2026-03-08 - GPT-5系max_completion_tokens増加（1024→4096、リーズニングトークン対策）
//                  - GPT-5系はdeveloperロール使用（system→developer）
//                  - エラー詳細ログ追加

'use strict';

/**
 * OpenAI API接続モジュール（Worker中継版）
 * お姉ちゃん（GPT）との会話を管理
 */
const ApiOpenAI = (() => {

  // --- モデル定義 ---
  const MODELS = {
    'gpt54' : 'gpt-5.4',        // v1.1追加 - 会議モード最上位
    'gpt4o' : 'gpt-4o',
    'mini'  : 'gpt-4o-mini',
  };

  // デフォルトモデル
  const DEFAULT_MODEL = 'mini';

  // v1.3追加 - GPT-5系はdeveloperロール使用（sendMessageで動的に設定）
  let _currentSystemRole = 'system';

  /**
   * OpenAI APIにメッセージを送信
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴
   * @param {Object} options - オプション
   * @returns {Promise<string>} AI の返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面からトークンを入力してください。');
    }

    const modelKey  = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];

    // v1.3追加 - GPT-5系はdeveloperロール、それ以外はsystemロール
    _currentSystemRole = modelName.startsWith('gpt-5') ? 'developer' : 'system';

    const messages  = _buildMessages(userMessage, systemPrompt, history, options.attachment);

    // リクエストボディ
    const body = {
      model   : modelName,
      messages: messages,
    };

    // v1.3修正 - gpt-5系はmax_completion_tokens（リーズニングトークン含む→4096必要）
    //           それ以外はmax_tokens（1024で十分）
    if (modelName.startsWith('gpt-5')) {
      body.max_completion_tokens = options.maxTokens || 4096;
    } else {
      body.max_tokens = options.maxTokens || 1024;
    }

    try {
      const data = await ApiCommon.callAPI('openai', body);
      const text = _extractText(data);

      // トークン使用量を記録
      const usage = data?.usage;
      if (typeof TokenMonitor !== 'undefined') {
        const inputTokens  = usage?.prompt_tokens     || 0;
        const outputTokens = usage?.completion_tokens || 0;
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
  function _buildMessages(userMessage, systemPrompt, history, attachment) {
    const messages = [];

    // v1.3修正 - GPT-5系はdeveloperロール推奨（systemも後方互換で動くが公式推奨に合わせる）
    // _buildMessagesはモデル名を知らないので、呼び出し側で判定して渡す
    if (systemPrompt) {
      messages.push({ role: _currentSystemRole, content: systemPrompt });
    }

    // 会話履歴（最新20件）
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      messages.push({
        role   : msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // 添付ファイル対応
    if (attachment && attachment.type === 'image') {
      messages.push({ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.content}` } },
        { type: 'text', text: userMessage },
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
    if (data?.error) {
      const errMsg = data?.error?.message || '不明なエラー';
      console.error('[ApiOpenAI] APIエラーレスポンス:', JSON.stringify(data.error));
      return `ごめん、お姉ちゃん側でエラーが起きたよ！🌙 ${errMsg}`;
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      // v1.3追加 - デバッグ用にレスポンス構造をログ出力
      console.warn('[ApiOpenAI] contentが空。finish_reason:', data?.choices?.[0]?.finish_reason);
      console.warn('[ApiOpenAI] usage:', JSON.stringify(data?.usage));
      return 'あれ？お姉ちゃんの返事が来なかった。もう一回試してみて！';
    }
    return text;
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
