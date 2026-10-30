// tests/mascot-eyes.test.js v1.2
// このファイルは COCOMITalk の「目が動く小さな顔」(mascot-eyes.js / .css) のテスト。乱数とタイマーを差し替えて決まった動きを確かめる（v1.2: 口なし・全画面のfixed表示・オープニング中は隠す・重なりを避ける・あたたかい顔色・ピョン）
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

// ---- 部品づくり・取り付け（最小の偽DOM。class/属性/body/getElementById/elementsFromPointを持つ） ----
function fakeDom() {
  const ids = {};
  const mk = (tag) => {
    const cls = new Set();
    const n = { tag, attrs: {}, children: [], parentNode: null, style: { setProperty() {} }, top: 11,
      get className() { return [...cls].join(' '); }, set className(v) { cls.clear(); String(v).split(' ').filter(Boolean).forEach((c) => cls.add(c)); },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
      addEventListener(ty, f) { (this.ls = this.ls || {})[ty] = f; }, removeEventListener(ty) { if (this.ls) delete this.ls[ty]; },
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') ids[v] = this; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; if (c.attrs.id) delete ids[c.attrs.id]; },
      contains(c) { for (let p = c; p; p = p.parentNode) if (p === this) return true; return false; },
      getBoundingClientRect() { return { top: this.top, left: 0, width: 30, height: 30 }; },
      querySelector(sel) { const k = sel.split('.').filter(Boolean); const f = (x) => { for (const c of x.children) { if (k.every((q) => c.classList.contains(q))) return c; const r = f(c); if (r) return r; } return null; }; return f(this); } };
    return n;
  };
  const body = mk('body');
  const doc = { createElement: mk, body, hidden: false, mk, ids, addEventListener() {}, removeEventListener() {},
    getElementById: (id) => ids[id] || null, querySelector: (sel) => body.querySelector(sel) };
  doc.add = (id, cls) => { const e = mk('div'); e.className = cls || ''; e.setAttribute('id', id); body.appendChild(e); return e; };
  return doc;
}
const ALL = (root) => { const a = []; (function w(n) { a.push(n); n.children.forEach(w); })(root); return a; };
test('build: aria-hidden、目が2つ、黒目が2つ。口(me-smile)も外部画像のURLもない（目だけ）', () => {
  const doc = fakeDom(); const root = M.build(doc);
  assert.equal(root.attrs['aria-hidden'], 'true'); assert.ok(root.className.includes('mascot-eyes'));
  const all = ALL(root);
  assert.equal(all.filter((n) => n.className === 'me-eye').length, 2);
  assert.equal(all.filter((n) => n.className === 'me-pupil').length, 2);
  assert.equal(all.length, 1 + 1 + 2 + 2, '顔の外側・顔・目2・黒目2だけ');
  assert.ok(!all.some((n) => /smile|mouth/.test(n.className)));
});
test('mountFixed: body直下に1つだけfixedで付く／二重に付けない／body無しなら何もしない／destroyで外れる', () => {
  const doc = fakeDom(); doc.add('splash-screen', 'splash hidden');
  const m = M.mountFixed(doc, { rng: () => 0.5, win: makeWin(true) });
  assert.ok(m && m.el.parentNode === doc.body && m.el.classList.contains('me-fixed') && m.el.classList.contains('mascot-eyes'));
  assert.equal(M.mountFixed(doc, { rng: () => 0.5 }), null);
  assert.equal(M.mountFixed({ createElement: doc.createElement }, {}), null);
  assert.equal(M.mountFixed(null, {}), null);
  m.destroy(); assert.ok(!doc.body.children.includes(m.el));
});

