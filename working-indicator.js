// working-indicator.js v1.0
// このファイルは COCOMITalk の「いま作業中だよ」表示（左上の小さな顔が動く＋左端の小さな札とラベル）をまとめて出し入れする
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
// v1.0 2026-11-01 - 新規作成（v4.9）。start(kind,label)→token / stop(token) の参照カウント式。重なった作業も最後の1つが終わるまで出し続ける
//   ・kind: think(考え中=ぷるぷる) / speak(おしゃべり中=びよ〜んジャンプ) / write(書記・書類・議事録・共有=キーボードをカタカタ)
//   ・止め忘れ対策: 1件ごとに既定120秒で自動停止。見た目は CSS だけ（working-indicator.css）。動きを減らす設定ではそっと点滅だけ
//   ・ラベルは role=status / aria-live=polite で読み上げ。タイマー・document は差し替え可能（テスト用）
'use strict';

const WorkingIndicator = (() => {
  const KINDS = { think: 'wobble', speak: 'bounce', write: 'typing' };
  const TIMEOUT_MS = 120000;
  let doc = (typeof document !== 'undefined') ? document : null;
  let st = (fn, ms) => setTimeout(fn, ms);
  let ct = (id) => clearTimeout(id);
  let timeoutMs = TIMEOUT_MS;
  const jobs = new Map(); // token -> { kind, label, timer }
  let seq = 0, el = null, labelEl = null;
  const listeners = [];

  function configure(o = {}) {
    if (o.doc !== undefined) { doc = o.doc; el = null; labelEl = null; }
    if (o.setTimeoutFn) st = o.setTimeoutFn;
    if (o.clearTimeoutFn) ct = o.clearTimeoutFn;
    if (o.timeoutMs) timeoutMs = o.timeoutMs;
  }

  function anim(kind) { return KINDS[kind] || 'wobble'; }

  function ensureEl() {
    if (el || !doc || !doc.body || !doc.createElement) return el;
    if (doc.head && !doc.querySelector('link[data-wi]')) {
      const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = 'working-indicator.css';
      l.setAttribute('data-wi', '1'); doc.head.appendChild(l);
    }
    el = doc.createElement('div'); el.id = 'working-indicator'; el.className = 'wi-box';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="wi-face" aria-hidden="true"><span class="wi-eye"></span><span class="wi-eye"></span></span>'
      + '<span class="wi-kb" aria-hidden="true"></span><span class="wi-label"></span>';
    labelEl = el.querySelector('.wi-label');
    doc.body.appendChild(el);
    return el;
  }

  function current() { let last = null; for (const j of jobs.values()) last = j; return last; }

  function render() {
    const j = current();
    const body = doc && doc.body;
    if (body && body.classList) {
      for (const a of ['wobble', 'bounce', 'typing']) body.classList.remove('wi-' + a);
      body.classList.toggle('wi-on', !!j);
      if (j) body.classList.add('wi-' + anim(j.kind));
    }
    const e = ensureEl();
    if (e) {
      e.classList.toggle('wi-show', !!j);
      if (labelEl) labelEl.textContent = j ? j.label + (jobs.size > 1 ? `（ほか${jobs.size - 1}件）` : '') : '';
    }
    for (const fn of listeners) { try { fn(state()); } catch (_) { /* 表示の失敗で本処理を止めない */ } }
  }

  function start(kind, label) {
    const token = ++seq;
    const k = KINDS[kind] ? kind : 'think';
    const job = { kind: k, label: String(label || '作業中…'), timer: null };
    job.timer = st(() => { if (jobs.has(token)) { jobs.delete(token); render(); } }, timeoutMs);
    jobs.set(token, job);
    render();
    return token;
  }

  function stop(token) {
    const j = jobs.get(token);
    if (!j) return false;
    ct(j.timer); jobs.delete(token); render();
    return true;
  }

  function stopAll() { for (const j of jobs.values()) ct(j.timer); jobs.clear(); render(); }

  /** 非同期の仕事を包む: 始まりで start、終わり（成功/失敗どちらも）で stop。結果はそのまま返す */
  function wrap(kind, label, fn) {
    return function (...args) {
      let t = null;
      try { t = start(kind, typeof label === 'function' ? label.apply(this, args) : label); } catch (_) { /* 表示だけ */ }
      let r;
      try { r = fn.apply(this, args); } catch (e) { stop(t); throw e; }
      if (r && typeof r.then === 'function') return r.then((v) => { stop(t); return v; }, (e) => { stop(t); throw e; });
      stop(t); return r;
    };
  }

  function state() { const j = current(); return { active: jobs.size, kind: j ? j.kind : null, anim: j ? anim(j.kind) : null, label: j ? j.label : '' }; }
  function onChange(fn) { listeners.push(fn); }

  return { KINDS, TIMEOUT_MS, configure, start, stop, stopAll, wrap, state, onChange, isActive: () => jobs.size > 0 };
})();
