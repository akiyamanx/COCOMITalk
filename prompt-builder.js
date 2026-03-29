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
// v1.6.1 2026-03-30 - テンプレート修正: グループで本人が既に答えた場合は自然に受ける指示を追加
'use strict';

const PromptBuilder = (() => {

  const MODE_DEFAULTS = {
    chat:    { memoryLimit: 3, clearSearch: true  },
    group:   { memoryLimit: 3, clearSearch: false },
    meeting: { memoryLimit: 5, clearSearch: false },
  };

  let _hotTopicRawCache = null;
  let _hotTopicCacheTime = 0;
  const HOT_TOPIC_CACHE_TTL = 5 * 60 * 1000;

  const SISTER_LABEL = {
    koko: '🌸ここちゃん',
    onee: '🌙お姉ちゃん',
    kuro: '🔮クロちゃん',
  };

  const SISTER_KEY_TO_DB = {
    koko: 'koko',
    gpt: 'onee',
    claude: 'kuro',
  };

  const SHARED_CATEGORIES = ['会議決定', '共通認識', '開発ルール', 'ロードマップ'];

  function _classifyMemoryOwner(memory, dbSister) {
    if (!memory.sister || SHARED_CATEGORIES.includes(memory.category)) {
      return 'shared';
    }
    if (memory.sister === dbSister) {
      return 'self';
    }
    return 'other';
  }

  /**
   * v1.5追加 - 代弁禁止＋代替行動テンプレートを生成する
   * v1.6.1修正 - グループで本人が既に答えた場合の対応を追加
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
      // v1.6.1追加 - 本人が既に答えた場合の対応
      template += '→ ただし、グループ会話で本人が既に答えている場合は「本人に聞いて」と言う必要はありません。\n';
      template += '  本人の回答を受けて自然に会話してください（「いいね！」「〇〇ちゃんらしいね」等）。\n';
    } else {
      template += '→ 自分の言葉で代弁せず、本人に聞くことを提案してください。\n';
      template += '  例: 「それは本人に聞いた方がいいかも！グループで聞いてみない？」\n';
      template += '  例: 「〇〇ちゃんの好みは本人が一番よく知ってるよ〜。今度一緒に話そう！」\n';
    }

    template += '※ 共有の決定事項（会議で決まったこと等）は全員が答えてOKです。\n';
    template += '※ 自分自身の好み・体験・意見は自由に答えてください。\n';

    return template;
  }

  async function build(options = {}) {
    const mode = options.mode || 'chat';
    const sister = options.sister || null;
    const defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.chat;

    const memoryLimit = options.memoryLimit ?? defaults.memoryLimit;
    const clearSearch = options.clearSearch ?? defaults.clearSearch;
    const skipMemory = options.skipMemory || false;
    const skipSearch = options.skipSearch || false;
    const skipHotTopic = options.skipHotTopic || mode === 'meeting';

    let extra = '';

    if (options.preBuiltMemory) {
      extra += options.preBuiltMemory;
    } else if (!skipMemory) {
      extra += await _getMemoryText(memoryLimit);
    }

    if (!skipHotTopic) {
      extra += await _getHotTopicText(mode, sister);
    }

    if (!skipSearch) {
      extra += _getSearchText(clearSearch);
    }

    if (!options.skipVector && options.userText) {
      extra += await _getVectorSearchText(options.userText, undefined, mode, sister);
    }

    if (!options.skipChatMemory && mode === 'chat') {
      extra += await _getChatMemoryText(options.chatMemoryLimit || 3);
    }

    return extra;
  }

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

        if (dbSister) {
          const ownership = _classifyMemoryOwner(m, dbSister);
          if (ownership === 'other') {
            const otherName = ownerLabel || '他の姉妹';
            prompt += `🔒 [${otherName}の個人的な記憶] 「${m.topic}」— この話題は本人に回答権があります。\n`;
            hasOther = true;
            continue;
          }
        }

        const ownerTag = ownerLabel ? `[${ownerLabel}の記憶] ` : '';
        prompt += `📌 ${ownerTag}${date} ${m.topic}: ${m.summary}\n`;
      }

      prompt += '上記の過去の記憶に自然に触れて会話してね。\n';

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

  async function _getHotTopicText(mode, sister) {
    if (typeof ApiCommon === 'undefined') return '';

    try {
      const now = Date.now();
      let memories = null;

      if (_hotTopicRawCache !== null && (now - _hotTopicCacheTime) < HOT_TOPIC_CACHE_TTL) {
        memories = _hotTopicRawCache;
      } else {
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

        if (dbSister) {
          const ownership = _classifyMemoryOwner(m, dbSister);
          if (ownership === 'other') {
            const otherName = ownerLabel || '他の姉妹';
            prompt += `${itemNum}. 🔒 [${otherName}の個人的な記憶] 「${m.topic}」— この話題は本人に回答権があります [${date}]\n`;
            hasOther = true;
            continue;
          }
        }

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