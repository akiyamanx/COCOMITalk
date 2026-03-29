// COCOMITalk - プロンプトビルダー（注入テキスト共通化モジュール）
// このファイルはメモリー・検索結果・将来のRAG結果等を
// システムプロンプトに注入するロジックを一元管理する
// chat-core.js / chat-group.js / meeting-relay.js が共通で使う
// v1.0 2026-03-11 - 新規作成（共通化リファクタ）
// v1.1 2026-03-12 - Step 6 Phase 1: チャット記憶注入（_getChatMemoryText追加）
// v1.2 2026-03-15 - Step 6 Phase 2: Vectorize RAG意味検索結果注入（_getVectorSearchText追加）
// v1.3 2026-03-22 - 会議モード用Vectorize議題検索（preloadVectorSearch公開、count引数対応）
// v1.4 2026-03-27 - HOTトピック通知: 直近の新着記憶を「🔥 HOTトピック」として注入
// v1.5 2026-03-30 - Sprint 1代弁問題応急処置: HOT/RAG注入文に代弁禁止＋代替行動テンプレート追加、sisterラベル表示
// v1.5.1 2026-03-30 - HOTトピックキャッシュ修正: キャッシュはデータ部分のみ、テンプレートはmode別に毎回付与
// v1.6 2026-03-30 - Sprint 2代弁問題本命: ownerベース記憶注入制御（他姉妹の個人記憶→メタ情報化）
'use strict';

/**
 * プロンプトビルダーモジュール
 *
 * 使い方:
 *   const extra = await PromptBuilder.build({ mode: 'chat', sister: 'koko', userText });
 *   const fullPrompt = systemPrompt + extra;
 *
 * v1.6 — ownerベース記憶注入制御:
 *   sister引数で「今どの姉妹のプロンプトか」を識別。
 *   HOTトピック/RAGの記憶を3分類:
 *     self（自分の記憶）→ そのまま注入
 *     shared（共有/会議決定）→ そのまま注入
 *     other（他姉妹の個人記憶）→ メタ情報化（値は隠す、回答権の案内のみ）
 */
