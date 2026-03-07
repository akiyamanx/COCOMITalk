// COCOMITalk - Claude API接続（Worker中継版）
// このファイルはクロちゃん（Claude）APIとの通信をWorker経由で管理する
// v0.5 Step 2 - 新規作成
// v0.8 Step 3 - モデルグレード切替対応（Opus追加）

'use strict';

/**
 * Claude API接続モジュール（Worker中継版）
 * クロちゃん（Claude）との会話を担当
 */
const ApiClaude = (() => {

  // --- モデル定義 ---
  // v0.8 Step 3 - モデルグレード切替用にOpus追加
  const MODELS = {
    'haiku': 'claude-haiku-4-5-20251001',
    'sonnet': 'claude-sonnet-4-20250514',
    'opus': 'claude-opus-4-6-20260205',
  };

  // デフォルトモデル（コスト安全: まず安いモデルでテスト）
  const DEFAULT_MODEL = 'haiku';

  /**
   * Claude APIにメッセージを送信
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴（{role, content}の配列）
   * @param {Object} options - オプション
   * @param {string} options.model - モデルキー（haiku/sonnet）
   * @returns {Promise<string>} AIの返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面からトークンを入力してください。');
    }

    const modelKey = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];

    // Anthropic形式のメッセージ配列を構築
    const messages = _buildMessages(userMessage, history);

    // リクエストボディ（Anthropic形式: systemは別パラメータ）
    const body = {
      model: modelName,
      max_tokens: 1024,
      temperature: 0.3,
      messages: messages,
    };

    // systemプロンプトは別パラメータで渡す（Anthropic独自形式）
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    try {
      // v0.5 - Worker経由でリクエスト
      const data = await ApiCommon.callAPI('claude', body);

      // レスポンスからテキスト抽出
      const text = _extractText(data);

      // トークン使用量を記録
      const usage = data?.usage;
      if (usage && typeof TokenMonitor !== 'undefined') {
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        TokenMonitor.record(modelName, inputTokens, outputTokens);
      }

      return text;

    } catch (error) {
      console.error('[ApiClaude] 通信エラー:', error);
      throw error;
    }
  }

  /**
   * Anthropic形式のメッセージ配列を構築
   * ※ systemプロンプトはbody.systemで渡すのでここには含めない
   */
  function _buildMessages(userMessage, history) {
    const messages = [];

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
    // Anthropicのエラーチェック
    if (data?.type === 'error') {
      const errMsg = data?.error?.message || '不明なエラー';
      return `ごめん、エラーが起きちゃった…💦（${errMsg}）`;
    }

    const content = data?.content;
    if (!content || content.length === 0) {
      return 'あれ？クロちゃんから返事が来なかった…もう一回話しかけてみて！';
    }

    // content配列からtextブロックを結合
    const texts = content
      .filter(block => block.type === 'text')
      .map(block => block.text);

    if (texts.length === 0) {
      return 'うーん、クロちゃんの言葉がうまく届かなかった…もう一回お願い！';
    }

    return texts.join('');
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
