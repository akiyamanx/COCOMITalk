// COCOMITalk - 過去の会議一覧UI
// このファイルは📂ボタンで表示される過去会議の一覧・閲覧・削除を管理する
// meeting-ui.jsから分割（500行制限対応）
// v1.0 Step 3.5 - 新規作成（2026-03-08）
// v1.1 2026-03-09 - 「見る」ボタンでMeetingRelay状態復元（過去会議の再開・追加質問対応）
'use strict';

/**
 * 会議アーカイブUIモジュール
 * - 過去の会議一覧表示
 * - 個別会議の閲覧（読み取り専用で再描画）
 * - 会議の削除
 * - MeetingHistory（IndexedDB）とMeetingUI（描画）の橋渡し
 */
const MeetingArchiveUI = (() => {

  // 姉妹表示設定（MeetingUIと同じ）
  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  /**
   * 初期化（イベント設定）
   */
  function init() {
    // 一覧画面の閉じるボタン
    const btnClose = document.getElementById('btn-archive-close');
    if (btnClose) {
      btnClose.addEventListener('click', hide);
    }
    console.log('[MeetingArchiveUI] 初期化完了');
  }

  /**
   * 過去の会議一覧を表示
   */
  async function show() {
    const archiveDiv = document.getElementById('meeting-archive');
    const listDiv = document.getElementById('archive-list');
    if (!archiveDiv || !listDiv) return;

    // ローディング表示
    listDiv.innerHTML = '<p class="archive-loading">読み込み中...</p>';
    archiveDiv.classList.remove('hidden');

    try {
      if (typeof MeetingHistory === 'undefined') {
        listDiv.innerHTML = '<p class="archive-empty">会議履歴モジュールが未読み込みです</p>';
        return;
      }

      const meetings = await MeetingHistory.getAllMeetings();
      if (!meetings || meetings.length === 0) {
        listDiv.innerHTML = '<p class="archive-empty">まだ会議の記録がありません</p>';
        return;
      }

      // 一覧HTML生成
      listDiv.innerHTML = meetings.map(m => _renderArchiveItem(m)).join('');

      // イベント委譲（見る/削除ボタン）
      listDiv.onclick = (e) => {
        const viewBtn = e.target.closest('.archive-view-btn');
        const delBtn = e.target.closest('.archive-delete-btn');
        if (viewBtn) _viewMeeting(viewBtn.dataset.id);
        if (delBtn) _deleteMeeting(delBtn.dataset.id);
      };

    } catch (e) {
      console.error('[MeetingArchiveUI] 一覧取得エラー:', e);
      listDiv.innerHTML = `<p class="archive-empty">読み込みエラー: ${e.message}</p>`;
    }
  }

  /**
   * 一覧画面を閉じる
   */
  function hide() {
    const archiveDiv = document.getElementById('meeting-archive');
    if (archiveDiv) archiveDiv.classList.add('hidden');
  }

  /**
   * 一覧アイテムのHTML生成
   * @param {Object} meeting - 会議データ
   * @returns {string} HTML文字列
   */
  function _renderArchiveItem(meeting) {
    const d = new Date(meeting.date);
    const dateStr = _formatDate(d);
    const timeStr = _formatTime(d);
    const leadName = SISTER_DISPLAY[meeting.lead]?.name || meeting.lead;
    const leadEmoji = SISTER_DISPLAY[meeting.lead]?.emoji || '👤';
    const count = meeting.history ? meeting.history.length : 0;
    const statusIcon = meeting.status === 'completed' ? '✅' : '🔄';

    return `<div class="archive-item" data-meeting-id="${meeting.id}">
      <div class="archive-item-header">
        <span class="archive-date">${dateStr} ${timeStr}</span>
        <span class="archive-status">${statusIcon}</span>
      </div>
      <div class="archive-topic">${_escapeHtml(meeting.topic)}</div>
      <div class="archive-meta">
        <span>${leadEmoji} 主担当: ${leadName}</span>
        <span>💬 ${count}発言</span>
      </div>
      <div class="archive-actions">
        <button class="archive-view-btn" data-id="${meeting.id}">見る</button>
        <button class="archive-delete-btn" data-id="${meeting.id}">🗑️</button>
      </div>
    </div>`;
  }

  /**
   * 過去の会議を閲覧＋再開（MeetingRelayの状態も復元し、追加ラウンド可能にする）
   * v1.1修正 - restoreFromDBで会議状態を復元（追加質問対応）
   * @param {string} meetingId - 会議ID
   */
  async function _viewMeeting(meetingId) {
    try {
      const meeting = await MeetingHistory.getMeeting(meetingId);
      if (!meeting) {
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.addSystemMessage('会議データが見つかりません');
        }
        return;
      }

      // 一覧を閉じる
      hide();

      // v1.1追加 - MeetingRelayの状態を復元（追加ラウンドできるようにする）
      let routing = null;
      if (typeof MeetingRelay !== 'undefined') {
        routing = MeetingRelay.restoreFromDB(meeting);
      }

      // MeetingUIに会議内容を再描画＋操作可能にする
      if (typeof MeetingUI === 'undefined') return;
      MeetingUI.restoreDisplay(meeting, routing);

    } catch (e) {
      console.error('[MeetingArchiveUI] 閲覧エラー:', e);
      if (typeof MeetingUI !== 'undefined') {
        MeetingUI.addSystemMessage(`表示エラー: ${e.message}`);
      }
    }
  }

  /**
   * 会議を削除（確認ダイアログあり）
   * @param {string} meetingId - 会議ID
   */
  async function _deleteMeeting(meetingId) {
    if (!confirm('この会議を削除しますか？')) return;

    try {
      await MeetingHistory.deleteMeeting(meetingId);
      // 一覧を再表示
      show();
    } catch (e) {
      console.error('[MeetingArchiveUI] 削除エラー:', e);
      alert(`削除エラー: ${e.message}`);
    }
  }

  /**
   * 日付フォーマット（YYYY-MM-DD）
   */
  function _formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * 時刻フォーマット（HH:MM）
   */
  function _formatTime(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * HTMLエスケープ（XSS防止）
   */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { init, show, hide };
})();