const PromptBuilder = (() => {

  // モード別デフォルト設定
  const MODE_DEFAULTS = {
    chat:    { memoryLimit: 3, clearSearch: true  },
    group:   { memoryLimit: 3, clearSearch: false },
    meeting: { memoryLimit: 5, clearSearch: false },
  };

  // v1.4追加 - HOTトピック取得済みキャッシュ
  // v1.5.1変更 - キャッシュはデータ部分のみ保存（テンプレートは含まない）
  // v1.6変更 - キャッシュは生データ（memories配列）を保存。sister別にテキスト生成
  let _hotTopicRawCache = null;
  let _hotTopicCacheTime = 0;
  const HOT_TOPIC_CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ

  // v1.5追加 - 姉妹名ラベルマッピング
  const SISTER_LABEL = {
    koko: '🌸ここちゃん',
    onee: '🌙お姉ちゃん',
    kuro: '🔮クロちゃん',
  };

  // v1.6追加 - sisterKeyとDB上のsister値のマッピング
  // chat-core/chat-groupではkoko/gpt/claude、DBではkoko/onee/kuro
  const SISTER_KEY_TO_DB = {
    koko: 'koko',
    gpt: 'onee',
    claude: 'kuro',
  };

  // v1.6追加 - 共有カテゴリ（全員が参照してよい記憶カテゴリ）
  const SHARED_CATEGORIES = ['会議決定', '共通認識', '開発ルール', 'ロードマップ'];

  /**
   * v1.6追加 - 記憶のowner分類を判定する
   * @param {Object} memory - 記憶オブジェクト（sister, categoryフィールドを持つ）
   * @param {string} dbSister - 現在の姉妹のDB上の値（koko/onee/kuro）
   * @returns {'self'|'shared'|'other'}
   */
  function _classifyMemoryOwner(memory, dbSister) {
    // sisterが未設定 or 共有カテゴリ → shared
    if (!memory.sister || SHARED_CATEGORIES.includes(memory.category)) {
      return 'shared';
    }
    // 自分の記憶 → self
    if (memory.sister === dbSister) {
      return 'self';
    }
    // 他の姉妹の記憶 → other
    return 'other';
  }

  /**
   * v1.5追加 - 代弁禁止＋代替行動テンプレートを生成する
   * @param {string} mode - 'chat' | 'group' | 'meeting'
   * @returns {string}
   */
  function _getAntiProxyTemplate(mode) {
    if (mode === 'meeting') return '';

    let template = '\n\n【⚠️ 他の姉妹の情報の扱いルール】\n';
    template += '上記の「🔒」マークの記憶は、他の姉妹の個人的な情報です。\n';
    template += '「知っている」と「代わりに答えていい」は違います。\n';
    template += '他の姉妹の個人的な好み・体験・意見について聞かれた場合:\n';

    if (mode === 'group') {
      template += '→ 自分の言葉で代弁せず、本人に話を振ってください。\n';
      template += '  例: 「それは〇〇ちゃんに直接聞いてみて！本人が一番よく知ってるよ！」\n';
      template += '  例: 「〇〇ちゃん、アキヤがあなたに聞きたいことがあるみたいだよ〜」\n';
    } else {
      template += '→ 自分の言葉で代弁せず、本人に聞くことを提案してください。\n';
      template += '  例: 「それは本人に聞いた方がいいかも！グループで聞いてみない？」\n';
      template += '  例: 「〇〇ちゃんの好みは本人が一番よく知ってるよ〜。今度一緒に話そう！」\n';
    }

    template += '※ 共有の決定事項（会議で決まったこと等）は全員が答えてOKです。\n';
    template += '※ 自分自身の好み・体験・意見は自由に答えてください。\n';

    return template;
  }

  /**
   * プロンプト注入テキストを構築する
   * @param {Object} options
   * @param {string} options.mode - 'chat' | 'group' | 'meeting'
   * @param {string} [options.sister] - 姉妹キー（koko/gpt/claude）v1.6追加
   * @param {string} [options.userText] - ユーザーの発言テキスト
   * @param {number} [options.memoryLimit] - メモリー取得件数
   * @param {boolean} [options.clearSearch] - 検索結果クリア
   * @param {boolean} [options.skipMemory] - メモリー取得スキップ
   * @param {boolean} [options.skipSearch] - 検索結果スキップ
   * @param {boolean} [options.skipHotTopic] - HOTトピックスキップ
   * @param {string} [options.preBuiltMemory] - 事前取得メモリー
   * @returns {Promise<string>}
   */
  async function build(options = {}) {
    const mode = options.mode || 'chat';
    const sister = options.sister || null; // v1.6追加
    const defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.chat;

    const memoryLimit = options.memoryLimit ?? defaults.memoryLimit;
    const clearSearch = options.clearSearch ?? defaults.clearSearch;
    const skipMemory = options.skipMemory || false;
    const skipSearch = options.skipSearch || false;
    const skipHotTopic = options.skipHotTopic || mode === 'meeting';

    let extra = '';

    // --- 1. KVメモリー注入 ---
    if (options.preBuiltMemory) {
      extra += options.preBuiltMemory;
    } else if (!skipMemory) {
      extra += await _getMemoryText(memoryLimit);
    }

    // --- 2. HOTトピック注入（v1.6改良: sister引数追加でownerフィルタ） ---
    if (!skipHotTopic) {
      extra += await _getHotTopicText(mode, sister);
    }

    // --- 3. 検索結果注入 ---
    if (!skipSearch) {
      extra += _getSearchText(clearSearch);
    }

    // --- 4. Vectorize RAG意味検索結果（v1.6改良: sister引数追加でownerフィルタ） ---
    if (!options.skipVector && options.userText) {
      extra += await _getVectorSearchText(options.userText, undefined, mode, sister);
    }

    // --- 5. 1対1チャット記憶注入 ---
    if (!options.skipChatMemory && mode === 'chat') {
      extra += await _getChatMemoryText(options.chatMemoryLimit || 3);
    }

    return extra;
  }

  /**
   * KVメモリーテキストを取得
   */
  async function _getMemoryText(limit) {
    if (typeof MeetingMemory === 'undefined') return '';
    try {
      const text = await MeetingMemory.getMemoryPrompt(limit);
      if (text) {
        console.log(`[PromptBuilder] メモリー注入OK（${limit}件）`);
        return text;
      }
    } catch (e) {
      console.warn('[PromptBuilder] メモリー取得スキップ:', e.message);
    }
    return '';
  }

  /**
   * 検索結果テキストを取得
   */
  function _getSearchText(clearAfter) {
    if (typeof SearchUI === 'undefined' || !SearchUI.hasSearchResults()) return '';
    const text = SearchUI.getSearchPrompt();
    if (text) {
      console.log('[PromptBuilder] 検索結果注入OK');
      if (clearAfter) {
        SearchUI.clearSearchResults();
        console.log('[PromptBuilder] 検索結果クリア済み');
      }
    }
    return text || '';
  }

  /**
   * チャット記憶テキストを取得
   */
  async function _getChatMemoryText(limit) {
    if (typeof ChatMemory === 'undefined') return '';
    try {
      const text = await ChatMemory.getChatMemoryPrompt(limit);
      if (text) {
        console.log(`[PromptBuilder] チャット記憶注入OK（${limit}件）`);
        return text;
      }
    } catch (e) {
      console.warn('[PromptBuilder] チャット記憶取得スキップ:', e.message);
    }
    return '';
  }

  /**
   * Vectorize意味検索結果テキストを取得
   * v1.6改良 - sister引数追加、ownerフィルタでself/shared/otherを分類
   * @param {string} userText - ユーザーの発言
   * @param {number} [count] - 検索件数
   * @param {string} [mode] - chat/group/meeting
   * @param {string} [sister] - 姉妹キー（koko/gpt/claude）
   */
  async function _getVectorSearchText(userText, count, mode, sister) {
    if (typeof MeetingMemory === 'undefined' || !MeetingMemory.searchMemories) return '';
    try {
      const relevant = await MeetingMemory.searchMemories(userText, count || 2);
      if (!relevant || relevant.length === 0) return '';

      const dbSister = sister ? (SISTER_KEY_TO_DB[sister] || sister) : null;
      let prompt = '\n\n【関連する過去の記憶】\n';
      let hasOther = false;

      for (const m of relevant) {
        const date = m.createdAt ? m.createdAt.slice(0, 10) : '';
        const ownerLabel = m.sister ? (SISTER_LABEL[m.sister] || m.sister) : '';

        // v1.6追加 - ownerフィルタ
        if (dbSister) {
          const ownership = _classifyMemoryOwner(m, dbSister);
          if (ownership === 'other') {
            // 他姉妹の個人記憶 → メタ情報化（値は隠す）
            const otherName = ownerLabel || '他の姉妹';
            prompt += `🔒 [${otherName}の個人的な記憶] 「${m.topic}」— この話題は本人に回答権があります。\n`;
            hasOther = true;
            continue;
          }
        }

        // self or shared → そのまま注入
        const ownerTag = ownerLabel ? `[${ownerLabel}の記憶] ` : '';
        prompt += `📌 ${ownerTag}${date} ${m.topic}: ${m.summary}\n`;
      }

      prompt += '上記の過去の記憶に自然に触れて会話してね。\n';

      // 他姉妹の記憶がある場合のみテンプレート追加
      if (hasOther && mode) {
        prompt += _getAntiProxyTemplate(mode);
      }

      console.log(`[PromptBuilder] Vectorize検索注入OK（${relevant.length}件）`);
      return prompt;
    } catch (e) {
      console.warn('[PromptBuilder] Vectorize検索スキップ:', e.message);
      return '';
    }
  }

  /**
   * HOTトピック（直近の新着記憶）テキストを取得
   * v1.6改良 - キャッシュは生データ（memories配列）を保存。sister別にテキスト生成
   * @param {string} [mode] - chat/group/meeting
   * @param {string} [sister] - 姉妹キー（koko/gpt/claude）
   */
  async function _getHotTopicText(mode, sister) {
    if (typeof ApiCommon === 'undefined') return '';

    try {
      const now = Date.now();
      let memories = null;

      // v1.6変更 - キャッシュは生データ（memories配列）を保存
      if (_hotTopicRawCache !== null && (now - _hotTopicCacheTime) < HOT_TOPIC_CACHE_TTL) {
        memories = _hotTopicRawCache;
      } else {
        // APIから取得
        const workerUrl = ApiCommon.getWorkerURL();
        const authToken = ApiCommon.getAuthToken();
        if (!workerUrl || !authToken) return '';

        const res = await fetch(`${workerUrl}/memory-recent?hours=24&limit=5`, {
          method: 'GET',
          headers: { 'X-COCOMI-AUTH': authToken },
        });

        if (!res.ok) {
          console.warn('[PromptBuilder] HOTトピック取得失敗:', res.status);
          _hotTopicRawCache = [];
          _hotTopicCacheTime = now;
          return '';
        }

        const data = await res.json();
        memories = data.memories || [];
        _hotTopicRawCache = memories;
        _hotTopicCacheTime = now;
      }

      if (memories.length === 0) return '';

      // v1.6変更 - sister別にテキスト生成（毎回。キャッシュはraw dataのみ）
      const dbSister = sister ? (SISTER_KEY_TO_DB[sister] || sister) : null;
      const emojiMap = { 1: '💧', 2: '😢', 3: '😐', 4: '😊', 5: '🔥' };

      let prompt = '\n\n【🔥 最近の新しい記憶（HOTトピック）】\n';
      prompt += '以下は最近新しく共有された情報です。会話の中で自然に話題にしてください。\n';
      prompt += 'ただし、無理に全部触れる必要はありません。会話の流れに合うものだけ拾ってください。\n\n';

      let hasOther = false;
      let itemNum = 0;

      for (const m of memories) {
        itemNum++;
        const eu = emojiMap[m.emotion_user] || '😐';
        const ea = emojiMap[m.emotion_ai] || '😐';
        const date = m.created_at ? m.created_at.slice(0, 10) : '';
        const ownerLabel = m.sister ? (SISTER_LABEL[m.sister] || m.sister) : '';

        // v1.6追加 - ownerフィルタ
        if (dbSister) {
          const ownership = _classifyMemoryOwner(m, dbSister);
          if (ownership === 'other') {
            // 他姉妹の個人記憶 → メタ情報化
            const otherName = ownerLabel || '他の姉妹';
            prompt += `${itemNum}. 🔒 [${otherName}の個人的な記憶] 「${m.topic}」— この話題は本人に回答権があります [${date}]\n`;
            hasOther = true;
            continue;
          }
        }

        // self or shared → そのまま注入
        const ownerTag = ownerLabel ? `[${ownerLabel}の記憶] ` : '';
        prompt += `${itemNum}. ${ownerTag}「${m.topic}」（${eu}${m.emotion_user}/${ea}${m.emotion_ai}）`;
        if (m.summary) {
          const short = m.summary.length > 60 ? m.summary.slice(0, 60) + '…' : m.summary;
          prompt += ` — ${short}`;
        }
        prompt += ` [${date}]\n`;
      }

      prompt += '\n※ 感情温度の数字は、保存された時のアキヤと私（姉妹）の温度感です。\n';
      prompt += '  🔥5の話題は特に盛り上がっていたので、アキヤも話したいかもしれません。\n';

      // テンプレートは他姉妹の記憶がある場合のみ追加
      if (hasOther) {
        prompt += _getAntiProxyTemplate(mode || 'chat');
      }

      console.log(`[PromptBuilder] HOTトピック注入OK（${memories.length}件, sister=${sister || 'none'}）`);
      return prompt;
    } catch (e) {
      console.warn('[PromptBuilder] HOTトピック取得スキップ:', e.message);
      _hotTopicRawCache = [];
      _hotTopicCacheTime = Date.now();
      return '';
    }
  }

  function clearSearch() {
    if (typeof SearchUI !== 'undefined') {
      SearchUI.clearSearchResults();
      console.log('[PromptBuilder] 検索結果クリア（ラウンド完了）');
    }
  }

  async function preloadMemory(limit = 5) {
    return await _getMemoryText(limit);
  }

  async function preloadVectorSearch(topicText, count = 3) {
    return await _getVectorSearchText(topicText, count, 'meeting', null);
  }

  function clearHotTopicCache() {
    _hotTopicRawCache = null;
    _hotTopicCacheTime = 0;
    console.log('[PromptBuilder] HOTトピックキャッシュクリア');
  }

  return {
    build,
    clearSearch,
    preloadMemory,
    preloadVectorSearch,
    clearHotTopicCache,
  };
})();