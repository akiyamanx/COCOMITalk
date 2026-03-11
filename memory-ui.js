// COCOMITalk - メモリー管理UI（KV記憶の一覧・詳細・削除・検索・一括削除）
// このファイルはKVに保存された会議記憶を一覧表示し、確認・削除を行うUI
// 設定画面の「🧠記憶管理を開く」ボタンから起動される
// meeting-archive-ui.js のパターンを踏襲
// v1.0 2026-03-12 - Step 4補完: 新規作成
// v1.1 2026-03-11 - メモリー管理UI改善（件数正確化・検索フィルタ・一括削除）
// v1.2 2026-03-11 - 期間指定削除機能追加＋CSS整備
'use strict';

/** メモリー管理UIモジュール */
const MemoryUI = (() => {

  // 姉妹表示設定
  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  // 全記憶データ（検索フィルタ用にキャッシュ）
  let _allMemories = [];
  // 現在のWorker側の全件数
  let _totalCount = 0;

  /** 初期化（イベント設定） */
  function init() {
    const btnOpen = document.getElementById('btn-open-memory-ui');
    if (btnOpen) btnOpen.addEventListener('click', show);
    const btnClose = document.getElementById('btn-memory-close');
    if (btnClose) btnClose.addEventListener('click', hide);
    // v1.1追加 - 一括削除ボタン
    const btnDeleteAll = document.getElementById('btn-memory-delete-all');
    if (btnDeleteAll) btnDeleteAll.addEventListener('click', _deleteAll);
    // v1.1追加 - 検索入力
    const searchInput = document.getElementById('memory-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', _onSearchInput);
    }
    // v1.2追加 - 期間指定削除ボタン
    const btnDeleteByPeriod = document.getElementById('btn-memory-delete-period');
    if (btnDeleteByPeriod) btnDeleteByPeriod.addEventListener('click', _deleteByPeriod);
    console.log('[MemoryUI] 初期化完了');
  }

  /**
   * メモリー一覧画面を表示
   * Worker /memory?limit=100 から全件取得して描画
   */
  async function show() {
    const overlay = document.getElementById('memory-manager');
    const listDiv = document.getElementById('memory-list');
    if (!overlay || !listDiv) return;

    // 検索欄をクリア
    const searchInput = document.getElementById('memory-search-input');
    if (searchInput) searchInput.value = '';

    // ローディング
    listDiv.innerHTML = '<p class="memory-loading">🧠 記憶を読み込み中...</p>';
    overlay.classList.remove('hidden');

    try {
      if (typeof MeetingMemory === 'undefined') {
        listDiv.innerHTML = '<p class="memory-empty">MeetingMemoryモジュールが未読み込みです</p>';
        return;
      }

      // v1.1変更 - 最大100件取得（検索フィルタ用に全件保持）
      const result = await MeetingMemory.getMemoriesWithTotal(100);
      _allMemories = result.memories || [];
      _totalCount = result.total || _allMemories.length;

      if (_allMemories.length === 0) {
        listDiv.innerHTML = '<p class="memory-empty">まだ記憶がありません</p>';
        _updateCount(0, 0);
        return;
      }

      // 新しい順にソート
      _allMemories = [..._allMemories].reverse();

      // v1.1修正 - 正確な件数表示（Worker側のtotalを使用）
      _updateCount(_allMemories.length, _totalCount);

      // 一覧描画
      _renderList(_allMemories);

    } catch (e) {
      console.error('[MemoryUI] 一覧取得エラー:', e);
      listDiv.innerHTML = `<p class="memory-empty">読み込みエラー: ${e.message}</p>`;
    }
  }

  /** メモリー管理画面を閉じる */
  function hide() {
    const overlay = document.getElementById('memory-manager');
    if (overlay) overlay.classList.add('hidden');
  }

  // =========================================
  // v1.1追加 - 検索フィルタ
  // =========================================

  /** 検索入力時のフィルタ処理 */
  function _onSearchInput(e) {
    const query = (e.target.value || '').trim().toLowerCase();
    if (!query) {
      _renderList(_allMemories);
      _updateCount(_allMemories.length, _totalCount);
      return;
    }

    // 議題・要約・決定事項で部分一致フィルタ
    const filtered = _allMemories.filter(m => {
      const topic = (m.topic || '').toLowerCase();
      const summary = (m.summary || '').toLowerCase();
      const decisions = (m.decisions || []).join(' ').toLowerCase();
      return topic.includes(query) || summary.includes(query) || decisions.includes(query);
    });

    _renderList(filtered);
    _updateCount(filtered.length, _totalCount, query);
  }

  // =========================================
  // v1.1追加 - 一括削除
  // =========================================

  /** 全件削除（確認ダイアログ2段階） */
  async function _deleteAll() {
    if (_totalCount === 0) {
      alert('削除する記憶がありません。');
      return;
    }

    if (!confirm(`全${_totalCount}件の記憶を削除しますか？\nこの操作は取り消せません。`)) return;
    if (!confirm('本当に全件削除しますか？\nWorker KVから完全に消えます。')) return;

    try {
      const result = await MeetingMemory.deleteAllMemories();
      if (result && result.success) {
        _allMemories = [];
        _totalCount = 0;
        const listDiv = document.getElementById('memory-list');
        if (listDiv) listDiv.innerHTML = '<p class="memory-empty">全ての記憶を削除しました</p>';
        _updateCount(0, 0);
      } else {
        alert('一括削除に失敗しました。もう一度お試しください。');
      }
    } catch (e) {
      console.error('[MemoryUI] 一括削除エラー:', e);
      alert(`一括削除エラー: ${e.message}`);
    }
  }

  // =========================================
  // v1.2追加 - 期間指定削除
  // =========================================

  /** 指定期間より古い記憶を削除 */
  async function _deleteByPeriod() {
    const select = document.getElementById('memory-period-select');
    if (!select) return;

    const days = parseInt(select.value, 10);
    if (!days || days <= 0) {
      alert('削除する期間を選択してください。');
      return;
    }

    // 基準日時を計算
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffISO = cutoff.toISOString();

    // 対象件数を先にカウント
    const targets = _allMemories.filter(m => m.createdAt && m.createdAt < cutoffISO);
    if (targets.length === 0) {
      alert(`${days}日以上前の記憶はありません。`);
      return;
    }

    if (!confirm(`${days}日以上前の記憶を${targets.length}件削除しますか？\nこの操作は取り消せません。`)) return;

    // 1件ずつ削除（Worker側に期間指定APIがないため）
    let deleted = 0;
    for (const m of targets) {
      try {
        const result = await MeetingMemory.deleteMemory(m.key);
        if (result && result.success) deleted++;
      } catch (e) {
        console.warn(`[MemoryUI] 期間削除中エラー: ${m.key}`, e);
      }
    }

    // UIを更新
    _allMemories = _allMemories.filter(m => !targets.includes(m));
    _totalCount = Math.max(0, _totalCount - deleted);
    _renderList(_allMemories);
    _updateCount(_allMemories.length, _totalCount);
    alert(`${deleted}件の記憶を削除しました。`);
  }

  // =========================================
  // 描画ヘルパー
  // =========================================

  /** v1.1修正 - 件数表示を正確化 */
  function _updateCount(shown, total, query) {
    const el = document.getElementById('memory-count');
    if (!el) return;
    if (query) {
      el.textContent = `${shown}/${total}件（検索中）`;
    } else {
      el.textContent = `${total}件の記憶`;
    }
  }

  /** 一覧を描画 */
  function _renderList(memories) {
    const listDiv = document.getElementById('memory-list');
    if (!listDiv) return;

    if (memories.length === 0) {
      listDiv.innerHTML = '<p class="memory-empty">該当する記憶がありません</p>';
      return;
    }

    listDiv.innerHTML = memories.map(m => _renderItem(m)).join('');

    listDiv.onclick = (e) => {
      const detailBtn = e.target.closest('.memory-detail-btn');
      const delBtn = e.target.closest('.memory-delete-btn');
      if (detailBtn) _showDetail(detailBtn.dataset.key, memories);
      if (delBtn) _deleteMemory(delBtn.dataset.key);
    };
  }

  /** 一覧アイテムのHTML生成 */
  function _renderItem(m) {
    const date = m.createdAt ? m.createdAt.slice(0, 10) : '不明';
    const time = m.createdAt ? m.createdAt.slice(11, 16) : '';
    const leadName = SISTER_DISPLAY[m.lead]?.name || m.lead || '—';
    const leadEmoji = SISTER_DISPLAY[m.lead]?.emoji || '👤';
    const aiIcon = m.aiSummary ? '🤖' : '📝';
    const aiLabel = m.aiSummary ? 'AI要約' : 'フォールバック';
    const decStr = (m.decisions && m.decisions.length > 0)
      ? m.decisions.slice(0, 2).map(d => _escapeHtml(d)).join(' / ')
      : '（決定事項なし）';

    return `<div class="memory-item">
      <div class="memory-item-header">
        <span class="memory-date">${date} ${time}</span>
        <span class="memory-ai-badge ${m.aiSummary ? 'ai' : 'fallback'}">${aiIcon} ${aiLabel}</span>
      </div>
      <div class="memory-topic">${_escapeHtml(m.topic || '（議題なし）')}</div>
      <div class="memory-summary">${_escapeHtml(m.summary || '')}</div>
      <div class="memory-decisions">${decStr}</div>
      <div class="memory-meta">
        <span>${leadEmoji} ${leadName}</span>
        <span>🔄 R${m.round || 1}</span>
      </div>
      <div class="memory-actions">
        <button class="memory-detail-btn" data-key="${_escapeHtml(m.key)}">詳細</button>
        <button class="memory-delete-btn" data-key="${_escapeHtml(m.key)}">🗑️</button>
      </div>
    </div>`;
  }

  /** 記憶の詳細をモーダル表示 */
  function _showDetail(key, memories) {
    const m = memories.find(mem => mem.key === key);
    if (!m) return;

    const detailDiv = document.getElementById('memory-detail');
    if (!detailDiv) return;

    const date = m.createdAt || '不明';
    const leadName = SISTER_DISPLAY[m.lead]?.name || m.lead || '—';
    const decisions = (m.decisions && m.decisions.length > 0)
      ? m.decisions.map(d => `<li>${_escapeHtml(d)}</li>`).join('')
      : '<li>（決定事項なし）</li>';

    detailDiv.innerHTML = `
      <div class="memory-detail-card">
        <div class="memory-detail-header">
          <h3>📌 ${_escapeHtml(m.topic || '（議題なし）')}</h3>
          <button class="memory-detail-close-btn" id="btn-memory-detail-close">✕</button>
        </div>
        <div class="memory-detail-body">
          <div class="detail-row">
            <span class="detail-label">📅 日時</span>
            <span>${_escapeHtml(date)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">👤 主担当</span>
            <span>${_escapeHtml(leadName)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">🔄 ラウンド</span>
            <span>${m.round || 1}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">${m.aiSummary ? '🤖 AI要約' : '📝 フォールバック'}</span>
            <span>${m.aiSummary ? 'はい' : 'いいえ'}</span>
          </div>
          ${m.aiError ? `<div class="detail-row"><span class="detail-label">⚠️ AI備考</span><span class="detail-error">${_escapeHtml(m.aiError)}</span></div>` : ''}
          <div class="detail-section">
            <span class="detail-label">📝 要約</span>
            <p class="detail-text">${_escapeHtml(m.summary || '—')}</p>
          </div>
          <div class="detail-section">
            <span class="detail-label">✅ 決定事項</span>
            <ul class="detail-decisions">${decisions}</ul>
          </div>
          <div class="detail-row">
            <span class="detail-label">🔑 キー</span>
            <span class="detail-key">${_escapeHtml(m.key)}</span>
          </div>
        </div>
      </div>`;

    detailDiv.classList.remove('hidden');

    const closeBtn = document.getElementById('btn-memory-detail-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => detailDiv.classList.add('hidden'));
    }
  }

  /** 記憶を1件削除 */
  async function _deleteMemory(key) {
    if (!confirm('この記憶を削除しますか？\n削除するとWorker KVから完全に消えます。')) return;

    try {
      const result = await MeetingMemory.deleteMemory(key);
      if (result && result.success) {
        _allMemories = _allMemories.filter(m => m.key !== key);
        _totalCount = Math.max(0, _totalCount - 1);
        _renderList(_allMemories);
        _updateCount(_allMemories.length, _totalCount);
      } else {
        alert('削除に失敗しました。もう一度お試しください。');
      }
    } catch (e) {
      console.error('[MemoryUI] 削除エラー:', e);
      alert(`削除エラー: ${e.message}`);
    }
  }

  /** HTMLエスケープ（XSS防止） */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { init, show, hide };
})();
