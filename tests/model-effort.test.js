// COCOMITalk - 思考の強さ（model-effort.js / effort-settings-ui.js と各API本文）のテスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない。送信本文だけ確認）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { load, makeStorage } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
const KEY = 'cocomitalk-effort-prefs';
const CORE = ['model-tiers.js', 'model-effort.js', 'characters.js'];

function env(init = {}) {
  const storage = makeStorage(init);
  const e = load(CORE, ['ModelTiers', 'ModelEffort', 'CharacterRegistry'], { localStorage: storage });
  return { ...e, storage };
}

// ---- 対応表（公式docs 2026-10-28 の転記と一致） ----
test('OpenAI: モデルごとに使える強さ（Astra/Solは none 不可、Luna/Terraは none 可）', () => {
  const { ModelEffort: E } = env();
  const all = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  const noNone = ['low', 'medium', 'high', 'xhigh', 'max'];
  assert.deepEqual(plain(E.levelsFor('openai', 'gpt-6-luna')), all);
  assert.deepEqual(plain(E.levelsFor('openai', 'gpt-6.1-terra')), all);
  assert.deepEqual(plain(E.levelsFor('openai', 'gpt-6.1-sol')), noNone);
  assert.deepEqual(plain(E.levelsFor('openai', 'gpt-6-astra')), noNone);
  for (const id of ['gpt-6.1-sol', 'gpt-6-astra']) {
    assert.equal(E.isValid('openai', id, 'none'), false, `${id} none`);
    assert.equal(E.isValid('openai', id, 'minimal'), false, `${id} minimal`);
  }
});

test('Claude 5.5系・Gemini・xAI・Kimi の表（xAI/Kimiは表のみ）', () => {
  const { ModelEffort: E } = env();
  for (const id of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) assert.deepEqual(plain(E.levelsFor('anthropic', id)), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(plain(E.levelsFor('gemini', 'gemini-3.5-flash-lite')), ['minimal', 'low', 'medium', 'high']);
  assert.equal(E.isValid('gemini', 'gemini-3.8-flash', 'minimal'), false);
  assert.deepEqual(plain(E.levelsFor('moonshot', 'kimi-k3.1-pro')), ['low', 'high', 'max']);
  assert.equal(E.isValid('xai', 'grok-4.7', 'none'), false);
  assert.deepEqual(plain(E.levelsFor('openai', 'unknown-model')), []);
  assert.deepEqual(plain(E.levelsFor('constructor', '__proto__')), []);
});

// ---- 保存と検証 ----
test('setPref: 有効な値だけ保存・無効はfalseで保存なし・空で既定に戻る', () => {
  const { ModelEffort: E, storage } = env();
  assert.equal(E.setPref('openai', 'high', 'gpt-6-astra', 'none'), false);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(E.setPref('openai', 'high', 'gpt-6-astra', 'xhigh'), true);
  assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), 'xhigh');
  assert.equal(E.setPref('openai', 'high', 'gpt-6-astra', 'bogus'), false);
  assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), 'xhigh'); // 失敗しても前の値は残る
  assert.equal(E.setPref('openai', 'high', 'gpt-6-astra', ''), true);
  assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), null);
  assert.equal(E.setPref('openai', 'nope', 'gpt-6-astra', 'low'), false);   // 不明な段階
  assert.equal(E.setPref('openai', 'high', 'gpt-9', 'low'), false);         // 不明なモデル
});

test('壊れた保存・別バージョン・モデル入替・無効値は無視して既定へ（例外を出さない）', () => {
  for (const bad of ['{oops', 'null', '[]', '{"v":2,"prefs":{}}', '{"v":1,"prefs":null}', '"x"']) {
    const { ModelEffort: E } = env({ [KEY]: bad });
    assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), null, bad);
    assert.equal(E.setPref('openai', 'high', 'gpt-6-astra', 'low'), true, bad); // 壊れていても上書き保存できる
  }
  // 保存時のモデルIDと今のIDが違う（モデル入替）→無視
  const stale = JSON.stringify({ v: 1, prefs: { openai: { high: { id: 'gpt-6.1-sol', effort: 'max' } } } });
  const { ModelEffort: E, ModelTiers: T } = env({ [KEY]: stale });
  assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), null);
  assert.equal(T.resolve('openai', 'high').effort, 'medium');
  // 保存値がそのモデルで無効（手で書き換えた等）→無視
  const inval = JSON.stringify({ v: 1, prefs: { openai: { high: { id: 'gpt-6-astra', effort: 'none' } } } });
  assert.equal(env({ [KEY]: inval }).ModelTiers.resolve('openai', 'high').params.reasoning_effort, 'medium');
});

