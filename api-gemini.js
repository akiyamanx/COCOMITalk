// COCOMITalk - Gemini API接続
// このファイルはGemini APIとの通信を管理する
// v0.1 Session B - API接続基盤
// v0.4 Session D - usageMetadata取得＋TokenMonitor連携
'use strict';

/**
 * Gemini API接続モジュール
 * Gemini 2.5 Flash をデフォルトモデルとして使用
 */
const ApiGemini = (() => {

  // --- モデル定義 ---
  const MODELS = {
    'flash-lite': 'gemini-2.0-flash-lite',
    'flash': 'gemini-2.0-flash',
    'flash-25': 'gemini-2.5-flash',
    'pro': 'gemini-2.5-pro-preview-03-25',
  };

  // デフォルトモデル
  const DEFAULT_MODEL = 'flash-25';

  // APIエンドポイント
  const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

  /**
   * Gemini APIにメッセージを送信
   * @param {string} userMessage - ユーザーのメッセージ
   * @param {string} systemPrompt - システムプロンプト
   * @param {Array} history - 会話履歴（{role, content}の配列）
   * @param {Object} options - オプション
   * @param {string} options.model - モデルキー（flash-lite/flash/flash-25/pro）
   * @param {string} options.apiKey - APIキー
   * @returns {Promise<string>} AIの返答テキスト
   */
  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    const apiKey = options.apiKey || _getApiKey();
    if (!apiKey) {
      throw new Error('Gemini APIキーが設定されていません。設定画面からキーを入力してください。');
    }

    const modelKey = options.model || DEFAULT_MODEL;
    const modelName = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
    const url = `${BASE_URL}/${modelName}:generateContent?key=${apiKey}`;

    // リクエストボディ構築
    const body = _buildRequestBody(userMessage, systemPrompt, history);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;
        throw new Error(`Gemini API エラー: ${errorMsg}`);
      }

      const data = await response.json();
      const text = _extractText(data);

      // v0.4追加 - トークン使用量を記録
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
   * リクエストボディを構築
   */
  function _buildRequestBody(userMessage, systemPrompt, history) {
    // 会話履歴をGemini形式に変換
    const contents = [];

    // 履歴を追加（直近10ターン）
    const recentHistory = history.slice(-20); // 10ターン = 20メッセージ
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
   * レスポンスからテキストを抽出
   */
  function _extractText(data) {
    const candidates = data?.candidates;
    if (!candidates || candidates.length === 0) {
      // ブロックされた場合
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
   * LocalStorageからAPIキーを取得
   */
  function _getApiKey() {
    try {
      const settings = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}');
      return settings.geminiKey || '';
    } catch {
      return '';
    }
  }

  /**
   * APIキーが設定されているか確認
   */
  function hasApiKey() {
    return !!_getApiKey();
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
