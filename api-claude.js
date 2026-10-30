// このファイルはクロちゃん（Claude）APIとの通信をWorker経由で管理する
// v1.1 2026-03-08 - Opus 4.6のtemperature非対応修正（Opusはtemperature省略）
// v1.2 2026-03-08 - モデル名修正（claude-opus-4-6-20260205 → claude-opus-4-6）
// v1.3 2026-03-08 - max_tokens増加（1024→4096、会議モードで発言途切れ防止）
// v1.4 2026-03-11 - Phase 2a+ Tool Use対応（web_search自動検索）
// v1.5 2026-03-11 - Phase 2c ToolRegistry統合（複数ツール対応）
// v1.6 2026-03-12 - history末尾のuserMessage二重送信防止
// v1.7 2026-03-19 - skipToolsオプション追加（会議モードでtool_useエラー防止）
// v1.8 2026-10-28 - モデルをModelTiers(軽量/標準/高頭脳)から決定。temperatureは段階表で送信可否を判定（Claude 4.7+は送らない）
// v1.9 2026-10-28 - 思考の強さ: 設定で選ばれた時だけ output_config.effort を送る（未選択はAPI既定。xhigh/maxは出力枠を16000に拡大）
// v2.0 2026-10-30 - 音声会話中(options.onDelta)は受け取りながら返す（voice-stream.js が最初の1文から読み上げ）。ツール使用・失敗時は今まで通りの送り方でやり直す
// 2026-10-30 - ツール使用時に options.toolUsed / toolNames を立てる（自動フォローアップ判定・吹き出しの印用）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30

'use strict';

/**
 * Claude API接続モジュール（Worker中継版）
 * クロちゃん（Claude）との会話を管理
 */
const ApiClaude = (() => {

  // --- モデル定義 ---
  // v1.8変更 - モデルIDは model-tiers.js が唯一の定義元（lite/standard/high。旧キー haiku/sonnet/opus も受け付ける）
  const PROVIDER = 'anthropic';

  // デフォルトモデル（段階名。コスト安全・まず安いモデル）
  const DEFAULT_MODEL = 'lite';

  /** 思考トークンも max_tokens に含まれるため、xhigh/max では枠を広げる（model-effort.js） */
  function _maxTokens(effort) {
    return typeof ModelEffort !== 'undefined' ? ModelEffort.maxTokensFor('anthropic', effort, 4096) : 4096;
  }

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

    // v1.8変更 - 段階/旧キー → モデルID。不明なキーは軽量にフォールバック
    const tier      = ModelTiers.resolve(PROVIDER, options.model || DEFAULT_MODEL);
    const modelName = tier.id;
    const messages  = _buildMessages(userMessage, history, options.attachment);

    // リクエストボディ（Anthropic形式、systemは別パラメータ）
    const body = {
      model     : modelName,
      max_tokens: options.maxTokens || _maxTokens(tier.effort),
      messages  : messages,
    };

    // v1.9追加 - 思考の強さ（公式: トップレベル output_config:{effort}。betaヘッダ不要。5.5系は low/medium/high/xhigh/max 有効）【実API未確認】
    if (tier.effort) body.output_config = { effort: tier.effort };

    // v1.8変更 - Claude 4.7以降は temperature を非デフォルト値で送ると400になる【公式ドキュメント記載・実API未確認】
    // ため、段階表で sendTemperature:false のモデルには送らない（現在の3段階は全て送らない）
    if (tier.sendTemperature) {
      body.temperature = 0.3;
    }

    // systemプロンプトは別パラメータで渡す（Anthropic独自形式）
    if (systemPrompt) {
      body.system = systemPrompt;
    }

    // v1.5変更 - ToolRegistry経由で全ツール定義を追加（Phase 2c）
    // v1.7修正 - skipToolsオプションで会議モード等ツール不要時はスキップ
    if (typeof ToolRegistry !== 'undefined' && !options.skipTools) {
      body.tools = ToolRegistry.getClaudeTools();
    }

    // v2.0追加 - 音声会話: 受け取りながら返す（null=ツール/失敗 → 下の今まで通りの送り方）
    if (typeof options.onDelta === 'function' && typeof ApiCommon.streamText === 'function') {
      const streamed = await ApiCommon.streamText('claude', body, options.onDelta);
      if (streamed) return streamed;
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
    if (options) { options.toolUsed = true; (options.toolNames = options.toolNames || []).push(tuBlock.name); } // 自動フォローアップ判定・吹き出しの印用
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
    return ModelTiers.idMap(PROVIDER);
  }

  return {
    supportsStream: true, // v2.0: 音声会話で受け取りながら返せる
    sendMessage,
    hasApiKey,
    getModels,
    DEFAULT_MODEL,
  };
})();
