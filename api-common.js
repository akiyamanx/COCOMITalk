// COCOMITalk - API共通ヘルパー（Worker中継版）
// このファイルはcocomi-api-relay Worker経由のAPI呼び出しを共通化する
// v0.5 Step 2 - 共通ヘルパー新規作成
// v0.6 2026-03-10 - AbortController対応（送信キャンセル機能）
// v0.7 2026-03-24 - タイムアウト検出＋エラーメッセージ強化（30秒制限の原因特定支援）
// v0.8 2026-07-16 - 送信直前JSON記録デバッグログ追加（お姉ちゃんJSON破損バグ調査用・DebugLogger稼働時のみ）
// v0.9 2026-07-17 - 孤立サロゲート検知＋消毒（絵文字の片割れによる400対策・検知時は必ずログ）
// v0.10 2026-07-17 - 400番台エラー時のbody全文＋本家エラー詳細ダンプ（真犯人特定用・DebugLogger稼働時のみ）
// v0.11 2026-10-30 - callAPIStream に onDelta（届いた文字をすぐ渡す）とツール呼び出し検知（_toolCall）を追加。streamText() 追加（音声会話の読み上げ用・失敗時は null で今まで通りに戻す）
// v0.12 2026-10-30 - hooks.keepTools: Claude の tool_use を止めずに最後まで受け取り、content(text/tool_use)を組み立てて返す（やり直し送信を1回減らす）。streamData() 追加
// v0.13 2026-10-30 - tool_use は content_block_stop まで届いたものだけ実行可（input_json_delta が揃う前に組み立てない）

'use strict';

/**
 * API共通モジュール
 * Worker URLと認証トークンを一元管理
 */
