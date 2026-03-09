// COCOMITalk - API共通ヘルパー（Worker中継版）
// このファイルはcocomi-api-relay Worker経由のAPI呼び出しを共通化する
// v0.5 Step 2 - 共通ヘルパー新規作成
// v0.6 2026-03-10 - AbortController対応（送信キャンセル機能）

'use strict';

/**
 * API共通モジュール
 * Worker URLと認証トークンを一元管理
 */
const ApiCommon = (() => {

  const WORKER_URL = 'https://cocomi-api-relay.k-akiyaman.workers.dev';

  // v0.6追加 - 現在進行中のAbortControllerを保持
  let _activeControllers = [];

  function getAuthToken() {
    try {
      const settings = JSON.parse(localStorage.getItem('cocomitalk-settings') || '{}');
      return settings.geminiKey || '';
    } catch {
      return '';
    }
  }

  function hasAuthToken() {
    return !!getAuthToken();
  }

  /**
   * Worker経由でAPIを呼び出す
   * v0.6変更 - AbortController対応（options.signalで外部からも渡せる）
   */
  async function callAPI(endpoint, body, options = {}) {
    const authToken = getAuthToken();
    if (!authToken) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面のGemini APIキー欄にトークンを入力してください。');
    }

    // v0.6追加 - AbortController生成
    const controller = new AbortController();
    _activeControllers.push(controller);

    const headers = { 'X-COCOMI-AUTH': authToken };
    let fetchBody;
    if (options.isFormData) {
      fetchBody = body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${WORKER_URL}/${endpoint}`, {
        method: 'POST',
        headers,
        body: fetchBody,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || errorData?.error || `HTTP ${response.status}`;
        throw new Error(`API中継エラー（${endpoint}）: ${errorMsg}`);
      }

      return response.json();
    } finally {
      // v0.6追加 - 完了したcontrollerをリストから除去
      _activeControllers = _activeControllers.filter(c => c !== controller);
    }
  }

  /**
   * v0.6追加 - 全ての進行中APIリクエストを中断
   * @returns {number} 中断したリクエスト数
   */
  function abortAll() {
    const count = _activeControllers.length;
    for (const c of _activeControllers) {
      try { c.abort(); } catch (e) { /* 既に終了してる場合は無視 */ }
    }
    _activeControllers = [];
    console.log(`[ApiCommon] ${count}件のAPIリクエストを中断`);
    return count;
  }

  /** v0.6追加 - 進行中のリクエストがあるか */
  function hasActiveRequests() {
    return _activeControllers.length > 0;
  }

  function getWorkerURL() { return WORKER_URL; }

  return {
    getAuthToken,
    hasAuthToken,
    callAPI,
    getWorkerURL,
    abortAll,
    hasActiveRequests,
  };
})();
