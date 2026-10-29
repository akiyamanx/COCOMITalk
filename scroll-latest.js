// COCOMITalk - 「最新の会話へ」ボタン（上にスクロールしたら右下に丸い↓ボタン）
// このファイルは、チャット欄（1対1/グループ=#chat-area、会議=.meeting-chat）を上に戻した時に
// 入力欄のすぐ上・右下に丸い↓ボタンを出し、タップで一番下へ戻す。見ていない間に新着が来たら小さな点を付ける
// v1.0 2026-10-30 - 新規作成（44px・--app-primary・aria-label「最新の会話へ」・動きを減らす設定ではスムーズスクロールしない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';

const ScrollLatest = (() => {
  /** 一番下からこの距離以内なら「最新を見ている」とみなして隠す */
  const NEAR_PX = 120;
  const TARGETS = [
    { area: '#chat-area', footer: '.input-area' },
    { area: '.meeting-chat', footer: '.meeting-input-area' },
  ];

  function isNearBottom(el, near = NEAR_PX) {
    return (el.scrollHeight - el.scrollTop - el.clientHeight) <= near;
  }

  function _reduced() {
    return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function _injectStyle(doc) {
    if (doc.getElementById('scroll-latest-style')) return;
    const st = doc.createElement('style');
    st.id = 'scroll-latest-style';
    st.textContent = `
.scroll-latest-btn{position:fixed;right:16px;width:44px;height:44px;border-radius:50%;border:none;z-index:900;
  background:var(--app-primary,#4A76A8);color:#fff;font-size:22px;line-height:44px;padding:0;cursor:pointer;
  box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:opacity .2s,transform .2s}
.scroll-latest-btn[hidden]{display:none}
.scroll-latest-btn:focus-visible{outline:3px solid var(--app-dark,#3D6591);outline-offset:2px}
.scroll-latest-btn .sl-dot{position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;background:#E5484D;border:2px solid #fff;display:none}
.scroll-latest-btn.has-new .sl-dot{display:block}
@media (prefers-reduced-motion: reduce){.scroll-latest-btn{transition:none}}`;
    doc.head.appendChild(st);
  }

  /** 1つのチャット欄にボタンを付ける（テストからも呼べる） */
  function attach(area, footer, doc = document) {
    if (!area || area.dataset.scrollLatest) return null;
    area.dataset.scrollLatest = '1';
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'scroll-latest-btn';
    btn.setAttribute('aria-label', '最新の会話へ');
    btn.title = '最新の会話へ';
    btn.innerHTML = '<span aria-hidden="true">↓</span><span class="sl-dot" aria-hidden="true"></span>';
    btn.hidden = true;
    btn.dataset.for = area.id || area.className || '';
    doc.body.appendChild(btn);

    const place = () => {
      // 入力欄（＋/マイク含む）の上端より12px上に置く＝重ならない
      const fh = footer && footer.getBoundingClientRect ? footer.getBoundingClientRect() : null;
      const vh = (doc.defaultView && doc.defaultView.innerHeight) || 0;
      const bottom = fh && fh.height ? Math.max(12, vh - fh.top + 12) : 88;
      btn.style.bottom = `${bottom}px`;
    };
    const update = () => {
      const shown = area.offsetParent !== null || area.getClientRects().length > 0;
      const hide = !shown || isNearBottom(area);
      if (hide) btn.classList.remove('has-new');
      if (btn.hidden !== hide) btn.hidden = hide;
      if (!hide) place();
    };
    area.addEventListener('scroll', update, { passive: true });
    if (doc.defaultView) doc.defaultView.addEventListener('resize', update);
    btn.addEventListener('click', () => {
      area.scrollTo({ top: area.scrollHeight, behavior: _reduced() ? 'auto' : 'smooth' });
      btn.hidden = true;
      btn.classList.remove('has-new');
    });
    // 新着: 上を見ている間に吹き出しが増えたら点を付ける
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (!isNearBottom(area)) btn.classList.add('has-new');
        update();
      }).observe(area, { childList: true });
    }
    update();
    return { btn, update };
  }

  function init(doc = document) {
    _injectStyle(doc);
    for (const t of TARGETS) attach(doc.querySelector(t.area), doc.querySelector(t.footer), doc);
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init());
    else init();
  }

  return { init, attach, isNearBottom, NEAR_PX };
})();