test('保存は専用キーだけ。既存キーに触らず、clearAll で消える', () => {
  const { ModelEffort: E, storage } = env({ 'cocomitalk-custom-models': '{"a":1}', 'cocomitalk-settings': '{"b":2}' });
  E.setPref('anthropic', 'high', 'claude-opus-5-5', 'max');
  assert.equal(storage.getItem('cocomitalk-custom-models'), '{"a":1}');
  assert.equal(storage.getItem('cocomitalk-settings'), '{"b":2}');
  E.clearAll();
  assert.equal(storage.getItem(KEY), null);
});

test('保存先が使えなくても（localStorage例外）落ちない', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const e = load(CORE, ['ModelTiers', 'ModelEffort'], { localStorage: bad });
  assert.equal(e.ModelEffort.getPref('openai', 'high', 'gpt-6-astra'), null);
  assert.equal(e.ModelEffort.setPref('openai', 'high', 'gpt-6-astra', 'low'), false);
  assert.equal(e.ModelTiers.resolve('openai', 'high').id, 'gpt-6-astra');
  e.ModelEffort.clearAll();
});

// ---- resolve への反映 ----
test('段階の既定: Luna=none / Terra=low / Astra=medium。Astraに none は絶対に出ない', () => {
  const { ModelTiers: T, ModelEffort: E } = env();
  assert.deepEqual(['lite', 'standard', 'high'].map(t => T.resolve('openai', t).params.reasoning_effort), ['none', 'low', 'medium']);
  // どの保存値でも、Astraに送る強さは none にならない
  for (const lv of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', '', null, 'x']) {
    E.setPref('openai', 'high', 'gpt-6-astra', lv);
    const r = T.resolve('openai', 'high');
    assert.notEqual(r.params.reasoning_effort, 'none', String(lv));
    assert.ok(E.isValid('openai', 'gpt-6-astra', r.params.reasoning_effort), String(lv));
  }
});

test('保存した強さが resolve に反映され、他の段階・他社には影響しない', () => {
  const { ModelTiers: T, ModelEffort: E } = env();
  E.setPref('openai', 'high', 'gpt-6-astra', 'max');
  const a = T.resolve('openai', 'high');
  assert.equal(a.effort, 'max'); assert.equal(a.params.reasoning_effort, 'max'); assert.equal(a.effortSource, 'pref');
  assert.equal(a.chatTools, false);
  assert.equal(T.resolve('openai', 'standard').params.reasoning_effort, 'low');
  assert.equal(T.resolve('anthropic', 'high').effort, null);
  assert.equal(T.resolve('anthropic', 'high').params.reasoning_effort, undefined);
});

test('Luna: Chat Completionsのツールは強さ none のときだけ', () => {
  const { ModelTiers: T, ModelEffort: E } = env();
  assert.equal(T.resolve('openai', 'lite').chatTools, true);
  E.setPref('openai', 'lite', 'gpt-6-luna', 'low');
  assert.equal(T.resolve('openai', 'lite').chatTools, false);
  E.setPref('openai', 'lite', 'gpt-6-luna', 'none');
  assert.equal(T.resolve('openai', 'lite').chatTools, true);
});

test('model-effort.js が無くても従来どおり動く（古いキャッシュ対策）', () => {
  const e = load(['model-tiers.js'], ['ModelTiers'], { localStorage: makeStorage() });
  const r = e.ModelTiers.resolve('openai', 'high');
  assert.equal(r.id, 'gpt-6-astra');
  assert.equal(r.params.reasoning_effort, 'medium');
});

test('maxTokensFor: xhigh/maxだけ出力枠を広げる（Claude 16000 / 他 32000）', () => {
  const { ModelEffort: E } = env();
  assert.equal(E.maxTokensFor('openai', 'high', 8192), 8192);
  assert.equal(E.maxTokensFor('openai', null, 8192), 8192);
  assert.equal(E.maxTokensFor('openai', 'xhigh', 8192), 32000);
  assert.equal(E.maxTokensFor('anthropic', 'max', 4096), 16000);
  assert.equal(E.maxTokensFor('openai', 'max', 50000), 50000); // 呼び出し側が大きく指定していればそのまま
});

