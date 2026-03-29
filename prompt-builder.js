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
'use strict';

/**
 * プロンプトビルダーモジュール
 *
 * 使い方:
 *   const extra = await PromptBuilder.build({ mode: 'chat', memoryLimit: 3 });
 *   const fullPrompt = systemPrompt + extra;
 *
 * モード別のデフォルト:
 *   chat    — メモリー3件 + 検索結果（使ったらクリア）+ HOTトピック
 *   group   — メモリー3件 + 検索結果（クリアしない＝全姉妹参照用）+ HOTトピック
 *   meeting — メモリー5件 + 検索結果（クリアしない＝ラウンド中保持）+ HOTトピックなし
 *
 * v1.5追加 — 代弁問題対策:
 *   HOTトピック/RAG注入文に「他の姉妹の個人的な情報は代弁しない」ルールを追加。
 *   groupモード: 本人にパス回し（「〇〇ちゃんに聞いてみて！」）
 *   chatモード: 次回グループで聞く提案（「グループで聞いてみるといいかも！」）
 *
 * v1.5.1修正 — HOTトピックキャッシュ問題:
 *   キャッシュにはAPI取得データ部分のみ保存。代弁禁止テンプレートはmodeに応じて
 *   毎回付与する。chat→group切り替え時にも正しいテンプレートが適用される。
 */
