// COCOMITalk - 画面レイアウト改善テスト（開閉状態・準備中の札・配線・新規CSSの決まり）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, makeStorage, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

/** layout-ui.js だけを読む（document が無いので init は走らない） */
function boot(ls = makeStorage()) {
  const r = load(['characters.js', 'layout-ui.js'], ['CharacterRegistry', 'LayoutUi'], { window: { localStorage: ls } });
  return { L: r.LayoutUi, CR: r.CharacterRegistry, ls };
}

/** 最小のDOM替え玉（classList / dataset / 属性 / イベント） */
function fakeEl() {
  const cls = new Set(); const attrs = {}; const ev = {};
  return {
    dataset: {}, attrs, ev,
    classList: { add: c => cls.add(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) },
    setAttribute: (k, v) => { attrs[k] = v; },
    addEventListener: (t, fn) => { ev[t] = fn; },
  };
}

test('parseState: 壊れた保存値・配列・null は空にする', () => {
  const { L } = boot();
  assert.deepEqual(plain(L.parseState('{"a":true}')), { a: true });
  for (const bad of [null, '', 'xx', '[1]', '123', 'null']) assert.deepEqual(plain(L.parseState(bad)), {}, String(bad));
});

test('isOpen / toggled: 既定は認証だけ開く。保存があればそれを優先', () => {
  const { L } = boot();
  assert.equal(L.isOpen({}, 'sec-auth'), true);
  assert.equal(L.isOpen({}, 'sec-voice'), false);
  assert.equal(L.isOpen({ 'sec-auth': false }, 'sec-auth'), false);
  const s = L.toggled({}, 'sec-voice');
  assert.equal(L.isOpen(s, 'sec-voice'), true);
  assert.equal(L.isOpen(L.toggled(s, 'sec-voice'), 'sec-voice'), false);
  assert.equal(L.isOpen(L.toggled({}, 'sec-auth'), 'sec-auth'), false);
});

test('soonTabs: 準備中のキャラだけ（葵🦋・キミ）。アイコン未決定は✨', () => {
  const { L, CR } = boot();
  const t = plain(L.soonTabs(CR.list()));
  assert.deepEqual(t.map(x => x.key), ['aoi', 'kimi']);
  assert.equal(t[0].icon, '🦋');
  assert.equal(L.soonTabs(CR.list()).every(x => x.icon && x.name), true);
  assert.deepEqual(plain(L.soonTabs([{ key: 'x', name: 'X', enabled: false }])), [{ key: 'x', icon: '✨', name: 'X', note: '準備中' }]);
  assert.deepEqual(plain(L.soonTabs(null)), []);
  assert.deepEqual(plain(L.soonTabs([{ key: 'y', enabled: true, name: 'Y' }])), []);
  assert.match(L.soonMessage(t[0]), /葵.*準備中/);
});

