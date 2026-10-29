// このファイルはお姉ちゃん（GPT）APIとの通信をWorker経由で管理する
// v1.0 2026-03-08 - 初期作成
// v1.1 2026-03-08 - GPT-5系はmax_completion_tokens対応（バグ修正）
// v1.2 2026-03-08 - モデル名をgpt-5.4に統一、max_completion_tokens分岐修正
// v1.3 2026-03-08 - GPT-5系max_completion_tokens増加（1024→4096、リーズニングトークン対策）
//                  - GPT-5系はdeveloperロール使用（system→developer）
//                  - エラー詳細ログ追加
// v1.4 2026-03-09 - max_completion_tokens 4096→8192（リーズニングトークン枯渇対策）
//                  - 空レスポンス時のリトライ機能追加（最大2回、安全ガイド準拠）
//                  - _extractText()戻り値をオブジェクト化（{text, retryable}）
// v1.5 2026-03-11 - Phase 2a+ Function Calling対応（web_search自動検索）
// v1.6 2026-03-11 - Phase 2c ToolRegistry統合（複数ツール対応）
// v1.7 2026-03-12 - history末尾のuserMessage二重送信防止
// v1.8 2026-10-28 - モデルをModelTiers(軽量/標準/高頭脳)から決定。GPT-6系対応（reasoning_effort付与・Terra/Astraはツール不可）
// v1.9 2026-10-28 - Terra/Astra: 設定スイッチON時は Responses API（api-openai-responses.js）でツール付き。失敗時は従来のChat Completions（ツール無し）へ自動フォールバック
// v2.0 2026-10-28 - 高頭脳をAstraに。強さ(reasoning_effort)は設定で変更可（tier.params経由）。xhigh/maxは出力枠を32000に拡大。Lunaは強さnone以外だとChat Completionsでツール無し
// 2026-10-30 - ツール使用時に options.toolUsed を立てる（自動フォローアップ判定用）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30

'use strict';

/**
 * OpenAI API接続モジュール（Worker中継版）
 * お姉ちゃん（GPT）との会話を管理
 */
