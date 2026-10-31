// mic-indicator.js v1.0
// このファイルはCOCOMITalkのマイクボタンに「いま何をしているか」をはっきり出す表示部品
// 状態: 相手が話し中(マイクお休み) / 聞く準備OK(やさしい脈) / 声が聞こえた(強い輪＋音量に合わせて広がる＋「聞いてるよ」) /
//       文字起こし中(「文字にしてるよ…」) / 耳を起こし中(復帰中)。ラベルは aria-live で読み上げ端末にも伝える
// v1.0 2026-10-31 - 新規（whisper-provider v1.13 から update(state, level)、voice-ui v1.4 から setBase(state) が呼ばれる）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';

const MicIndicator = (() => {
  const LABELS = {
    speaking: '🔇 お話し中…待っててね',
    listening: '話してOKだよ',
    voice: '👂 聞いてるよ',
    transcribing: '✍️ 文字にしてるよ…',
    asleep: '🔄 マイクを起こしてるよ…',
    recovering: '🔄 マイク準備中…',
  };
  let base = 'idle';     // voice-ui 側の大きな状態（listening/speaking/recovering/idle…）
  let sub = 'listening'; // 録音中の細かい状態（listening/voice/transcribing/asleep）
  let lvl = 0, raf = 0, els = null;

  /** 今見せる状態（純粋関数・テスト用に公開） */
  function resolve(b, s) {
    if (b === 'speaking') return 'speaking';
    if (b === 'recovering') return 'recovering';
    if (b !== 'listening') return 'idle';
    return LABELS[s] ? s : 'listening';
  }

  function ensure() {
    if (els && els.wrap.isConnected) return els;
    if (typeof document === 'undefined') return null;
    const wrap = document.getElementById('cocomi-mic-wrap');
    if (!wrap) return null;
    injectCss();
    const meter = document.createElement('div'); meter.className = 'cocomi-mic-meter'; meter.setAttribute('aria-hidden', 'true');
    const label = document.createElement('div'); label.className = 'cocomi-mic-label';
    label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite');
    wrap.insertBefore(meter, wrap.firstChild); wrap.appendChild(label);
    els = { wrap, meter, label };
    return els;
  }

  function render() {
    raf = 0;
    const e = ensure(); if (!e) return;
    const st = resolve(base, sub);
    if (e.wrap.dataset.mic !== st) {
      e.wrap.dataset.mic = st;
      const t = LABELS[st] || '';
      e.label.textContent = t; e.label.style.display = t ? 'block' : 'none';
      const btn = document.getElementById('cocomi-mic-btn');
      if (btn) btn.setAttribute('aria-label', t ? '音声入力: ' + t.replace(/^[^\p{L}\p{N}]+/u, '') : '音声入力');
    }
    const v = st === 'voice' ? Math.max(0.25, lvl) : 0;
    e.meter.style.transform = `translate(-50%,-50%) scale(${(1 + v * 0.6).toFixed(3)})`;
    e.meter.style.opacity = st === 'voice' ? String(0.55 + v * 0.45) : '0';
  }
  function schedule() {
    if (raf) return;
    raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(render) : (render(), 0);
  }

  /** whisper-provider から（100ms毎＋状態変化時） */
  function update(state, level) { sub = state || 'listening'; lvl = Number(level) || 0; schedule(); }
  /** voice-ui.updateMicState から */
  function setBase(state) { base = state || 'idle'; if (state !== 'listening') { sub = 'listening'; lvl = 0; } schedule(); }

  function injectCss() {
    if (document.getElementById('cocomi-mic-indicator-css')) return;
    const st = document.createElement('style'); st.id = 'cocomi-mic-indicator-css';
    st.textContent = `
      .cocomi-mic-meter { position:absolute; top:50%; left:50%; width:100%; height:100%; border-radius:50%;
        border:4px solid #FF8A3D; box-shadow:0 0 14px rgba(255,138,61,.7); pointer-events:none; z-index:2;
        opacity:0; transform:translate(-50%,-50%) scale(1); transition:transform .1s linear, opacity .15s; }
      .cocomi-mic-label { position:absolute; bottom:calc(100% + 6px); right:0; display:none; white-space:nowrap;
        font-size:12px; line-height:1.2; padding:3px 8px; border-radius:10px; pointer-events:none; z-index:4;
        background:rgba(61,101,145,.92); color:#fff; box-shadow:0 1px 4px rgba(0,0,0,.2); }
      #cocomi-mic-wrap[data-mic="voice"] .cocomi-mic-label { background:#E8702A; font-weight:700; }
      #cocomi-mic-wrap[data-mic="voice"] #cocomi-mic-btn { background:linear-gradient(135deg,#FF9A52,#E8702A) !important; animation:none !important; }
      #cocomi-mic-wrap[data-mic="voice"] .cocomi-mic-ring { display:none !important; }
      #cocomi-mic-wrap[data-mic="transcribing"] #cocomi-mic-btn { animation:cocomi-mic-think 1s ease-in-out infinite !important; }
      #cocomi-mic-wrap[data-mic="transcribing"] .cocomi-mic-ring { display:none !important; }
      #cocomi-mic-wrap[data-mic="asleep"] #cocomi-mic-btn { background:#fdcb6e !important; animation:none !important; }
      #cocomi-mic-wrap[data-mic="speaking"] #cocomi-mic-btn { opacity:.75; }
      @keyframes cocomi-mic-think { 0%,100% { opacity:1; } 50% { opacity:.55; } }
      @media (prefers-reduced-motion: reduce) { .cocomi-mic-meter { transition:none; } #cocomi-mic-wrap #cocomi-mic-btn { animation:none !important; } }
    `;
    document.head.appendChild(st);
  }

  return { LABELS, resolve, update, setBase };
})();

if (typeof window !== 'undefined') window.MicIndicator = MicIndicator;
