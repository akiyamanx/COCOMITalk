// meeting-voice.js v1.0
// このファイルは会議モードの音声制御＋UX改善（確認ダイアログ）を担当する
// meeting-ui.jsから分離。確認ダイアログの表示/非表示、送信ボタンの状態分岐を管理
// v1.0 2026-03-10 新規作成 - Step 5c: 会議音声＋確認ダイアログ

'use strict';

/**
 * 会議音声＋UXモジュール
 * - ▶ボタン押下時の確認ダイアログ（進行中会議の続行 or 新規開始）
 * - 会議入力欄のplaceholder動的変更
 * - 確認ダイアログの表示/応答処理
 */
const MeetingVoice = (() => {

  let _dialog = null;
  let _msgEl = null;
  let _btnYes = null;
  let _btnNo = null;
  // 確認ダイアログで「はい」を押した時の処理を一時保持
  let _pendingText = '';

  /** 初期化（app.jsまたはMeetingUI.init後に呼ぶ） */
  function init() {
    _dialog = document.getElementById('meeting-confirm-dialog');
    _msgEl = document.getElementById('meeting-confirm-msg');
    _btnYes = document.getElementById('btn-confirm-yes');
    _btnNo = document.getElementById('btn-confirm-no');

    if (_btnYes) {
      _btnYes.addEventListener('click', _onConfirmYes);
    }
    if (_btnNo) {
      _btnNo.addEventListener('click', _onConfirmNo);
    }
    // オーバーレイクリックで閉じる
    const overlay = _dialog?.querySelector('.meeting-confirm-overlay');
    if (overlay) {
      overlay.addEventListener('click', _hideDialog);
    }

    console.log('[MeetingVoice] 初期化完了');
  }

  /**
   * 確認ダイアログを表示
   * 会議進行中に▶ボタン or Enterキーが押された時に呼ばれる
   * @param {string} text - 入力欄のテキスト
   */
  function showConfirm(text) {
    _pendingText = text;
    if (!_dialog || !_msgEl) return;

    const round = (typeof MeetingRelay !== 'undefined') ? MeetingRelay.getCurrentRound() : 0;
    _msgEl.innerHTML =
      `📌 現在ラウンド${round}まで完了しています。<br><br>` +
      `「<strong>${_truncate(text, 30)}</strong>」を<br>どちらで送信しますか？`;

    if (_btnYes) _btnYes.textContent = '🔄 この会議の続き（ラウンド' + (round + 1) + '）';
    if (_btnNo) _btnNo.textContent = '🆕 新しい会議として開始';

    _dialog.classList.remove('hidden');
  }

  /** 「この会議の続き」を選択 → 追加ラウンド */
  function _onConfirmYes() {
    _hideDialog();
    if (typeof MeetingUI !== 'undefined' && _pendingText) {
      // topicInputに値をセットしてからhandleContinueを呼ぶ
      const topicInput = document.querySelector('.meeting-topic-input');
      if (topicInput) topicInput.value = _pendingText;
      MeetingUI.handleContinue();
    }
    _pendingText = '';
  }

  /** 「新しい会議」を選択 → 新規開始 */
  function _onConfirmNo() {
    _hideDialog();
    if (typeof MeetingUI !== 'undefined' && _pendingText) {
      MeetingUI.startNewMeeting(_pendingText);
    }
    _pendingText = '';
  }

  /** ダイアログを閉じる */
  function _hideDialog() {
    if (_dialog) _dialog.classList.add('hidden');
  }

  /** テキストを指定文字数で切り詰め */
  function _truncate(text, max) {
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  return {
    init,
    showConfirm,
  };
})();