// ---- 全画面での位置（重なりを避ける）・オープニング中は隠す ----
test('pickSpot: 基本位置(☰の右隣)が空いていればそこ。埋まっていれば空いた所のうち基本位置に近い所。横に空きが無ければ下へずらす。全部埋まりなら一番空いた所', () => {
  const W = 390, home = M.DOCK.homeX, P = (c, cur, w) => ({ ...M.pickSpot(w || W, c, cur) });
  assert.deepEqual(P(() => 0), { x: home, dy: 0 });
  assert.deepEqual(P((x) => (x < 100 ? 3 : 0)), { x: 100, dy: 0 });                // 左側が埋まり→100以降で最も近い所
  assert.deepEqual(P((x) => (x < 100 ? 3 : 0), { x: 150, dy: 0 }), { x: 150, dy: 0 }, '今の位置が空いていればそのまま');
  assert.deepEqual(P((x, dy) => (dy === 0 ? 3 : 0)), { x: 56, dy: 7 }, '1行目が全部埋まり→一段下へ');
  assert.deepEqual(P((x, dy) => (x === home && dy === 0 ? 5 : 2)), { x: 56, dy: 0 }, '同じ埋まり具合なら基本位置に近い所');
  assert.deepEqual(P((x, dy) => (x === 200 && dy === 0 ? 1 : 4)), { x: 200, dy: 0 }, '全部埋まり: 一番少ない所');
  assert.deepEqual(P(() => 0, null, 320), { x: home, dy: 0 });
  assert.ok(P(() => 0, null, 60).x <= 60 - M.DOCK.size, '狭い画面でも画面の外へ出ない');
});
test('isBusyEl: ボタン・文字・画像は中身あり／何も無い背景は空き', () => {
  const doc = fakeDom();
  const bare = doc.createElement('div'); bare.nodeType = 1; bare.childNodes = [];
  const txt = doc.createElement('span'); txt.nodeType = 1; txt.childNodes = [{ nodeType: 3, nodeValue: ' 設定 ' }];
  const ws = doc.createElement('div'); ws.nodeType = 1; ws.childNodes = [{ nodeType: 3, nodeValue: '\n  ' }];
  const inBtn = doc.createElement('span'); inBtn.nodeType = 1; inBtn.childNodes = []; inBtn.closest = (s) => (/button/.test(s) ? {} : null);
  assert.ok(!M.isBusyEl(bare) && !M.isBusyEl(ws) && !M.isBusyEl(null));
  assert.ok(M.isBusyEl(txt) && M.isBusyEl(inBtn));
});
test('isBusyEl: 文字だけの要素(見出し・段落)は箱が広くても、文字の範囲に当たったときだけ中身あり', () => {
  const mk = (rects) => ({
    nodeType: 1, childNodes: [{ nodeType: 3, nodeValue: '記憶管理' }],
    ownerDocument: { createRange: () => ({ selectNodeContents() {}, getClientRects: () => rects }) },
  });
  const h = mk([{ left: 10, right: 80, top: 5, bottom: 25 }]);
  assert.ok(M.isBusyEl(h, 40, 15), '文字の上');
  assert.ok(M.isBusyEl(h, 82, 15), '文字の2px外まで');
  assert.ok(!M.isBusyEl(h, 150, 15), '同じ見出しの右の空き');
  assert.ok(!M.isBusyEl(h, 40, 60), '文字の下の空き');
  assert.ok(M.isBusyEl(h), '点を省くと箱全体で判定');
  const z = mk([{ left: 54, right: 54, top: 28, bottom: 28 }]);
  assert.ok(M.isBusyEl(z, 70, 15), '文字の幅が0(::afterで見せる飾り文字)なら箱全体で判定');
  const btn = { nodeType: 1, childNodes: [], closest: (q) => (/button/.test(q) ? {} : null) };
  assert.ok(M.isBusyEl(btn, 999, 999), 'ボタンは常に箱全体');
});
test('オープニング(#opening-overlay)中・ロゴ画面(#splash-screen)中は隠し、終わったら出す。隠れている間は目も動かない', () => {
  const doc = fakeDom(); const op = doc.add('opening-overlay', ''); const sp = doc.add('splash-screen', 'splash');
  const c = makeClock();
  const m = M.mountFixed(doc, { rng: () => 0.5, win: { ...makeWin(false), innerWidth: 390 }, setTimeoutFn: c.st, clearTimeoutFn: c.ct });
  assert.ok(m.el.classList.contains('me-off') && m.dock.isOff() && !m.isRunning());
  doc.body.removeChild(op); m.dock.update();
  assert.ok(m.el.classList.contains('me-off'), 'ロゴ画面が出ている間はまだ隠す');
  sp.classList.add('hidden'); m.dock.update();
  assert.ok(!m.el.classList.contains('me-off') && !m.dock.isOff() && m.isRunning());
  m.destroy();
});
test('位置の見直し: 画面が変わったら(予約→160ms後)重なる所を避けて動く。閉じたら基本位置へ戻る。タイマーは1つにまとまる', () => {
  const doc = fakeDom(); doc.add('splash-screen', 'splash hidden');
  const c = makeClock(); let busyBelow = 0;                                          // busyBelow より左は埋まっている（ドロワーが開いた想定）
  const m = M.mountFixed(doc, { rng: () => 0.5, win: { ...makeWin(false), innerWidth: 390 }, setTimeoutFn: c.st, clearTimeoutFn: c.ct, countAt: (x) => (x < busyBelow ? 3 : 0) });
  assert.equal(m.dock.left(), M.DOCK.homeX);
  busyBelow = 120; m.dock.schedule(); m.dock.schedule(); m.dock.schedule();
  assert.equal(c.delays().filter((d) => d === M.DOCK.checkMs).length, 1, '連続変化はまとめる');
  c.advance(M.DOCK.checkMs); assert.equal(m.dock.left(), 120); assert.equal(m.dock.down(), 0); assert.equal(m.el.style.left, '120px');
  busyBelow = 0; m.dock.schedule(); c.advance(M.DOCK.checkMs); assert.equal(m.dock.left(), M.DOCK.homeX);
  m.destroy(); c.advance(1000); assert.equal(c.active(), 0);
});

