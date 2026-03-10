// COCOMITalk - リアルタイム検索UI（Phase 2a）
// このファイルはチャット画面に検索ボタンを追加し、
// Worker /search経由でBrave Searchを呼び、結果を三姉妹のプロンプトに注入する
// v1.0 2026-03-12 - Phase 2a 新規作成
'use strict';

/** リアルタイム検索UIモジュール */
const SearchUI = (() => {

  // 検索結果の一時保存（次のメッセージ送信時にプロンプトに注入）
  let _lastSearchResults = null;

  /** 初期化（イベント設定） */
  function init() {
    // 検索ボタン
    const btnSearch = document.getElementById('btn-search');
    if (btnSearch) {
      btnSearch.addEventListener('click', _onSearchClick);
    }
    // 検索モーダルの閉じるボタン
    const btnClose = document.getElementById('btn-search-close');
    if (btnClose) {
      btnClose.addEventListener('click', _hideModal);
    }
    // 検索実行ボタン（モーダル内）
    const btnExec = document.getElementById('btn-search-exec');
    if (btnExec) {
      btnExec.addEventListener('click', _executeSearch);
    }
    // Enterキーでも検索実行
    const input = document.getElementById('search-query-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          _executeSearch();
        }
      });
    }
    console.log('[SearchUI] 初期化完了');
  }

  /** 🔍ボタンクリック → 検索モーダル表示 */
  function _onSearchClick() {
    const modal = document.getElementById('search-modal');
    if (modal) {
      modal.classList.remove('hidden');
      const input = document.getElementById('search-query-input');
      if (input) {
        input.value = '';
        input.focus();
      }
      // 結果エリアをクリア
      const resultDiv = document.getElementById('search-results');
      if (resultDiv) resultDiv.innerHTML = '';
    }
  }

  /** 検索モーダルを閉じる */
  function _hideModal() {
    const modal = document.getElementById('search-modal');
    if (modal) modal.classList.add('hidden');
  }

  /** 検索実行 */
  async function _executeSearch() {
    const input = document.getElementById('search-query-input');
    const resultDiv = document.getElementById('search-results');
    const btnExec = document.getElementById('btn-search-exec');
    if (!input || !resultDiv) return;

    const query = input.value.trim();
    if (!query) return;

    // ローディング表示
    resultDiv.innerHTML = '<p class="search-loading">🔍 検索中...</p>';
    if (btnExec) btnExec.disabled = true;

    try {
      // Worker /search を呼び出し
      const data = await _callSearchAPI(query);

      if (!data || !data.results || data.results.length === 0) {
        resultDiv.innerHTML = '<p class="search-empty">検索結果が見つかりませんでした</p>';
        _lastSearchResults = null;
        return;
      }

      // 結果を保存（次のメッセージ送信時に注入）
      _lastSearchResults = data;

      // 結果を表示
      resultDiv.innerHTML = _renderResults(data);

      // 「この結果を使って質問する」ボタンのイベント
      const btnUse = document.getElementById('btn-use-search');
      if (btnUse) {
        btnUse.addEventListener('click', () => {
          _hideModal();
          // チャット入力欄にフォーカス
          const chatInput = document.querySelector('.chat-input, .meeting-topic-input');
          if (chatInput) chatInput.focus();
        });
      }

    } catch (e) {
      console.error('[SearchUI] 検索エラー:', e);
      resultDiv.innerHTML = `<p class="search-empty">検索エラー: ${e.message}</p>`;
      _lastSearchResults = null;
    } finally {
      if (btnExec) btnExec.disabled = false;
    }
  }

  /**
   * Worker /search API呼び出し
   * @param {string} query - 検索キーワード
   * @returns {object} { results, query, totalCount }
   */
  async function _callSearchAPI(query) {
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      throw new Error('認証トークンが未設定です');
    }
    const url = `${ApiCommon.getWorkerURL()}/search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-COCOMI-AUTH': ApiCommon.getAuthToken(),
      },
      body: JSON.stringify({ query, count: 5 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  /**
   * 検索結果のHTML生成
   * @param {object} data - 検索レスポンス
   * @returns {string} HTML
   */
  function _renderResults(data) {
    let html = `<div class="search-result-header">
      <span>🔍 「${_esc(data.query)}」の検索結果（${data.totalCount}件）</span>
    </div>`;

    for (const r of data.results) {
      html += `<div class="search-result-item">
        <div class="search-result-title">${r.rank}. ${_esc(r.title)}</div>
        <div class="search-result-desc">${_esc(r.description)}</div>
        <div class="search-result-url">${_esc(r.url)}</div>
      </div>`;
    }

    // v1.0 - 検索結果を使って質問するボタン
    html += `<button id="btn-use-search" class="btn-use-search">
      💬 この結果を使って質問する
    </button>`;

    return html;
  }

  /**
   * 検索結果をプロンプト注入用テキストに変換
   * チャット送信時にchat-core.jsから呼ばれる
   * @returns {string} プロンプトに注入するテキスト（なければ空文字）
   */
  function getSearchPrompt() {
    if (!_lastSearchResults || !_lastSearchResults.results) return '';

    let prompt = '\n\n【リアルタイム検索結果】\n';
    prompt += `検索キーワード: ${_lastSearchResults.query}\n`;
    for (const r of _lastSearchResults.results) {
      prompt += `\n${r.rank}. ${r.title}\n`;
      prompt += `   ${r.description}\n`;
      prompt += `   URL: ${r.url}\n`;
    }
    prompt += '\n上記の検索結果を参考にして回答してね。';
    prompt += '情報の出典（URLやサイト名）も教えてあげてね。\n';

    return prompt;
  }

  /**
   * 検索結果をクリア（メッセージ送信後に呼ぶ）
   */
  function clearSearchResults() {
    _lastSearchResults = null;
  }

  /**
   * 検索結果が保持されているか
   * @returns {boolean}
   */
  function hasSearchResults() {
    return _lastSearchResults !== null;
  }

  /** HTMLエスケープ */
  function _esc(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  }

  return { init, getSearchPrompt, clearSearchResults, hasSearchResults };
})();
