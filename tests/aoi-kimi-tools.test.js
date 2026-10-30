// COCOMITalk - 葵/きみのツール（検索・日時・計算）と発言順の回帰テスト（v3.91）
// このファイルは api-compat-core.js のツール1回ループと、グループ/会議の発言順に葵/きみが入ることを確かめる（中継はモック）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, makeStorage } = require('./_load');
const plain = x => JSON.parse(JSON.stringify(x));

/** replies を順に返す中継モック。関数なら例外を投げられる */
function env(replies, extra = {}) {
  const calls = [], ran = [];
  const ApiCommon = { hasAuthToken: () => true, callAPI: async (endpoint, body) => {
    calls.push({ endpoint, body: plain(body) });
    const r = replies[calls.length - 1];
    if (typeof r === 'function') return r();
    return r;
  } };
  const SearchCaller = { execute: async q => { ran.push(q); return `検索結果:${q}`; } };
  const e = load(['model-tiers.js', 'model-effort.js', 'tool-registry.js', 'api-compat-core.js', 'api-xai.js', 'api-kimi.js'],
    ['ApiXai', 'ApiKimi', 'ToolRegistry'], { window: {}, localStorage: makeStorage(), ApiCommon, SearchCaller, ...extra });
  return { ...e, calls, ran };
}
const ok = text => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const call = (name, args) => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function',
  function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] });

test('ツール: 三姉妹と同じツール定義(OpenAI形式・8個以内)を tool_choice:auto で送る。会議(skipTools)では送らない', async () => {
  const e = env([ok('a'), ok('b')]);
  await e.ApiXai.sendMessage('q', 's', [], {});
  const b = e.calls[0].body;
  assert.deepEqual(b.tools.map(t => t.function.name), plain(e.ToolRegistry.getToolNames()));
  assert.ok(b.tools.length <= 8 && b.tools.every(t => t.type === 'function'));
  assert.equal(b.tool_choice, 'auto');
  await e.ApiKimi.sendMessage('q', 's', [], { skipTools: true });
  assert.ok(!('tools' in e.calls[1].body) && !('tool_choice' in e.calls[1].body));
});

test('ツール: tool_calls → 実行 → tool役で結果を返し(tool_choice:none) 最終回答。opts に toolUsed/toolNames が立つ', async () => {
  const e = env([call('web_search', { query: '今日の天気' }), ok('晴れだよ')]);
  const opts = {};
  assert.equal(await e.ApiKimi.sendMessage('天気は？', 's', [], opts), '晴れだよ');
  assert.deepEqual(e.ran, ['今日の天気']);
  assert.equal(opts.toolUsed, true); assert.deepEqual(plain(opts.toolNames), ['web_search']);
  const b2 = e.calls[1].body;
  assert.equal(e.calls[1].endpoint, 'kimi'); assert.equal(b2.tool_choice, 'none');
  const [asst, tool] = b2.messages.slice(-2);
  assert.equal(asst.role, 'assistant'); assert.equal(asst.tool_calls[0].id, 'c1');
  assert.equal(tool.role, 'tool'); assert.equal(tool.tool_call_id, 'c1'); assert.match(tool.content, /検索結果:今日の天気/);
  assert.equal(e.calls.length, 2);
});

test('ツール: 2回目が失敗したら、結果を本文に入れてツール無しで1回だけ聞き直す。計算ツールも動く', async () => {
  const e = env([call('calculate', { expression: '2+3' }), () => { throw new Error('API中継エラー（kimi）: HTTP 400'); }, ok('5だよ')]);
  assert.equal(await e.ApiKimi.sendMessage('2+3は？', 's', [], {}), '5だよ');
  const b3 = e.calls[2].body;
  assert.ok(!('tools' in b3) && !('tool_choice' in b3));
  assert.ok(b3.messages.every(m => m.role !== 'tool'));
  assert.match(b3.messages.at(-1).content, /calculate の結果[\s\S]*5[\s\S]*2\+3は？/);
});

test('ツール: 知らないツール名は実行しない（本文が空なら従来どおりエラー）', async () => {
  const e = env([call('rm_rf', {})]);
  await assert.rejects(() => e.ApiXai.sendMessage('q', 's', [], {}), /葵ちゃん.*空/);
  assert.equal(e.calls.length, 1);
});

test('発言順: 有効な葵/きみは三姉妹の順の後ろに付く（主担当は変えない）。準備中なら三姉妹だけ', async () => {
  const on = load(['characters.js', 'meeting-router.js'], ['MeetingRouter'], { realRegistry: true });
  const r = await on.MeetingRouter.analyzeTopic('バグ修正のコードとAPIのエラー');
  assert.deepEqual(plain(r.order), ['claude', 'koko', 'gpt', 'aoi', 'kimi']); assert.equal(r.lead, 'claude');
  const off = load(['characters.js', 'meeting-router.js'], ['MeetingRouter']);
  assert.deepEqual(plain((await off.MeetingRouter.analyzeTopic('バグ修正のコード')).order), ['claude', 'koko', 'gpt']);
});
