// COCOMITalk - API共通ヘルパー（Worker中継版）
// このファイルはcocomi-api-relay Worker経由のAPI呼び出しを共通化する
// v0.5 Step 2 - 共通ヘルパー新規作成
// v0.6 2026-03-10 - AbortController対応（送信キャンセル機能）
// v0.7 2026-03-24 - タイムアウト検出＋エラーメッセージ強化（30秒制限の原因特定支援）

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
   * v0.7変更 - タイムアウト検出＋エラーメッセージ強化
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

    // v0.7追加 - リクエスト開始時刻を記録（タイムアウト判定用）
    const startTime = Date.now();

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
        // v0.7追加 - 502/504/524はWorkerタイムアウトの可能性を明示
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if ([502, 504, 524].includes(response.status)) {
          throw new Error(`${endpoint}: Workerタイムアウト（${elapsed}秒）。上位モデルの設計書は30秒制限に引っかかる場合があるよ`);
        }
        throw new Error(`API中継エラー（${endpoint}）: ${errorMsg}（${elapsed}秒）`);
      }

      return response.json();
    } catch (err) {
      // v0.7追加 - ネットワークエラー時のタイムアウト判定
      if (err.name === 'TypeError' || err.message === 'Failed to fetch') {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (elapsed > 25) {
          throw new Error(`${endpoint}: 通信タイムアウト（${elapsed}秒）。Workerの30秒制限が原因の可能性が高いよ`);
        }
        throw new Error(`${endpoint}: 通信エラー（${elapsed}秒）: ${err.message}`);
      }
      throw err;
    } finally {
      // v0.6追加 - 完了したcontrollerをリストから除去
      _activeControllers = _activeControllers.filter(c => c !== controller);
    }
  }

  /**
   * v0.7追加 - ストリーミングAPI呼び出し（SSEパース＋テキスト組み立て）
   * Worker経由でstream:trueのリクエストを投げ、SSEストリームを受信して
   * テキストを組み立てて返す。30秒タイムアウト回避用。
   * @param {string} endpoint - 'openai' or 'claude'
   * @param {Object} body - APIリクエストボディ（stream:trueを含む）
   * @returns {Promise<Object>} OpenAI形式 or Claude形式のレスポンスオブジェクト
   */
  async function callAPIStream(endpoint, body) {
    const authToken = getAuthToken();
    if (!authToken) {
      throw new Error('COCOMI認証トークンが設定されていません');
    }

    const controller = new AbortController();
    _activeControllers.push(controller);
    const startTime = Date.now();

    try {
      const response = await fetch(`${WORKER_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-COCOMI-AUTH': authToken,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData?.error?.message || errorData?.error || `HTTP ${response.status}`;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        throw new Error(`API中継エラー（${endpoint}）: ${errorMsg}（${elapsed}秒）`);
      }

      // SSEストリームをパースしてテキストを組み立てる
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let finishReason = null;
      let stopReason = null;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 最後の不完全な行はバッファに残す
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(dataStr);
            if (endpoint === 'openai') {
              // OpenAI SSE: choices[0].delta.content
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) fullText += delta;
              const fr = parsed.choices?.[0]?.finish_reason;
              if (fr) finishReason = fr;
            } else if (endpoint === 'claude') {
              // Claude SSE: delta.text (content_block_delta) or delta.stop_reason (message_delta)
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text;
                if (delta) fullText += delta;
              } else if (parsed.type === 'message_delta') {
                stopReason = parsed.delta?.stop_reason || null;
              }
            }
          } catch (e) {
            // JSONパース失敗は無視（不完全なチャンク）
          }
        }
      }

      // 各API形式に合わせたレスポンスオブジェクトを組み立てて返す
      if (endpoint === 'openai') {
        return {
          choices: [{ message: { content: fullText }, finish_reason: finishReason || 'stop' }],
        };
      } else {
        return {
          content: [{ type: 'text', text: fullText }],
          stop_reason: stopReason || 'end_turn',
        };
      }
    } catch (err) {
      if (err.name === 'TypeError' || err.message === 'Failed to fetch') {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        throw new Error(`${endpoint}: ストリーミング通信エラー（${elapsed}秒）: ${err.message}`);
      }
      throw err;
    } finally {
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
    callAPIStream,
    getWorkerURL,
    abortAll,
    hasActiveRequests,
  };
})();
