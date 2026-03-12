// voice-sender.js v1.0
// このファイルはVoiceControllerの送信処理メソッドを外部ファイルに分離したもの
// voice-input.jsの行数削減のため、mixinパターンでVoiceController.prototypeに注入
// voice-input.jsより後に読み込むこと（VoiceControllerクラスが先に定義されている必要あり）

// v1.0 新規作成 - voice-input.js v1.8.3から送信処理を分離（mixin方式）

/**
 * VoiceControllerに送信系メソッドをmixin注入
 * voice-input.jsでクラス定義 → voice-sender.jsでメソッド追加
 * thisはVoiceControllerインスタンスを指すので、全プロパティにアクセス可能
 */

// ═══════════════════════════════════════════
// 送信処理（voice-input.js v1.8.3から移植）
// ═══════════════════════════════════════════

/** 音声メッセージの送信（コマンド判定→送信） */
VoiceController.prototype._sendVoiceMessage = function(text) {
  try {
    // 音声コマンドチェック
    if (this._voiceCmd && this._voiceCmd.handle(text)) return;

    // 通常メッセージ送信（v1.7の実績あるロジックに戻し）
    this._ui.hideInterim();
    this._lastText = '';

    const inMeeting = typeof MeetingUI !== 'undefined' && MeetingUI.getIsVisible();
    if (inMeeting) {
      this._sendToMeeting(text);
    } else {
      this._sendToNormalChat(text);
    }
  } catch (e) {
    console.error('[Voice] _sendVoiceMessage エラー:', e);
    this._forceIdleState();
    this._ui.showStatus('送信エラーが発生しました', 'error');
  }
};

/** 通常チャットへの音声送信（v1.7実績ロジック） */
VoiceController.prototype._sendToNormalChat = function(text) {
  const input = document.getElementById('msg-input');
  if (!input) {
    console.error('[Voice] #msg-input が見つかりません');
    this._forceIdleState();
    return;
  }
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => {
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      console.log('[Voice] 通常チャット音声送信完了');
    } else {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter',
        keyCode: 13, which: 13, bubbles: true
      });
      input.dispatchEvent(event);
    }
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
  }, 50);
};

/** 会議モードへの音声送信（v1.7実績ロジック） */
VoiceController.prototype._sendToMeeting = function(text) {
  const topicInput = document.querySelector('.meeting-topic-input');
  if (!topicInput) {
    console.error('[Voice] .meeting-topic-input が見つかりません');
    this._forceIdleState();
    return;
  }
  topicInput.value = text;
  topicInput.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(() => {
    const isRunning = typeof MeetingRelay !== 'undefined' && MeetingRelay.getCurrentRound() > 0;
    if (isRunning) {
      const btnContinue = document.getElementById('btn-meeting-continue');
      if (btnContinue) { btnContinue.click(); console.log('[Voice] 会議追加ラウンド音声送信完了'); }
    } else {
      const btnStart = document.getElementById('btn-meeting-start');
      if (btnStart) { btnStart.click(); console.log('[Voice] 会議開始音声送信完了'); }
    }
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
  }, 50);
};

/** 会議マイクボタンのUI状態を同期更新 */
VoiceController.prototype._updateMeetingMicState = function(state) {
  const btn = document.getElementById('btn-meeting-mic');
  if (!btn) return;
  const styles = {
    idle:      { bg: 'white', border: 'var(--active-primary,#6c5ce7)', icon: '🎤' },
    listening: { bg: '#e74c3c', border: '#e74c3c', icon: '🎤' },
    speaking:  { bg: 'var(--active-primary,#6c5ce7)', border: 'var(--active-primary,#6c5ce7)', icon: '🔊' },
    error:     { bg: '#e74c3c', border: '#e74c3c', icon: '⚠️' },
  };
  const s = styles[state] || styles.idle;
  btn.style.background = s.bg;
  btn.style.borderColor = s.border;
  btn.innerHTML = s.icon;
  btn.style.animation = state === 'listening'
    ? 'cocomi-mic-pulse 1s ease-in-out infinite' : 'none';
};

console.log('[VoiceSender] v1.0 mixin注入完了');