const ApiOpenAI = (() => {

  // --- モデル定義 ---
  // v1.8変更 - モデルIDは model-tiers.js が唯一の定義元（lite/standard/high。旧キー mini/gpt4o/gpt54 も受け付ける）
  const PROVIDER = 'openai';

  // デフォルトモデル（段階名）
  const DEFAULT_MODEL = 'lite';

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

    // v1.8変更 - 段階/旧キー → モデルID＋追加パラメータ。不明なキーは軽量にフォールバック
    const tier      = ModelTiers.resolve(PROVIDER, options.model || DEFAULT_MODEL);
    const modelName = tier.id;
    const isReasoning = ModelTiers.isReasoningOpenAI(modelName); // gpt-5 / gpt-6

    // v1.3追加 - GPT-5/6系はdeveloperロール、それ以外はsystemロール
    _currentSystemRole = isReasoning ? 'developer' : 'system';

    const messages  = _buildMessages(userMessage, systemPrompt, history, options.attachment);

    // v1.9追加 - Terra/Sol＋スイッチON → Responses API（Web検索等のツール可）。【実API未確認】失敗したら下の従来経路へ戻る
    if (typeof ApiOpenAIResponses !== 'undefined' && ApiOpenAIResponses.isActiveFor(tier)) {
      try {
        const viaResponses = await ApiOpenAIResponses.run({ tier, messages, options });
        if (viaResponses) return viaResponses;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;   // ユーザーの中断は戻さない
        ApiOpenAIResponses.markFailed();
        console.warn('[ApiOpenAI] Responses API失敗 → Chat Completionsへフォールバック:', e && e.message);
      }
    }

    // リクエストボディ
    const body = {
      model   : modelName,
      messages: messages,
    };

    // v1.8追加 - 段階ごとの追加パラメータ（reasoning_effort等）【実API未確認】
    Object.assign(body, tier.params);

    // v1.6変更 - ToolRegistry経由で全ツール定義を追加（Phase 2c）
    // GPT-5系はreasoningモデルのためFunction Callingの互換性に注意
    // v1.8変更 - GPT-6: Luna(reasoning_effort=none)だけChat Completionsでツール可。Terra/SolはResponses API必須のためツール無し
    //   v1.9: Terra/Solのツールは Responses API 経路（上のブロック。既定オフ・中継側の対応が必要）。
    //   このChat Completions経路ではTerra/Solにツールを付けない（フォールバック時もここ）。
    if (typeof ToolRegistry !== 'undefined' && (!isReasoning || tier.chatTools) && !modelName.startsWith('gpt-5')) {
      body.tools = ToolRegistry.getOpenAITools();
      body.tool_choice = 'auto';
    }

    // v1.4修正 - GPT-5系のmax_completion_tokensを8192に増加
    // リーズニングトークンが3000〜4000消費するため、4096では出力枠が足りない
    if (isReasoning) {
      body.max_completion_tokens = options.maxTokens || (typeof ModelEffort !== 'undefined' ? ModelEffort.maxTokensFor('openai', tier.effort, 8192) : 8192);
    } else {
      body.max_tokens = options.maxTokens || 1024;
    }

    // v1.4追加 - リトライロジック（安全ガイド準拠: 最大2回リトライ）
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await ApiCommon.callAPI('openai', body);

        // v1.5追加 - Function Calling応答（tool_calls）の検出と処理
        const fcText = await _handleToolCalls(data, body, modelName, options);
        if (fcText) return fcText;

        const result = _extractText(data);

        // トークン使用量を記録（リトライ時も毎回記録）
        const usage = data?.usage;
        if (typeof TokenMonitor !== 'undefined') {
          const inputTokens  = usage?.prompt_tokens     || 0;
          const outputTokens = usage?.completion_tokens || 0;
          TokenMonitor.record(modelName, inputTokens, outputTokens);
        }

        if (result.text) {
          return result.text;
        }

        // リトライ不可 or 最終試行 → エラーメッセージを返す
        if (!result.retryable || attempt === MAX_RETRIES) {
          console.warn(`[ApiOpenAI] リトライ不可 or 最終試行（attempt=${attempt}）`);
          return 'ごめん、お姉ちゃんの回答生成に失敗しちゃった…💦 もう一度試してみてね！';
        }

        // リトライ前に待機（指数バックオフ: 1秒→2秒）
        console.log(`[ApiOpenAI] リトライ ${attempt + 1}/${MAX_RETRIES}（finish_reason=length）`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));

      } catch (error) {
        console.error('[ApiOpenAI] 通信エラー:', error);
        if (attempt === MAX_RETRIES) throw error;
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
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
    // v1.7修正 - 最後のメッセージが今回のuserMessageと同じなら除外（二重送信防止）
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
   * v1.6変更 - OpenAI tool_calls応答を処理（ToolRegistry統合版）
   * tool_callsが返ってきたらToolRegistryで実行 → 結果をOpenAIに返して最終回答を取得
   * 安全ガイド: 最大1回のツール呼び出し（ループ防止）
   */
  async function _handleToolCalls(data, originalBody, modelName, options) {
    const msg = data?.choices?.[0]?.message;
    if (!msg?.tool_calls || msg.tool_calls.length === 0) return null;

    const tc = msg.tool_calls[0]; // 最初の1つだけ処理（ループ防止）
    if (typeof ToolRegistry === 'undefined' || !ToolRegistry.hasTool(tc.function?.name)) return null;

    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { /* パースエラー */ }
    console.log(`[ApiOpenAI] tool_calls検出: ${tc.function.name}(${JSON.stringify(args)})`);

    // ToolRegistryでツール実行
    if (options) options.toolUsed = true; // 自動フォローアップ判定用
    const toolResult = await ToolRegistry.execute(tc.function.name, args);

    // ツール結果をOpenAIに返す（tool role形式）
    const followUpBody = { ...originalBody };
    followUpBody.messages = [
      ...originalBody.messages,
      msg, // assistantのtool_calls応答をそのまま含める
      { role: 'tool', tool_call_id: tc.id, content: toolResult },
    ];
    // 2回目はツール定義なし（ループ防止）
    delete followUpBody.tools;
    delete followUpBody.tool_choice;

    const data2 = await ApiCommon.callAPI('openai', followUpBody);
    const result = _extractText(data2);

    // トークン記録（2回目の分）
    const usage2 = data2?.usage;
    if (usage2 && typeof TokenMonitor !== 'undefined') {
      TokenMonitor.record(modelName, usage2.prompt_tokens || 0, usage2.completion_tokens || 0);
    }

    console.log(`[ApiOpenAI] Function Calling完了（${tc.function.name}） → 最終回答取得`);
    return result.text || 'ごめん、ツール結果からの回答生成に失敗しちゃった…💦';
  }

  /**
   * レスポンスからテキストを抽出
   * v1.4修正 - 戻り値を{text, retryable}オブジェクトに変更
   */
  function _extractText(data) {
    if (data?.error) {
      const errMsg = data?.error?.message || '不明なエラー';
      console.error('[ApiOpenAI] APIエラーレスポンス:', JSON.stringify(data.error));
      return { text: `ごめん、お姉ちゃん側でエラーが起きたよ！🌙 ${errMsg}`, retryable: false };
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      const reason = data?.choices?.[0]?.finish_reason || 'unknown';
      console.warn('[ApiOpenAI] contentが空。finish_reason:', reason);
      console.warn('[ApiOpenAI] usage:', JSON.stringify(data?.usage));
      // v1.4追加 - finish_reason=lengthはトークン不足 → リトライで改善の可能性あり
      return { text: null, retryable: (reason === 'length') };
    }
    return { text, retryable: false };
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
    sendMessage,
    hasApiKey,
    getModels,
    DEFAULT_MODEL,
  };
})();
