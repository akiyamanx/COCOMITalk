// COCOMITalk - 会議メモリーKV管理（Cloudflare KV経由で記憶を永続化）
// このファイルはWorkerの /memory エンドポイント経由で会議記憶を保存・取得する
// v1.0 2026-03-10 - Step 4 新規作成
'use strict';

/** 会議メモリーモジュール */
const MeetingMemory = (() => {

  // キャッシュ（セッション中は再取得を減らす）
  let _cachedMemories = null;
  let _cacheTime = 0;
  const CACHE_TTL_MS = 60000; // 1分キャッシュ

  /** Worker /memory にリクエストを送る共通関数 */
  async function _request(method, body) {
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      console.warn('[Memory] Worker未設定のためスキップ');
      return null;
    }
    const url = `${ApiCommon.getWorkerURL()}/memory`;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-COCOMI-AUTH': ApiCommon.getAuthToken(),
      },
    };
    if (body) opts.body = JSON.stringify(body);
    // GETの場合はURLパラメータ
    let fetchUrl = url;
    if (method === 'GET' && body && body.limit) {
      fetchUrl = `${url}?limit=${body.limit}`;
      delete opts.body;
    }
    try {
      const res = await fetch(fetchUrl, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.error(`[Memory] ${method}エラー:`, e.message);
      return null;
    }
  }

  /**
   * 最新N件の記憶を取得
   * @param {number} limit - 取得件数（デフォルト5、最大20）
   * @returns {Promise<Array>} - 記憶の配列
   */
  async function getMemories(limit = 5) {
    // キャッシュが有効ならそれを返す
    const now = Date.now();
    if (_cachedMemories && (now - _cacheTime) < CACHE_TTL_MS) {
      console.log('[Memory] キャッシュから取得');
      return _cachedMemories.slice(-limit);
    }
    const result = await _request('GET', { limit });
    if (result && result.memories) {
      _cachedMemories = result.memories;
      _cacheTime = now;
      console.log(`[Memory] ${result.memories.length}件取得（全${result.total}件）`);
      return result.memories;
    }
    return [];
  }

  /**
   * 会議記憶を1件保存
   * @param {object} data - { topic, summary, decisions, round, lead, mood }
   * @returns {Promise<object|null>} - 保存結果
   */
  async function saveMemory(data) {
    const result = await _request('POST', data);
    if (result && result.success) {
      // キャッシュを無効化（次回取得時に最新を取る）
      _cachedMemories = null;
      console.log(`[Memory] 保存成功: ${result.key}`);
    }
    return result;
  }

  /**
   * 会議記憶を1件削除
   * @param {string} key - 記憶のキー（例: "meeting:1710000000000"）
   * @returns {Promise<object|null>}
   */
  async function deleteMemory(key) {
    const result = await _request('DELETE', { key });
    if (result && result.success) {
      _cachedMemories = null;
      console.log(`[Memory] 削除成功: ${key}`);
    }
    return result;
  }

  /**
   * 記憶をプロンプト注入用テキストに変換
   * 最新N件の記憶を「前回の会議の決定事項」としてフォーマット
   * @param {number} limit - 件数
   * @returns {Promise<string>} - プロンプトに注入するテキスト
   */
  async function getMemoryPrompt(limit = 5) {
    const memories = await getMemories(limit);
    if (!memories || memories.length === 0) return '';

    let prompt = '\n\n【過去の会議の記憶（最新）】\n';
    for (const m of memories) {
      const date = m.createdAt ? m.createdAt.slice(0, 10) : '不明';
      prompt += `\n📌 ${date} 議題: ${m.topic}\n`;
      prompt += `  要約: ${m.summary}\n`;
      if (m.decisions && m.decisions.length > 0) {
        prompt += `  決定事項: ${m.decisions.join(' / ')}\n`;
      }
    }
    prompt += '\n上記の過去の記憶を踏まえて回答してね。\n';
    return prompt;
  }

  /**
   * 会議履歴から要約と決定事項を自動抽出してKVに保存
   * meeting-relay.jsのラウンド完了時に呼ばれる
   * @param {string} topic - 議題
   * @param {Array} history - MeetingRelayの会議履歴
   * @param {object} routing - ルーティング結果（lead等）
   */
  async function autoSaveFromMeeting(topic, history, routing) {
    if (!history || history.length === 0) return;

    // 全発言を結合して要約を作成（最初の200文字）
    const allText = history.map(h => h.content).join('\n');
    const summary = allText.substring(0, 200) + (allText.length > 200 ? '...' : '');

    // 「決定」「結論」「まとめ」等を含む発言を決定事項として抽出
    const decisionKeywords = /決定|結論|まとめ|確定|採用|方針|するべき|することに/;
    const decisions = history
      .filter(h => decisionKeywords.test(h.content))
      .map(h => h.content.substring(0, 100))
      .slice(0, 5); // 最大5件

    const lastRound = history.length > 0
      ? Math.max(...history.map(h => h.round || 1))
      : 1;

    await saveMemory({
      topic,
      summary,
      decisions,
      round: lastRound,
      lead: routing ? routing.lead : null,
      mood: 'neutral',
    });
  }

  return {
    getMemories,
    saveMemory,
    deleteMemory,
    getMemoryPrompt,
    autoSaveFromMeeting,
  };
})();
