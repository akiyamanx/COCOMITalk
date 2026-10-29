// COCOMITalk - グループの話しかけ先（帯の札タップ）のテスト: 切替・1回で解除・準備中は選べない・発言順・v1/既存🔄の無傷
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const events = [];
const doc = { dispatchEvent: e => { events.push(e.detail.target); return true; } };
class CE { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }

function env() {
  events.length = 0;
  return load(['characters.js', 'layout2-core.js', 'chat-group.js'], ['CharacterRegistry', 'Layout2Core', 'ChatGroup'],
    { document: doc, CustomEvent: CE, window: {}, requestAnimationFrame: f => f() });
}

/** 偽の返信環境: 呼ばれた順(calls)と、表示されたメッセージ(shown)を記録 */
function fakeCtx(keys = ['koko', 'gpt', 'claude']) {
  const calls = [], shown = [];
  const SISTERS = {}, SISTER_API = {};
  for (const k of keys) {
    SISTERS[k] = { name: k + '名', icon: '*' };
    SISTER_API[k] = { module: () => ({ hasApiKey: () => true, sendMessage: async (t, sys) => { calls.push({ k, lead: sys.includes('あなたが主担当です') }); return k + 'の返事'; } }), prompt: () => '' };
  }
  const chatArea = { appendChild() {}, scrollTop: 0, scrollHeight: 0 };
  return { calls, shown, ctx: { currentSister: 'koko', chatHistories: { koko: [], gpt: [], claude: [] }, addMessage: (r, c, o) => shown.push(o && o.sisterKey), hideTyping() {}, chatArea, SISTERS, SISTER_API } };
}
const withRouter = (sandbox, order, lead) => { sandbox.MeetingRouter = { analyzeTopic: async () => ({ order, lead }) }; };
// chat-group.js内の document.createElement を使う _showGroupTyping のための最小document
const mkdoc = () => ({ dispatchEvent: doc.dispatchEvent, createElement: () => ({ appendChild() {}, set innerHTML(v) {}, style: {} }) });

test('toggleTarget: 選ぶ→同じ子をもう一度で解除→別の子へ付け替え', () => {
  const { Layout2Core: C, CharacterRegistry: CR } = env();
  const L = CR.list();
  let r = plain(C.toggleTarget(null, 'claude', L));
  assert.deepEqual(r, { target: 'claude', rejected: null, row: null });
  assert.equal(C.toggleTarget('claude', 'claude', L).target, null);
  assert.equal(C.toggleTarget('claude', 'koko', L).target, 'koko');
  assert.equal(C.toggleTarget(undefined, 'gpt', L).target, 'gpt');
});

test('toggleTarget: 準備中(葵・キミ)と知らない子は選べず、今の選択は変わらない。準備中はtoast用のrowが付く', () => {
  const { Layout2Core: C, CharacterRegistry: CR } = env();
  const L = CR.list();
  const a = C.toggleTarget('koko', 'aoi', L);
  assert.equal(a.rejected, 'soon'); assert.equal(a.target, 'koko'); assert.equal(a.row.key, 'aoi');
  assert.equal(C.soonMessage(a.row), '🦋 葵ちゃんは準備中だよ。もうすぐ会えるよ');
  const k = C.toggleTarget(null, 'kimi', L);
  assert.equal(k.rejected, 'soon'); assert.equal(k.target, null);
  const u = C.toggleTarget('gpt', 'nobody', L);
  assert.equal(u.rejected, 'unknown'); assert.equal(u.target, 'gpt');
  assert.equal(C.toggleTarget(null, 'koko', null).rejected, 'unknown');   // 名簿が空でも落ちない
});

test('applyTarget: 話しかけ先が先頭＋主担当。他は元の順。入力は壊さない。無効なら元のまま', () => {
  const { Layout2Core: C, CharacterRegistry: CR } = env();
  const L = CR.list(), order = ['koko', 'gpt', 'claude'];
  assert.deepEqual(plain(C.applyTarget(order, 'koko', 'claude', L)), { order: ['claude', 'koko', 'gpt'], lead: 'claude', targeted: true });
  assert.deepEqual(plain(C.applyTarget(['gpt', 'claude', 'koko'], 'gpt', 'koko', L)).order, ['koko', 'gpt', 'claude']);
  assert.deepEqual(plain(C.applyTarget(order, 'koko', 'koko', L)), { order, lead: 'koko', targeted: true });
  assert.deepEqual(order, ['koko', 'gpt', 'claude']);                                   // 元の配列は不変
  for (const t of [null, undefined, '', 'aoi', 'kimi', 'nobody']) {
    assert.deepEqual(plain(C.applyTarget(order, 'gpt', t, L)), { order, lead: 'gpt', targeted: false }, String(t));
  }
  assert.deepEqual(plain(C.applyTarget(['gpt'], 'gpt', 'claude', L)).order, ['claude', 'gpt']);   // 順に居なくても先頭へ入る
  assert.deepEqual(plain(C.applyTarget(null, 'koko', null, null)), { order: [], lead: 'koko', targeted: false });
});

