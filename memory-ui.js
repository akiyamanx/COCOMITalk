// COCOMITalk - メモリー管理UI（KV記憶の一覧・詳細・削除・検索・一括削除）
// このファイルはKVに保存された会議記憶を一覧表示し、確認・削除を行うUI
// 設定画面の「🧠記憶管理を開く」ボタンから起動される
// meeting-archive-ui.js のパターンを踏襲
// v1.0 2026-03-12 - Step 4補完: 新規作成
// v1.1 2026-03-11 - メモリー管理UI改善（件数正確化・検索フィルタ・一括削除）
// v1.2 2026-03-11 - 期間指定削除機能追加＋CSS整備
// v1.3 2026-03-13 - 期間指定削除サーバーサイド化（1件ずつループ→Worker SQL一発）
// v1.4 2026-03-15 - 感情の温度表示（一覧に絵文字＋詳細に感情セクション追加）
// v1.5 2026-03-16 - 日時表示をJST変換（UTCで保存→表示時にAsia/Tokyo変換）
'use strict';

/** メモリー管理UIモジュール */
const MemoryUI = (() => {

  // 姉妹表示設定
  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  // v1.4追加 - 感情温度→絵文字変換
  const EMOTION_EMOJI = { 1: '💧', 2: '😢', 3: '😐', 4: '😊', 5: '🔥' };
  function _emotionBadge(val) {
    if (!val) return '';
    return (EMOTION_EMOJI[val] || '😐') + val;
  }

  // v1.5追加 - UTC→JST変換ヘルパー（データはUTC保持、表示のみJST）
  function _toJSTDate(isoStr) {
    if (!isoStr) return '不明';
    const d = new Date(isoStr);
    return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function _toJSTTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function _toJSTFull(isoStr) {
    if (!isoStr) return '不明';
    const d = new Date(isoStr);
    return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  }

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
    if (btnDeleteAll) {
      btnDeleteAll.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('[MemoryUI] 全削除ボタン押下');
        _deleteAll();
      });
      console.log('[MemoryUI] 全削除ボタン: イベント設定OK');
    } else {
      console.warn('[MemoryUI] 全削除ボタンが見つかりません');
    }
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
  // v1.3改修 - サーバーサイド化（1件ずつループ→SQL一発）
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

    // 対象件数を先にカウント（UI表示用）
    const targets = _allMemories.filter(m => m.createdAt && m.createdAt < cutoffISO);
    if (targets.length === 0) {
      alert(`${days}日以上前の記憶はありません。`);
      return;
    }

    if (!confirm(`${days}日以上前の記憶を${targets.length}件削除しますか？\nこの操作は取り消せません。`)) return;

    try {
      // v1.3改修 - Worker側でSQL一発削除（1件ずつループ不要に）
      const result = await MeetingMemory.deleteByPeriod(cutoffISO);
      if (result && result.success) {
        const deleted = result.deleted || 0;
        // UIを更新
        _allMemories = _allMemories.filter(m => !(m.createdAt && m.createdAt < cutoffISO));
        _totalCount = Math.max(0, _totalCount - deleted);
        _renderList(_allMemories);
        _updateCount(_allMemories.length, _totalCount);
        alert(`${deleted}件の記憶を削除しました。`);
      } else {
        alert('期間指定削除に失敗しました。もう一度お試しください。');
      }
    } catch (e) {
      console.error('[MemoryUI] 期間指定削除エラー:', e);
      alert(`期間指定削除エラー: ${e.message}`);
    }
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
    // v1.5変更 - JST変換表示（UTCスライスから変換関数に差し替え）
    const date = _toJSTDate(m.createdAt);
    const time = _toJSTTime(m.createdAt);
    const leadName = SISTER_DISPLAY[m.lead]?.name || m.lead || '—';
    const leadEmoji = SISTER_DISPLAY[m.lead]?.emoji || '👤';
    const aiIcon = m.aiSummary ? '🤖' : '📝';
    const aiLabel = m.aiSummary ? 'AI要約' : 'フォールバック';
    const decStr = (m.decisions && m.decisions.length > 0)
      ? m.decisions.slice(0, 2).map(d => _escapeHtml(d)).join(' / ')
      : '（決定事項なし）';
    // v1.4追加 - 感情温度バッジ
    const emoUser = _emotionBadge(m.emotionUser);
    const emoAi = _emotionBadge(m.emotionAi);
    const emoHtml = (emoUser || emoAi)
      ? `<span class="memory-emotion-badge">🌡️ ${emoUser || '—'}/${emoAi || '—'}</span>` : '';

    return `<div class="memory-item">
      <div class="memory-item-header">
        <span class="memory-date">${date} ${time}</span>
        ${emoHtml}
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

    // v1.5変更 - JST変換表示
    const date = _toJSTFull(m.createdAt);
    const leadName = SISTER_DISPLAY[m.lead]?.name || m.lead || '—';
    const decisions = (m.decisions && m.decisions.length > 0)
      ? m.decisions.map(d => `<li>${_escapeHtml(d)}</li>`).join('')
      : '<li>（決定事項なし）</li>';
    // v1.4追加 - 感情セクションHTML
    const hasEmotion = m.emotionUser || m.emotionAi;
    const emotionHtml = hasEmotion ? `
          <div class="detail-section">
            <span class="detail-label">🌡️ 感情の温度</span>
            <div class="detail-row" style="margin-top:4px">
              <span>👤 アキヤ</span>
              <span>${_emotionBadge(m.emotionUser) || '—'}</span>
            </div>
            <div class="detail-row">
              <span>🤖 AI</span>
              <span>${_emotionBadge(m.emotionAi) || '—'}</span>
            </div>
            ${m.emotionComment ? `<p class="detail-text" style="margin-top:4px">💬 ${_escapeHtml(m.emotionComment)}</p>` : ''}
          </div>` : '';

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
          ${emotionHtml}
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