const ApiCommon = (() => {

  const WORKER_URL = 'https://cocomi-api-relay.k-akiyaman.workers.dev';

  // v0.6追加 - 現在進行中のAbortControllerを保持
  let _activeControllers = [];

  // --- v0.9 孤立サロゲート消毒ここから ---
  // v0.9追加 - 孤立サロゲート（絵文字の片割れ）の検知と除去
  // 絵文字などは内部的に2文字ペア（サロゲートペア）で表現される。
  // 片割れだけが混入するとOpenAI/ClaudeがJSON不正(400)として拒否するため、
  // 送信直前に除去する。除去した時は必ずログに残す（無言で直さない）。
  function _sanitizeLoneSurrogates(s) {
    const hits = [];
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const n = (i + 1 < s.length) ? s.charCodeAt(i + 1) : -1;
        if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue; }
        hits.push({ index: i, around: s.slice(Math.max(0, i - 40), i) + '◆' + s.slice(i + 1, i + 41) });
        continue;
      }
      if (c >= 0xDC00 && c <= 0xDFFF) {
        hits.push({ index: i, around: s.slice(Math.max(0, i - 40), i) + '◆' + s.slice(i + 1, i + 41) });
        continue;
      }
      out += s[i];
    }
    return { text: hits.length ? out : s, hits: hits };
  }

  // v0.9追加 - 消毒付きJSON化（全API送信のチョークポイント）
  function _stringifyWithSanitize(body, endpoint) {
    const totalHits = [];
    const json = JSON.stringify(body, (key, val) => {
      if (typeof val !== 'string') return val;
      const r = _sanitizeLoneSurrogates(val);
      for (const h of r.hits) totalHits.push({ key: key, index: h.index, around: h.around });
      return r.text;
    });
    if (totalHits.length) {
      try {
        console.warn('[ApiCommon] 孤立サロゲート' + totalHits.length + '件を消毒して送信 [' + endpoint + ']', totalHits);
        if (typeof window !== 'undefined' && window.DebugLogger && window.DebugLogger.isActive()) {
          const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
          window.DebugLogger.addLog('[' + ts + '] 🧹孤立サロゲート消毒 [' + endpoint + '] ' + totalHits.length + '件');
          for (const h of totalHits.slice(0, 3)) {
            window.DebugLogger.addLog('[' + ts + '] 　key=' + h.key + ' 位置=' + h.index + ' 前後: ' + h.around);
          }
        }
      } catch (_e) { /* ログ失敗は送信に影響させない */ }
    }
    return json;
  }
  // --- v0.9 孤立サロゲート消毒ここまで ---

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
      // v0.9変更 - 消毒付きJSON化（孤立サロゲート対策）
      fetchBody = _stringifyWithSanitize(body, endpoint);
    }

    // v0.8追加 - 送信直前JSON記録（お姉ちゃんJSON破損バグ調査用・DebugLogger稼働時のみ記録）
    // 既存フローは変更しない。ログ機能自体がAPIを止めないようtry/catchで完全隔離。
    try {
      if (!options.isFormData && typeof window !== 'undefined'
          && window.DebugLogger && window.DebugLogger.isActive()) {
        const _ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
        const _model = (body && body.model) ? body.model : '(model無し)';
        const _hasTools = !!(body && body.tools);
        const _len = (typeof fetchBody === 'string') ? fetchBody.length : -1;
        const _head = (typeof fetchBody === 'string') ? fetchBody.slice(0, 300) : '(非文字列)';
        window.DebugLogger.addLog(`[${_ts}] 📤送信JSON [${endpoint}] model=${_model} tools=${_hasTools} 長さ=${_len}`);
        window.DebugLogger.addLog(`[${_ts}] 先頭300字: ${_head}`);
      }
    } catch (_e) { /* ログ失敗はAPIに影響させない */ }

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
        // v0.10エラーダンプ - 400番台の時だけ、送信body全文＋本家エラー詳細を記録（真犯人特定用）
        // 既存のエラー処理フローは変更しない。ログ出力のみ追加。DebugLogger稼働時のみ。
        try {
          if (response.status >= 400 && response.status < 500
              && typeof window !== 'undefined' && window.DebugLogger && window.DebugLogger.isActive()) {
            const _ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
            window.DebugLogger.addLog(`[${_ts}] 🚨${response.status}エラー [${endpoint}] 本家詳細: ${errorMsg}`);
            if (typeof fetchBody === 'string') {
              window.DebugLogger.addLog(`[${_ts}] 🚨送信body全長: ${fetchBody.length}字`);
              // 全文を600字ずつ分割して記録（300字先頭ログの奥まで見るため）
              for (let _p = 0; _p < fetchBody.length; _p += 600) {
                window.DebugLogger.addLog(`[${_ts}] body[${_p}]: ${fetchBody.slice(_p, _p + 600)}`);
              }
            }
          }
        } catch (_e) { /* ログ失敗はエラー処理に影響させない */ }
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
  async function callAPIStream(endpoint, body, hooks = {}) {
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
        body: _stringifyWithSanitize(body, endpoint), // v0.9変更 - 消毒付きJSON化
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
      let toolCall = false; // v0.11: ツールを呼ぼうとしたら止める（呼び出し側が普通の送り方でやり直す）
      const keep = !!hooks.keepTools && endpoint === 'claude'; // v0.12: 止めずに tool_use の中身まで受け取る
      const blocks = []; // v0.12: Claude の content ブロック（index順）
      const emit = (d) => { fullText += d; if (hooks.onDelta) { try { hooks.onDelta(d); } catch (e) { /* 読み上げ側の失敗で受信を止めない */ } } };

      while (!toolCall || keep) {
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
              if (parsed.choices?.[0]?.delta?.tool_calls) toolCall = true;
              if (delta) emit(delta);
              const fr = parsed.choices?.[0]?.finish_reason;
              if (fr) finishReason = fr;
            } else if (endpoint === 'claude') {
              // Claude SSE: delta.text (content_block_delta) or delta.stop_reason (message_delta)
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text;
                if (delta) { emit(delta); const b = blocks[parsed.index]; if (b && b.type === 'text') b.text += delta; }
                if (parsed.delta?.type === 'input_json_delta') { const b = blocks[parsed.index]; if (b) b._json += parsed.delta.partial_json || ''; }
              } else if (parsed.type === 'content_block_start') {
                const cb = parsed.content_block || {};
                if (cb.type === 'tool_use') { toolCall = true; blocks[parsed.index] = { type: 'tool_use', id: cb.id, name: cb.name, _json: '' }; }
                else if (cb.type === 'text') blocks[parsed.index] = { type: 'text', text: cb.text || '' };
              } else if (parsed.type === 'content_block_stop') {
                const b = blocks[parsed.index]; if (b) b._stop = true; // v0.13: このブロックの断片は全部届いた
              } else if (parsed.type === 'message_delta') {
                stopReason = parsed.delta?.stop_reason || null;
              }
            }
          } catch (e) {
            // JSONパース失敗は無視（不完全なチャンク）
          }
        }
      }

      if (toolCall) { try { await reader.cancel(); } catch (e) { /* ignore */ } }
      // 各API形式に合わせたレスポンスオブジェクトを組み立てて返す
      const out = endpoint === 'openai'
        ? { choices: [{ message: { content: fullText }, finish_reason: finishReason || 'stop' }] }
        : { content: [{ type: 'text', text: fullText }], stop_reason: stopReason || 'end_turn' };
      if (toolCall) out._toolCall = true;
      if (toolCall && keep) { // v0.12: tool_use の input を組み立てる（読めなければ _toolCall のまま＝やり直し）
        try {
          out.content = blocks.filter(b => b && (b.type !== 'text' || b.text)).map(b => b.type === 'tool_use'
            ? { type: 'tool_use', id: b.id, name: b.name, input: b._json ? JSON.parse(b._json) : {} } : { type: 'text', text: b.text });
          const tus = blocks.filter(b => b && b.type === 'tool_use');
          out._toolsReady = tus.length > 0 && tus.every(b => b._stop && b.id && b.name); // v0.13: 全部 stop 済みの時だけ
        } catch (e) { out._toolsReady = false; }
      }
      return out;
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
   * v0.11追加 - 文字を受け取りながら返事を作る（音声会話用）。返事の文字列を返す。
   * ツールを呼ぼうとした・空・通信エラーの時は null（呼び出し側が今まで通りの送り方でやり直す）。中断(AbortError)はそのまま投げる
   */
  async function streamText(endpoint, body, onDelta) {
    try {
      const r = await callAPIStream(endpoint, { ...body, stream: true }, { onDelta });
      if (r._toolCall) return null;
      const t = endpoint === 'openai' ? r.choices[0].message.content : r.content[0].text;
      return t && t.trim() ? t : null;
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      console.warn('[ApiCommon] streamText 失敗→通常送信へ:', e && e.message);
      return null;
    }
  }

  /**
   * v0.12追加 - streamText と同じだが、Claude のツール呼び出しも組み立てて返す（{content, stop_reason, _toolCall, _toolsReady}）。失敗は null
   */
  async function streamData(endpoint, body, onDelta) {
    try {
      return await callAPIStream(endpoint, { ...body, stream: true }, { onDelta, keepTools: true });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      console.warn('[ApiCommon] streamData 失敗→通常送信へ:', e && e.message);
      return null;
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
    streamText,
    streamData,
    getWorkerURL,
    abortAll,
    hasActiveRequests,
  };
})();