test('makeCollapsible: 見出しを押すと開閉し、端末に覚え、二重に付かない', () => {
  const ls = makeStorage();
  const { L } = boot(ls);
  const el = fakeEl(); const title = fakeEl();
  L.makeCollapsible(el, title, 'sec-voice');
  assert.equal(el.classList.contains('lx-collapsible'), true);
  assert.equal(el.classList.contains('lx-open'), false);
  assert.equal(title.attrs['aria-expanded'], 'false');
  assert.equal(title.attrs.role, 'button');
  title.ev.click();
  assert.equal(el.classList.contains('lx-open'), true);
  assert.equal(title.attrs['aria-expanded'], 'true');
  assert.deepEqual(JSON.parse(ls.getItem(L.STORE_KEY)), { 'sec-voice': true });
  // キーボード（Enter / Space）でも動く。他のキーは無反応
  let prevented = 0;
  title.ev.keydown({ key: 'Enter', preventDefault: () => prevented++ });
  assert.equal(el.classList.contains('lx-open'), false);
  title.ev.keydown({ key: 'a', preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  // 二重適用しない
  const before = title.ev.click;
  L.makeCollapsible(el, title, 'sec-voice');
  assert.equal(title.ev.click, before);
  // 次の起動でも覚えている
  const el2 = fakeEl(); const t2 = fakeEl();
  boot(ls).L.makeCollapsible(el2, t2, 'sec-voice');
  assert.equal(el2.classList.contains('lx-open'), false);
  title.ev.click();
  const el3 = fakeEl(); const t3 = fakeEl();
  boot(ls).L.makeCollapsible(el3, t3, 'sec-voice');
  assert.equal(el3.classList.contains('lx-open'), true);
});

test('makeCollapsible: 保存できない端末でも落ちない / 要素が無くても落ちない', () => {
  const r = load(['layout-ui.js'], ['LayoutUi'], { window: { localStorage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } } });
  const el = fakeEl(); const title = fakeEl();
  r.LayoutUi.makeCollapsible(el, title, 'sec-auth');
  assert.equal(el.classList.contains('lx-open'), true); // 既定どおり認証は開く
  title.ev.click();
  r.LayoutUi.makeCollapsible(null, null, 'k');
});

test('配線: index.html に新CSS2つ・layout-ui.js、sw.js に3ファイル、設定の7節にid', () => {
  const html = read('index.html'); const sw = read('sw.js');
  for (const f of ['layout-main.css', 'layout-panels.css']) {
    assert.ok(html.includes(`href="${f}"`), f);
    assert.ok(sw.includes(`'./${f}'`), `sw ${f}`);
  }
  assert.ok(html.includes('src="layout-ui.js"') && sw.includes("'./layout-ui.js'"));
  // 既存のCSSより後に読み込む（上書きが効く）
  const last = html.lastIndexOf('rel="stylesheet" href="vision-styles.css"');
  assert.ok(html.indexOf('layout-main.css') > last && html.indexOf('layout-panels.css') > html.indexOf('layout-main.css'));
  for (const id of ['sec-auth', 'sec-models', 'sec-voice', 'sec-memory', 'sec-history', 'sec-walk', 'sec-tokens']) {
    assert.match(html, new RegExp(`<section id="${id}" class="settings-section"`), id);
  }
  // 設定が開閉されても、既存のid（保存ボタン・各設定）は残っている
  for (const id of ['btn-save-settings', 'btn-close-settings', 'model-settings-area', 'walk-spend-area', 'btn-open-memory-ui']) assert.ok(html.includes(`id="${id}"`), id);
  // 動作に使うタブは3人のまま（準備中の札はJSが足す。data-sister を持たない）
  assert.equal((html.match(/class="tab[ "][^>]*data-sister=/g) || []).length, 3);
});

test('新規ファイル: ヘッダー行と500行以内、CSSは色を直書きせずトークンを使う', () => {
  for (const f of ['layout-main.css', 'layout-panels.css', 'layout-ui.js', 'tests/layout-ui.test.js']) {
    const s = read(f);
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-(28|29)/.test(s), f);
    assert.ok(s.split('\n').length <= 500, f);
  }
  // 押しやすさの基準が消えていない（44px）
  assert.match(read('layout-main.css'), /--lx-tap:\s*44px/);
  // 補助文字の色は読める濃さ（白地でWCAG AA 4.5:1以上）
  const m = read('layout-main.css').match(/--lx-muted:\s*#([0-9A-Fa-f]{6})/);
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = h => 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16)) + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
  const ratio = (1.05) / (L(m[1]) + 0.05);
  assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}`);
});

test('既存タブの処理に準備中の札が混ざらない（app.js は .tab を data-sister で扱う）', () => {
  const app = read('app.js');
  assert.ok(app.includes("querySelectorAll('.tab')"));
  // 準備中の札は class="tab-soon" で .tab ではない
  assert.ok(read('layout-ui.js').includes("b.className = 'tab-soon'"));
});
