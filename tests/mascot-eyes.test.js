// tests/mascot-eyes.test.js v1.0
// このファイルは COCOMITalk の「目が動く小さな顔」(mascot-eyes.js / .css) のテスト。乱数とタイマーを差し替えて決まった動きを確かめる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { MascotEyes: M } = load(['mascot-eyes.js'], ['MascotEyes']);

// ---- 偽のタイマー（時計を手で進める） ----
function makeClock() {
  let now = 0, seq = 0; const q = new Map();
  return {
    st: (fn, ms) => { const id = ++seq; q.set(id, { at: now + ms, fn, ms }); return id; },
    ct: (id) => { q.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [id, t] of q) if (t.at <= end && (!best || t.at < best.t.at)) best = { id, t };
        if (!best) break;
        q.delete(best.id); now = best.t.at; best.t.fn();
      }
      now = end;
    },
    now: () => now, active: () => q.size,
    delays: () => [...q.values()].map((t) => t.ms),
  };
}
// ---- 偽の要素・document・matchMedia ----
function makeRoot() {
  const props = {}, cls = new Set(), log = [];
  const clock = { t: () => 0 };
  const root = {
    style: { setProperty: (k, v) => { props[k] = v; log.push([k, v]); } },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    parentNode: null,
  };
  return { root, props, cls, log, clock };
}
function makeDoc() {
  const ls = {};
  return { hidden: false, addEventListener: (t, f) => { (ls[t] = ls[t] || new Set()).add(f); }, removeEventListener: (t, f) => { ls[t] && ls[t].delete(f); },
    fire(t) { [...(ls[t] || [])].forEach((f) => f()); }, count: () => Object.values(ls).reduce((n, s) => n + s.size, 0) };
}
function makeWin(reduced) {
  const ls = new Set(); const mq = { matches: !!reduced, addEventListener: (_, f) => ls.add(f), removeEventListener: (_, f) => ls.delete(f) };
  return { matchMedia: () => mq, set(v) { mq.matches = v; [...ls].forEach((f) => f()); }, count: () => ls.size };
}
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const setup = (rng, reduced) => {
  const c = makeClock(), r = makeRoot(), d = makeDoc(), w = makeWin(reduced);
  const ctl = M.create(r.root, { rng, doc: d, win: w, setTimeoutFn: c.st, clearTimeoutFn: c.ct });
  return { c, r, d, w, ctl };
};

test('間隔: 視線は0.8〜3.5秒、まばたきは2〜6秒の範囲（乱数の両端）', () => {
  assert.equal(M.nextSaccadeDelay(() => 0), 800);
  assert.ok(M.nextSaccadeDelay(() => 0.999999) <= 3500);
  assert.equal(M.nextBlinkDelay(() => 0), 2000);
  assert.ok(M.nextBlinkDelay(() => 0.999999) <= 6000);
  const rng = lcg(7);
  for (let i = 0; i < 500; i++) {
    const s = M.nextSaccadeDelay(rng), b = M.nextBlinkDelay(rng);
    assert.ok(s >= 800 && s <= 3500 && b >= 2000 && b <= 6000);
  }
});

test('視線: 黒目は範囲(±2, ±2.5px)内。ときどき真ん中に戻る。乱数を差し替えると決まった値になる', () => {
  const rng = lcg(42); let centers = 0, moves = 0;
  for (let i = 0; i < 2000; i++) {
    const g = M.pickGaze(rng);
    assert.ok(Math.abs(g.x) <= M.CFG.maxX && Math.abs(g.y) <= M.CFG.maxY, JSON.stringify(g));
    if (g.kind === 'center') { centers++; assert.deepEqual([g.x, g.y], [0, 0]); } else moves++;
  }
  assert.ok(centers > 250 && centers < 550, `真ん中に戻る割合 ${centers}/2000`);
  assert.ok(moves > 1400);
  const seq = [0.5, 1, 0]; let i = 0;                       // 真ん中にならず(0.5>=0.2)、x=+max, y=-max
  assert.deepEqual({ ...M.pickGaze(() => seq[i++ % 3]) }, { x: 2, y: -2.5, kind: 'move' });
  assert.equal(M.pickGaze(() => 0.1).kind, 'center');
});

test('動き(乱数0.5固定): 最初の視線は2.15秒、以後2.15秒ごと。黒目の値は範囲内で、続けて動くのは起きない', () => {
  const { c, r } = setup(() => 0.5);
  assert.equal(r.log.length, 2);                              // 初期化: 真ん中 (--me-x, --me-y)
  c.advance(2149); assert.equal(r.log.length, 2);
  c.advance(1); assert.equal(r.log.length, 4);                // 2150ms: 1回動いた
  c.advance(2150); assert.equal(r.log.length, 6);
});

