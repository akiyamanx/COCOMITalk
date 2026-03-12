// voice-ui.js v1.1
// このファイルは音声会話のUI部品（DOM操作）を担当する
// マイクボタン、interim表示、送信確認UI、姉妹アイコン発光を管理
// voice-input.jsのVoiceControllerから呼ばれる

// v1.0 新規作成 - Step 5b voice-input.jsからUI部分を分離
// v1.1 追加 - リングウェーブ＋呼吸グロー マイクボタンデザイン

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
   * input-wrapperの中（テキストエリア＋送信ボタンと同じ行）に配置する
   */
  _getInputArea() {
    return document.querySelector('.input-wrapper')
      || document.querySelector('.input-area')
      || document.querySelector('#msg-input')?.parentElement;
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

    // v1.1: ラッパーdiv（波紋がはみ出せるようにoverflow:visible）
    const wrap = document.createElement('div');
    wrap.id = 'cocomi-mic-wrap';
    wrap.style.cssText = `
      position: relative; width: 42px; height: 42px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; overflow: visible;
    `;

    const btn = document.createElement('button');
    btn.id = 'cocomi-mic-btn';
    btn.className = 'cocomi-mic-btn cocomi-mic-idle';
    btn.setAttribute('aria-label', '音声入力');
    btn.innerHTML = '🎤';
    btn.addEventListener('click', onMicClick);
    btn.style.cssText = `
      width: 38px; height: 38px;
      border-radius: 50%;
      border: 2px solid var(--active-primary, #6c5ce7);
      background: white;
      font-size: 18px;
      cursor: pointer; transition: all 0.3s ease;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      padding: 0; position: relative; z-index: 3;
    `;

    // v1.1: リングウェーブ要素（listening時のみ表示）
    for (let i = 1; i <= 2; i++) {
      const ring = document.createElement('div');
      ring.className = `cocomi-mic-ring cocomi-mic-ring-${i}`;
      ring.style.display = 'none';
      wrap.appendChild(ring);
    }

    wrap.appendChild(btn);

    const inputArea = this._getInputArea();
    if (inputArea) {
      inputArea.appendChild(wrap);
    } else {
      wrap.style.position = 'fixed';
      wrap.style.bottom = '80px';
      wrap.style.right = '16px';
      wrap.style.zIndex = '1000';
      document.body.appendChild(wrap);
    }

    this._elements.micBtn = btn;
    this._elements.micWrap = wrap;
  }

  /**
   * interim（途中経過）テキスト表示エリアを生成
   */
  _createInterimArea() {
    const el = document.createElement('div');
    el.id = 'cocomi-voice-interim';
    el.style.cssText = `
      display: none;
      padding: 8px 12px; margin: 4px 8px;
      background: rgba(108, 92, 231, 0.1);
      border-left: 3px solid var(--active-primary, #6c5ce7);
      border-radius: 4px;
      font-size: 14px;
      color: #555;
      font-style: italic;
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
      padding: 8px 12px; margin: 4px 8px;
      background: rgba(108, 92, 231, 0.08);
      border: 1px solid var(--active-primary, #6c5ce7);
      border-radius: 8px; font-size: 14px;
      color: #333;
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
      /* v1.1: リングウェーブ＋呼吸グロー */
      .cocomi-mic-listening {
        background: linear-gradient(135deg, #ec4899, #a855f7) !important;
        border-color: transparent !important;
        animation: cocomi-breath-scale 3s ease-in-out infinite !important;
      }
      .cocomi-mic-listening::before {
        content: '';
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ec4899, #a855f7);
        filter: blur(12px);
        z-index: -1;
        animation: cocomi-breath-glow 3s ease-in-out infinite;
      }
      .cocomi-mic-ring {
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px solid;
        pointer-events: none;
        z-index: 1;
      }
      .cocomi-mic-ring-1 {
        border-color: rgba(236,72,153,0.4);
        animation: cocomi-ring-expand 2.4s ease-out infinite;
      }
      .cocomi-mic-ring-2 {
        border-color: rgba(168,85,247,0.3);
        animation: cocomi-ring-expand 2.4s ease-out infinite 0.8s;
      }
      @keyframes cocomi-breath-scale {
        0%, 100% { transform: scale(1); box-shadow: 0 0 14px rgba(236,72,153,0.3); }
        50% { transform: scale(1.06); box-shadow: 0 0 24px rgba(168,85,247,0.4); }
      }
      @keyframes cocomi-breath-glow {
        0%, 100% { opacity: 0.25; transform: scale(0.9); }
        50% { opacity: 0.5; transform: scale(1.1); }
      }
      @keyframes cocomi-ring-expand {
        0% { width: 38px; height: 38px; opacity: 0.7; }
        100% { width: 72px; height: 72px; opacity: 0; }
      }
      /* speaking状態 */
      .cocomi-mic-speaking {
        background: linear-gradient(135deg, #a855f7, #6c5ce7) !important;
        border-color: transparent !important;
        box-shadow: 0 0 12px rgba(108,92,231,0.4);
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

    // v1.1: リング要素の表示/非表示
    const rings = this._elements.micWrap
      ? this._elements.micWrap.querySelectorAll('.cocomi-mic-ring')
      : [];
    const showRings = (state === 'listening');
    rings.forEach(r => { r.style.display = showRings ? 'block' : 'none'; });

    // CSSクラスをリセット
    btn.classList.remove('cocomi-mic-idle', 'cocomi-mic-listening', 'cocomi-mic-speaking');

    if (state === 'listening') {
      btn.classList.add('cocomi-mic-listening');
      btn.innerHTML = '🎤';
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.animation = '';
    } else if (state === 'speaking') {
      btn.classList.add('cocomi-mic-speaking');
      btn.innerHTML = '🔊';
      btn.style.animation = 'none';
    } else if (state === 'error') {
      btn.classList.add('cocomi-mic-idle');
      btn.style.background = '#e74c3c';
      btn.style.borderColor = '#e74c3c';
      btn.style.animation = 'none';
      btn.innerHTML = '⚠️';
    } else {
      // idle
      btn.classList.add('cocomi-mic-idle');
      btn.style.background = 'white';
      btn.style.borderColor = 'var(--active-primary, #6c5ce7)';
      btn.style.animation = 'none';
      btn.innerHTML = '🎤';
    }
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
      <div style="margin-bottom:6px; color:#333;">
        「${escaped}」
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="cocomi-voice-send" style="
          padding:6px 16px; border-radius:6px; border:none;
          background:var(--active-primary, #6c5ce7); color:white;
          cursor:pointer; font-size:14px;">送る！</button>
        <button id="cocomi-voice-cancel" style="
          padding:6px 16px; border-radius:6px; border:1px solid #ccc;
          background:white; color:#666;
          cursor:pointer; font-size:14px;">やめる</button>
        <button id="cocomi-voice-retry" style="
          padding:6px 16px; border-radius:6px; border:1px solid #ccc;
          background:white; color:#666;
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
