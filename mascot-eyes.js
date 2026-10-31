// mascot-eyes.js v1.2
// このファイルは COCOMITalk の全画面に出す「目だけの小さなまるい顔（口なし）」を作って動かす（見た目は mascot-eyes.css）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// v1.0 2026-10-29 - 新規作成（依頼B）。外部画像・通信・音なし。黒目の動きはCSS transition、タイマーは最小限
//   ・黒目: 0.8〜3.5秒ごとにランダムに視線移動（ときどき真ん中に戻る／続けて2回動く）
//   ・まばたき: 2〜6秒ごと。ときどき目を丸くする「え？」
//   ・画面が裏（document.hidden）の間は止まる。prefers-reduced-motion なら真ん中で静止
// v1.1 2026-10-29 - 口を廃止（目だけ。表情は見る人が想像する）。body直下のfixed表示(mountFixed)を追加し、どの画面でも見えるように
//   ・左上に固定。下にある文字/ボタンに重なる所は避けて横にずれる(pickSpot)。pointer-events:none でタップは素通し
//   ・オープニング(#opening-overlay)とロゴ画面の間は隠し、アプリ表示後に出す
//   ・横に空きが無い画面(狭い幅の見出しなど)は下へ段ずらし。見出し・段落は「文字のある範囲」だけを避ける(幅0の飾り文字は箱全体)
//   ・乱数(rng)とタイマー(setTimeoutFn/clearTimeoutFn)は差し替え可能（テスト用）。destroy() で全部片付く
// v1.2 2026-10-29 - 避けて場所を変えたとき root に me-hop を付けてピョン(つぶれて伸びて着地)を1回再生。動きを減らす設定では付けない
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

  // ---- 全画面に出す（body直下のfixed）。下の文字やボタンに重ならない場所を探して横にずれる ----
  const DOCK = {
    size: 30, homeX: 58, minX: 4, step: 4, sideMargin: 4,   // 基本位置(☰の右隣)・横に探す刻み・画面端の余白(px)
    rowStep: 7, maxRows: 14, rowCost: 3,                     // 横に空きが無いとき下へずらす刻み(px)・最大段数・1段ぶんの重さ(横px換算)
    checkMs: 160,                                            // 画面変化のあとに位置を見直すまでの間隔(ms。連続変化はまとめる)
  };
  const OFFS = [-3, 4, 11, 18, 25, 33];   // 顔(30px)の左端/上端から見た調べる点。縁の外3px(ぎりぎり接する並びも避ける)まで含める
  const BUSY_SEL = 'button,a,input,select,textarea,label,img,svg,canvas,video,[role="button"]';

  // その要素が「見えている中身」(ボタン・文字・画像など)か。何も無い背景やスクリムは false。
  // 文字だけの要素(見出し・段落)は箱が横いっぱいでも、文字の置かれた範囲(px,py の点)に当たったときだけ true
  // （px,py を省くと箱全体で判定。ボタン・入力欄・画像は常に箱全体）
  function isBusyEl(el, px, py) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest(BUSY_SEL)) return true;
    const kids = el.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType !== 3 || !/\S/.test(k.nodeValue || '')) continue;
      const d = el.ownerDocument;
      if (px == null || !d || typeof d.createRange !== 'function') return true;
      try {
        const rg = d.createRange(); rg.selectNodeContents(k);
        const rs = rg.getClientRects(), m = 2;
        let shown = false;
        for (let j = 0; j < rs.length; j++) {
          if (rs[j].right - rs[j].left > 0) shown = true;
          if (px >= rs[j].left - m && px <= rs[j].right + m && py >= rs[j].top - m && py <= rs[j].bottom + m) return true;
        }
        if (!shown) return true;   // 文字が幅0(font-size:0 で ::after の飾り文字を出す等)のときは見えている中身の位置が分からないので箱全体で判定
      } catch (e) { return true; }
    }
    return false;
  }
  // 画面の幅 viewW で顔を置く場所 {x, dy} を決める。x=左端、dy=基本の高さから下へずらす量(px)。
  // countAt(x, dy) は、そこに置いたとき下にある中身の数。
  // 基本位置が空いていればそこ、次に今の位置、だめなら一番空いている所（同数なら基本位置に近い方。下へずらすのは横に空きが無いときだけ有利）
  function pickSpot(viewW, countAt, current) {
    const maxX = Math.max(DOCK.minX, viewW - DOCK.size - DOCK.sideMargin);
    const home = { x: Math.min(DOCK.homeX, maxX), dy: 0 };
    let bestC = countAt(home.x, 0);
    if (bestC === 0) return home;
    if (current && current.x >= DOCK.minX && current.x <= maxX && countAt(current.x, current.dy) === 0) return { x: current.x, dy: current.dy };
    let best = home, bestCost = 0;
    const cost = (x, dy) => Math.abs(x - home.x) + (dy / DOCK.rowStep) * DOCK.rowCost;
    for (let r = 0; r <= DOCK.maxRows; r++) {
      const dy = r * DOCK.rowStep;
      for (let x = DOCK.minX; x <= maxX; x += DOCK.step) {
        const c = countAt(x, dy), k = cost(x, dy);
        if (c < bestC || (c === bestC && k < bestCost)) { best = { x, dy }; bestC = c; bestCost = k; }
      }
    }
    return best;
  }

  // 隠す条件: オープニング表示中、またはロゴ画面(#splash-screen)がまだ出ている間
  function isOpeningActive(doc) {
    if (!doc || !doc.getElementById) return false;
    if (doc.getElementById('opening-overlay')) return true;
    const sp = doc.getElementById('splash-screen');
    return !!(sp && !(sp.classList && sp.classList.contains('hidden')));
  }

  // root(.mascot-eyes.me-fixed) の位置・表示を面倒みる。ctl は create() の戻り値
  function attachDock(root, ctl, o) {
    const doc = o.doc || (typeof document !== 'undefined' ? document : null);
    const win = o.win || (typeof window !== 'undefined' ? window : null);
    const st = o.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    const ct = o.clearTimeoutFn || ((id) => clearTimeout(id));
    let timer = null, current = null, curDy = 0, off = null, mo = null, dead = false;
    const inside = (n) => !!(n && root.contains && root.contains(n));

    // 顔を x に置いたとき、下にある中身の数。顔より2〜3px広い範囲を細かく調べる（同じ点は1回の見直しの間は使い回す）。
    // elementsFromPoint が無い環境は0
    const makeCount = () => {
      const memo = new Map();
      const r = root.getBoundingClientRect();
      const busyAt = (px, py) => {
        const k = px + ',' + py;
        if (!memo.has(k)) {
          const els = (doc && typeof doc.elementsFromPoint === 'function' && doc.elementsFromPoint(px, py)) || [];
          memo.set(k, isBusyEl(els.find((e) => !inside(e)), px, py));
        }
        return memo.get(k);
      };
      const baseTop = r.top - curDy;
      return (x, dy) => {
        let n = 0;
        for (let i = 0; i < OFFS.length; i++) for (let j = 0; j < OFFS.length; j++) if (busyAt(x + OFFS[i], Math.round(baseTop + (dy || 0) + OFFS[j]))) n++;
        return n;
      };
    };

    // ピョン: 場所を変えるときに1回。連続したら最初から。終わったらクラスを外す。動きを減らす設定なら何もしない（即移動）
    const calm = () => !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function hop() {
      if (calm()) return;
      root.classList.remove('me-hop');
      if (typeof root.offsetWidth === 'number') void root.offsetWidth;   // 再生し直すための再計算
      root.classList.add('me-hop');
    }
    const onHopEnd = (e) => { if (e && e.animationName === 'me-hop') root.classList.remove('me-hop'); };
    if (root.addEventListener) root.addEventListener('animationend', onHopEnd);

    function update() {
      if (dead) return;
      const nowOff = isOpeningActive(doc);
      if (nowOff !== off) {
        off = nowOff;
        if (off) { root.classList.add('me-off'); ctl.stop(); } else { root.classList.remove('me-off'); ctl.sync(); }
      }
      if (off || (doc && doc.hidden)) return;
      const p = pickSpot((win && win.innerWidth) || 390, o.countAt || makeCount(), current === null ? null : { x: current, dy: curDy });
      const moved = current !== null && (p.x !== current || p.dy !== curDy);
      if (moved) hop();
      if (p.x !== current) { current = p.x; root.style.left = p.x + 'px'; }
      if (p.dy !== curDy) { curDy = p.dy; root.style.top = p.dy ? 'calc(env(safe-area-inset-top, 0px) + ' + (11 + p.dy) + 'px)' : ''; }
    }
    function schedule() {
      if (dead || timer !== null) return;
      timer = st(() => { timer = null; update(); }, DOCK.checkMs);
    }
    const onEvt = (e) => { if (!inside(e && e.target)) schedule(); };
    if (win && typeof win.MutationObserver === 'function' && doc && doc.body) {
      mo = new win.MutationObserver((recs) => { if (recs.some((r) => !inside(r.target))) schedule(); });
      mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    if (win && win.addEventListener) win.addEventListener('resize', schedule);
    if (doc && doc.addEventListener) { doc.addEventListener('transitionend', onEvt, true); doc.addEventListener('animationend', onEvt, true); }
    update();

    function destroy() {
      dead = true;
      if (timer !== null) { ct(timer); timer = null; }
      if (mo) mo.disconnect();
      if (root.removeEventListener) root.removeEventListener('animationend', onHopEnd);
      if (win && win.removeEventListener) win.removeEventListener('resize', schedule);
      if (doc && doc.removeEventListener) { doc.removeEventListener('transitionend', onEvt, true); doc.removeEventListener('animationend', onEvt, true); }
    }
    return { update, schedule, destroy, isOff: () => off, left: () => current, down: () => curDy };
  }

  // 全画面に出す。body直下にfixedで1つだけ付ける（二重に付けない）。body が無ければ何もしない
  function mountFixed(doc, opts) {
    const o = opts || {};
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return null;
    if (doc.querySelector && doc.querySelector('.mascot-eyes.me-fixed')) return null;
    const root = build(doc);
    root.classList.add('me-fixed');
    doc.body.appendChild(root);
    const ctl = create(root, Object.assign({}, o, { doc }));
    const dock = attachDock(root, ctl, Object.assign({}, o, { doc }));
    const baseDestroy = ctl.destroy;
    ctl.dock = dock;
    ctl.destroy = () => { dock.destroy(); baseDestroy(); };
    return ctl;
  }

  return { CFG, DOCK, isBusyEl, pickSpot, isOpeningActive, mountFixed, nextSaccadeDelay, nextBlinkDelay, doubleGap, pickGaze, shouldDouble, shouldWide, build, create };
})();
if (typeof window !== 'undefined') window.MascotEyes = MascotEyes;