test('続けて2回動く: 乱数が小さいと1回目の0.18〜0.42秒後にもう一度動く', () => {
  // 乱数0.21: 真ん中(0.2未満)にならず、double(0.25未満)になる
  const { c, r } = setup(() => 0.21);
  const first = Math.round(0.21 * 2700 + 800);               // 1367ms
  c.advance(first); const n1 = r.log.length;
  c.advance(M.doubleGap(() => 0.21) + 1);
  assert.equal(r.log.length, n1 + 2, '2回目の視線');
});

test('まばたき: 乱数0.5なら4秒で閉じて130ms後に開く。乱数が小さいと「え？」(目を丸く)で0.9秒後に戻る', () => {
  const a = setup(() => 0.5);
  a.c.advance(3999); assert.ok(!a.r.cls.has('me-blink'));
  a.c.advance(1); assert.ok(a.r.cls.has('me-blink'));
  a.c.advance(130); assert.ok(!a.r.cls.has('me-blink'));
  const b = setup(() => 0.05);                                // wideChance 0.12 未満
  b.c.advance(2200);
  assert.ok(b.r.cls.has('me-wide') && !b.r.cls.has('me-blink'));
  b.c.advance(M.CFG.wideMs); assert.ok(!b.r.cls.has('me-wide'));
});

test('長く動かしてもタイマーは少ない（常に4個以内）で、実際に視線が何種類も変わる', () => {
  const { c, r, ctl } = setup(lcg(2026)); let max = 0; const seen = new Set();
  for (let t = 0; t < 120000; t += 100) { c.advance(100); max = Math.max(max, ctl.pending()); seen.add(r.props['--me-x'] + ',' + r.props['--me-y']); }
  assert.ok(max <= 4, `最大 ${max}`);
  assert.ok(seen.size >= 10, `視線の種類 ${seen.size}`);
  for (const v of r.log) if (v[0] === '--me-x') assert.ok(Math.abs(+v[1]) <= 2);
});

test('裏に回る(document.hidden)と止まり、戻ると再開する', () => {
  const { c, r, d, ctl } = setup(() => 0.5);
  c.advance(3000); assert.ok(ctl.isRunning());
  d.hidden = true; d.fire('visibilitychange');
  assert.equal(ctl.pending(), 0); assert.equal(c.active(), 0); assert.ok(!ctl.isRunning());
  const n = r.log.length; c.advance(60000); assert.equal(r.log.length, n);
  d.hidden = false; d.fire('visibilitychange');
  assert.ok(ctl.isRunning()); c.advance(2200); assert.ok(r.log.length > n);
});

test('最初から裏のとき(hidden)は始まらない', () => {
  const c = makeClock(), r = makeRoot(), d = makeDoc(); d.hidden = true;
  const ctl = M.create(r.root, { rng: () => 0.5, doc: d, win: makeWin(false), setTimeoutFn: c.st, clearTimeoutFn: c.ct });
  assert.equal(c.active(), 0); assert.ok(!ctl.isRunning());
});

test('動きを減らす設定(prefers-reduced-motion)なら動かず真ん中で静止。設定が変われば追従', () => {
  const { c, r, w, ctl } = setup(() => 0.9, true);
  assert.equal(c.active(), 0); assert.ok(!ctl.isRunning());
  c.advance(60000);
  assert.deepEqual([r.props['--me-x'], r.props['--me-y']], ['0', '0']);
  assert.ok(!r.cls.has('me-blink') && !r.cls.has('me-wide'));
  w.set(false); assert.ok(ctl.isRunning()); c.advance(3300); assert.notEqual(r.props['--me-x'] + r.props['--me-y'], '00');
  w.set(true); assert.equal(c.active(), 0); assert.deepEqual([r.props['--me-x'], r.props['--me-y']], ['0', '0']);
});

test('destroy: タイマーも監視も全部片付き、以後は何も起きない。2回呼んでもよい', () => {
  const { c, r, d, w, ctl } = setup(lcg(5));
  c.advance(5000); assert.ok(c.active() > 0);
  assert.equal(d.count(), 1); assert.equal(w.count(), 1);
  ctl.destroy();
  assert.equal(c.active(), 0); assert.equal(ctl.pending(), 0);
  assert.equal(d.count(), 0); assert.equal(w.count(), 0);
  const n = r.log.length; c.advance(60000); d.fire('visibilitychange'); w.set(false);
  assert.equal(r.log.length, n); assert.equal(c.active(), 0);
  assert.doesNotThrow(() => ctl.destroy());
});

