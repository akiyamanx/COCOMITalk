// voice-send.js v1.0
// このファイルは音声入力テキストをチャット/会議に送信する処理を担当する
// voice-input.js から分離（500行制限対策＋責務分離）
// v1.0 新規作成 - バグ修正: UI固まり問題の根本対策
//   - sendBtn.click()→input値セット＋_handleSendトリガーの確実な発火
//   - 送信後のUIリカバリタイムアウト追加（5秒後に強制idle復帰）
//   - 会議モード送信のエラーハンドリング強化

'use strict';

/**
 * VoiceSend
 * 音声入力テキストをチャット/会議に送信する
 *
 * 使い方:
 *   const sender = new VoiceSend();
 *   sender.send(text, { onComplete, onError });
 */
class VoiceSend {
  constructor() {
    // v1.0 送信中フラグ（二重送信防止）
    this._sending = false;
    // v1.0 UIリカバリタイマー
    this._recoveryTimer = null;
  }

  /**
   * 音声テキストをチャットまたは会議に送信する
   * @param {string} text - 送信するテキスト
   * @param {Object} callbacks
   * @param {Function} callbacks.onComplete - 送信トリガー後のコールバック
   * @param {Function} callbacks.onError - エラー時のコールバック(errorMsg)
   */
  send(text, callbacks = {}) {
    if (this._sending) {
      console.warn('[VoiceSend] 二重送信を防止しました');
      return;
    }
    this._sending = true;

    try {
      // 会議画面が表示中かチェック
      const inMeeting = typeof MeetingUI !== 'undefined' && MeetingUI.getIsVisible();

      if (inMeeting) {
        this._sendToMeeting(text, callbacks);
      } else {
        this._sendToNormalChat(text, callbacks);
      }

      // v1.0追加: UIリカバリタイムアウト（5秒後に強制復帰）
      // 送信が正常に処理されたがUIが戻らないケースの最終防衛
      this._startRecoveryTimer(callbacks);

    } catch (e) {
      console.error('[VoiceSend] 送信エラー:', e);
      this._sending = false;
      callbacks.onError?.('送信エラーが発生しました');
    }
  }

  /** 送信中かどうか */
  isSending() { return this._sending; }

  /** 送信完了を通知（外部からのリカバリ用） */
  markComplete() {
    this._sending = false;
    this._clearRecoveryTimer();
  }

  // ═══════════════════════════════════════════
  // 通常チャットへの送信 v1.0 — バグ2根本修正
  // ═══════════════════════════════════════════

  /**
   * 通常チャットに送信する
   * 旧方式: sendBtn.click()→btnがdisabledだとKeyboardEventフォールバック→不発
   * 新方式: input値セット→inputイベント→sendBtn確認→click or btn-send再取得
   */
  _sendToNormalChat(text, callbacks) {
    const input = document.getElementById('msg-input');
    if (!input) {
      console.error('[VoiceSend] #msg-input が見つかりません');
      this._sending = false;
      callbacks.onError?.('入力欄が見つかりません');
      return;
    }

    // 入力欄にテキストをセット
    input.value = text;
    // inputイベントを発火してbtnSendのdisabled状態を更新させる
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // 少し待ってからボタンのdisabled状態が更新されるのを待つ
    setTimeout(() => {
      try {
        const sendBtn = document.getElementById('btn-send');

        if (sendBtn && !sendBtn.disabled) {
          // 通常パス: ボタンが有効なのでクリック
          sendBtn.click();
          console.log('[VoiceSend] 通常チャット送信完了（btn-send.click）');
        } else if (sendBtn && sendBtn.disabled) {
          // btnがまだdisabledの場合: inputイベントの反映が遅い
          // → もう一度inputイベントを発火してリトライ
          console.warn('[VoiceSend] btn-sendがdisabled → inputイベント再発火してリトライ');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => {
            const retryBtn = document.getElementById('btn-send');
            if (retryBtn && !retryBtn.disabled) {
              retryBtn.click();
              console.log('[VoiceSend] リトライ送信完了');
            } else {
              // 最終手段: Enterキーイベント
              console.warn('[VoiceSend] リトライも失敗 → Enterキー送信');
              input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter',
                keyCode: 13, which: 13, bubbles: true
              }));
            }
            this._sending = false;
            callbacks.onComplete?.();
          }, 100);
          return;
        } else {
          // sendBtnが存在しない場合
          console.error('[VoiceSend] #btn-send が見つかりません');
          this._sending = false;
          callbacks.onError?.('送信ボタンが見つかりません');
          return;
        }

        this._sending = false;
        callbacks.onComplete?.();
      } catch (e) {
        console.error('[VoiceSend] 送信処理内エラー:', e);
        this._sending = false;
        callbacks.onError?.('送信処理でエラーが発生しました');
      }
    }, 80); // v1.0: 50ms→80msに延長（inputイベント反映の余裕）
  }

  // ═══════════════════════════════════════════
  // 会議モードへの送信
  // ═══════════════════════════════════════════

  /**
   * 会議モードに送信する
   */
  _sendToMeeting(text, callbacks) {
    const topicInput = document.querySelector('.meeting-topic-input');
    if (!topicInput) {
      console.error('[VoiceSend] .meeting-topic-input が見つかりません');
      this._sending = false;
      callbacks.onError?.('会議入力欄が見つかりません');
      return;
    }

    topicInput.value = text;
    topicInput.dispatchEvent(new Event('input', { bubbles: true }));

    setTimeout(() => {
      try {
        // 会議進行中かどうかで送信先を判定
        const isRunning = typeof MeetingRelay !== 'undefined' && MeetingRelay.getCurrentRound() > 0;
        let triggered = false;

        if (isRunning) {
          const btnContinue = document.getElementById('btn-meeting-continue');
          if (btnContinue) {
            btnContinue.click();
            triggered = true;
            console.log('[VoiceSend] 会議追加ラウンド音声送信完了');
          }
        } else {
          const btnStart = document.getElementById('btn-meeting-start');
          if (btnStart) {
            btnStart.click();
            triggered = true;
            console.log('[VoiceSend] 会議開始音声送信完了');
          }
        }

        if (!triggered) {
          console.warn('[VoiceSend] 会議ボタンが見つかりませんでした');
          callbacks.onError?.('会議ボタンが見つかりません');
        } else {
          callbacks.onComplete?.();
        }
      } catch (e) {
        console.error('[VoiceSend] 会議送信エラー:', e);
        callbacks.onError?.('会議送信でエラーが発生しました');
      }
      this._sending = false;
    }, 80);
  }

  // ═══════════════════════════════════════════
  // UIリカバリタイマー v1.0
  // ═══════════════════════════════════════════

  /**
   * 送信後5秒経ってもsendingが解除されない場合の強制リカバリ
   * UIが固まるバグの最終防衛ライン
   */
  _startRecoveryTimer(callbacks) {
    this._clearRecoveryTimer();
    this._recoveryTimer = setTimeout(() => {
      if (this._sending) {
        console.warn('[VoiceSend] UIリカバリタイムアウト: 5秒経過で強制復帰');
        this._sending = false;
        callbacks.onError?.('送信タイムアウト — UIを復帰しました');
      }
    }, 5000);
  }

  /** リカバリタイマーをクリア */
  _clearRecoveryTimer() {
    if (this._recoveryTimer) {
      clearTimeout(this._recoveryTimer);
      this._recoveryTimer = null;
    }
  }
}

// グローバルに公開
window.VoiceSend = VoiceSend;