// ---- ピョン（避けて動くとき）----
const hopSetup = (reduced) => {
  const doc = fakeDom(); doc.add('splash-screen', 'splash hidden');
  const c = makeClock(); let busyBelow = 0;
  const m = M.mountFixed(doc, { rng: () => 0.5, win: { ...makeWin(reduced), innerWidth: 390 }, setTimeoutFn: c.st, clearTimeoutFn: c.ct, countAt: (x) => (x < busyBelow ? 3 : 0) });
  return { m, c, set: (v) => { busyBelow = v; m.dock.schedule(); c.advance(M.DOCK.checkMs); } };
};
test('ピョン: 最初の配置では付かず、避けて動くとき me-hop が付く。終わり(animationend)で外れ、続けて動けばまた付く', () => {
  const { m, set } = hopSetup(false);
  assert.ok(!m.el.classList.contains('me-hop'), '最初の配置ではピョンしない');
  set(120); assert.equal(m.dock.left(), 120); assert.ok(m.el.classList.contains('me-hop'));
  m.el.ls.animationend({ animationName: 'other' }); assert.ok(m.el.classList.contains('me-hop'), '別のアニメ終了では外さない');
  m.el.ls.animationend({ animationName: 'me-hop' }); assert.ok(!m.el.classList.contains('me-hop'));
  set(0); assert.equal(m.dock.left(), M.DOCK.homeX); assert.ok(m.el.classList.contains('me-hop'), '戻るときもピョン');
  set(0); m.el.ls.animationend({ animationName: 'me-hop' }); set(0); assert.ok(!m.el.classList.contains('me-hop'), '動かなければ付かない');
  m.destroy(); assert.ok(!m.el.ls || !m.el.ls.animationend, 'destroyでリスナーも外れる');
});
test('ピョン: 動きを減らす設定では付けず即移動。まばたき(me-blink/me-wide)のクラスとは別', () => {
  const { m, set } = hopSetup(true);
  set(120); assert.equal(m.dock.left(), 120); assert.ok(!m.el.classList.contains('me-hop'));
  const a = hopSetup(false); a.m.el.classList.add('me-blink'); a.set(120);
  assert.ok(a.m.el.classList.contains('me-blink') && a.m.el.classList.contains('me-hop'), 'ピョン中もまばたきクラスは壊れない');
});

