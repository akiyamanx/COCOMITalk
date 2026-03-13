// chat-memory.js v1.2
// このファイルは1対1チャットの記憶をKVに保存・取得する
// meeting-memory.jsと同じパターンでWorker /memory エンドポイントを使う
// Worker memory.js v1.6 の type/sister/categoryフィルタ対応と連携
// v1.0 2026-03-12 - Step 6 Phase 1 新規作成
// v1.1 2026-03-13 - AI自発的記憶保存（detectAndSave）追加
// v1.2 2026-03-13 - Worker側フィルタ対応（全件取得→type=chat&sister指定に変更）
'use strict';

/**
 * チャット記憶モジュール
 *
 * 使い方:
 *   ChatMemory.countTurn('koko');           // AI返答後に呼ぶ
 *   ChatMemory.autoSave('koko', history);   // 5往復ごとに自動保存
 *   ChatMemory.manualSave('koko', history); // 「覚えて」で手動保存
 *   const text = await ChatMemory.getChatMemoryPrompt(3);  // プロンプト注入用
 *   ChatMemory.resetTurnCount();            // 姉妹切替時にリセット
 */
const ChatMemory = (() => {

  // --- 定数 ---
  const AUTO_SAVE_INTERVAL = 5;  // 5往復ごとに自動保存
  const MEMORY_TYPE = 'chat';    // KVキープレフィックス: "chat:TIMESTAMP"
  const MAX_RAW_TURNS = 10;      // rawHistoryに含める最大往復数（直近10メッセージ）
  const MIN_TURNS_BETWEEN_AI_SAVE = 2; // v1.1追加 - AI自発保存の最低間隔（往復数）

  // --- 状態 ---
  let _turnCount = 0;       // 現在の往復カウント
  let _lastSaveTurn = 0;    // 最後に保存した時の往復数
  let _lastAiSaveTurn = 0;  // v1.1追加 - 最後にAI自発保存した時の往復数
  let _isSaving = false;    // 保存中フラグ（二重保存防止）

  // --- キャッシュ ---
  let _cachedMemories = null;
  let _cachedCacheKey = null; // v1.2追加 - 姉妹別キャッシュ判定用
  let _cacheTime = 0;
  const CACHE_TTL_MS = 60000; // 1分キャッシュ

  // ═══════════════════════════════════════════
  // Worker通信（meeting-memory.jsと同じパターン）
  // ═══════════════════════════════════════════

  /** Worker /memory にリクエストを送る共通関数 */
  // v1.2改修 - GETのクエリパラメータを汎用化（type/sister/category対応）
  async function _request(method, body) {
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      console.warn('[ChatMemory] Worker未設定のためスキップ');
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
    let fetchUrl = url;
    if (method === 'GET' && body) {
      // v1.2改修 - bodyの全プロパティをクエリパラメータに変換
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        if (v != null) params.set(k, v);
      }
      const qs = params.toString();
      if (qs) fetchUrl = `${url}?${qs}`;
    } else if (body) {
      opts.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(fetchUrl, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.error(`[ChatMemory] ${method}エラー:`, e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════
  // 往復カウント＋自動保存
  // ═══════════════════════════════════════════

  /**
   * 往復カウントを1増加（chat-core.jsのAI返答後に呼ぶ）
   * @param {string} sisterId - 会話相手の姉妹ID（koko/gpt/claude）
   */
  function countTurn(sisterId) {
    _turnCount++;
    console.log(`[ChatMemory] 往復カウント: ${_turnCount} (${sisterId})`);
  }

  /**
   * 自動保存判定＋実行（5往復ごと）
   * @param {string} sisterId - 会話相手の姉妹ID
   * @param {Array} history - チャット履歴配列 [{role, content}, ...]
   */
  async function autoSave(sisterId, history) {
    // 5往復未満、または前回保存から5往復経っていなければスキップ
    if (_turnCount - _lastSaveTurn < AUTO_SAVE_INTERVAL) return;
    // 履歴が少なすぎる場合もスキップ
    if (!history || history.length < 4) return;

    console.log(`[ChatMemory] 自動保存トリガー（${_turnCount}往復目）`);
    const result = await _save(sisterId, history);
    if (result && result.success) {
      _showNotify(`💾 会話を記憶したよ（${_turnCount}往復目）`);
    }
    _lastSaveTurn = _turnCount;
  }

  /**
   * 手動保存（「覚えて」音声コマンド/ボタン）
   * @param {string} sisterId - 会話相手の姉妹ID
   * @param {Array} history - チャット履歴配列
   */
  async function manualSave(sisterId, history) {
    if (!history || history.length < 2) {
      console.warn('[ChatMemory] 手動保存スキップ: 履歴が短すぎる');
      return null;
    }
    console.log(`[ChatMemory] 手動保存（${sisterId}）`);
    const result = await _save(sisterId, history);
    _lastSaveTurn = _turnCount; // 手動保存後もカウントリセット
    return result;
  }

  /**
   * 姉妹切替時にカウントリセット
   */
  function resetTurnCount() {
    _turnCount = 0;
    _lastSaveTurn = 0;
    console.log('[ChatMemory] カウントリセット（姉妹切替）');
  }

  // ═══════════════════════════════════════════
  // 保存処理（内部）
  // ═══════════════════════════════════════════

  /**
   * チャット記憶をWorker経由でKVに保存
   * @param {string} sisterId - 姉妹ID
   * @param {Array} history - チャット履歴
   * @returns {Promise<object|null>}
   */
  async function _save(sisterId, history) {
    if (_isSaving) {
      console.warn('[ChatMemory] 保存中のため二重保存スキップ');
      return null;
    }
    _isSaving = true;

    try {
      // 直近の会話をrawHistoryとして抽出（最大MAX_RAW_TURNS件）
      const recent = history.slice(-MAX_RAW_TURNS);
      const rawHistory = recent.map(h => ({
        role: h.role,
        content: h.content.substring(0, 500), // 1メッセージ最大500文字
      }));

      // フォールバック用topic/summary（AI要約が失敗した場合に使われる）
      const firstUserMsg = recent.find(h => h.role === 'user');
      const fallbackTopic = firstUserMsg
        ? firstUserMsg.content.substring(0, 30) + 'の会話'
        : `${_getSisterName(sisterId)}との会話`;
      const fallbackSummary = `${_getSisterName(sisterId)}と${recent.length}メッセージの会話をした`;

      const result = await _request('POST', {
        type: MEMORY_TYPE,
        topic: fallbackTopic,
        summary: fallbackSummary,
        decisions: [],
        rawHistory,
        sister: sisterId,
        category: null, // AI要約で自動判定
      });

      if (result && result.success) {
        _cachedMemories = null; // キャッシュ無効化
        _cachedCacheKey = null;
        console.log(`[ChatMemory] 保存成功: ${result.key}`);
      }
      return result;
    } catch (e) {
      console.error('[ChatMemory] 保存エラー:', e.message);
      return null;
    } finally {
      _isSaving = false;
    }
  }

  // ═══════════════════════════════════════════
  // 記憶取得＋プロンプト注入
  // ═══════════════════════════════════════════

  /**
   * チャット記憶をプロンプト注入用テキストに変換
   * @param {number} limit - 取得件数（デフォルト3）
   * @returns {Promise<string>} - プロンプト注入テキスト
   */
  async function getChatMemoryPrompt(limit = 3) {
    const memories = await _getChatMemories(limit);
    if (!memories || memories.length === 0) return '';

    let prompt = '\n\n【過去の会話の記憶（最新）】\n';
    for (const m of memories) {
      const date = m.createdAt ? m.createdAt.slice(0, 10) : '不明';
      const sister = _getSisterName(m.sister);
      const cat = m.category ? `（${m.category}）` : '';
      prompt += `\n💬 ${date} ${sister}との会話${cat}\n`;
      prompt += `  要約: ${m.summary}\n`;
      if (m.decisions && m.decisions.length > 0) {
        prompt += `  決まったこと: ${m.decisions.join(' / ')}\n`;
      }
    }
    prompt += '\n上記の過去の会話の記憶を踏まえて、自然に会話してね。\n';
    return prompt;
  }

  /**
   * KVからチャット記憶を取得
   * v1.2改修 - Worker側のtype/sisterフィルタを使用（全件取得→フロントフィルタ廃止）
   * @param {number} limit - 件数
   * @param {string} [sisterId] - 姉妹ID（指定時はその姉妹との記憶のみ取得）
   * @returns {Promise<Array>}
   */
  async function _getChatMemories(limit, sisterId) {
    const now = Date.now();
    // キャッシュキーは姉妹IDを含める（姉妹切替時にキャッシュが混ざらない）
    const cacheKey = sisterId || '_all';
    if (_cachedMemories && _cachedCacheKey === cacheKey && (now - _cacheTime) < CACHE_TTL_MS) {
      return _cachedMemories;
    }
    // v1.2改修 - Worker側でtype=chatフィルタ（＋姉妹フィルタ）
    const query = { type: 'chat', limit };
    if (sisterId) query.sister = sisterId;
    const result = await _request('GET', query);
    if (result && result.memories) {
      _cachedMemories = result.memories;
      _cachedCacheKey = cacheKey;
      _cacheTime = now;
      return result.memories;
    }
    return [];
  }

  // ═══════════════════════════════════════════
  // ユーティリティ
  // ═══════════════════════════════════════════

  /** 姉妹IDから表示名に変換 */
  function _getSisterName(sisterId) {
    const names = { koko: 'ここちゃん', gpt: 'お姉ちゃん', claude: 'クロちゃん' };
    return names[sisterId] || sisterId || '不明';
  }

  /** 画面上にトースト通知を表示（3秒で自動消去） */
  function _showNotify(message) {
    // 既存のVoiceUI.showStatusがあればそれを使う
    if (window.voiceController && window.voiceController._ui) {
      try {
        window.voiceController._ui.showStatus(message, 'success');
        return;
      } catch (_) { /* フォールバックへ */ }
    }
    // フォールバック: 独自トースト
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);' +
      'background:linear-gradient(135deg,#ff69b4,#9b59b6);color:#fff;padding:10px 20px;' +
      'border-radius:20px;font-size:14px;z-index:99999;box-shadow:0 2px 10px rgba(0,0,0,0.3);' +
      'transition:opacity 0.5s;';
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 2500);
    setTimeout(() => { el.remove(); }, 3000);
  }

  // ═══════════════════════════════════════════
  // v1.1追加 - AI自発的記憶保存（マーカー検知）
  // ═══════════════════════════════════════════

  /** マーカー検知用の正規表現 */
  const AI_SAVE_MARKER_RE = /💾SAVE:(.+?)(?:\n|$)/g;

  /**
   * AI応答テキストから💾SAVEマーカーを検知し、あれば記憶保存する
   * マーカーはテキストから除去して返す（ユーザーには見せない）
   * @param {string} replyText - AIの応答テキスト（生）
   * @param {string} sisterId - 応答した姉妹ID
   * @param {Array} history - チャット履歴
   * @returns {Promise<string>} マーカー除去後の表示テキスト
   */
  async function detectAndSave(replyText, sisterId, history) {
    const matches = [...replyText.matchAll(AI_SAVE_MARKER_RE)];
    if (matches.length === 0) return replyText;

    // マーカーをテキストから除去（保存成否に関わらず常に除去）
    let cleanText = replyText.replace(AI_SAVE_MARKER_RE, '').trim();
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    // 過剰保存防止: 前回のAI自発保存から2往復以内ならスキップ
    if (_turnCount - _lastAiSaveTurn < MIN_TURNS_BETWEEN_AI_SAVE) {
      console.log('[ChatMemory] AI自発保存スキップ（間隔不足）');
      return cleanText;
    }

    // 1応答につき最初のマーカーのみ処理
    const reason = matches[0][1].trim();
    console.log(`[ChatMemory] AI自発保存検知: "${reason}" by ${sisterId}`);

    const result = await manualSave(sisterId, history);
    if (result && result.success) {
      _lastAiSaveTurn = _turnCount;
      _showNotify(`💾 覚えたよ — ${reason.substring(0, 30)}`);
    }

    return cleanText;
  }

  // ═══════════════════════════════════════════
  // 公開API
  // ═══════════════════════════════════════════

  return {
    countTurn,
    autoSave,
    manualSave,
    detectAndSave,
    getChatMemoryPrompt,
    resetTurnCount,
  };
})();
