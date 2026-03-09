// voice-ui.js v1.0
// このファイルは音声会話のUI部品（DOM操作）を担当する
// マイクボタン、interim表示、送信確認UI、姉妹アイコン発光を管理
// voice-input.jsのVoiceControllerから呼ばれる

// v1.0 新規作成 - Step 5b voice-input.jsからUI部分を分離

/**
 * VoiceUI
 * 音声会話に必要なDOM要素の生成と制御
 */
class VoiceUI {
  constructor() {
    this._elements = {};
    this._injectedStyles = false;
  }

  /**
   * 全UI要素を生成・DOM挿入
   * @param {function} onMicClick - マイクボタンクリック時のコールバック
   */
  init(onMicClick) {
    this._createMicButton(onMicClick);
    this._createInterimArea();
    this._createConfirmArea();
    this._injectStyles();
    console.log('[VoiceUI] UI要素生成完了');
  }

  /**
   * 入力エリアの親要素を取得（配置先）
   */
  _getInputArea() {
    return document.querySelector('.input-area')
      || document.querySelector('.chat-input-area')
      || document.querySelector('#chat-input')?.parentElement;
  }

  /**
   * マイクボタンを生成
   */
  _createMicButton(onMicClick) {
    if (document.getElementById('cocomi-mic-btn')) {
      this._elements.micBtn = document.getElementById('cocomi-mic-btn');
      this._elements.micBtn.addEventListener('click', onMicClick);
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'cocomi-mic-btn';
    btn.className = 'cocomi-mic-btn';
    btn.setAttribute('aria-label', '音声入力');
    btn.innerHTML = '🎤';
    btn.addEventListener('click', onMicClick);

    btn.style.cssText = `
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 2px solid var(--cocomi-accent, #6c5ce7);
      background: var(--cocomi-bg-card, #2d2d3d);
      color: white; font-size: 20px;
      cursor: pointer; transition: all 0.2s ease;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    `;

    const inputArea = this._getInputArea();
    if (inputArea) {
      inputArea.appendChild(btn);
    } else {
      // フォールバック: 固定配置
      btn.style.position = 'fixed';
      btn.style.bottom = '80px';
      btn.style.right = '16px';
      btn.style.zIndex = '1000';
      document.body.appendChild(btn);
    }

    this._elements.micBtn = btn;
  }

  /**
   * interim（途中経過）テキスト表示エリアを生成
   */
  _createInterimArea() {
    const el = document.createElement('div');
    el.id = 'cocomi-voice-interim';
    el.style.cssText = `
      display: none;
      padding: 8px 12px; margin: 4px 0;
      background: rgba(108, 92, 231, 0.15);
      border-left: 3px solid var(--cocomi-accent, #6c5ce7);
      border-radius: 4px;
      font-size: 14px;
      color: var(--cocomi-text, #e0e0e0);
      opacity: 0.8; font-style: italic;
    `;

    const inputArea = this._getInputArea();
    if (inputArea) {
      inputArea.parentElement.insertBefore(el, inputArea);
    }
    this._elements.interim = el;
  }

  /**
   * 送信確認エリアを生成
   */
  _createConfirmArea() {
    const el = document.createElement('div');
    el.id = 'cocomi-voice-confirm';
    el.style.cssText = `
      display: none;
      padding: 8px 12px; margin: 4px 0;
      background: rgba(108, 92, 231, 0.2);
      border: 1px solid var(--cocomi-accent, #6c5ce7);
      border-radius: 8px; font-size: 14px;
    `;

    const inputArea = this._getInputArea();
    if (inputArea) {
      inputArea.parentElement.insertBefore(el, inputArea);
    }
    this._elements.confirm = el;
  }

  /**
   * アニメーション用CSSを注入（初回のみ）
   */
  _injectStyles() {
    if (this._injectedStyles) return;
    this._injectedStyles = true;

    const style = document.createElement('style');
    style.id = 'cocomi-voice-styles';
    style.textContent = `
      @keyframes cocomi-mic-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(231, 76, 60, 0.4); }
        50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(231, 76, 60, 0); }
      }
      @keyframes cocomi-speak-glow {
        0%, 100% { box-shadow: 0 0 4px rgba(108, 92, 231, 0.3); }
        50% { box-shadow: 0 0 16px rgba(108, 92, 231, 0.8); }
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════
  // 状態更新メソッド
  // ═══════════════════════════════════════════

  /**
   * マイクボタンのUI状態を更新
   * @param {'idle'|'listening'|'speaking'|'error'} state
   */
  updateMicState(state) {
    const btn = this._elements.micBtn;
    if (!btn) return;

    const styles = {
      idle:      { bg: 'var(--cocomi-bg-card, #2d2d3d)', border: 'var(--cocomi-accent, #6c5ce7)', anim: 'none', icon: '🎤' },
      listening: { bg: '#e74c3c', border: '#e74c3c', anim: 'cocomi-mic-pulse 1s ease-in-out infinite', icon: '🎤' },
      speaking:  { bg: 'var(--cocomi-accent, #6c5ce7)', border: 'var(--cocomi-accent, #6c5ce7)', anim: 'none', icon: '🔊' },
      error:     { bg: '#e74c3c', border: '#e74c3c', anim: 'none', icon: '⚠️' }
    };

    const s = styles[state] || styles.idle;
    btn.style.background = s.bg;
    btn.style.borderColor = s.border;
    btn.style.animation = s.anim;
    btn.innerHTML = s.icon;
  }

  /**
   * interim テキストを表示
   */
  showInterim(text) {
    const el = this._elements.interim;
    if (!el) return;
    el.style.display = 'block';
    el.textContent = text || '🎤 聞いてるよ...';
  }

  /**
   * interimを非表示
   */
  hideInterim() {
    const el = this._elements.interim;
    if (el) el.style.display = 'none';
  }

  /**
   * 送信確認UIを表示
   * @param {string} text - 確定テキスト
   * @param {function} onSend - 送信コールバック
   * @param {function} onCancel - キャンセルコールバック
   * @param {function} onRetry - もう一回コールバック
   */
  showConfirm(text, onSend, onCancel, onRetry) {
    const el = this._elements.confirm;
    if (!el) return;

    this.hideInterim();
    el.style.display = 'block';

    // HTMLエスケープ
    const escaped = this._escapeHTML(text);

    el.innerHTML = `
      <div style="margin-bottom:6px; color:var(--cocomi-text, #e0e0e0);">
        「${escaped}」
      </div>
      <div style="display:flex; gap:8px;">
        <button id="cocomi-voice-send" style="
          padding:6px 16px; border-radius:6px; border:none;
          background:var(--cocomi-accent, #6c5ce7); color:white;
          cursor:pointer; font-size:14px;">送る！</button>
        <button id="cocomi-voice-cancel" style="
          padding:6px 16px; border-radius:6px; border:1px solid #666;
          background:transparent; color:#ccc;
          cursor:pointer; font-size:14px;">やめる</button>
        <button id="cocomi-voice-retry" style="
          padding:6px 16px; border-radius:6px; border:1px solid #666;
          background:transparent; color:#ccc;
          cursor:pointer; font-size:14px;">🎤 もう一回</button>
      </div>
    `;

    document.getElementById('cocomi-voice-send')?.addEventListener('click', onSend);
    document.getElementById('cocomi-voice-cancel')?.addEventListener('click', onCancel);
    document.getElementById('cocomi-voice-retry')?.addEventListener('click', onRetry);
  }

  /**
   * 確認UIを非表示
   */
  hideConfirm() {
    const el = this._elements.confirm;
    if (el) el.style.display = 'none';
  }

  /**
   * 姉妹アイコンの発光制御
   */
  highlightSister(sisterId, active) {
    const els = document.querySelectorAll(`[data-sister="${sisterId}"]`);
    els.forEach(el => {
      if (active) {
        el.classList.add('cocomi-speaking');
        el.style.animation = 'cocomi-speak-glow 1s ease-in-out infinite';
      } else {
        el.classList.remove('cocomi-speaking');
        el.style.animation = 'none';
      }
    });
  }

  /**
   * ステータスメッセージ表示
   */
  showStatus(message, type = 'info') {
    console.log(`[VoiceUI] ${type}: ${message}`);
    const bar = document.querySelector('.status-bar')
      || document.querySelector('#cocomi-status');
    if (bar) {
      bar.textContent = message;
      const colors = { info: '#74b9ff', error: '#e74c3c', success: '#00b894' };
      bar.style.color = colors[type] || '#74b9ff';
    }
  }

  /**
   * マイクボタンの無効化
   */
  disableMic() {
    if (this._elements.micBtn) {
      this._elements.micBtn.disabled = true;
      this._elements.micBtn.style.opacity = '0.4';
    }
  }

  /**
   * HTMLエスケープ
   */
  _escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// グローバルに公開
window.VoiceUI = VoiceUI;