// ---- 見た目・配線 ----
test('CSS: タップ素通し・30px・fixedで全画面(z-index 9000)・口なし・ヘッダー幅調整なし・reduced-motionで静止・画像/通信なし', () => {
  const css = read('mascot-eyes.css'), js = read('mascot-eyes.js');
  assert.ok(/\.mascot-eyes \{[^}]*pointer-events:\s*none/.test(css));
  assert.ok(/width:\s*30px;\s*height:\s*30px/.test(css));
  assert.ok(/\.mascot-eyes\.me-fixed \{[^}]*position:\s*fixed[^}]*env\(safe-area-inset-top[^}]*z-index:\s*9000/.test(css));
  assert.ok(/\.me-fixed\.me-off \{[^}]*visibility:\s*hidden/.test(css));
  assert.ok(!/me-smile|mouth/.test(css + js), '口は無い');
  assert.ok(!/lx2-char|app-header|calc\(100% - 138px\)/.test(css), 'ヘッダーの名前ボタンの幅は触らない');
  assert.ok(/\.me-pupil \{[^}]*transition:\s*transform/.test(css));
  assert.ok(/prefers-reduced-motion: reduce\) \{[\s\S]*transition: none/.test(css));
  assert.ok(!/url\(|https?:|@import/.test(css + js), '外部リソースなし');
  assert.ok(!/fetch\(|XMLHttpRequest|new Audio|AudioContext|setInterval/.test(js), '通信・音・setIntervalなし');
  const z = +/z-index:\s*(\d+)/.exec(css)[1];
  assert.ok(z > 8100 && z < 9999, 'ドロワー(8100)より上、確認ダイアログ(9999)より下');
});
test('CSS: 顔はあたたかいクリーム(#FFF3E3・縁#F0C9A8)＋ほっぺ(#FFB8A8・薄い)。青灰色の顔色は残らない。目の読みやすさ(白目・黒目)は維持', () => {
  const css = read('mascot-eyes.css');
  const face = /\.mascot-eyes \.me-face \{([^}]*)\}/.exec(css)[1];
  assert.ok(/background:\s*#FFF3E3/i.test(face) && /border:\s*1\.5px solid #F0C9A8/i.test(face));
  const cheek = /\.me-face::before, \.mascot-eyes \.me-face::after \{([^}]*)\}/.exec(css)[1];
  assert.ok(/#FFB8A8/i.test(cheek) && +/opacity:\s*([\d.]+)/.exec(cheek)[1] <= 0.6, 'ほっぺは低い不透明度');
  assert.ok(!/E6EEF6|74, 118, 168/i.test(css), '以前の青灰色は使わない');
  assert.ok(/\.me-eye \{[^}]*background:\s*#FFFFFF/.test(css) && /\.me-pupil \{[^}]*background:\s*#141414/.test(css));
  assert.ok(/\.me-eye \{[^}]*box-shadow:[^;]*rgba\(150, 100, 70/.test(css), '白目の縁は暖色で見える');
});
test('CSS: ピョンは顔(内側 .me-face)だけに transform。外側の left/top の transition とは別。0.35〜0.5秒・つぶれ→伸び→着地つぶれ→戻り。reduced-motionでは無効', () => {
  const css = read('mascot-eyes.css');
  const use = /\.mascot-eyes\.me-hop \.me-face \{[^}]*animation:\s*me-hop\s+([\d.]+)s/.exec(css);
  assert.ok(use && +use[1] >= 0.35 && +use[1] <= 0.5);
  assert.ok(!/\.mascot-eyes\.me-hop \{/.test(css) && !/\.me-fixed \{[^}]*(animation|transform)/.test(css), '外側の要素にはtransformを掛けない');
  const kf = /@keyframes me-hop \{([\s\S]*?)\n\}/.exec(css)[1];
  const sc = [...kf.matchAll(/(\d+)%\s*\{[^}]*scale\(([\d.]+), ([\d.]+)\)/g)].map((m) => [+m[1], +m[2], +m[3]]);
  assert.deepEqual(sc[0].slice(1), [1, 1]); assert.deepEqual(sc[sc.length - 1].slice(1), [1, 1]);
  assert.ok(sc.some(([, x, y]) => x > 1 && y < 1), 'つぶれ(横伸び・縦縮み)');
  assert.ok(sc.some(([, x, y]) => x < 1 && y > 1), '伸び(縦伸び)');
  assert.ok(/translateY\(-\d+px\)/.test(kf), 'ジャンプで上がる');
  assert.ok(/prefers-reduced-motion: reduce\) \{[\s\S]*\.me-hop \.me-face \{ animation: none/.test(css));
});
test('配線: index.html(css/js)・sw.js(CACHE_FILES・v3.89)・app.jsのtry/catch取り付け・layout2-uiは帯に付けない', () => {
  const html = read('index.html'), sw = read('sw.js'), ui = read('layout2-ui.js'), app = read('app.js');
  assert.ok(html.includes('href="mascot-eyes.css"'));
  assert.ok(html.indexOf('src="mascot-eyes.js"') > 0 && html.indexOf('src="mascot-eyes.js"') < html.indexOf('src="app.js"'));
  const files = sw.slice(sw.indexOf('const CACHE_FILES'), sw.indexOf('const CACHE_FONTS'));
  assert.ok(files.includes("'./mascot-eyes.js'") && files.includes("'./mascot-eyes.css'"));
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v3.89';"));
  assert.ok(/try \{ if \(typeof MascotEyes !== 'undefined'\) MascotEyes\.mountFixed\(document\); \} catch/.test(app));
  assert.ok(!/typeof MascotEyes/.test(ui), '帯(layout2-ui)には付けない');
});
test('CI: 各ファイル500行以内・ヘッダー(作成/最終更新・バージョン・「このファイルは」)', () => {
  for (const f of ['mascot-eyes.js', 'mascot-eyes.css', 'tests/mascot-eyes.test.js', 'layout2-ui.js', 'app.js']) {
    const t = read(f); assert.ok(t.split('\n').length <= 500, f);
    const head = t.split('\n').slice(0, 14).join('\n');
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-(29|30)/.test(head), f);
    assert.ok(/v\d+\.\d+/.test(head), f);
  }
  for (const f of ['mascot-eyes.js', 'mascot-eyes.css', 'tests/mascot-eyes.test.js']) assert.ok(/このファイルは|COCOMITalk/.test(read(f).split('\n').slice(0, 5).join('\n')), f);
});
