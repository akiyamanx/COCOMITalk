// COCOMITalk - テスト: グループの自動フォローアップ（約束で止まった子だけ1回・最大2回/ターン・葵/きみは対象外・停止で中止・ツール印）
// v1.0 2026-10-30 - 新規作成（chat-group v1.8）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const doc = { dispatchEvent: () => true, createElement: () => ({ appendChild() {}, set innerHTML(v) {}, style: {} }) };
class CE { constructor(t, i) { this.detail = i && i.detail; } }

/** replies[k] = [1回目, 2回目...]（文字列 or {text, tools}） */
function setup(replies, order) {
  const env = load(['promise-followup.js', 'chat-group.js'], ['PromiseFollowup', 'ChatGroup'],
    { document: doc, CustomEvent: CE, window: {}, requestAnimationFrame: f => f() });
  env.sandbox.MeetingRouter = { analyzeTopic: async () => ({ order, lead: order[0] }) };
  const calls = [], shown = [], SISTERS = {}, SISTER_API = {}, chatHistories = {};
  for (const k of order) {
    SISTERS[k] = { name: k, icon: '*' }; chatHistories[k] = [];
    let n = 0;
    SISTER_API[k] = { prompt: () => 'SYS', module: () => ({ hasApiKey: () => true, sendMessage: async (t, sys, hist, opts) => {
      const r = replies[k][n++]; calls.push({ k, t, hist: hist.slice(), max: opts.maxTokens });
      if (r && r.tools) { opts.toolUsed = true; opts.toolNames = r.tools; }
      if (r && r.abort && env.ChatGroup.abort) env.ChatGroup.abort();
      return typeof r === 'string' ? r : r.text; } }) };
  }
  const ctx = { currentSister: 'koko', chatHistories, addMessage: (role, text, o) => shown.push({ text, k: o.sisterKey, tools: o.toolNames }),
    hideTyping() {}, chatArea: { appendChild() {} }, SISTERS, SISTER_API };
  return { env, ctx, calls, shown, chatHistories };
}

test('約束で止まった子だけ、全員の後に1回フォローアップ。答えの吹き出しにツール印、履歴にも残る', async () => {
  const s = setup({ koko: ['調べてみるね', { text: '答えは42', tools: ['web_search'] }], gpt: ['いいね'], claude: ['賛成'] }, ['koko', 'gpt', 'claude']);
  await s.env.ChatGroup.handleGroupReply('質問', s.ctx);
  assert.deepEqual(s.shown.map(x => x.k), ['koko', 'gpt', 'claude', 'koko']);
  assert.equal(s.shown[3].text, '答えは42');
  assert.deepEqual([...s.shown[3].tools], ['web_search']);
  const fu = s.calls[3];
  assert.equal(fu.t, s.env.PromiseFollowup.HIDDEN_INSTRUCTION);
  assert.equal(fu.max, 2048);
  assert.equal(fu.hist[fu.hist.length - 1].content, '調べてみるね');
  assert.ok(s.chatHistories.koko.some(m => m.content.includes('答えは42')));
  assert.ok(!s.chatHistories.koko.some(m => m.content.includes('システムからの自動指示')));
});

test('通常の返事でもツール印が付く。ツールを使った子はフォローアップしない', async () => {
  const s = setup({ koko: [{ text: '調べてみるね', tools: ['web_search'] }], gpt: ['ok'] }, ['koko', 'gpt']);
  await s.env.ChatGroup.handleGroupReply('質問', s.ctx);
  assert.equal(s.calls.length, 2);
  assert.deepEqual([...s.shown[0].tools], ['web_search']);
});

test('1ターン最大2回・葵/きみも三姉妹と同じく対象（v3.92。中継がtools対応したため）', async () => {
  const p = '確認してみるね';
  const s = setup({ koko: [p, 'a1'], gpt: [p, 'a2'], claude: [p, 'a3'], aoi: [p, 'x'] }, ['aoi', 'koko', 'gpt', 'claude']);
  await s.env.ChatGroup.handleGroupReply('質問', s.ctx);
  assert.deepEqual(s.calls.slice(4).map(c => c.k), ['aoi', 'koko']);
  const k = setup({ kimi: [p, 'k2'], gpt: ['ok'] }, ['kimi', 'gpt']);
  k.ctx.currentSister = 'kimi';
  await k.env.ChatGroup.handleGroupReply('質問', k.ctx);
  assert.deepEqual(k.calls.map(c => c.k), ['kimi', 'gpt', 'kimi']);
});

test('停止を押したらフォローアップしない', async () => {
  const s = setup({ koko: [{ text: '調べてみるね', abort: true }, 'no'], gpt: ['ok'] }, ['koko', 'gpt']);
  await s.env.ChatGroup.handleGroupReply('質問', s.ctx);
  assert.equal(s.calls.filter(c => c.k === 'koko').length, 1);
});
