// COCOMITalk - 起動オープニング(opening*.js)の組み込みテスト
// このファイルは node --test tests/*.test.js で実行する。DOM/Canvas/AudioContext は手作りモック（実ブラウザ・実音声は使わない）
// v1.0 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const JS = ['opening.js', 'opening-scene.js', 'opening-audio.js'];
const ALL = [...JS, 'opening.css'];

// ---------- 手作りモック ----------
/** 何を呼んでも/代入してもよい万能モック（Canvas2D・WebAudioノード用）。width は measureText 用に10 */
function deep(over = {}) {
  const store = { ...over };
  return new Proxy(function () {}, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k in store) return store[k];
      if (k === 'width') return 10;
      return (store[k] = deep());
    },
    set(_t, k, v) { store[k] = v; return true; },
    apply() { return deep(); },
  });
}

function makeEnv({ reduce = false, w = 390, h = 844 } = {}) {
  const log = { rafCancelled: [], audioClosed: 0, audioCreated: 0 };
  let now = 0, seq = 1;
  const timers = [], raf = [], winL = {}, docL = {};
  const mkEl = (tag) => {
    const cls = new Set();
    const el = {
      tag, id: '', children: [], parentNode: null, listeners: {}, attrs: {}, textContent: '', width: 300, height: 150,
      classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; return c; },
      addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); },
      removeEventListener(t, f) { el.listeners[t] = (el.listeners[t] || []).filter(x => x !== f); },
      setAttribute(k, v) { el.attrs[k] = v; },
      getContext() { return deep(); },
      click() { (el.listeners.click || []).slice().forEach(f => f({ target: el })); },
    };
    Object.defineProperty(el, 'className', { get: () => [...cls].join(' '), set: v => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); } });
    return el;
  };
  const body = mkEl('body');
  const byId = id => { const f = n => (n.id === id ? n : n.children.map(f).find(Boolean)); return f(body) || null; };
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => now },
    innerWidth: w, innerHeight: h, devicePixelRatio: 2,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    setTimeout: (fn, ms) => { const id = seq++; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: cb => { const id = seq++; raf.push({ id, cb }); return id; },
    cancelAnimationFrame: id => { log.rafCancelled.push(id); const i = raf.findIndex(r => r.id === id); if (i >= 0) raf.splice(i, 1); },
    matchMedia: () => ({ matches: reduce }),
    document: {
      body, createElement: mkEl,
      addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); },
      removeEventListener(t, f) { docL[t] = (docL[t] || []).filter(x => x !== f); },
    },
  };
  sb.window = sb;
  sb.addEventListener = (t, f) => { (winL[t] = winL[t] || []).push(f); };
  sb.removeEventListener = (t, f) => { winL[t] = (winL[t] || []).filter(x => x !== f); };
  sb.dispatchEvent = e => { log.lastEvent = e; return true; };
  sb.AudioContext = class {
    constructor() { log.audioCreated++; this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = deep(); }
    createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
    close() { log.audioClosed++; return Promise.resolve(); }
    resume() {}
  };
  for (const n of ['createGain', 'createOscillator', 'createDelay', 'createBiquadFilter', 'createBufferSource']) sb.AudioContext.prototype[n] = () => deep();
  vm.createContext(sb);
  const env = {
    sb, log, body, byId,
    load(files) { for (const f of files) vm.runInContext(read(f), sb, { filename: f }); return env; },
    advance(ms) { // 疑似時計を進めて期限のタイマーを順に実行
      const end = now + ms;
      for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; timers.shift(); now = Math.max(now, t.at); t.fn(); }
      now = end;
    },
    frame(tsMs) { now = Math.max(now, tsMs); raf.splice(0).forEach(r => r.cb(tsMs)); },
    pending: () => ({ raf: raf.length, timers: timers.length }),
    listeners: () => ({ win: Object.values(winL).flat().length, doc: Object.values(docL).flat().length }),
    fireKey(key) { (docL.keydown || []).slice().forEach(f => f({ key })); },
    fireResize() { (winL.resize || []).slice().forEach(f => f({})); },
  };
  return env;
}

