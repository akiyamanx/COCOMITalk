// COCOMITalk - 画面レイアウトv2のテスト（純粋関数・配線・守るべきid・v1に戻せること・小さな不具合の修正）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, makeStorage, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const { Layout2Core: C, CharacterRegistry: CR } = load(['characters.js', 'layout2-core.js'], ['Layout2Core', 'CharacterRegistry']);
const html = read('index.html');
const css = read('layout2-main.css') + read('layout2-panels.css');
const ui = read('layout2-ui.js');

test('pickLayout: 既定はv2。URLの?layout=v1が最優先、次に保存値', () => {
  assert.equal(C.pickLayout('', null), 'v2');
  assert.equal(C.pickLayout('', 'v1'), 'v1');
  assert.equal(C.pickLayout('?layout=v1', 'v2'), 'v1');
  assert.equal(C.pickLayout('?a=1&layout=v2', 'v1'), 'v2');
  assert.equal(C.pickLayout('?layout=zzz', 'xx'), 'v2');       // 壊れた値はv2（既定）
  assert.equal(C.pickLayout(undefined, undefined), 'v2');
});

test('charMenu: 使える子が先、準備中(葵・キミ)は後ろで色つき。今の子に印', () => {
  const rows = plain(C.charMenu(CR.list(), 'gpt'));
  assert.deepEqual(rows.map(r => r.key), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  assert.equal(rows.find(r => r.key === 'gpt').current, true);
  assert.equal(rows.filter(r => r.current).length, 1);
  const aoi = rows.find(r => r.key === 'aoi'), kimi = rows.find(r => r.key === 'kimi');
  assert.equal(aoi.soon, true); assert.equal(kimi.soon, true);
  assert.notEqual(aoi.color.dot, kimi.color.dot);               // 青い蝶 / 金の星
  assert.equal(aoi.color.dot, '#3BA7D9'); assert.equal(kimi.color.dot, '#E0A21B');
  assert.equal(kimi.icon, '🌟');                                // キミは🌟（2026-10-29 決定）
  assert.equal(aoi.note, '準備中');
  assert.equal(C.charMenu(CR.list(), null).filter(r => r.current).length, 0);   // グループ中は誰も「今の子」にしない
  assert.deepEqual(plain(C.charMenu(null, 'x')), []);
});

test('groupChips / speakerFromText: 帯は使える3人。表示名(👑つきも)から話している子を当てる', () => {
  assert.deepEqual(plain(C.groupChips(CR.list()).map(c => c.key)), ['koko', 'gpt', 'claude']);
  const l = CR.list();
  assert.equal(C.speakerFromText('ここちゃん', l), 'koko');
  assert.equal(C.speakerFromText('クロちゃん 👑', l), 'claude');
  assert.equal(C.speakerFromText(' お姉ちゃん ', l), 'gpt');
  assert.equal(C.speakerFromText('葵ちゃん', l), null);          // 準備中の子は光らせない
  assert.equal(C.speakerFromText('', l), null);
  assert.equal(C.speakerFromText(null, l), null);
});

test('showSend: 文字があるか送れる時は↑、空なら🎤', () => {
  assert.equal(C.showSend('', true), false);
  assert.equal(C.showSend('   ', true), false);
  assert.equal(C.showSend('こんにちは', true), true);
  assert.equal(C.showSend('', false), true);                    // 画像だけ添付などで送れる時
  assert.equal(C.showSend(undefined, true), false);
});

test('modeClicks: 普段→開発→会議の循環で会議室までの押す回数', () => {
  assert.equal(C.modeClicks('normal', 'meeting'), 2);
  assert.equal(C.modeClicks('dev', 'meeting'), 1);
  assert.equal(C.modeClicks('meeting', 'meeting'), 0);
  assert.equal(C.modeClicks('???', 'meeting'), 0);
  assert.equal(C.modeClicks(undefined, 'meeting'), 0);
});

test('soonMessage / HELP: 準備中の一言、AF・エコの説明が空でない', () => {
  assert.match(C.soonMessage({ icon: '🦋', name: '葵ちゃん' }), /葵ちゃん.*準備中/);
  assert.ok(C.HELP.af.includes('ピント') && C.HELP.res.includes('エコ'));
});

test('配線: index.html に v2 の CSS/JS が v1 の後ろ・1回ずつ。sw.js に全部ある', () => {
  const links = [...html.matchAll(/<link[^>]*href="([^"?]+)/g)].map(m => m[1]);
  const scripts = [...html.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]);
  for (const f of ['layout2-main.css', 'layout2-panels.css']) { assert.equal(links.filter(x => x === f).length, 1, f); assert.ok(links.indexOf(f) > links.indexOf('layout-panels.css'), f); }
  for (const f of ['layout2-core.js', 'layout2-ui.js']) assert.equal(scripts.filter(x => x === f).length, 1, f);
  assert.ok(scripts.indexOf('layout2-core.js') < scripts.indexOf('layout2-ui.js'));
  assert.ok(scripts.indexOf('layout2-ui.js') > scripts.indexOf('layout-ui.js'));      // LayoutUi.toast を使う
  assert.ok(scripts.indexOf('layout2-ui.js') > scripts.indexOf('characters.js'));
  const sw = read('sw.js');
  for (const f of ['layout2-core.js', 'layout2-ui.js', 'layout2-main.css', 'layout2-panels.css']) assert.ok(sw.includes(f), f);
});