// ---- 価格 ----
test('Astraの価格は $10/$50（入力/出力 100万トークン）で、Solも価格表にある', () => {
  const { ModelTiers: T } = env();
  const ap = T.getPricing('gpt-6-astra', '2026-10-28');
  assert.equal(ap.input, 10); assert.equal(ap.output, 50);
  assert.equal(T.getPricing('gpt-6.1-sol', '2026-10-28').output, 10);
});

// ---- API本文 ----
function apiEnv(file, name, response, extra = '') {
  const sent = [], rec = [];
  const e = load(CORE, ['ModelTiers', 'ModelEffort'], { __sent: sent, __rec: rec, __resp: response, localStorage: makeStorage() });
  vm.runInContext(`const ApiCommon = { hasAuthToken: () => true, callAPI: async (p, b) => { __sent.push({ p, b: JSON.parse(JSON.stringify(b)) }); return __resp; }, callAPIStream: async (p, b) => { __sent.push({ p, b: JSON.parse(JSON.stringify(b)) }); return __resp; } };
    const TokenMonitor = { record: (...a) => __rec.push(a) }; ${extra}`, e.sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const out = vm.runInContext(`${src}\n;({${name}})`, e.sandbox);
  return { A: out[name], sent, rec, E: e.ModelEffort, T: e.ModelTiers };
}

test('Claude: 強さを選んだ時だけ output_config.effort を送る。xhigh/maxは出力枠16000', async () => {
  const resp = { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  const { A, sent, E } = apiEnv('api-claude.js', 'ApiClaude', resp);
  await A.sendMessage('こんにちは', 'sys', [], { model: 'high', skipTools: true });
  assert.equal('output_config' in sent[0].b, false);        // 未選択は送らない（API既定）
  assert.equal(sent[0].b.max_tokens, 4096);
  E.setPref('anthropic', 'high', 'claude-opus-5-5', 'xhigh');
  sent.length = 0; await A.sendMessage('x', 's', [], { model: 'high', skipTools: true });
  assert.deepEqual(plain(sent[0].b.output_config), { effort: 'xhigh' });
  assert.equal(sent[0].b.max_tokens, 16000);
  assert.equal(sent[0].b.model, 'claude-opus-5-5');
  assert.equal('temperature' in sent[0].b, false);
  sent.length = 0; await A.sendMessage('x', 's', [], { model: 'lite', skipTools: true });   // 別の段階は影響なし
  assert.equal('output_config' in sent[0].b, false);
});

test('Gemini: 強さを選んだ時だけ thinkingLevel を送り、思考トークンも出力として記録', async () => {
  const resp = { candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } };
  const { A, sent, rec, E } = apiEnv('api-gemini.js', 'ApiGemini', resp);
  await A.sendMessage('こんにちは', 'sys', [], { model: 'standard' });
  assert.equal('thinkingConfig' in sent[0].b.generationConfig, false);
  E.setPref('gemini', 'standard', 'gemini-3.8-flash', 'high');
  sent.length = 0; rec.length = 0;
  await A.sendMessage('x', 's', [], { model: 'standard' });
  assert.deepEqual(plain(sent[0].b.generationConfig.thinkingConfig), { thinkingLevel: 'high' });
  assert.deepEqual(plain(rec), [['gemini-3.8-flash', 10, 12]]);
  assert.equal(E.setPref('gemini', 'standard', 'gemini-3.8-flash', 'minimal'), false); // 3.8 は minimal 不可
});

test('OpenAI(Chat): 強さが reasoning_effort に入り、xhigh/maxは max_completion_tokens 32000', async () => {
  const resp = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  const { A, sent, E } = apiEnv('api-openai.js', 'ApiOpenAI', resp);
  await A.sendMessage('x', 's', [], { model: 'high' });
  assert.equal(sent[0].b.reasoning_effort, 'medium');
  assert.equal(sent[0].b.max_completion_tokens, 8192);
  E.setPref('openai', 'high', 'gpt-6-astra', 'max');
  sent.length = 0; await A.sendMessage('x', 's', [], { model: 'high' });
  assert.equal(sent[0].b.reasoning_effort, 'max');
  assert.equal(sent[0].b.max_completion_tokens, 32000);
  assert.equal('temperature' in sent[0].b, false);
});

test('OpenAI(Responses): 強さが reasoning.effort に入り、max_output_tokens も広がる', () => {
  const { A: R, E, T } = apiEnv('api-openai-responses.js', 'ApiOpenAIResponses', {});
  const msgs = [{ role: 'user', content: 'x' }];
  let b = plain(R.buildBody(T.resolve('openai', 'high'), msgs, {}, 'function'));
  assert.deepEqual(b.reasoning, { effort: 'medium' }); assert.equal(b.max_output_tokens, 8192);
  E.setPref('openai', 'high', 'gpt-6-astra', 'xhigh');
  b = plain(R.buildBody(T.resolve('openai', 'high'), msgs, {}, 'function'));
  assert.deepEqual(b.reasoning, { effort: 'xhigh' }); assert.equal(b.max_output_tokens, 32000);
  b = plain(R.buildBody(T.resolve('openai', 'high'), msgs, { maxTokens: 500 }, 'function'));
  assert.equal(b.max_output_tokens, 500);
});

// ---- 設定画面（effort-settings-ui.js） ----
function uiEnv() {
  const storage = makeStorage();
  const e = load([...CORE, 'effort-settings-ui.js'], ['ModelTiers', 'ModelEffort', 'CharacterRegistry', 'EffortSettingsUI'], { localStorage: storage });
  return { ...e, storage };
}
const selectHtml = (h, id) => h.split(`<select id="${id}"`)[1].split('</select>')[0];

test('設定画面: 有効な3人×3段階の選択欄。選択肢はそのモデルで有効な強さだけ', () => {
  const { EffortSettingsUI: U } = uiEnv();
  const h = U.html();
  assert.equal((h.match(/class="model-select effort-select"/g) || []).length, 9);
  assert.ok(!/id="effort-(xai|moonshot)-/.test(h));          // 準備中のキャラは出さない
  const astra = selectHtml(h, 'effort-openai-high');
  assert.ok(!astra.includes('value="none"') && !astra.includes('value="minimal"'));
  for (const v of ['low', 'medium', 'high', 'xhigh', 'max']) assert.ok(astra.includes(`value="${v}"`), v);
  assert.ok(astra.includes('段階の既定（中）'));
  assert.ok(selectHtml(h, 'effort-openai-lite').includes('value="none"'));                       // Lunaはnone可
  assert.ok(selectHtml(h, 'effort-gemini-standard').includes('モデルの既定（中）'));
  assert.ok(!selectHtml(h, 'effort-gemini-standard').includes('value="minimal"'));
  assert.ok(selectHtml(h, 'effort-anthropic-high').includes('モデルの既定（中）'));
});

test('設定画面: 保存値が選択状態に出る／保存で反映／既定に戻す／無効値は保存されない', () => {
  const { EffortSettingsUI: U, ModelEffort: E } = uiEnv();
  const sel = (provider, tier, value) => ({ dataset: { provider, tier }, value });
  const root = list => ({ querySelectorAll: () => list });
  U.save(root([sel('openai', 'high', 'xhigh'), sel('anthropic', 'high', 'max'), sel('gemini', 'standard', 'low'), sel('openai', 'standard', '')]));
  assert.equal(E.getPref('openai', 'high', 'gpt-6-astra'), 'xhigh');
  assert.equal(E.getPref('anthropic', 'high', 'claude-opus-5-5'), 'max');
  assert.equal(E.getPref('gemini', 'standard', 'gemini-3.8-flash'), 'low');
  assert.ok(selectHtml(U.html(), 'effort-openai-high').includes('<option value="xhigh" selected>'));
  U.save(root([sel('openai', 'high', 'none')]));              // 無効値（Astraにnone）は拒否＝保存しない（既存値は消える）
  assert.notEqual(E.getPref('openai', 'high', 'gpt-6-astra'), 'none');
  U.reset();
  assert.equal(E.getPref('anthropic', 'high', 'claude-opus-5-5'), null);
  assert.ok(selectHtml(U.html(), 'effort-openai-high').includes('<option value="" selected>'));
});
