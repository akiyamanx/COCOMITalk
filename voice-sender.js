// voice-sender.js v1.0
// このファイルはVoiceControllerの送信処理メソッドを外部ファイルに分離したもの
// voice-input.jsの行数削減のため、mixinパターンでVoiceController.prototypeに注入
// voice-input.jsより後に読み込むこと（VoiceControllerクラスが先に定義されている必要あり）

// v1.0 新規作成 - voice-input.js v1.8.3から送信処理を分離（mixin方式）
// v1.0.1 修正 - 会議マイクもリングウェーブ＋呼吸グローデザインに対応

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

/** 会議マイクボタンのUI状態を同期更新 v1.0.1 新デザイン対応 */
VoiceController.prototype._updateMeetingMicState = function(state) {
  const btn = document.getElementById('btn-meeting-mic');
  if (!btn) return;

  if (state === 'listening') {
    btn.style.background = 'linear-gradient(135deg, #ec4899, #a855f7)';
    btn.style.borderColor = 'transparent';
    btn.innerHTML = '🎤';
    btn.style.animation = 'cocomi-breath-scale 3s ease-in-out infinite';
    btn.style.boxShadow = '0 0 14px rgba(236,72,153,0.3)';
  } else if (state === 'speaking') {
    btn.style.background = 'linear-gradient(135deg, #a855f7, #6c5ce7)';
    btn.style.borderColor = 'transparent';
    btn.innerHTML = '🔊';
    btn.style.animation = 'none';
    btn.style.boxShadow = '0 0 12px rgba(108,92,231,0.4)';
  } else if (state === 'error') {
    btn.style.background = '#e74c3c';
    btn.style.borderColor = '#e74c3c';
    btn.innerHTML = '⚠️';
    btn.style.animation = 'none';
    btn.style.boxShadow = 'none';
  } else {
    btn.style.background = 'white';
    btn.style.borderColor = 'var(--active-primary,#6c5ce7)';
    btn.innerHTML = '🎤';
    btn.style.animation = 'none';
    btn.style.boxShadow = 'none';
  }
};

console.log('[VoiceSender] v1.0 mixin注入完了');
