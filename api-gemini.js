// COCOMITalk - Gemini API接続（Worker中継版）
// このファイルはここちゃん（Gemini）APIとの通信をWorker経由で管理する
// v0.1 Session B - API接続基盤
// v0.4 Session D - usageMetadata取得＋TokenMonitor連携
// v0.5 Step 2 - Worker中継＋ApiCommon共通化
// v0.8 Step 3 - モデルグレード切替対応（flash-3/pro-3.1追加）
// v0.9 2026-03-08 - maxOutputTokens増加（1024→4096、会議モードで発言が途切れるバグ修正）
// v1.0 2026-03-11 - Phase 2a+ Function Calling対応（web_search自動検索）
// v1.1 2026-03-11 - Phase 2c ToolRegistry統合（複数ツール対応）
// v1.2 2026-03-12 - history末尾のuserMessage二重送信防止
// v1.3 2026-10-28 - モデルをModelTiers(軽量/標準/高頭脳)から決定（旧モデルID表を廃止）
// v1.4 2026-10-28 - 思考レベル: 設定で選ばれた時だけ generationConfig.thinkingConfig.thinkingLevel を送る。思考トークン(thoughtsTokenCount)も出力として記録
// v1.6 2026-10-30 - 実行したツール名を options.toolNames に記録（吹き出しの印用）
// v1.5 2026-10-30 - Function Calling 2回目に元のpartsをそのまま返す（thoughtSignature保持）。複数functionCallに対応。ツール使用をoptions.toolUsedで通知
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30

'use strict';

/**
 * Gemini API接続モジュール（Worker中継版）
 * ここちゃん（Gemini）との会話を担当
 */