test('v1に戻せる: v2のCSSは全部 html.lx2 の中だけ。v2のJSは未選択なら何もしない', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(s => s.trim()).filter(Boolean);
  for (const r of rules) {
    const sel = r.slice(0, r.indexOf('{')).trim();
    if (sel.startsWith('@') || sel.startsWith('from') || /^\d+%|^50%/.test(sel)) continue;   // @media / @keyframes の内側は別に見る
    for (const one of sel.split(',')) assert.ok(/^(html\.lx2\b|@)/.test(one.trim()) || /^\d+%$/.test(one.trim()), `html.lx2 の外に出ている: ${one.trim()}`);
  }
  assert.ok(ui.includes('pickLayout') && ui.includes("classList.add('lx2')"));
  assert.ok(ui.includes("setItem(Layout2Core.STORE_KEY, 'v1')"));     // ☰の「旧レイアウトに戻す」
});

test('既存のid・クラスをv2が消していない（移動だけ）', () => {
  const ids = ['btn-style', 'btn-mode', 'btn-people', 'btn-settings', 'btn-vision-toggle', 'btn-attach', 'btn-search', 'btn-continue-talk', 'btn-send', 'msg-input', 'model-indicator', 'token-cost', 'char-count', 'btn-generate-doc', 'btn-download', 'walk-spend-badge', 'vision-focus-indicator', 'btn-vision-resolution', 'btn-vision-walk', 'btn-open-memory-ui', 'btn-open-memory-import', 'chat-area', 'sec-auth', 'sec-models', 'sec-voice', 'sec-memory', 'sec-history', 'sec-walk', 'sec-tokens'];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), id);
  assert.equal((html.match(/class="tab[ "]/g) || []).length, 3);        // app.js が使う札は残す（隠すだけ）
  assert.ok(!/removeChild|\.remove\(\)/.test(ui.replace(/classList\.remove\([^)]*\)/g, '')));   // v2のJSは要素を消さない
  for (const id of ['lx2-menu-btn', 'lx2-char-btn', 'lx2-more-btn', 'lx2-plus', 'lx2-sheet', 'lx2-drawer', 'lx2-settings-toggle', 'lx2-preview-toggle']) assert.ok(ui.includes(id), id);
  for (const id of ['btn-vision-toggle', 'btn-attach', 'btn-search', 'btn-continue-talk']) assert.ok(new RegExp(`_adopt\\(sheet, '${id}'`).test(ui), `＋シートに ${id}`);
});

test('押す大きさ・幅: v2のCSSは44px基準を使い、チャットの幅を広げ、タブを隠すだけ', () => {
  assert.ok(css.includes('var(--lx-tap)'));
  assert.match(css, /html\.lx2 \.sister-tabs \{ display: none; \}/);
  assert.match(css, /\.message\.user \.msg-avatar \{ display: none; \}/);
  assert.match(css, /\.msg-bubble \{ max-width: 90%/);
  assert.match(css, /prefers-reduced-motion/);
  assert.ok(css.includes('lx2-speaking'));
  assert.ok(css.includes("content: 'ピント'") && css.includes("content: '画質'"));   // AF・エコの見える名前
});

test('不具合(a): フッターの「Gemini 2.5 Flash」直書きをやめ、起動時にモード表示で上書きする', () => {
  assert.ok(!/id="model-indicator"[^>]*>[^<]*2\.5/.test(html), '直書きの古い名前が残っている');
  const app = read('app.js');
  assert.match(app, /ModeSwitcher\.onSisterSwitch\(ChatCore\.getCurrentSister\(\)\)/);
  // 実際の表示: 起動直後(普段・ここちゃん)でも段階のモデル名になる
  const ind = { textContent: '' };
  const env = load(['model-tiers.js', 'characters.js', 'model-migration.js', 'mode-switcher.js'], ['ModeSwitcher', 'ModelTiers'], { localStorage: makeStorage(), document: { getElementById: id => (id === 'model-indicator' ? ind : null) } });
  env.ModeSwitcher.onSisterSwitch('koko');
  assert.ok(ind.textContent.includes(env.ModelTiers.resolve('gemini', 'lite').label), ind.textContent);
  assert.ok(!ind.textContent.includes('2.5'));
});

test('不具合(b): 🔍の橙の輪をv1でも消し、他の道具ボタンと同じ見た目', () => {
  const l1 = read('layout-main.css');
  assert.match(l1, /\.btn-search \{[^}]*border: none/);
  assert.ok(!/\.btn-search \{ border-width: 2px; \}/.test(l1));
});

test('v2の新規ファイルのヘッダと行数上限(500)', () => {
  for (const f of ['layout2-core.js', 'layout2-ui.js', 'layout2-main.css', 'layout2-panels.css', 'tests/layout2.test.js']) {
    const s = read(f);
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-(28|29)/.test(s), f);
    assert.ok(s.split('\n').length <= 500, f);
  }
});
