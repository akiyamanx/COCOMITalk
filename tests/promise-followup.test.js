// COCOMITalk - テスト: 約束だけで止まった返事の自動フォローアップ（promise-followup.js）と Gemini thoughtSignature 保持
// このファイルは判定の正誤・最大1回・隠し指示が履歴に残らないこと・2回目にpartsがそのまま返ることを確かめる
// v1.0 2026-10-30 - 新規作成
// v1.1 2026-10-30 - v3.85 の検索指示テストを追加
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, makeStorage } = require('./_load');

const { PromiseFollowup: PF } = load(['promise-followup.js'], ['PromiseFollowup']);

test('判定: 約束で終わる返事は true', () => {
  for (const t of ['調べてみるから待っててね！', 'ちょっと確認するね〜😊', '200年前かぁ…調べてみるね！🔍',
    '2027年の曜日、確認してみるね', '今から検索するね！', '少し待っててね♪']) assert.equal(PF.isPromiseOnly(t), true, t);
});

test('判定: 答え・完了形・途中の言葉は false', () => {
  for (const t of ['今日は10月29日(木)だよ！', '調べたよ！答えは水曜日だね。', '確認してね、アキちゃん！ところで元気？',
    '待っててくれてありがとう！答えは42だよ。', '', null, 'それは調べてみる価値があるテーマだね。私はこう思うよ、まず歴史的に見ると…（長い説明）']) {
    assert.equal(PF.isPromiseOnly(t), false, String(t));
  }
});

test('ツールを使った返事・フォローアップ済みならしない', () => {
  assert.equal(PF.shouldFollowUp('調べてみるね！', { toolUsed: true }), false);
  assert.equal(PF.shouldFollowUp('調べてみるね！', { followedUp: true }), false);
  assert.equal(PF.shouldFollowUp('調べてみるね！', {}), true);
});

test('最大1回: 2回目の返事がまた約束でも追加の問い合わせはしない／隠し指示は履歴に入らない', async () => {
  const calls = [];
  const api = { async sendMessage(msg, sys, hist, opts) { calls.push({ msg, hist: hist.slice(), opts }); return 'また調べてみるね！'; } };
  const history = [{ role: 'user', content: '200年前の10月は暑かった？' }, { role: 'assistant', content: '調べてみるね！' }];
  const before = JSON.stringify(history);
  const state = {};
  const r1 = await PF.run({ apiModule: api, systemPrompt: 'S', history, firstReply: '調べてみるね！', model: 'm', state });
  assert.equal(r1, 'また調べてみるね！');
  const r2 = await PF.run({ apiModule: api, systemPrompt: 'S', history, firstReply: r1, model: 'm', state });
  assert.equal(r2, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msg, PF.HIDDEN_INSTRUCTION);
  assert.ok(calls[0].opts.maxTokens <= 2048);
  assert.equal(JSON.stringify(history), before, '実履歴は変更されない');
  assert.ok(!calls[0].hist.some(h => h.content === PF.HIDDEN_INSTRUCTION));
});

test('Gemini: 2回目の送信に functionCall の part（thoughtSignature含む）がそのまま入る', async () => {
  const sent = [];
  const fcParts = [{ functionCall: { name: 'get_datetime', args: {} }, thoughtSignature: 'SIG123' }];
  const ApiCommon = {
    hasAuthToken: () => true,
    async callAPI(_p, body) {
      sent.push(JSON.parse(JSON.stringify(body)));
      return sent.length === 1 ? { candidates: [{ content: { parts: fcParts } }] } : { candidates: [{ content: { parts: [{ text: '木曜日だよ' }] } }] };
    },
  };
  const ToolRegistry = { getGeminiTools: () => ({ functionDeclarations: [] }), hasTool: () => true, async execute() { return 'JST'; } };
  const ModelTiers = { resolve: () => ({ id: 'gemini-x' }) };
  const { ApiGemini } = load(['api-gemini.js'], ['ApiGemini'], { ApiCommon, ToolRegistry, ModelTiers, localStorage: makeStorage() });
  const opts = {};
  const text = await ApiGemini.sendMessage('今日は何曜日？', 'S', [], opts);
  assert.equal(text, '木曜日だよ');
  assert.equal(opts.toolUsed, true);
  const modelTurn = sent[1].contents.find(c => c.role === 'model');
  assert.equal(modelTurn.parts[0].thoughtSignature, 'SIG123');
  assert.ok(!('tools' in sent[1]));
});

test('v3.85: 共通プロンプトと隠し指示に「知識に無い・最近/今の出来事は推測せず web_search」、雑談は検索しない', () => {
  const L = '自分の知識に無いこと・最近や今の出来事・数字・昔の事実は、推測や憶測で答えずに web_search で調べてから答える。調べても分からなければ『わからない』と言う。';
  const env = require('fs').readFileSync(require('path').join(__dirname, '..', 'prompts/common-env.js'), 'utf8');
  assert.ok(env.includes(L) && env.includes('雑談や気持ちの話では検索しない。'));
  assert.ok(PF.HIDDEN_INSTRUCTION.includes(L));
});

test('v3.85: web_search の結果にだけ答え方の指示が付く／共通プロンプトにも同じ文', async () => {
  const N = '検索したときは、分かった中身（名前・数字・日付など）を短く入れて答える。ふんわりした感想だけで終わらない。';
  const SearchCaller = { execute: async () => '【検索結果】RTX 5090 発売 2025年1月' };
  const { ToolRegistry } = load(['tool-registry.js'], ['ToolRegistry'], { SearchCaller, Intl, Date });
  const r = await ToolRegistry.execute('web_search', { query: 'GPU 最新' });
  assert.ok(r.startsWith('【検索結果】RTX 5090') && r.includes(N) && r.includes('2〜4文'));
  assert.ok(!(await ToolRegistry.execute('calculate', { expression: '1+1' })).includes(N));
  const env = require('fs').readFileSync(require('path').join(__dirname, '..', 'prompts/common-env.js'), 'utf8');
  assert.ok(env.includes(N));
});