const ApiGemini = (() => {

  // --- モデル定義 ---
  // v1.3変更 - モデルIDは model-tiers.js が唯一の定義元（lite/standard/high。旧キー flash-25/flash-3/pro-31 等も受け付ける）
  // ※旧 gemini-2.0-flash 系は停止済みのため、旧キー flash-lite/flash は軽量(3.5 Flash-Lite)へ寄せる
  const PROVIDER = 'gemini';

  // デフォルトモデル（段階名）
  const DEFAULT_MODEL = 'lite';

  /**
   * Gemini APIにメッセージを送信（Worker中継版）
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴（{role, content}の配列）
   * @param {Object} options - オプション
   * @param {string} options.model - モデルキー（flash-lite/flash/flash-25/pro）
   * @returns {Promise<string>} AIの返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    // v0.5変更 - ApiCommonで認証チェック
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面のGemini APIキー欄にトークンを入力してください。');
    }

    // v1.3変更 - 段階/旧キー → モデルID。不明なキーは軽量にフォールバック
    const tier = ModelTiers.resolve(PROVIDER, options.model || DEFAULT_MODEL);
    const modelName = tier.id;

    // リクエストボディ構築（v1.0変更 - 添付ファイル対応）
    const body = _buildRequestBody(userMessage, systemPrompt, history, options.attachment);

    // v0.9修正 - 出力上限を4096に増加（会議モードでここちゃんの発言が途切れるバグ修正）
    body.generationConfig.maxOutputTokens = options.maxTokens || 4096;

    // v1.4追加 - 思考レベル（公式REST: generationConfig.thinkingConfig.thinkingLevel。思考トークンも出力枠に含まれる）【実API未確認】
    if (tier.effort) body.generationConfig.thinkingConfig = { thinkingLevel: tier.effort };

    // v0.5追加 - Worker用にmodelフィールドを追加
    body.model = modelName;

    // v1.1変更 - ToolRegistry経由で全ツール定義を追加（Phase 2c）
    if (typeof ToolRegistry !== 'undefined') {
      body.tools = [ToolRegistry.getGeminiTools()];
    }

    try {
      // v0.5変更 - ApiCommon経由でリクエスト
      const data = await ApiCommon.callAPI('gemini', body);

      // v1.0追加 - Function Calling応答の検出と処理
      const fcResult = await _handleFunctionCall(data, body, modelName, options);
      if (fcResult) return fcResult;

      const text = _extractText(data);

      // v0.4追加 - トークン使用量を記録（変更なし）
      const usage = data?.usageMetadata;
      if (usage && typeof TokenMonitor !== 'undefined') {
        const inputTokens = usage.promptTokenCount || 0;
        // v1.4: 思考トークン(thoughtsTokenCount)は出力として課金される（公式）ので足して記録
        const outputTokens = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
        TokenMonitor.record(modelName, inputTokens, outputTokens);
      }

      return text;

    } catch (error) {
      console.error('[ApiGemini] 通信エラー:', error);
      throw error;
    }
  }

  /**
   * リクエストボディを構築（v1.0変更 - 添付ファイル対応）
   */
  function _buildRequestBody(userMessage, systemPrompt, history, attachment) {
    const contents = [];

    // 履歴を追加（直近10ターン）
    // v1.2修正 - 最後のメッセージが今回のuserMessageと同じなら除外（二重送信防止）
    let recentHistory = history.slice(-20);
    if (recentHistory.length > 0) {
      const last = recentHistory[recentHistory.length - 1];
      if (last.role === 'user' && last.content === userMessage) {
        recentHistory = recentHistory.slice(0, -1);
      }
    }
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // 現在のユーザーメッセージ（v1.0変更 - 添付ファイル付き）
    const userParts = [{ text: userMessage }];

    if (attachment) {
      if (attachment.type === 'text') {
        // テキスト添付 → メッセージに追加
        userParts.unshift({ text: `【添付ファイル: ${attachment.name}】\n${attachment.content}` });
      } else if (attachment.type === 'image') {
        // 画像添付 → inlineData形式（Geminiのマルチモーダル）
        userParts.push({
          inlineData: { mimeType: attachment.mimeType, data: attachment.content }
        });
      }
    }

    contents.push({ role: 'user', parts: userParts });

    const body = {
      contents,
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        topK: 40,
        // v0.9修正 - maxOutputTokensはsendMessage側で上書き（デフォルト4096）
        maxOutputTokens: 4096,
      },
    };

    // システムプロンプトを設定
    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    // 安全設定（ブロックしすぎ防止）
    body.safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ];

    return body;
  }

  /**
   * v1.1変更 - Gemini Function Calling応答を処理（ToolRegistry統合版）
   * functionCallが返ってきたらToolRegistryで実行 → 結果をGeminiに返して最終回答を取得
   * 安全ガイド: 最大1回のツール呼び出し（ループ防止）
   */
  async function _handleFunctionCall(data, originalBody, modelName, options) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts) return null;

    const fcPart = parts.find(p => p.functionCall);
    if (!fcPart || !fcPart.functionCall) return null;

    const fc = fcPart.functionCall;
    if (typeof ToolRegistry === 'undefined' || !ToolRegistry.hasTool(fc.name)) return null;
    if (options) options.toolUsed = true; // v1.5: 自動フォローアップ判定用

    console.log(`[ApiGemini] Function Call検出: ${fc.name}(${JSON.stringify(fc.args)})`);

    // ToolRegistryでツール実行
    // v1.5: モデルの返したparts（thoughtSignature含む）をそのまま返す。functionCallが複数なら全部に答える（最大3つ）
    const responses = [];
    for (const [i, p] of parts.filter(x => x.functionCall).entries()) {
      const f = p.functionCall;
      const ok = i < 3 && ToolRegistry.hasTool(f.name);
      if (ok && options) (options.toolNames = options.toolNames || []).push(f.name); // v1.6: 吹き出しの「ツールを使ったよ」印用
      const result = ok ? await ToolRegistry.execute(f.name, f.args || {}) : '（このツールは実行しませんでした）';
      responses.push({ functionResponse: { name: f.name, response: { result } } });
    }

    // ツール結果をGeminiに返す（functionResponse形式）
    const followUpBody = { ...originalBody };
    followUpBody.contents = [
      ...originalBody.contents,
      { role: 'model', parts },
      { role: 'user', parts: responses },
    ];
    // 2回目はツール定義なし（ループ防止）
    delete followUpBody.tools;

    const data2 = await ApiCommon.callAPI('gemini', followUpBody);
    const text = _extractText(data2);

    // トークン記録（2回目の分）
    const usage2 = data2?.usageMetadata;
    if (usage2 && typeof TokenMonitor !== 'undefined') {
      TokenMonitor.record(modelName, usage2.promptTokenCount || 0, (usage2.candidatesTokenCount || 0) + (usage2.thoughtsTokenCount || 0));
    }

    console.log(`[ApiGemini] Function Calling完了（${fc.name}） → 最終回答取得`);
    return text;
  }

  /**
   * レスポンスからテキストを抽出（従来と同じ）
   */
  function _extractText(data) {
    const candidates = data?.candidates;
    if (!candidates || candidates.length === 0) {
      const blockReason = data?.promptFeedback?.blockReason;
      if (blockReason) {
        return 'ごめんね、その内容にはうまく答えられないみたい…💦 別の聞き方で試してみて！';
      }
      return 'あれ？うまく返事できなかった…もう一回話しかけてみて！😊';
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      return 'うーん、言葉がうまく出てこなかった…もう一回お願い！';
    }

    return parts.map(p => p.text || '').join('');
  }

  /**
   * v0.5変更 - 認証トークンが設定されているか確認
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
