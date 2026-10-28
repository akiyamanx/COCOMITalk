// COCOMITalk - グループの帯に「準備中」の葵・キミも並べる機能のテスト
//  純粋関数(stripChips) / レジストリを偽物にして enabled:true で普通の札になること / 札のDOM属性(aria-disabled等) /
//  準備中をタップしてもtoastだけで話しかけ先が変わらない / 発言順(chat-group)に準備中が入らない / 配線(CSS・つづき固定)
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

// ---- 最小の偽DOM（jsdomなし）: 帯の札づくりに必要な分だけ ----
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.dataset = {}; this.className = ''; this.listeners = {}; this.props = {}; this.style = { setProperty: (k, v) => { this.props[k] = v; } }; this._text = ''; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...ns) { ns.forEach(n => this.appendChild(n)); }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  replaceChildren(...ns) { this.children = []; ns.forEach(n => this.appendChild(n)); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach(f => f({})); }
  _all() { return this.children.flatMap(c => [c, ...c._all()]); }
  _has(cls) { return this.className.split(/\s+/).includes(cls); }
  querySelectorAll(sel) {
    const m = /^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/.exec(sel.trim().split(/\s+/).pop());
    if (!m) throw new Error('偽DOM未対応のセレクタ: ' + sel);
    return this._all().filter(e => e._has(m[1]) && !(m[2] && e._has(m[2])));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

/** characters.js の本文で、指定の子だけ enabled:false → true にした「偽の登録簿」版のソース（実ファイルは触らない） */
function charactersSrc(enableKeys = []) {
  let s = read('characters.js');
  for (const k of enableKeys) {
    const next = s.replace(new RegExp(`(key: '${k}'[\\s\\S]*?enabled: )false`), '$1true');
    assert.notEqual(next, s, `${k} を有効にできた`);
    s = next;
  }
  return s;
}

/** 帯(#lx2-strip)＋🔄つづきだけを持つ偽ページで layout2-ui を読み込む。enableKeys=偽の登録簿で有効にする子 */
function page(enableKeys = []) {
  const strip = new El('div'); strip.setAttribute('id', 'lx2-strip');
  const col = new El('div'); col.className = 'lx2-strip-scroll';
  const go = new El('button'); go.className = 'lx2-chip-act'; strip.append(col, go);
  const toasts = [];
  const document = {
    createElement: t => new El(t), getElementById: id => (id === 'lx2-strip' ? strip : null),
    querySelectorAll: sel => strip.querySelectorAll(sel), querySelector: () => null,
    addEventListener() {}, dispatchEvent() { return true; }, documentElement: { classList: { contains: () => false, add() {} } },
  };
  const sandbox = { console: { log() {}, warn() {}, error() {} }, requestAnimationFrame: f => f(), document, window: {}, CustomEvent: class { constructor(t, i) { this.detail = i && i.detail; } }, LayoutUi: { toast: m => toasts.push(m) } };
  vm.createContext(sandbox);
  const src = [charactersSrc(enableKeys), read('layout2-core.js'), read('chat-group.js'), read('layout2-ui.js')].join('\n;\n');
  const env = vm.runInContext(`${src}\n;({CharacterRegistry,Layout2Core,ChatGroup,Layout2Ui})`, sandbox);
  const targets = [];
  const origSet = env.ChatGroup.setTarget;
  env.ChatGroup.setTarget = k => { targets.push(k); origSet(k); };
  return { ...env, sandbox, strip, col, go, toasts, targets };
}
const chipsOf = p => p.strip.querySelectorAll('.lx2-chip');
const byKey = (p, k) => chipsOf(p).find(c => c.dataset.sister === k);

// 本物の登録簿から作った「葵を有効にした」偽の登録簿
function withEnabled(keys) {
  const { CharacterRegistry: CR } = load(['characters.js'], ['CharacterRegistry']);
  return CR.list().map(c => (keys.includes(c.key) ? { ...c, enabled: true, status: 'active', statusNote: '' } : c));
}

test('stripChips: 使える3人が先・準備中の葵(青)とキミ(金)が最後。groupChips(使える子だけ)は変わらない', () => {
  const { Layout2Core: C, CharacterRegistry: CR } = load(['characters.js', 'layout2-core.js'], ['Layout2Core', 'CharacterRegistry']);
  const chips = plain(C.stripChips(CR.list()));
  assert.deepEqual(chips.map(c => c.key), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  assert.deepEqual(chips.map(c => c.soon), [false, false, false, true, true]);
  assert.equal(chips[3].label, '葵ちゃんは準備中です');
  assert.equal(chips[4].label, 'きみちゃんは準備中です');
  assert.equal(chips[0].label, 'ここちゃんに話しかける');
  assert.equal(chips[3].note, '準備中'); assert.equal(chips[0].note, '');
  assert.equal(chips[3].color.dot, '#3BA7D9'); assert.equal(chips[4].color.dot, '#E0A21B');
  assert.equal(chips[3].icon, '🦋'); assert.equal(chips[4].icon, '🌟');   // キミは🌟
  assert.deepEqual(plain(C.groupChips(CR.list()).map(c => c.key)), ['koko', 'gpt', 'claude']);
  assert.deepEqual(plain(C.stripChips(null)), []);
  assert.equal(C.soonAria('葵ちゃん'), '葵ちゃんは準備中です');
});

test('stripChips: 偽の登録簿で葵を enabled:true にすると普通の札(準備中なし)、キミは準備中のまま。順は使える子が先', () => {
  const { Layout2Core: C } = load(['characters.js', 'layout2-core.js'], ['Layout2Core']);
  const list = withEnabled(['aoi']);
  const chips = plain(C.stripChips(list));
  assert.deepEqual(chips.map(c => c.key), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  const aoi = chips.find(c => c.key === 'aoi');
  assert.equal(aoi.soon, false); assert.equal(aoi.note, ''); assert.equal(aoi.color, null);
  assert.equal(aoi.label, '葵ちゃんに話しかける');
  assert.equal(chips.find(c => c.key === 'kimi').soon, true);
  // 並びも: キミだけ先に有効 → キミが葵より前
  assert.deepEqual(plain(C.stripChips(withEnabled(['kimi'])).map(c => c.key)), ['koko', 'gpt', 'claude', 'kimi', 'aoi']);
  // 全員有効なら準備中の札は0
  assert.equal(C.stripChips(withEnabled(['aoi', 'kimi'])).filter(c => c.soon).length, 0);
});

test('帯のDOM: 準備中の札=aria-disabled・disabled属性なし・aria-pressedなし・準備中の札(.lx2-pill)・色・focus可。使える札は従来どおり', () => {
  const p = page(); p.Layout2Ui.refreshStrip();
  assert.deepEqual(chipsOf(p).map(c => c.dataset.sister), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  assert.equal(p.strip.children[p.strip.children.length - 1], p.go);                 // 🔄つづきは札の列の外・最後のまま
  assert.equal(p.col.children.length, 5); assert.ok(!p.col.children.includes(p.go));
  const aoi = byKey(p, 'aoi'), kimi = byKey(p, 'kimi'), koko = byKey(p, 'koko');
  for (const c of [aoi, kimi]) {
    assert.equal(c.tagName, 'BUTTON');
    assert.equal(c.getAttribute('aria-disabled'), 'true');
    assert.equal(c.hasAttribute('disabled'), false);                                  // tap→toast / Tabで止まる
    assert.equal(c.hasAttribute('aria-pressed'), false);
    assert.equal(c.getAttribute('type'), 'button');
    assert.ok(c._has('lx2-chip') && c._has('lx2-chip-soon'));
    assert.equal(c.querySelector('.lx2-pill').textContent, '準備中');
  }
  assert.equal(aoi.getAttribute('aria-label'), '葵ちゃんは準備中です');
  assert.equal(kimi.getAttribute('aria-label'), 'きみちゃんは準備中です');
  assert.equal(aoi.props['--lx2-soon-dot'], '#3BA7D9'); assert.equal(kimi.props['--lx2-soon-dot'], '#E0A21B');
  assert.equal(koko.getAttribute('aria-pressed'), 'false');
  assert.equal(koko.hasAttribute('aria-disabled'), false);
  assert.equal(koko.querySelector('.lx2-pill'), null);
  assert.equal(koko.getAttribute('aria-label'), 'ここちゃんに話しかける');
  // 作り直しても札が重複しない
  p.Layout2Ui.refreshStrip(); assert.equal(chipsOf(p).length, 5);
});

test('準備中の札をタップ: toastだけ。話しかけ先は変わらず(未選択でも選択済みでも)、何も送らない。使える札は従来どおり選べる', () => {
  const p = page(); p.Layout2Ui.refreshStrip();
  byKey(p, 'aoi').click();
  assert.deepEqual(p.toasts, ['🦋 葵ちゃんは準備中だよ。もうすぐ会えるよ']);
  assert.equal(p.ChatGroup.getTarget(), null); assert.deepEqual(p.targets, []);
  byKey(p, 'kimi').click();
  assert.equal(p.toasts.length, 2); assert.match(p.toasts[1], /きみちゃんは準備中/);
  assert.equal(p.ChatGroup.getTarget(), null);
  byKey(p, 'gpt').click();                                                            // 使える子は選べる
  assert.equal(p.ChatGroup.getTarget(), 'gpt'); assert.deepEqual(p.targets, ['gpt']);
  byKey(p, 'aoi').click();                                                            // 選択中に準備中を押しても変わらない
  assert.equal(p.ChatGroup.getTarget(), 'gpt'); assert.deepEqual(p.targets, ['gpt']);
  assert.equal(p.toasts.length, 3);
  p.Layout2Ui.refreshStrip();                                                         // 作り直しても選択中の見た目は保たれる
  assert.equal(byKey(p, 'gpt').getAttribute('aria-pressed'), 'true');
  assert.equal(byKey(p, 'aoi').hasAttribute('aria-pressed'), false);
});

test('偽の登録簿で葵が enabled:true → 札は自動で普通の札(準備中の札・aria-disabledなし)になり、タップで選べる。キミは準備中のまま', () => {
  const p = page(['aoi']);   // characters.js の aoi を enabled:true にした偽の登録簿
  p.Layout2Ui.refreshStrip();
  const aoi = byKey(p, 'aoi'), kimi = byKey(p, 'kimi');
  assert.equal(aoi._has('lx2-chip-soon'), false);
  assert.equal(aoi.hasAttribute('aria-disabled'), false);
  assert.equal(aoi.querySelector('.lx2-pill'), null);
  assert.equal(aoi.getAttribute('aria-pressed'), 'false');
  assert.equal(aoi.getAttribute('aria-label'), '葵ちゃんに話しかける');
  assert.equal(kimi.getAttribute('aria-disabled'), 'true');
  assert.deepEqual(chipsOf(p).map(c => c.dataset.sister), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  aoi.click();
  assert.equal(p.ChatGroup.getTarget(), 'aoi'); assert.deepEqual(p.toasts, []);
  p.Layout2Ui.refreshStrip();
  assert.equal(byKey(p, 'aoi').getAttribute('aria-pressed'), 'true');
});

test('発言順: 準備中を話しかけ先にしても/ルーターが準備中を返しても、グループの返信順・呼び出しに葵・キミは入らない', async () => {
  const p = page();
  const calls = [];
  const SISTERS = {}, SISTER_API = {};
  for (const k of ['koko', 'gpt', 'claude']) {
    SISTERS[k] = { name: k, icon: '*' };
    SISTER_API[k] = { module: () => ({ hasApiKey: () => true, sendMessage: async () => { calls.push(k); return k; } }), prompt: () => '' };
  }
  const ctx = { currentSister: 'koko', chatHistories: { koko: [], gpt: [], claude: [] }, addMessage() {}, hideTyping() {}, chatArea: { appendChild() {}, scrollTop: 0, scrollHeight: 0 }, SISTERS, SISTER_API };
  p.sandbox.MeetingRouter = { analyzeTopic: async () => ({ order: ['gpt', 'claude', 'koko'], lead: 'gpt' }) };
  p.Layout2Ui.refreshStrip();
  byKey(p, 'aoi').click(); byKey(p, 'kimi').click();                                   // 札を押しても
  p.ChatGroup.setTarget('aoi');                                                       // 無理にsetしても
  p.sandbox.document = { ...p.sandbox.document, createElement: () => ({ appendChild() {}, set innerHTML(v) {}, style: {} }) };   // 以降は返信の表示用の最小document
  await p.ChatGroup.handleGroupReply('こんにちは', ctx);
  assert.deepEqual(calls, ['gpt', 'claude', 'koko']);
  assert.ok(!read('chat-group.js').includes('stripChips'));                                             // 帯の札の一覧は発言順の元にならない
});

test('配線: CSS(淡く・準備中の札を流用・44px)、札の列は横スクロール＋🔄つづきは列の外(右端固定)、sw v3.75、行数と最終更新', () => {
  const css = read('layout2-main.css'), ui = read('layout2-ui.js'), sw = read('sw.js');
  assert.match(css, /\.lx2-chip-soon \{[^}]*--lx2-soon-bg[^}]*--lx2-soon-dot/);
  assert.match(css, /\.lx2-chip \{[^}]*height: var\(--lx-tap\)/);                      // 準備中の札も.lx2-chipなので44px
  assert.ok(!/\.lx2-chip-soon \{[^}]*height:/.test(css));                              // 44pxを下回らせない
  assert.match(css, /\.lx2-chip-soon \.lx2-pill \{/);                                  // ドロップダウンの.lx2-pillを流用
  assert.match(css, /\.lx2-strip-scroll \{[^}]*min-width: 0;[^}]*overflow-x: auto/);   // 札の列だけスクロール
  assert.match(css, /\.lx2-chip-act \{[^}]*flex: 0 0 auto/);                         // つづきは縮まない・列の外
  assert.ok(!/\.lx2-strip \{[^}]*overflow-x/.test(css));
  assert.ok(ui.includes("'lx2-strip-scroll'"));
  assert.ok(ui.includes("'aria-disabled'") && ui.includes('Layout2Core.stripChips') && !ui.includes("attrs.disabled"));
  assert.ok(sw.includes("'cocomitalk-v3.75'"));
  for (const f of ['layout2-core.js', 'layout2-ui.js', 'layout2-main.css', 'tests/strip-soon.test.js']) {
    const s = read(f);
    assert.ok(/最終更新: 葵\(Aoi\), 2026-10-(28|29)/.test(s), f);
    assert.ok(s.split('\n').length <= 500, f);
  }
});
