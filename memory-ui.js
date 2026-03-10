// COCOMITalk - メモリー管理UI（KV記憶の一覧・詳細・削除）
// このファイルはKVに保存された会議記憶を一覧表示し、確認・削除を行うUI
// 設定画面の「🧠記憶管理を開く」ボタンから起動される
// meeting-archive-ui.js のパターンを踏襲
// v1.0 2026-03-12 - Step 4補完: 新規作成
'use strict';

/** メモリー管理UIモジュール */
const MemoryUI = (() => {

  // 姉妹表示設定
  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  /** 初期化（イベント設定） */
  function init() {
    // 記憶管理を開くボタン（設定モーダル内）
    const btnOpen = document.getElementById('btn-open-memory-ui');
    if (btnOpen) btnOpen.addEventListener('click', show);
    // オーバーレイの閉じるボタン
    const btnClose = document.getElementById('btn-memory-close');
    if (btnClose) btnClose.addEventListener('click', hide);
    console.log('[MemoryUI] 初期化完了');
  }

  /**
   * メモリー一覧画面を表示
   * Worker /memory?limit=20 から取得して描画
   */
  async function show() {
    const overlay = document.getElementById('memory-manager');
    const listDiv = document.getElementById('memory-list');
    if (!overlay || !listDiv) return;

    // ローディング
    listDiv.innerHTML = '<p class="memory-loading">🧠 記憶を読み込み中...</p>';
    overlay.classList.remove('hidden');

    try {
      if (typeof MeetingMemory === 'undefined') {
        listDiv.innerHTML = '<p class="memory-empty">MeetingMemoryモジュールが未読み込みです</p>';
        return;
      }

      // 最大20件取得
      const memories = await MeetingMemory.getMemories(20);
      if (!memories || memories.length === 0) {
        listDiv.innerHTML = '<p class="memory-empty">まだ記憶がありません</p>';
        _updateCount(0, 0);
        return;
      }

      // 新しい順に表示（Worker側はslice(-limit)で古い順なのでreverse）
      const sorted = [...memories].reverse();

      // 全件数を取得（getMemoriesの中でtotalも取れるが、ここでは配列長で代用）
      _updateCount(sorted.length, sorted.length);

      // 一覧HTML生成
      listDiv.innerHTML = sorted.map(m => _renderItem(m)).join('');

      // イベント委譲（詳細・削除ボタン）
      listDiv.onclick = (e) => {
        const detailBtn = e.target.closest('.memory-detail-btn');
        const delBtn = e.target.closest('.memory-delete-btn');
        if (detailBtn) _showDetail(detailBtn.dataset.key, sorted);
        if (delBtn) _deleteMemory(delBtn.dataset.key);
      };

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

  /** 件数表示を更新 */
  function _updateCount(shown, total) {
    const el = document.getElementById('memory-count');
    if (el) el.textContent = `${total}件の記憶`;
  }

  /**
   * 一覧アイテムのHTML生成
   * @param {object} m - 記憶データ
   * @returns {string} HTML文字列
   */
  function _renderItem(m) {
    const date = m.createdAt ? m.createdAt.slice(0, 10) : '不明';
    const time = m.createdAt ? m.createdAt.slice(11, 16) : '';
    const leadName = SISTER_DISPLAY[m.lead]?.name || m.lead || '—';
    const leadEmoji = SISTER_DISPLAY[m.lead]?.emoji || '👤';
    const aiIcon = m.aiSummary ? '🤖' : '📝';
    const aiLabel = m.aiSummary ? 'AI要約' : 'フォールバック';
    // decisions表示（最大2件まで）
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

  /**
   * 記憶の詳細をモーダル表示
   * @param {string} key - 記憶のキー
   * @param {Array} memories - 記憶配列
   */
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

    // 閉じるボタン
    const closeBtn = document.getElementById('btn-memory-detail-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        detailDiv.classList.add('hidden');
      });
    }
  }

  /**
   * 記憶を1件削除（確認ダイアログあり）
   * @param {string} key - 記憶のキー
   */
  async function _deleteMemory(key) {
    if (!confirm('この記憶を削除しますか？\n削除するとWorker KVから完全に消えます。')) return;

    try {
      const result = await MeetingMemory.deleteMemory(key);
      if (result && result.success) {
        // 一覧を再取得して再描画
        await show();
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
