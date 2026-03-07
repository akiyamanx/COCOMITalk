// COCOMITalk - API共通ヘルパー（Worker中継版）
// このファイルはcocomi-api-relay Worker経由のAPI呼び出しを共通化する
// 全APIモジュール（api-gemini.js, api-openai.js, api-claude.js）が使う
// v0.5 Step 2 - 共通ヘルパー新規作成

'use strict';

/**
 * API共通モジュール
 * Worker URLと認証トークンを一元管理
 */
const ApiCommon = (() => {

  // v0.5 - Worker中継URL
  const WORKER_URL = 'https://cocomi-api-relay.k-akiyaman.workers.dev';

  /**
   * Worker認証トークンを取得
   * ※ 設定画面のGemini APIキー欄を認証トークン入力に流用中
   * ※ 将来的に専用のcocomiAuthToken欄に移行予定
   */
  function getAuthToken() {
    try {
      const settings = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}');
      return settings.geminiKey || '';
    } catch {
      return '';
    }
  }

  /**
   * 認証トークンが設定されているか確認
   */
  function hasAuthToken() {
    return !!getAuthToken();
  }

  /**
   * Worker経由でAPIを呼び出す
   * @param {string} endpoint - エンドポイント名（gemini/openai/claude/whisper）
   * @param {Object|FormData} body - リクエストボディ
   * @param {Object} options - オプション
   * @param {boolean} options.isFormData - FormDataで送信する場合true
   * @returns {Promise<Object>} APIレスポンス
   */
  async function callAPI(endpoint, body, options = {}) {
    const authToken = getAuthToken();
    if (!authToken) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面のGemini APIキー欄にトークンを入力してください。');
    }

    const headers = {
      'X-COCOMI-AUTH': authToken,
    };

    let fetchBody;
    if (options.isFormData) {
      // FormData（Whisper用）はContent-Typeを自動設定
      fetchBody = body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }

    const response = await fetch(`${WORKER_URL}/${endpoint}`, {
      method: 'POST',
      headers,
      body: fetchBody,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData?.error?.message || errorData?.error || `HTTP ${response.status}`;
      throw new Error(`API中継エラー（${endpoint}）: ${errorMsg}`);
    }

    return response.json();
  }

  /**
   * Worker URLを取得（テスト用）
   */
  function getWorkerURL() {
    return WORKER_URL;
  }

  return {
    getAuthToken,
    hasAuthToken,
    callAPI,
    getWorkerURL,
  };
})();