test('targetHint: 「〇〇に話しかける」。準備中・空は null', () => {
  const { Layout2Core: C, CharacterRegistry: CR } = env();
  const L = CR.list();
  assert.equal(C.targetHint('koko', L), 'ここちゃんに話しかける');
  assert.equal(C.targetHint('claude', L), 'クロちゃんに話しかける');
  assert.equal(C.targetHint('aoi', L), null);
  assert.equal(C.targetHint(null, L), null);
});

test('ChatGroup.setTarget/takeTarget: 1回で解除。変わるたびにイベント。同じ値はイベントなし。resetHistoryでも解除', () => {
  const { ChatGroup: G } = env();
  assert.equal(G.getTarget(), null);
  G.setTarget('gpt'); G.setTarget('gpt');
  assert.deepEqual(events, ['gpt']);
  assert.equal(G.takeTarget(), 'gpt');
  assert.equal(G.takeTarget(), null);
  assert.deepEqual(events, ['gpt', null]);
  G.setTarget('claude'); G.resetHistory();
  assert.equal(G.getTarget(), null);
  assert.deepEqual(events, ['gpt', null, 'claude', null]);
});

test('発言順(実際のhandleGroupReply): 話しかけ先が先に答えて主担当。次の1通は元の順に戻る', async () => {
  const e = env();
  e.sandbox.document = mkdoc();
  withRouter(e.sandbox, ['koko', 'gpt', 'claude'], 'koko');
  const f = fakeCtx();
  e.ChatGroup.setTarget('claude');
  await e.ChatGroup.handleGroupReply('こんにちは', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['claude', 'koko', 'gpt']);
  assert.deepEqual(f.calls.map(c => c.lead), [true, false, false]);
  assert.deepEqual(f.shown, ['claude', 'koko', 'gpt']);
  assert.equal(e.ChatGroup.getTarget(), null);                      // 送った時点で解除
  f.calls.length = 0;
  await e.ChatGroup.handleGroupReply('もう一回', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['koko', 'gpt', 'claude']);   // 通常に戻る
  assert.deepEqual(f.calls.map(c => c.lead), [true, false, false]);
});

test('発言順: ルーターが別の順を返しても話しかけ先が先頭。準備中のkeyを無理にsetしても無視される', async () => {
  const e = env();
  e.sandbox.document = mkdoc();
  withRouter(e.sandbox, ['gpt', 'claude', 'koko'], 'gpt');
  const f = fakeCtx();
  e.ChatGroup.setTarget('koko');
  await e.ChatGroup.handleGroupReply('x', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['koko', 'gpt', 'claude']);
  f.calls.length = 0;
  e.ChatGroup.setTarget('aoi');
  await e.ChatGroup.handleGroupReply('x', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['gpt', 'claude', 'koko']);   // 葵は無視＝元の順
  assert.equal(e.ChatGroup.getTarget(), null);
});

test('発言順: ルーターが無い/失敗しても動く。話しかけなし=従来どおり(koko,gpt,claude)', async () => {
  const e = env();
  e.sandbox.document = mkdoc();
  const f = fakeCtx();
  await e.ChatGroup.handleGroupReply('x', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['koko', 'gpt', 'claude']);
  f.calls.length = 0;
  e.ChatGroup.setTarget('gpt');
  await e.ChatGroup.handleGroupReply('x', f.ctx);
  assert.deepEqual(f.calls.map(c => c.k), ['gpt', 'koko', 'claude']);
});

test('配線: 札はbutton+aria-pressed+44px、準備中toast、v1/🔄/発言ハイライトは残る、sw v3.81', () => {
  const ui = read('layout2-ui.js'), css = read('layout2-main.css'), sw = read('sw.js');
  assert.match(ui, /_el\('button', 'lx2-chip'/);
  assert.ok(ui.includes("'aria-pressed'") && ui.includes('data-sister'));
  assert.ok(ui.includes('soonMessage(r.row)') && ui.includes('toggleTarget'));
  assert.ok(ui.includes("_click('btn-continue-talk')") && ui.includes('lx2-speaking'));   // 🔄と発言ハイライト
  assert.match(css, /\.lx2-chip \{[^}]*height: var\(--lx-tap\)/);
  assert.match(css, /\.lx2-chip\[aria-pressed="true"\]/);
  assert.ok(css.includes('.lx2-chip.lx2-speaking'));
  assert.ok(sw.includes("'cocomitalk-v3.81'"));
  assert.ok(read('chat-group.js').includes('takeTarget()'));
  for (const f of ['layout2-core.js', 'layout2-ui.js', 'chat-group.js', 'tests/group-target.test.js']) {
    const s = read(f);
    assert.ok(/最終更新: 葵\(Aoi\), 2026-10-(28|29)/.test(s), f);
    assert.ok(s.split('\n').length <= 500, f);
  }
  // v1では帯が出ない（html.lx2 のときだけ表示）
  assert.match(css, /html\.lx2 \.lx2-strip \{ display: none;/);
});
