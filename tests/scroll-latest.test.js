// COCOMITalk - テスト: 「最新の会話へ」ボタン（scroll-latest.js）とツール使用の印（toolLabel）
// このファイルは偽のDOMで、上にスクロールすると出る・下の近くでは隠れる・タップで一番下へ・新着で点、を確かめる
// v1.0 2026-10-30 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

function fakeDoc() {
  const mk = (tag) => {
    const el = { tagName: tag, dataset: {}, style: {}, hidden: false, attrs: {}, listeners: {}, children: [], _cls: new Set(),
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      appendChild(c) { this.children.push(c); return c; }, getClientRects: () => [1], offsetParent: {},
      fire(t) { (this.listeners[t] || []).forEach(f => f()); },
      getBoundingClientRect: () => ({ top: 700, height: 80 }) };
    el.classList = { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c) };
    return el;
  };
  const body = mk('body');
  const doc = { body, head: mk('head'), createElement: mk, getElementById: () => null, defaultView: { innerHeight: 780, addEventListener() {} } };
  return doc;
}

const { ScrollLatest } = load(['scroll-latest.js'], ['ScrollLatest']);
const { PromiseFollowup } = load(['promise-followup.js'], ['PromiseFollowup']);

test('上にスクロールすると出る・下120px以内では隠れる・入力欄の上に置く・aria-label', () => {
  const doc = fakeDoc();
  const area = doc.createElement('main');
  Object.assign(area, { scrollHeight: 3000, clientHeight: 600, scrollTop: 2400 });
  let scrolled = null; area.scrollTo = (o) => { scrolled = o; area.scrollTop = 2400; area.fire('scroll'); };
  const r = ScrollLatest.attach(area, doc.createElement('footer'), doc);
  assert.equal(r.btn.hidden, true, '一番下では隠れる');
  assert.equal(r.btn.attrs['aria-label'], '最新の会話へ');
  area.scrollTop = 1000; area.fire('scroll');
  assert.equal(r.btn.hidden, false, '上を見ている時は出る');
  assert.equal(r.btn.style.bottom, '92px', '入力欄(top=700)の12px上');
  area.scrollTop = 2300; area.fire('scroll');
  assert.equal(r.btn.hidden, true, '下から100pxなら隠れる');
  area.scrollTop = 500; area.fire('scroll');
  r.btn.fire('click');
  assert.equal(scrolled.top, 3000);
  assert.equal(r.btn.hidden, true);
  assert.equal(ScrollLatest.attach(area, null, doc), null, '二重に付けない');
});

test('CSS: 44px・--app-primary・動きを減らす設定に対応／index.html・sw.jsに登録', () => {
  const s = fs.readFileSync(path.join(ROOT, 'scroll-latest.js'), 'utf8');
  assert.ok(s.includes('width:44px;height:44px') && s.includes('var(--app-primary') && s.includes('prefers-reduced-motion'));
  assert.ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('<script src="scroll-latest.js"></script>'));
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.ok(sw.includes("'./scroll-latest.js'") && sw.includes("'cocomitalk-v3.96'"));
});

test('ツールの印: 名前→ラベル、無ければ空', () => {
  assert.equal(PromiseFollowup.toolLabel(['web_search', 'web_search']), '🔎検索したよ');
  assert.equal(PromiseFollowup.toolLabel(['get_datetime', 'calculate']), '🕒時計を見たよ 🧮計算したよ');
  assert.equal(PromiseFollowup.toolLabel([]), '');
});

test('隠し指示: 知識が要る質問は web_search を必ず呼ぶ・結果にない数字は書かない', () => {
  assert.ok(/必ず web_search/.test(PromiseFollowup.HIDDEN_INSTRUCTION));
  assert.ok(/結果に書いていない数字/.test(PromiseFollowup.HIDDEN_INSTRUCTION));
});
