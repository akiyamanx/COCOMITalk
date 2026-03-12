// COCOMITalk - プロンプトビルダー（注入テキスト共通化モジュール）
// このファイルはメモリー・検索結果・将来のRAG結果等を
// システムプロンプトに注入するロジックを一元管理する
// chat-core.js / chat-group.js / meeting-relay.js が共通で使う
// v1.0 2026-03-11 - 新規作成（共通化リファクタ）
// v1.1 2026-03-12 - Step 6 Phase 1: チャット記憶注入（_getChatMemoryText追加）
'use strict';

/**
 * プロンプトビルダーモジュール
 *
 * 使い方:
 *   const extra = await PromptBuilder.build({ mode: 'chat', memoryLimit: 3 });
 *   const fullPrompt = systemPrompt + extra;
 *
 * モード別のデフォルト:
 *   chat    — メモリー3件 + 検索結果（使ったらクリア）
 *   group   — メモリー3件 + 検索結果（クリアしない＝全姉妹参照用）
 *   meeting — メモリー5件 + 検索結果（クリアしない＝ラウンド中保持）
 *
 * 将来拡張:
 *   - Vectorize RAG結果の注入（Step 6）
 *   - Function Calling検索結果の注入（Phase 2a+）
 *   - 1対1チャット記憶の注入（chat-memory.js連携）
 */
const PromptBuilder = (() => {

  // モード別デフォルト設定
  const MODE_DEFAULTS = {
    chat:    { memoryLimit: 3, clearSearch: true  },
    group:   { memoryLimit: 3, clearSearch: false },
    meeting: { memoryLimit: 5, clearSearch: false },
  };

  /**
   * プロンプト注入テキストを構築する
   * @param {Object} options
   * @param {string} options.mode - 'chat' | 'group' | 'meeting'
   * @param {number} [options.memoryLimit] - メモリー取得件数（省略時はモード別デフォルト）
   * @param {boolean} [options.clearSearch] - 検索結果を使用後にクリアするか（省略時はモード別デフォルト）
   * @param {boolean} [options.skipMemory] - メモリー取得をスキップ（デフォルトfalse）
   * @param {boolean} [options.skipSearch] - 検索結果注入をスキップ（デフォルトfalse）
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

    let extra = '';

    // --- 1. KVメモリー注入 ---
    if (options.preBuiltMemory) {
      // 事前取得済みのメモリーテキストを使う（meeting-relayの会議中はこれ）
      extra += options.preBuiltMemory;
    } else if (!skipMemory) {
      extra += await _getMemoryText(memoryLimit);
    }

    // --- 2. 検索結果注入 ---
    if (!skipSearch) {
      extra += _getSearchText(clearSearch);
    }

    // --- 3. 将来拡張: Vectorize RAG結果（Step 6で追加予定） ---
    // if (!skipVector) { extra += await _getVectorText(query); }

    // --- 4. 1対1チャット記憶注入（Step 6 Phase 1） ---
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
   * グループ/会議モードの全姉妹完了後に検索結果をクリアする
   * chat-group.js / meeting-relay.jsのラウンド完了後に呼ぶ
   */
  function clearSearch() {
    if (typeof SearchUI !== 'undefined') {
      SearchUI.clearSearchResults();
      console.log('[PromptBuilder] 検索結果クリア（ラウンド完了）');
    }
  }

  /**
   * 会議開始時にメモリーを事前取得する（meeting-relay用）
   * 会議中は毎回KVを叩かず、この結果をpreBuiltMemoryとして渡す
   * @param {number} limit - 件数
   * @returns {Promise<string>}
   */
  async function preloadMemory(limit = 5) {
    return await _getMemoryText(limit);
  }

  return {
    build,
    clearSearch,
    preloadMemory,
  };
})();