const PromptBuilder = (() => {

  // モード別デフォルト設定
  const MODE_DEFAULTS = {
    chat:    { memoryLimit: 3, clearSearch: true  },
    group:   { memoryLimit: 3, clearSearch: false },
    meeting: { memoryLimit: 5, clearSearch: false },
  };

  // v1.4追加 - HOTトピック取得済みキャッシュ（同一セッション内で2回目以降はキャッシュを使う）
  // v1.5.1変更 - キャッシュはデータ部分のみ保存（テンプレートは含まない）
  let _hotTopicCache = null;
  let _hotTopicCacheTime = 0;
  const HOT_TOPIC_CACHE_TTL = 5 * 60 * 1000; // 5分キャッシュ

  // v1.5追加 - 姉妹名ラベルマッピング
  const SISTER_LABEL = {
    koko: '🌸ここちゃん',
    onee: '🌙お姉ちゃん',
    kuro: '🔮クロちゃん',
  };

  /**
   * v1.5追加 - 代弁禁止＋代替行動テンプレートを生成する
   * @param {string} mode - 'chat' | 'group' | 'meeting'
   * @returns {string} - 注入文末尾に追加する代弁禁止テキスト
   */
  function _getAntiProxyTemplate(mode) {
    // 会議モードでは代弁禁止テンプレート不要（議題に集中するため）
    if (mode === 'meeting') return '';

    let template = '\n\n【⚠️ 他の姉妹の情報の扱いルール】\n';
    template += '上記の記憶には、あなた以外の姉妹の個人的な情報（好み・体験・意見）が含まれている場合があります。\n';
    template += '「知っている」と「代わりに答えていい」は違います。\n';
    template += '他の姉妹の個人的な好み・体験・意見について聞かれた場合:\n';

    if (mode === 'group') {
      // グループモード: 本人がいるのでパス回し
      template += '→ 自分の言葉で代弁せず、本人に話を振ってください。\n';
      template += '  例: 「それは〇〇ちゃんに直接聞いてみて！本人が一番よく知ってるよ！」\n';
      template += '  例: 「〇〇ちゃん、アキヤがあなたに聞きたいことがあるみたいだよ〜」\n';
    } else {
      // 1対1チャットモード: 本人がいないので、グループを提案
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
   * @param {number} [options.memoryLimit] - メモリー取得件数（省略時はモード別デフォルト）
   * @param {boolean} [options.clearSearch] - 検索結果を使用後にクリアするか（省略時はモード別デフォルト）
   * @param {boolean} [options.skipMemory] - メモリー取得をスキップ（デフォルトfalse）
   * @param {boolean} [options.skipSearch] - 検索結果注入をスキップ（デフォルトfalse）
   * @param {boolean} [options.skipHotTopic] - HOTトピック注入をスキップ（デフォルトfalse）
   * @param {string} [options.preBuiltMemory] - 事前に取得済みのメモリーテキスト（meeting-relayの会議開始時用）
   * @returns {Promise<string>} - システムプロンプトに追加する文字列
   */
  async function build(options = {}) {
    const mode = options.mode || 'chat';
    const defaults = MODE_DEFAULTS[mode] || MODE_DEFAULTS.chat;

    const memoryLimit = options.memoryLimit ?? defaults.memoryLimit;
    const clearSearch = options.clearSearch ?? defaults.clearSearch;
    const skipMemory = options.skipMemory || false;
    const skipSearch = options.skipSearch || false;
    // v1.4追加 - 会議モードではHOTトピック不要（議題に集中するため）
    const skipHotTopic = options.skipHotTopic || mode === 'meeting';

    let extra = '';

    // --- 1. KVメモリー注入 ---
    if (options.preBuiltMemory) {
      extra += options.preBuiltMemory;
    } else if (!skipMemory) {
      extra += await _getMemoryText(memoryLimit);
    }

    // --- 2. HOTトピック注入（v1.4追加、v1.5改良: mode引数追加） ---
    if (!skipHotTopic) {
      extra += await _getHotTopicText(mode);
    }

    // --- 3. 検索結果注入 ---
    if (!skipSearch) {
      extra += _getSearchText(clearSearch);
    }

    // --- 4. Vectorize RAG意味検索結果（Step 6 Phase 2、v1.5改良: mode引数追加） ---
    if (!options.skipVector && options.userText) {
      extra += await _getVectorSearchText(options.userText, undefined, mode);
    }

    // --- 5. 1対1チャット記憶注入（Step 6 Phase 1） ---
    if (!options.skipChatMemory && mode === 'chat') {
      extra += await _getChatMemoryText(options.chatMemoryLimit || 3);
    }

    return extra;
  }

  /**
   * KVメモリーテキストを取得
   * @param {number} limit - 件数
   * @returns {Promise<string>}
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
   * @param {boolean} clearAfter - 取得後にクリアするか
   * @returns {string}
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
   * v1.1追加 - チャット記憶テキストを取得（Step 6 Phase 1）
   * @param {number} limit - 件数
   * @returns {Promise<string>}
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
   * v1.2追加 - Vectorize意味検索結果テキストを取得（Step 6 Phase 2）
   * v1.5改良 - mode引数追加、代弁禁止テンプレート追加
   * @param {string} userText - ユーザーの発言テキスト
   * @param {number} [count] - 検索件数
   * @param {string} [mode] - 'chat' | 'group' | 'meeting'
   * @returns {Promise<string>}
   */
  async function _getVectorSearchText(userText, count, mode) {
    if (typeof MeetingMemory === 'undefined' || !MeetingMemory.searchMemories) return '';
    try {
      const relevant = await MeetingMemory.searchMemories(userText, count || 2);
      if (!relevant || relevant.length === 0) return '';

      let prompt = '\n\n【関連する過去の記憶】\n';
      for (const m of relevant) {
        const date = m.createdAt ? m.createdAt.slice(0, 10) : '';
        // v1.5追加 - 記憶の所有者ラベルを表示（代弁防止の手がかり）
        const ownerLabel = m.sister ? (SISTER_LABEL[m.sister] || m.sister) : '';
        const ownerTag = ownerLabel ? `[${ownerLabel}の記憶] ` : '';
        prompt += `📌 ${ownerTag}${date} ${m.topic}: ${m.summary}\n`;
      }
      prompt += '上記の過去の記憶に自然に触れて会話してね。\n';

      // v1.5追加 - 代弁禁止テンプレート
      if (mode) {
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
   * v1.4追加 - HOTトピック（直近の新着記憶）テキストを取得
   * cocomi-api-relayの/memory-recentエンドポイントから直近24h以内の記憶を取得し、
   * 感情温度付きの「HOTトピック」セクションとしてプロンプトに注入する
   * v1.5改良 - mode引数追加、sisterラベル表示、代弁禁止テンプレート追加
   * v1.5.1修正 - キャッシュはデータ部分のみ。テンプレートはキャッシュ外でmode別に毎回付与
   * @param {string} [mode] - 'chat' | 'group' | 'meeting'
   * @returns {Promise<string>}
   */
  async function _getHotTopicText(mode) {
    // ApiCommonが未定義なら何もしない
    if (typeof ApiCommon === 'undefined') return '';

    try {
      // v1.5.1変更 - キャッシュはデータ部分のみ（テンプレートは含まない）
      const now = Date.now();
      let dataText = null;

      if (_hotTopicCache !== null && (now - _hotTopicCacheTime) < HOT_TOPIC_CACHE_TTL) {
        // キャッシュヒット: データ部分をそのまま使う
        dataText = _hotTopicCache;
        if (dataText) {
          console.log('[PromptBuilder] HOTトピック注入OK（キャッシュ）');
        }
      } else {
        // キャッシュミス: APIから取得
        const workerUrl = ApiCommon.getWorkerURL();
        const authToken = ApiCommon.getAuthToken();
        if (!workerUrl || !authToken) return '';

        const res = await fetch(`${workerUrl}/memory-recent?hours=24&limit=5`, {
          method: 'GET',
          headers: {
            'X-COCOMI-AUTH': authToken,
          },
        });

        if (!res.ok) {
          console.warn('[PromptBuilder] HOTトピック取得失敗:', res.status);
          _hotTopicCache = '';
          _hotTopicCacheTime = now;
          return '';
        }

        const data = await res.json();
        const memories = data.memories || [];

        if (memories.length === 0) {
          _hotTopicCache = '';
          _hotTopicCacheTime = now;
          return '';
        }

        // 感情温度の絵文字マッピング
        const emojiMap = { 1: '💧', 2: '😢', 3: '😐', 4: '😊', 5: '🔥' };

        // v1.5.1変更 - データ部分のみ組み立て（テンプレートはここに含めない）
        let built = '\n\n【🔥 最近の新しい記憶（HOTトピック）】\n';
        built += '以下は最近新しく共有された情報です。会話の中で自然に話題にしてください。\n';
        built += 'ただし、無理に全部触れる必要はありません。会話の流れに合うものだけ拾ってください。\n\n';

        for (let i = 0; i < memories.length; i++) {
          const m = memories[i];
          const eu = emojiMap[m.emotion_user] || '😐';
          const ea = emojiMap[m.emotion_ai] || '😐';
          const date = m.created_at ? m.created_at.slice(0, 10) : '';
          // v1.5追加 - 記憶の所有者ラベルを表示
          const ownerLabel = m.sister ? (SISTER_LABEL[m.sister] || m.sister) : '';
          const ownerTag = ownerLabel ? `[${ownerLabel}の記憶] ` : '';
          built += `${i + 1}. ${ownerTag}「${m.topic}」（${eu}${m.emotion_user}/${ea}${m.emotion_ai}）`;
          if (m.summary) {
            // summaryは60文字に切り詰め（トークン節約）
            const short = m.summary.length > 60 ? m.summary.slice(0, 60) + '…' : m.summary;
            built += ` — ${short}`;
          }
          built += ` [${date}]\n`;
        }

        built += '\n※ 感情温度の数字は、保存された時のアキヤと私（姉妹）の温度感です。\n';
        built += '  🔥5の話題は特に盛り上がっていたので、アキヤも話したいかもしれません。\n';

        console.log(`[PromptBuilder] HOTトピック注入OK（${memories.length}件）`);

        // v1.5.1変更 - キャッシュにはデータ部分のみ保存
        dataText = built;
        _hotTopicCache = dataText;
        _hotTopicCacheTime = now;
      }

      // データが空ならそのまま返す
      if (!dataText) return '';

      // v1.5.1変更 - テンプレートはキャッシュ外で毎回modeに応じて付与
      return dataText + _getAntiProxyTemplate(mode || 'chat');
    } catch (e) {
      console.warn('[PromptBuilder] HOTトピック取得スキップ:', e.message);
      _hotTopicCache = '';
      _hotTopicCacheTime = Date.now();
      return '';
    }
  }

  /**
   * グループ/会議モードの全姉妹完了後に検索結果をクリアする
   */
  function clearSearch() {
    if (typeof SearchUI !== 'undefined') {
      SearchUI.clearSearchResults();
      console.log('[PromptBuilder] 検索結果クリア（ラウンド完了）');
    }
  }

  /**
   * 会議開始時にメモリーを事前取得する（meeting-relay用）
   * @param {number} limit - 件数
   * @returns {Promise<string>}
   */
  async function preloadMemory(limit = 5) {
    return await _getMemoryText(limit);
  }

  /**
   * v1.3追加 - 会議開始時にVectorize議題検索を事前取得する（meeting-relay用）
   * @param {string} topicText - 議題テキスト
   * @param {number} [count=3] - 検索件数
   * @returns {Promise<string>}
   */
  async function preloadVectorSearch(topicText, count = 3) {
    return await _getVectorSearchText(topicText, count, 'meeting');
  }

  /**
   * v1.4追加 - HOTトピックキャッシュをクリアする
   * 新しい記憶が追加された後に呼ぶことで、次回取得時に最新を反映
   */
  function clearHotTopicCache() {
    _hotTopicCache = null;
    _hotTopicCacheTime = 0;
    console.log('[PromptBuilder] HOTトピックキャッシュクリア');
  }

  return {
    build,
    clearSearch,
    preloadMemory,
    preloadVectorSearch,
    clearHotTopicCache, // v1.4追加
  };
})();