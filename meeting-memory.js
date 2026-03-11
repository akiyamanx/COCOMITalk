// COCOMITalk - 会議メモリーKV管理（Cloudflare KV経由で記憶を永続化）
// このファイルはWorkerの /memory エンドポイント経由で会議記憶を保存・取得する
// v1.0 2026-03-10 - Step 4 新規作成
// v1.1 2026-03-10 - Step 4強化: AI要約対応（rawHistoryをWorkerに送信）
// v1.2 2026-03-11 - フォールバック要約/決定事項の品質改善
// v1.3 2026-03-11 - マークダウン記法除去（見出し・太字・リスト・テーブル）
// v1.4 2026-03-11 - getMemoriesWithTotal追加＋deleteAllMemories追加（メモリー管理UI改善）
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
   * v1.1改修: rawHistoryをWorkerに送信してAI要約を依頼
   *           Worker側でGemini Flashが要約＋決定事項を抽出してくれる
   *           AI要約失敗時はフォールバック用のsummary/decisionsも同時送信
   * @param {string} topic - 議題
   * @param {Array} history - MeetingRelayの会議履歴
   * @param {object} routing - ルーティング結果（lead等）
   */
  async function autoSaveFromMeeting(topic, history, routing) {
    if (!history || history.length === 0) return;

    // フォールバック用: 従来のキーワードマッチ要約（AI要約失敗時に使われる）
    const allText = history.map(h => h.content).join('\n');
    // v1.2修正 - フォールバック要約も80文字以内に
    const fallbackSummary = `${topic}について議論。` + allText.substring(0, 60).replace(/\n/g, ' ');
    const decisionKeywords = /決定|結論|まとめ|確定|採用|方針|するべき|することに/;
    // v1.3修正 - マークダウン見出し・記法を除去してからキーワード抽出
    const stripMarkdown = (s) => s
      .replace(/^\s*#{1,6}\s+\d*\.?\s*/g, '')  // ## 見出し → 除去
      .replace(/^\s*[-*]+\s+/g, '')  // - リスト / * リスト → 除去
      .replace(/\*{1,3}/g, '')  // 残った*を全除去（太字等）
      .replace(/\|[^|]*\|/g, '')  // |テーブル| → 除去
      .trim();
    const fallbackDecisions = history
      .filter(h => decisionKeywords.test(h.content))
      .map(h => {
        // 決定キーワードを含む文を抽出してマークダウン除去＋40文字以内に
        const sentences = h.content.split(/[。！？\n]/);
        const hit = sentences.find(s => decisionKeywords.test(s)) || sentences[0];
        const cleaned = stripMarkdown(hit || '');
        return cleaned.substring(0, 40);
      })
      .filter(d => d.length > 5 && !d.startsWith('#'))
      .slice(0, 5);

    const lastRound = history.length > 0
      ? Math.max(...history.map(h => h.round || 1))
      : 1;

    // v1.1追加: rawHistoryを含めてWorkerに送信（AI要約用）
    const rawHistory = history.map(h => ({
      sister: h.sister || 'unknown',
      content: h.content,
      round: h.round || 1,
    }));

    await saveMemory({
      topic,
      summary: fallbackSummary,
      decisions: fallbackDecisions,
      rawHistory,
      round: lastRound,
      lead: routing ? routing.lead : null,
      mood: 'neutral',
    });
  }

  /**
   * v1.4追加 - 記憶をtotal付きで取得（メモリー管理UI用）
   * @param {number} limit - 取得件数（最大100）
   * @returns {Promise<{memories: Array, total: number}>}
   */
  async function getMemoriesWithTotal(limit = 20) {
    // キャッシュを無効化して常に最新を取得（管理UI用）
    _cachedMemories = null;
    const result = await _request('GET', { limit });
    if (result && result.memories) {
      _cachedMemories = result.memories;
      _cacheTime = Date.now();
      return { memories: result.memories, total: result.total || result.memories.length };
    }
    return { memories: [], total: 0 };
  }

  /**
   * v1.4追加 - 全記憶を一括削除
   * Worker DELETE /memory に { action: "deleteAll" } を送信
   * @returns {Promise<object|null>}
   */
  async function deleteAllMemories() {
    const result = await _request('DELETE', { action: 'deleteAll' });
    if (result && result.success) {
      _cachedMemories = null;
      console.log(`[Memory] 一括削除成功: ${result.deleted}件`);
    }
    return result;
  }

  return {
    getMemories,
    getMemoriesWithTotal,
    saveMemory,
    deleteMemory,
    deleteAllMemories,
    getMemoryPrompt,
    autoSaveFromMeeting,
  };
})();