// ---- 部品づくり・取り付け（最小の偽DOM） ----
function fakeDom() {
  const mk = (tag) => ({ tag, className: '', attrs: {}, children: [], parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() { const p = this.parentNode; return p ? (p.children[p.children.indexOf(this) + 1] || null) : null; },
    querySelector(sel) { const k = sel.replace('.', ''); const f = (n) => { for (const c of n.children) { if (c.className.split(' ').includes(k)) return c; const r = f(c); if (r) return r; } return null; }; return f(this); },
    style: { setProperty() {} }, classList: { add() {}, remove() {} } });
  return { createElement: mk, hidden: false, addEventListener() {}, removeEventListener() {}, mk };
}
test('build: aria-hidden、目が2つ、黒目が2つ。外部画像のURLなし', () => {
  const doc = fakeDom(); const root = M.build(doc);
  assert.equal(root.attrs['aria-hidden'], 'true'); assert.ok(root.className.includes('mascot-eyes'));
  const all = []; (function w(n) { all.push(n); n.children.forEach(w); })(root);
  assert.equal(all.filter((n) => n.className === 'me-eye').length, 2);
  assert.equal(all.filter((n) => n.className === 'me-pupil').length, 2);
});
test('mount: ☰の直後に1つだけ付く／取り付け先が無ければ何もしない／二重に付けない', () => {
  const doc = fakeDom(); const bar = doc.mk('div'); const menu = doc.mk('button'); const ch = doc.mk('button'); bar.appendChild(menu); bar.appendChild(ch);
  const m = M.mount(bar, { after: menu, doc, rng: () => 0.5, win: makeWin(true) });
  assert.ok(m && bar.children[1] === m.el && bar.children[0] === menu && bar.children[2] === ch);
  assert.equal(M.mount(bar, { after: menu, doc }), null);
  assert.equal(M.mount(null, { doc }), null);
  m.destroy(); assert.equal(bar.children.length, 2);
});

// ---- 見た目・配線 ----
test('CSS: タップ素通し・帯(52px)に収まる30px・黒目はtransition・reduced-motionで静止・画像/通信なし', () => {
  const css = read('mascot-eyes.css'), js = read('mascot-eyes.js');
  assert.ok(/\.mascot-eyes \{[^}]*pointer-events:\s*none/.test(css));
  assert.ok(/width:\s*30px;\s*height:\s*30px/.test(css));
  assert.ok(/\.me-pupil \{[^}]*transition:\s*transform/.test(css));
  assert.ok(/prefers-reduced-motion: reduce\) \{[\s\S]*transition: none/.test(css));
  assert.ok(!/url\(|https?:|@import/.test(css + js), '外部リソースなし');
  assert.ok(!/fetch\(|XMLHttpRequest|new Audio|AudioContext|setInterval/.test(js), '通信・音・setIntervalなし');
});
test('配線: index.html(css/js。layout2-coreより前)・sw.js(CACHE_FILES・v3.78)・layout2-uiのtry/catch取り付け', () => {
  const html = read('index.html'), sw = read('sw.js'), ui = read('layout2-ui.js');
  assert.ok(html.includes('href="mascot-eyes.css"'));
  assert.ok(html.indexOf('src="mascot-eyes.js"') > 0 && html.indexOf('src="mascot-eyes.js"') < html.indexOf('src="layout2-ui.js"'));
  const files = sw.slice(sw.indexOf('const CACHE_FILES'), sw.indexOf('const CACHE_FONTS'));
  assert.ok(files.includes("'./mascot-eyes.js'") && files.includes("'./mascot-eyes.css'"));
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v3.78';"));
  assert.ok(/try \{ if \(typeof MascotEyes !== 'undefined'\) MascotEyes\.mount\(h, \{ after: menu \}\); \} catch/.test(ui));
});
test('CI: 各ファイル500行以内・ヘッダー(作成/最終更新・バージョン・「このファイルは」)', () => {
  for (const f of ['mascot-eyes.js', 'mascot-eyes.css', 'tests/mascot-eyes.test.js', 'layout2-ui.js']) {
    const t = read(f); assert.ok(t.split('\n').length <= 500, f);
    const head = t.split('\n').slice(0, 12).join('\n');
    assert.ok(head.includes('作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29'), f);
    assert.ok(/v\d+\.\d+/.test(head), f);
  }
  for (const f of ['mascot-eyes.js', 'mascot-eyes.css', 'tests/mascot-eyes.test.js']) assert.ok(/このファイルは|COCOMITalk/.test(read(f).split('\n').slice(0, 5).join('\n')), f);
});
