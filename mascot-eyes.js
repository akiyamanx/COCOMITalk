// mascot-eyes.js v1.0
// このファイルは COCOMITalk の上の帯に置く「目がきょろきょろ動く小さなまるい顔」を作って動かす（見た目は mascot-eyes.css）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// v1.0 2026-10-29 - 新規作成（依頼B）。外部画像・通信・音なし。黒目の動きはCSS transition、タイマーは最小限
//   ・黒目: 0.8〜3.5秒ごとにランダムに視線移動（ときどき真ん中に戻る／続けて2回動く）
//   ・まばたき: 2〜6秒ごと。ときどき目を丸くする「え？」
//   ・画面が裏（document.hidden）の間は止まる。prefers-reduced-motion なら真ん中で静止
//   ・乱数(rng)とタイマー(setTimeoutFn/clearTimeoutFn)は差し替え可能（テスト用）。destroy() で全部片付く
'use strict';

const MascotEyes = (() => {
  const CFG = {
    saccadeMin: 800, saccadeMax: 3500,   // 視線を動かす間隔(ms)
    blinkMin: 2000, blinkMax: 6000,      // まばたきの間隔(ms)
    maxX: 2, maxY: 2.5,                  // 黒目が動ける範囲(px。目の中からはみ出さない)
    centerChance: 0.2,                   // 真ん中に戻る確率
    doubleChance: 0.25,                  // 続けてもう一度動く確率
    doubleGapMin: 180, doubleGapMax: 420,
    wideChance: 0.12,                    // まばたきの代わりに目を丸くする確率
    blinkMs: 130, wideMs: 900,
  };
  const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

  const _span = (a, b, rng) => a + rng() * (b - a);
  const _r1 = (n) => Math.round(n * 10) / 10;
  const nextSaccadeDelay = (rng) => Math.round(_span(CFG.saccadeMin, CFG.saccadeMax, rng));
  const nextBlinkDelay = (rng) => Math.round(_span(CFG.blinkMin, CFG.blinkMax, rng));
  const doubleGap = (rng) => Math.round(_span(CFG.doubleGapMin, CFG.doubleGapMax, rng));
  const shouldDouble = (rng) => rng() < CFG.doubleChance;
  const shouldWide = (rng) => rng() < CFG.wideChance;
  // 次の視線。centerChance で真ん中、それ以外は範囲内のランダムな点
  function pickGaze(rng) {
    if (rng() < CFG.centerChance) return { x: 0, y: 0, kind: 'center' };
    return { x: _r1((rng() * 2 - 1) * CFG.maxX), y: _r1((rng() * 2 - 1) * CFG.maxY), kind: 'move' };
  }

  // 目の部品を作る（外部画像なし。CSSだけで描く）
  function build(doc) {
    const mk = (cls) => { const e = doc.createElement('span'); e.className = cls; return e; };
    const root = mk('mascot-eyes');
    root.setAttribute('aria-hidden', 'true');
    const face = mk('me-face');
    for (let i = 0; i < 2; i++) { const eye = mk('me-eye'); eye.appendChild(mk('me-pupil')); face.appendChild(eye); }
    face.appendChild(mk('me-smile'));
    root.appendChild(face);
    return root;
  }

  // root: .mascot-eyes 要素（style.setProperty と classList があればよい）
  function create(root, opts) {
    const o = opts || {};
    const rng = o.rng || Math.random;
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    const win = o.win || (typeof window !== 'undefined' ? window : null);
    const st = o.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const ct = o.clearTimeoutFn || ((id) => clearTimeout(id));
    const timers = new Set();
    let running = false, destroyed = false, mq = null;

    const later = (fn, ms) => {
      const id = st(() => { timers.delete(id); if (!destroyed && running) fn(); }, ms);
      timers.add(id); return id;
    };
    const clearAll = () => { timers.forEach((id) => ct(id)); timers.clear(); };
    const look = (g) => { root.style.setProperty('--me-x', String(g.x)); root.style.setProperty('--me-y', String(g.y)); };
    const flag = (name, on) => { if (on) root.classList.add(name); else root.classList.remove(name); };
    const reduced = () => !!(mq && mq.matches);
    const hidden = () => !!(doc && doc.hidden);

    function saccade() {
      look(pickGaze(rng));
      if (shouldDouble(rng)) later(() => { look(pickGaze(rng)); }, doubleGap(rng));
      later(saccade, nextSaccadeDelay(rng));
    }
    function blink() {
      if (shouldWide(rng)) { flag('me-wide', true); later(() => flag('me-wide', false), CFG.wideMs); }
      else { flag('me-blink', true); later(() => flag('me-blink', false), CFG.blinkMs); }
      later(blink, nextBlinkDelay(rng));
    }
    function settle() { flag('me-blink', false); flag('me-wide', false); }

    function stop() { running = false; clearAll(); settle(); }
    function start() {
      if (destroyed || running || reduced() || hidden()) return;
      running = true;
      later(saccade, nextSaccadeDelay(rng));
      later(blink, nextBlinkDelay(rng));
    }
    // 見えている・動かしてよい時だけ動かす（裏に回る／reduced-motion なら止めて真ん中）
    function sync() {
      if (destroyed) return;
      if (reduced()) { stop(); look({ x: 0, y: 0 }); return; }
      if (hidden()) { stop(); return; }
      start();
    }

    if (win && typeof win.matchMedia === 'function') { try { mq = win.matchMedia(REDUCED_QUERY); } catch (e) { mq = null; } }
    const onVis = () => sync();
    const onMq = () => sync();
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
    look({ x: 0, y: 0 });
    sync();

    function destroy() {
      if (destroyed) return;
      stop(); destroyed = true;
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVis);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onMq); else if (mq.removeListener) mq.removeListener(onMq); }
      if (root && root.parentNode) root.parentNode.removeChild(root);
    }
    return { el: root, start, stop, sync, destroy, pending: () => timers.size, isRunning: () => running };
  }

  // 帯に取り付ける。anchor(例: ☰ボタン)があればその直後、なければ parent の先頭。取り付け先が無ければ何もしない
  function mount(parent, opts) {
    const o = opts || {};
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    if (!parent || !doc) return null;
    if (parent.querySelector && parent.querySelector('.mascot-eyes')) return null;   // 二重に付けない
    const root = build(doc);
    if (o.after && o.after.parentNode === parent && o.after.nextSibling !== undefined) parent.insertBefore(root, o.after.nextSibling);
    else parent.insertBefore(root, parent.firstChild);
    return create(root, o);
  }

  return { CFG, nextSaccadeDelay, nextBlinkDelay, doubleGap, pickGaze, shouldDouble, shouldWide, build, create, mount };
})();
if (typeof window !== 'undefined') window.MascotEyes = MascotEyes;
