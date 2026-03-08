// COCOMITalk - Gemini API接続（Worker中継版）
// このファイルはここちゃん（Gemini）APIとの通信をWorker経由で管理する
// v0.1 Session B - API接続基盤
// v0.4 Session D - usageMetadata取得＋TokenMonitor連携
// v0.5 Step 2 - Worker中継＋ApiCommon共通化
// v0.8 Step 3 - モデルグレード切替対応（flash-3/pro-3.1追加）

'use strict';

/**
 * Gemini API接続モジュール（Worker中継版）
 * ここちゃん（Gemini）との会話を担当
 */
const ApiGemini = (() => {

  // --- モデル定義 ---
  // v0.8 Step 3 - モデルグレード切替用に追加
  // v0.9.5修正 - 正しいAPIモデル名に修正（Gemini 3系は-preview必須）
  const MODELS = {
    'flash-lite': 'gemini-2.0-flash-lite',
    'flash': 'gemini-2.0-flash',
    'flash-25': 'gemini-2.5-flash',
    'flash-3': 'gemini-3-flash-preview',
    'pro': 'gemini-2.5-pro-preview-03-25',
    'pro-31': 'gemini-3.1-pro-preview',
  };

  // デフォルトモデル
  const DEFAULT_MODEL = 'flash-25';

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

    const modelKey = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];

    // リクエストボディ構築（従来と同じ）
    const body = _buildRequestBody(userMessage, systemPrompt, history);

    // v0.5追加 - Worker用にmodelフィールドを追加
    body.model = modelName;

    try {
      // v0.5変更 - ApiCommon経由でリクエスト
      const data = await ApiCommon.callAPI('gemini', body);
      const text = _extractText(data);

      // v0.4追加 - トークン使用量を記録（変更なし）
      const usage = data?.usageMetadata;
      if (usage && typeof TokenMonitor !== 'undefined') {
        const inputTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;
        TokenMonitor.record(modelName, inputTokens, outputTokens);
      }

      return text;

    } catch (error) {
      console.error('[ApiGemini] 通信エラー:', error);
      throw error;
    }
  }

  /**
   * リクエストボディを構築（従来と同じ）
   */
  function _buildRequestBody(userMessage, systemPrompt, history) {
    // 会話履歴をGemini形式に変換
    const contents = [];

    // 履歴を追加（直近10ターン）
    const recentHistory = history.slice(-20);
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      });
    }

    // 現在のユーザーメッセージ
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    const body = {
      contents,
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024,
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
    return { ...MODELS };
  }

  return {
    sendMessage,
    hasApiKey,
    getModels,
    DEFAULT_MODEL,
  };
})();