/** 偽の scene/audio を差し込んだ環境（制御の検証用） */
function fakeEnv(opts = {}) {
  const env = makeEnv(opts).load(['opening.js']);
  const calls = { render: [], resize: 0, audio: [] };
  env.calls = calls;
  env.sb.CocomiOpeningScene = { DUR: 18.5, create: () => ({ DUR: 18.5, resize() { calls.resize++; }, render(t) { calls.render.push(t); if (opts.renderThrowsAt != null && calls.render.length > opts.renderThrowsAt) throw new Error('boom'); }, time: () => calls.render[calls.render.length - 1] || 0 }) };
  env.sb.CocomiOpeningAudio = { create: m => { if (opts.audioThrows) throw new Error('no audio'); const a = { muted: m, closed: 0, setMuted(x) { a.muted = x; }, close() { a.closed++; } }; calls.audio.push(a); return a; } };
  return env;
}

// ---------- 静的チェック（CI規則・配線） ----------
test('ファイルが存在し、500行以内・冒頭5行に「このファイルは/COCOMITalk」・v数字.数字・作成表記がある', () => {
  for (const f of ALL) {
    const s = read(f);
    const head = s.split('\n').slice(0, 5).join('\n');
    assert.ok(s.split('\n').length <= 500, `${f} は500行以内`);
    assert.ok(/(このファイルは|COCOMITalk)/.test(head), `${f} 冒頭5行に表記`);
    assert.ok(/v[0-9]+\.[0-9]+/.test(s), `${f} にバージョン表記`);
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-29/.test(head), `${f} 作成者表記`);
  }
  for (const f of ['app.js', 'sw.js', 'index.html']) assert.ok(/最終更新: 葵\(Aoi\), 2026-10-(29|30)/.test(read(f)), f);
});

test('sw.js: CACHE_FILES に4ファイルが入り、キャッシュ名は cocomitalk-v3.95（v3.75は残っていない）', () => {
  const sw = read('sw.js');
  const files = sw.slice(sw.indexOf('const CACHE_FILES'), sw.indexOf('const CACHE_FONTS'));
  for (const f of ALL) assert.ok(files.includes(`'./${f}'`), f);
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v3.95';"));
  assert.ok(!sw.includes("const CACHE_NAME = 'cocomitalk-v3.75'"));
});

test('index.html: opening.css を読み、scene→audio→opening→app の順に1回ずつ読み込む', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]);
  const idx = f => scripts.indexOf(f);
  for (const f of JS) assert.equal(scripts.filter(s => s === f).length, 1, f);
  assert.ok(idx('opening-scene.js') < idx('opening-audio.js') && idx('opening-audio.js') < idx('opening.js') && idx('opening.js') < idx('app.js'));
  assert.equal([...html.matchAll(/href="opening\.css"/g)].length, 1);
  assert.ok(html.indexOf('href="opening.css"') > html.indexOf('href="styles.css"'));
  assert.ok(html.includes('id="splash-screen"'), '従来スプラッシュは残す');
});

