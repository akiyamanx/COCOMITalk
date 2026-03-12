// このファイルはクロちゃん（Claude）APIとの通信をWorker経由で管理する
// v1.1 2026-03-08 - Opus 4.6のtemperature非対応修正（Opusはtemperature省略）
// v1.2 2026-03-08 - モデル名修正（claude-opus-4-6-20260205 → claude-opus-4-6）
// v1.3 2026-03-08 - max_tokens増加（1024→4096、会議モードで発言途切れ防止）
// v1.4 2026-03-11 - Phase 2a+ Tool Use対応（web_search自動検索）
// v1.5 2026-03-11 - Phase 2c ToolRegistry統合（複数ツール対応）
// v1.6 2026-03-12 - history末尾のuserMessage二重送信防止

'use strict';

/**
 * Claude API接続モジュール（Worker中継版）
 * クロちゃん（Claude）との会話を管理
 */
const ApiClaude = (() => {

  // --- モデル定義 ---
  const MODELS = {
    'haiku' : 'claude-haiku-4-5-20251001',
    'opus'  : 'claude-opus-4-6',            // v1.2修正 - 正しいモデル名
    'sonnet': 'claude-sonnet-4-6',
  };

  // デフォルトモデル（コスト安全・まず安いモデルでテスト）
  const DEFAULT_MODEL = 'haiku';

  /**
   * Claude APIにメッセージを送信
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴（role, contentの配列）
   * @param {Object} options - オプション
   * @param {string} options.model - モデルキー（haiku/sonnet/opus）
   * @returns {Promise<string>} AI の返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面からトークンを入力してください。');
    }

    const modelKey  = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
    const messages  = _buildMessages(userMessage, history, options.attachment);

    // リクエストボディ（Anthropic形式、systemは別パラメータ）
    const body = {
      model     : modelName,
      max_tokens: options.maxTokens || 4096,
      messages  : messages,
    };

    // v1.2修正 - Opus 4.6はtemperatureが使えないため省略、他モデルは0.3
    if (!modelName.includes('opus')) {
      body.temperature = 0.3;
    }

    // systemプロンプトは別パラメータで渡す（Anthropic独自形式）
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    // v1.5変更 - ToolRegistry経由で全ツール定義を追加（Phase 2c）
    if (typeof ToolRegistry !== 'undefined') {
      body.tools = ToolRegistry.getClaudeTools();
    }

    try {
      // v0.5 - Worker経由でリクエスト
      const data = await ApiCommon.callAPI('claude', body);

      // v1.4追加 - Tool Use応答の検出と処理
      const tuText = await _handleToolUse(data, body, modelName, options);
      if (tuText) return tuText;

      // レスポンスからテキスト抽出
      const text = _extractText(data);

      // トークン使用量を記録
      const usage = data?.usage;
      if (typeof TokenMonitor !== 'undefined') {
        const inputTokens  = usage?.input_tokens  || 0;
        const outputTokens = usage?.output_tokens || 0;
        TokenMonitor.record(modelName, inputTokens, outputTokens);
      }

      return text;
    } catch (error) {
      console.error('[ApiClaude] 通信エラー:', error);
      throw error;
    }
  }

  /**
   * Anthropic形式のメッセージ配列を構築（v1.0変更・添付ファイル対応）
   */
  function _buildMessages(userMessage, history, attachment) {
    const messages = [];

    // v1.6修正 - 最後のメッセージが今回のuserMessageと同じなら除外（二重送信防止）
    let recentHistory = history.slice(-20);
    if (recentHistory.length > 0) {
      const last = recentHistory[recentHistory.length - 1];
      if (last.role === 'user' && last.content === userMessage) {
        recentHistory = recentHistory.slice(0, -1);
      }
    }
    for (const msg of recentHistory) {
      messages.push({
        role   : msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // v1.0追加 - 添付ファイル対応
    if (attachment && attachment.type === 'image') {
      // Anthropic Vision形式（content配列）
      messages.push({ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.content } },
        { type: 'text',  text: userMessage },
      ]});
    } else if (attachment && attachment.type === 'text') {
      messages.push({ role: 'user', content: `【添付ファイル: ${attachment.name}】\n${attachment.content}\n\n${userMessage}` });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    return messages;
  }

  /**
   * v1.5変更 - Claude Tool Use応答を処理（ToolRegistry統合版）
   * tool_useブロックが返ってきたらToolRegistryで実行 → 結果をClaudeに返して最終回答を取得
   * 安全ガイド: 最大1回のツール呼び出し（ループ防止）
   */
  async function _handleToolUse(data, originalBody, modelName, options) {
    const content = data?.content;
    if (!content || !Array.isArray(content)) return null;

    const tuBlock = content.find(b => b.type === 'tool_use');
    if (!tuBlock || typeof ToolRegistry === 'undefined' || !ToolRegistry.hasTool(tuBlock.name)) return null;

    console.log(`[ApiClaude] tool_use検出: ${tuBlock.name}(${JSON.stringify(tuBlock.input)})`);

    // ToolRegistryでツール実行
    const toolResult = await ToolRegistry.execute(tuBlock.name, tuBlock.input || {});

    // ツール結果をClaudeに返す（tool_result形式）
    const followUpBody = { ...originalBody };
    followUpBody.messages = [
      ...originalBody.messages,
      { role: 'assistant', content: content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuBlock.id, content: toolResult }] },
    ];
    // 2回目はツール定義なし（ループ防止）
    delete followUpBody.tools;

    const data2 = await ApiCommon.callAPI('claude', followUpBody);
    const text = _extractText(data2);

    // トークン記録（2回目の分）
    const usage2 = data2?.usage;
    if (usage2 && typeof TokenMonitor !== 'undefined') {
      TokenMonitor.record(modelName, usage2.input_tokens || 0, usage2.output_tokens || 0);
    }

    console.log(`[ApiClaude] Tool Use完了（${tuBlock.name}） → 最終回答取得`);
    return text;
  }

  /**
   * レスポンスからテキストを抽出
   */
  function _extractText(data) {
    // Anthropicのエラーチェック
    if (data?.type === 'error') {
      const errMsg = data?.error?.message || '不明なエラー';
      return `ごめん、エラーが起きちゃった！🌙 ${errMsg}`;
    }

    const content = data?.content;
    if (!content || content.length === 0) {
      return 'あれ？クロちゃんの返事が来なかった。もう一回試しかてみて！';
    }
    const texts = content
      .filter(block => block.type === 'text')
      .map(block => block.text);

    if (texts.length === 0) {
      return 'ラーん、クロちゃんの返事がうまく届かなかった。もう一回お願い！';
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