test('外部通信・画面遷移・グローバル汚染なし／元の文言はそのまま', () => {
  for (const f of JS) {
    const s = read(f);
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\/|location\.href|postMessage|localStorage|\.src\s*=/.test(s.replace(/\/\/[^\n]*/g, '')), `${f} に外部通信/遷移なし`);
    assert.ok(/\(function \(\) \{/.test(s), `${f} はIIFE`);
  }
  const scene = read('opening-scene.js');
  for (const t of ['COCOMI CORE', 'PERAFCA', 'AKC Total Support Co., Ltd.', '想いが構造になり、', '構造が証明になる。', 'ORIGIN ARCHITECT OF COCOMI OS', 'Cognitive Architecture', 'Consciousness Architecture']) assert.ok(scene.includes(t), t);
  assert.ok(scene.includes('DUR = 18.5'));
  const env = makeEnv().load(['opening-scene.js', 'opening-audio.js', 'opening.js']);
  const globals = Object.keys(env.sb).filter(k => /^(Cocomi|op|__)/i.test(k) || k.startsWith('__'));
  assert.deepEqual(globals.sort(), ['CocomiOpening', 'CocomiOpeningAudio', 'CocomiOpeningScene']);
});

test('CSS: スキップ/ミュートは44px以上のタップ領域、overlayのz-indexはsplash(1000)以上', () => {
  const css = read('opening.css');
  const ui = css.match(/#opening-overlay \.op-ui\{([^}]*)\}/)[1];
  assert.ok(/min-width:44px/.test(ui) && /min-height:44px/.test(ui));
  const z = Number(css.match(/#opening-overlay\{[^}]*z-index:(\d+)/)[1]);
  const splashZ = Number(read('styles.css').match(/\.splash \{[^}]*z-index: (\d+)/)[1]);
  assert.ok(z >= splashZ, `overlay ${z} >= splash ${splashZ}`);
  assert.ok(/#op-skip\{[^}]*top:/.test(css), 'スキップは画面端に固定');
  assert.ok(/prefers-reduced-motion:reduce/.test(css));
});

// ---------- 制御（偽のscene/audioで） ----------
test('開始時: ▶再生・スキップ・ミュートがあり、スキップは常時表示。まだ音は鳴らない', () => {
  const env = fakeEnv();
  let ended = null;
  const c = env.sb.CocomiOpening.start({ onEnd: r => { ended = r; } });
  assert.ok(c && env.byId('opening-overlay') && env.byId('op-start') && env.byId('op-mute'));
  const skip = env.byId('op-skip');
  assert.ok(skip.classList.contains('op-ui') && skip.classList.contains('op-show'), 'スキップは最初から表示');
  assert.equal(skip.textContent, 'スキップ');
  assert.equal(env.byId('op-start').children.map(x => x.textContent).join('|'), '▶|再生|SOUND ON 推奨');
  assert.equal(env.calls.audio.length, 0, 'タップ前は無音');
  assert.equal(env.pending().raf, 0);
  assert.equal(ended, null);
});

test('スキップ: ▶前でも押したら即 onEnd(skipped)、overlay除去・rAF/timer/リスナー/Audio後片付け', () => {
  const env = fakeEnv();
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  env.byId('op-start').click();
  env.frame(1000);
  const audio = env.calls.audio[0];
  env.byId('op-skip').click();
  assert.deepEqual(ends, ['skipped']);
  assert.equal(env.byId('opening-overlay'), null);
  assert.equal(audio.closed, 1);
  assert.deepEqual(env.pending(), { raf: 0, timers: 0 });
  assert.ok(env.log.rafCancelled.length >= 1);
  assert.deepEqual(env.listeners(), { win: 0, doc: 0 });
  assert.equal(env.sb.CocomiOpening.start({ onEnd() {} }) !== null, true, '終了後は再度startできる');
});

test('スキップ: ▶を押す前・Escキーでも動き、二重にonEndしない', () => {
  const env = fakeEnv();
  const ends = [];
  const c = env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  env.fireKey('a');
  assert.deepEqual(ends, []);
  env.fireKey('Escape');
  c.skip(); env.byId('op-skip') && env.byId('op-skip').click();
  assert.deepEqual(ends, ['skipped']);
  assert.equal(env.calls.audio.length, 0);
});

test('最後まで再生: ▶で音つき開始→18.5秒で最後の画面→保持→フェード→onEnd(ended)→全停止', () => {
  const env = fakeEnv();
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  env.byId('op-start').click();
  assert.equal(env.calls.audio.length, 1);
  assert.equal(env.calls.audio[0].muted, false);
  assert.ok(env.byId('op-start').classList.contains('op-hide'));
  assert.ok(env.byId('op-mute').classList.contains('op-show'));
  for (let t = 100; t <= 19000; t += 500) env.frame(t);
  assert.ok(env.calls.render.some(t => t > 18.4), '最後まで描画した');
  assert.deepEqual(ends, [], '最後の画面を少し見せる');
  env.advance(1800);
  assert.ok(env.byId('op-fade').classList.contains('op-on'));
  assert.deepEqual(ends, []);
  env.advance(800);
  assert.deepEqual(ends, ['ended']);
  assert.equal(env.byId('opening-overlay'), null);
  assert.equal(env.calls.audio[0].closed, 1);
  assert.deepEqual(env.pending(), { raf: 0, timers: 0 });
  assert.deepEqual(env.listeners(), { win: 0, doc: 0 });
  assert.equal(env.sb.dispatchEvent && env.log.lastEvent.type, 'cocomi:opening-done');
});

test('最後の画面をタップすると待たずにフェードして終了。途中のタップでは終わらない', () => {
  const env = fakeEnv();
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  const canvas = env.byId('op-canvas');
  env.byId('op-start').click();
  env.frame(5000);
  canvas.click();
  env.advance(5000);
  assert.deepEqual(ends, [], '再生の途中では進まない');
  env.frame(19000);
  canvas.click(); canvas.click();
  env.advance(800);
  assert.deepEqual(ends, ['ended']);
});

test('ミュート切替: 表示と gain 切替。ミュートのまま開始しても音は作られ、close される', () => {
  const env = fakeEnv();
  env.sb.CocomiOpening.start({ onEnd() {} });
  const mute = env.byId('op-mute');
  mute.click();
  assert.equal(mute.textContent, '♪ サウンド OFF');
  env.byId('op-start').click();
  assert.equal(env.calls.audio[0].muted, true);
  mute.click();
  assert.equal(mute.textContent, '♪ サウンド ON');
  assert.equal(env.calls.audio[0].muted, false);
});

test('リサイズ: 再生前は静止フレームを描き直す／終了後はリスナーが残らない', () => {
  const env = fakeEnv();
  const c = env.sb.CocomiOpening.start({ onEnd() {} });
  const n = env.calls.render.length;
  env.fireResize();
  assert.equal(env.calls.resize, 1);
  assert.equal(env.calls.render.length, n + 1);
  c.destroy();
  assert.deepEqual(env.listeners(), { win: 0, doc: 0 });
  c.destroy(); // 二重呼び出しでも壊れない
});

// ---------- フォールバック ----------
test('フォールバック: scene 未読込 / 2D未対応 / 初期描画の失敗 → start は null、overlay は残さない', () => {
  const a = makeEnv().load(['opening.js']);
  assert.equal(a.sb.CocomiOpening.isSupported(), false);
  assert.equal(a.sb.CocomiOpening.start({ onEnd() {} }), null);
  const b = fakeEnv();
  b.sb.CocomiOpeningScene.create = () => null;
  assert.equal(b.sb.CocomiOpening.start({ onEnd() {} }), null);
  assert.equal(b.byId('opening-overlay'), null);
  assert.deepEqual(b.listeners(), { win: 0, doc: 0 });
  const c = fakeEnv({ renderThrowsAt: 0 });
  assert.equal(c.sb.CocomiOpening.start({ onEnd() {} }), null);
  assert.equal(c.byId('opening-overlay'), null);
});

test('フォールバック: 再生中に描画が例外 → onEnd(error)・全停止（app側が従来スプラッシュへ）', () => {
  const env = fakeEnv({ renderThrowsAt: 3 });
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  env.byId('op-start').click();
  for (let t = 100; t <= 3000; t += 100) env.frame(t);
  assert.deepEqual(ends, ['error']);
  assert.equal(env.byId('opening-overlay'), null);
  assert.equal(env.calls.audio[0].closed, 1);
  assert.deepEqual(env.pending(), { raf: 0, timers: 0 });
});

test('音が作れない端末: 映像だけで進み、ミュートボタンは出さない', () => {
  const env = fakeEnv({ audioThrows: true });
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  env.byId('op-start').click();
  env.frame(1000);
  assert.ok(!env.byId('op-mute').classList.contains('op-show'));
  env.byId('op-skip').click();
  assert.deepEqual(ends, ['skipped']);
});

test('onEnd が例外を投げても後片付けは済んでいる', () => {
  const env = fakeEnv();
  env.sb.CocomiOpening.start({ onEnd() { throw new Error('x'); } });
  env.byId('op-skip').click();
  assert.equal(env.byId('opening-overlay'), null);
});

// ---------- reduced-motion ----------
test('prefers-reduced-motion: ▶不要・最終フレーム静止・音なし・rAFなし・スキップ可・数秒後に自動で進む', () => {
  const env = fakeEnv({ reduce: true });
  const ends = [];
  env.sb.CocomiOpening.start({ onEnd: r => ends.push(r) });
  assert.deepEqual(env.calls.render, [18.5]);
  assert.ok(env.byId('op-start').classList.contains('op-hide'));
  assert.ok(env.byId('op-skip').classList.contains('op-show'));
  assert.equal(env.pending().raf, 0);
  assert.equal(env.calls.audio.length, 0);
  env.advance(3000);
  assert.deepEqual(ends, []);
  env.advance(1900);
  assert.deepEqual(ends, ['ended']);
  const env2 = fakeEnv({ reduce: true });
  const e2 = [];
  env2.sb.CocomiOpening.start({ onEnd: r => e2.push(r) });
  env2.byId('op-skip').click();
  assert.deepEqual(e2, ['skipped']);
});

// ---------- 本物の scene / audio（モックのCanvas・AudioContext） ----------
test('本物のscene: 390x844 と 1280x720 で t=0〜25秒を描画しても例外なし。resizeでサイズ追従', () => {
  for (const [w, h] of [[390, 844], [1280, 720]]) {
    const env = makeEnv({ w, h }).load(['opening-scene.js']);
    const cv = env.sb.document.createElement('canvas');
    const sc = env.sb.CocomiOpeningScene.create(cv);
    assert.equal(sc.DUR, 18.5);
    assert.equal(cv.width, w * 2);
    for (const t of [0, 0.5, 2, 4.7, 8, 10.5, 12.05, 13, 15, 17, 18.5, 22, 30]) sc.render(t);
    assert.equal(sc.time(), 30);
    env.sb.innerWidth = 200; sc.resize();
    assert.equal(cv.width, 400);
  }
  const env = makeEnv().load(['opening-scene.js']);
  assert.equal(env.sb.CocomiOpeningScene.create({ getContext: () => null }), null);
});

test('本物のaudio: 作成→ミュート切替→close は1回だけ。AudioContext不可/組み立て失敗は null', () => {
  const env = makeEnv().load(['opening-audio.js']);
  const a = env.sb.CocomiOpeningAudio.create(false);
  assert.ok(a && env.log.audioCreated === 1);
  a.setMuted(true);
  a.close(); a.close();
  assert.equal(env.log.audioClosed, 1);
  const e2 = makeEnv().load(['opening-audio.js']);
  e2.sb.AudioContext = function () { throw new Error('unsupported'); };
  assert.equal(e2.sb.CocomiOpeningAudio.create(false), null);
  const e3 = makeEnv().load(['opening-audio.js']);
  e3.sb.AudioContext.prototype.createOscillator = () => { throw new Error('broken'); };
  assert.equal(e3.sb.CocomiOpeningAudio.create(false), null);
  assert.equal(e3.log.audioClosed, 1, '失敗時もcloseする');
});

// ---------- app.js _handleSplash との接続 ----------
function loadHandleSplash(opening) {
  const src = read('app.js');
  const fn = src.slice(src.indexOf('function _handleSplash() {'), src.indexOf('// 三姉妹タブの設定'));
  const cls = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), has: c => s.has(c) }; };
  const splash = { classList: cls() }, app = { classList: cls() };
  app.classList.add('hidden');
  const timers = [];
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout: (f, ms) => timers.push({ f, ms }), document: { getElementById: id => (id === 'splash-screen' ? splash : app) } };
  sb.window = sb;
  if (opening) sb.CocomiOpening = opening;
  vm.createContext(sb);
  const run = vm.runInContext(`(${fn.replace(/^function _handleSplash/, 'function')})`, sb);
  return { run, splash, app, timers };
}

test('app.js: オープニング終了/スキップの後、ロゴ画面(COCOMITalk)を1000ms見せ→fade-out→400ms→アプリ表示', () => {
  for (const reason of ['ended', 'skipped']) {
    let onEnd;
    const h = loadHandleSplash({ isSupported: () => true, start: o => { onEnd = o.onEnd; return {}; } });
    h.run();
    assert.equal(h.timers.length, 0, 'オープニング中はタイマーなし');
    assert.ok(h.app.classList.has('hidden'), 'オープニング中はアプリ非表示');
    onEnd(reason);
    assert.ok(h.app.classList.has('hidden'), '終了直後はまだアプリを出さない');
    assert.ok(!h.splash.classList.has('hidden'), 'ロゴ画面が見えている');
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 1000);
    h.timers[0].f();
    assert.ok(h.splash.classList.has('fade-out'));
    assert.equal(h.timers[1].ms, 400);
    h.timers[1].f();
    assert.ok(h.splash.classList.has('hidden') && !h.app.classList.has('hidden'));
  }
});

test('app.js: 未対応/start失敗(null)/例外/描画失敗(error) は従来スプラッシュ(1500ms→fade-out→400ms→アプリ表示)', () => {
  const cases = [
    () => loadHandleSplash(null),
    () => loadHandleSplash({ isSupported: () => false, start: () => ({}) }),
    () => loadHandleSplash({ isSupported: () => true, start: () => null }),
    () => loadHandleSplash({ isSupported: () => true, start: () => { throw new Error('x'); } }),
  ];
  for (const mk of cases) {
    const h = mk();
    h.run();
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].ms, 1500);
    h.timers[0].f();
    assert.ok(h.splash.classList.has('fade-out'));
    assert.equal(h.timers[1].ms, 400);
    h.timers[1].f();
    assert.ok(h.splash.classList.has('hidden') && !h.app.classList.has('hidden'));
  }
  let onEnd;
  const h = loadHandleSplash({ isSupported: () => true, start: o => { onEnd = o.onEnd; return {}; } });
  h.run();
  onEnd('error');
  assert.equal(h.timers[0].ms, 1500);
  assert.ok(h.app.classList.has('hidden'), 'errorの直後はまだ従来スプラッシュ待ち');
});
