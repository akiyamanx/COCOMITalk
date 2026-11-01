// COCOMITalk - OpenAI Responses API経路（Terra/Astra のツール利用）のテスト
// このファイルは node --test tests/ で実行する。通信は全てモック（実API・実中継は呼ばない＝実物での動作は未検証）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { load, makeStorage } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
const CC_OK = { choices: [{ message: { content: 'cc-hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
const msgItem = (text, annotations = []) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] });
const resp = (output, extra = {}) => ({ id: 'resp_1', status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20 }, ...extra });

/** 環境: ModelTiers + スタブ(ToolRegistry/ApiCommon/TokenMonitor) + 本番の api-openai-responses.js / api-openai.js */
function env({ mode, handler } = {}) {
  const sent = [], rec = [], execs = [];
  const storage = makeStorage(mode ? { 'cocomitalk-openai-responses': mode } : {});
  const e = load(['model-tiers.js'], ['ModelTiers'], { localStorage: storage, __sent: sent, __rec: rec, __execs: execs, __handler: handler || (async () => resp([msgItem('こんにちは')])), __cc: CC_OK });
  vm.runInContext(`
    const ToolRegistry = {
      getOpenAITools: () => ['web_search', 'get_datetime', 'calculate'].map(n => ({ type: 'function', function: { name: n, description: n + 'desc', parameters: { type: 'object', properties: {} } } })),
      hasTool: n => ['web_search', 'get_datetime', 'calculate'].includes(n),
      execute: async (n, a) => { __execs.push([n, a]); return 'RESULT:' + n; },
    };
    const TokenMonitor = { record: (m, i, o) => __rec.push([m, i, o]) };
    const ApiCommon = { hasAuthToken: () => true, callAPI: async (ep, b) => {
      __sent.push({ ep, b: JSON.parse(JSON.stringify(b)) });
      return ep === 'openai' ? __cc : __handler(ep, b, __sent.filter(s => s.ep !== 'openai').length);
    } };`, e.sandbox);
  const run = f => vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', f), 'utf8')}\n;({X:${f.includes('responses') ? 'ApiOpenAIResponses' : 'ApiOpenAI'}})`, e.sandbox).X;
  const R = run('api-openai-responses.js');
  const A = run('api-openai.js');
  return { R, A, sent, rec, execs, storage, T: e.ModelTiers };
}

test('スイッチ: 既定オフ・不正値はオフ・保存できる', () => {
  const { R, storage } = env();
  assert.equal(R.getMode(), 'off');
  assert.equal(R.setMode('hosted'), 'hosted');
  assert.equal(storage.getItem('cocomitalk-openai-responses'), 'hosted');
  assert.equal(R.setMode('zzz'), 'off');
  storage.setItem('cocomitalk-openai-responses', 'weird');
  assert.equal(R.getMode(), 'off');
});

test('isActiveFor: Terra/Astraだけ・オンのときだけ・失敗後5分は使わない', () => {
  const { R, T } = env({ mode: 'function' });
  const lite = T.resolve('openai', 'lite'), std = T.resolve('openai', 'standard'), high = T.resolve('openai', 'high');
  assert.equal(R.isActiveFor(lite), false);        // Lunaは従来のChat Completions（ツール可）
  assert.equal(R.isActiveFor(std), true);
  assert.equal(R.isActiveFor(high), true);
  assert.equal(R.isActiveFor(null), false);
  R.markFailed(1000);
  assert.equal(R.isActiveFor(std, 1000 + 4 * 60 * 1000), false);
  assert.equal(R.isActiveFor(std, 1000 + 5 * 60 * 1000 + 1), true);
  R.markFailed(); R.resetFailure();
  assert.equal(R.isActiveFor(std), true);
  assert.equal(env({ mode: 'off' }).R.isActiveFor(std), false);
});

test('buildBody(function): 平らな関数ツール・developerロール・reasoning・temperatureなし', () => {
  const { R, T } = env({ mode: 'function' });
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: 'これ何' }] }];
  const b = plain(R.buildBody(T.resolve('openai', 'high'), msgs, {}, 'function'));
  assert.equal(b.model, 'gpt-6-astra');
  assert.deepEqual(b.reasoning, { effort: 'medium' });
  assert.equal(b.max_output_tokens, 8192);
  assert.equal(b.tool_choice, 'auto');
  assert.deepEqual(b.tools.map(t => t.name), ['web_search', 'get_datetime', 'calculate']);
  assert.ok(b.tools.every(t => t.type === 'function' && !t.function && t.parameters));
  assert.equal(b.input[0].role, 'developer');
  assert.deepEqual(b.input[3].content, [{ type: 'input_image', image_url: 'data:image/png;base64,AAA' }, { type: 'input_text', text: 'これ何' }]);
  for (const k of ['temperature', 'messages', 'max_tokens', 'max_completion_tokens', 'reasoning_effort']) assert.equal(k in b, false, k);
  assert.equal(R.buildBody(T.resolve('openai', 'standard'), msgs, { maxTokens: 500 }, 'function').max_output_tokens, 500);
});

test('buildBody(hosted): 内蔵web_search＋関数ツールからweb_searchを除く・effort none→low', () => {
  const { R, T } = env({ mode: 'hosted' });
  const std = plain(R.buildBody(T.resolve('openai', 'lite'), [{ role: 'user', content: 'x' }], {}, 'hosted')); // Luna(none)
  assert.deepEqual(std.tools[0], { type: 'web_search' });
  assert.deepEqual(std.tools.slice(1).map(t => t.name), ['get_datetime', 'calculate']);
  assert.deepEqual(std.reasoning, { effort: 'low' });    // noneは検索品質が落ちうるのでlowへ
  const fn = plain(R.buildBody(T.resolve('openai', 'lite'), [{ role: 'user', content: 'x' }], {}, 'function'));
  assert.deepEqual(fn.reasoning, { effort: 'none' });    // 関数モードは段階の設定どおり
});

test('extract: 本文・url_citation・検索回数・関数呼び出し・打ち切り', () => {
  const { R } = env();
  const d = resp([
    { type: 'reasoning', id: 'rs_1', summary: [] },
    { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    msgItem('今日は晴れ', [{ type: 'url_citation', url: 'https://example.com/w', title: '天気' }, { type: 'file_citation' }]),
    { type: 'function_call', call_id: 'c1', name: 'calculate', arguments: '{}' },
  ], { status: 'incomplete' });
  const r = plain(R.extract(d));
  assert.equal(r.text, '今日は晴れ');
  assert.deepEqual(r.citations, [{ url: 'https://example.com/w', title: '天気' }]);
  assert.equal(r.searches, 1);
  assert.equal(r.calls.length, 1);
  assert.equal(r.incomplete, true);
  assert.deepEqual(plain(R.extract(null)), { text: '', calls: [], citations: [], searches: 0, incomplete: false });
});

test('run: ツール不要なら1回で完了・usage記録・出典を保持', async () => {
  const { R, T, sent, rec } = env({ mode: 'hosted', handler: async () => resp([{ type: 'web_search_call' }, msgItem('答え', [{ type: 'url_citation', url: 'https://e.com', title: 't' }])]) });
  const text = await R.run({ tier: T.resolve('openai', 'high'), messages: [{ role: 'user', content: 'q' }] });
  assert.equal(text, '答え');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ep, 'openai-responses');
  assert.deepEqual(plain(rec), [['gpt-6-astra', 100, 20]]);
  const last = plain(R.getLast());
  assert.deepEqual(last.citations, [{ url: 'https://e.com', title: 't' }]);
  assert.equal(last.searches, 1);
  assert.equal(last.mode, 'hosted');
});

test('run: 関数ツール呼び出し → 実行 → function_call_outputで返す（出力項目ごと・ツール定義なし）', async () => {
  const first = resp([
    { type: 'reasoning', id: 'rs_1', summary: [] },
    { type: 'function_call', id: 'fc_1', call_id: 'call_A', name: 'get_datetime', arguments: '{}' },
    { type: 'function_call', id: 'fc_2', call_id: 'call_B', name: 'calculate', arguments: '{"expression":"1+1"}' },
  ]);
  const { R, T, sent, execs, rec } = env({ mode: 'function', handler: async (ep, b, n) => (n === 1 ? first : resp([msgItem('2時です')])) });
  const text = await R.run({ tier: T.resolve('openai', 'standard'), messages: [{ role: 'user', content: '今何時' }] });
  assert.equal(text, '2時です');
  assert.deepEqual(plain(execs), [['get_datetime', {}], ['calculate', { expression: '1+1' }]]);
  assert.equal(sent.length, 2);
  const b2 = sent[1].b;
  assert.equal(b2.tools, undefined);
  assert.equal(b2.tool_choice, undefined);
  assert.equal(b2.model, 'gpt-6.1-terra');
  assert.deepEqual(plain(b2.input.slice(-2)), [
    { type: 'function_call_output', call_id: 'call_A', output: 'RESULT:get_datetime' },
    { type: 'function_call_output', call_id: 'call_B', output: 'RESULT:calculate' },
  ]);
  assert.equal(b2.input.filter(i => i.type === 'function_call').length, 2);
  assert.equal(b2.input.filter(i => i.type === 'reasoning').length, 1);
  assert.equal(rec.length, 2);
});

test('run: 未知ツールは実行せず結果を返す／5個目以降は実行しない', async () => {
  const calls = ['x', 'get_datetime', 'get_datetime', 'get_datetime', 'get_datetime'].map((name, i) => ({ type: 'function_call', call_id: 'c' + i, name, arguments: 'not json' }));
  const { R, T, sent, execs } = env({ mode: 'function', handler: async (ep, b, n) => (n === 1 ? resp(calls) : resp([msgItem('ok')])) });
  assert.equal(await R.run({ tier: T.resolve('openai', 'high'), messages: [{ role: 'user', content: 'q' }] }), 'ok');
  assert.equal(execs.length, 3);                        // 未知(x)と5個目は実行しない
  const outs = sent[1].b.input.filter(i => i.type === 'function_call_output');
  assert.equal(outs.length, 5);                         // ただし全てのcall_idに出力は返す（返さないとAPIが400）
  assert.match(outs[0].output, /実行しませんでした/);
});

test('run: エラー応答・空応答・打ち切りは例外（呼び出し側がフォールバック）', async () => {
  const mk = h => env({ mode: 'function', handler: async () => h });
  const go = e => e.R.run({ tier: e.T.resolve('openai', 'high'), messages: [{ role: 'user', content: 'q' }] });
  await assert.rejects(go(mk({ error: { message: 'boom' } })), /boom/);
  await assert.rejects(go(mk(resp([]))), /空の応答/);
  await assert.rejects(go(mk(resp([], { status: 'incomplete' }))), /途中で打ち切/);
});

test('sendMessage: スイッチON＋Terra/Astra → /openai-responses、Lunaと段階不明は従来の/openai', async () => {
  const { A, sent } = env({ mode: 'function' });
  assert.equal(await A.sendMessage('こんにちは', 'sys', [], { model: 'standard' }), 'こんにちは');
  assert.equal(sent.map(s => s.ep).join(), 'openai-responses');
  assert.equal(sent[0].b.input.at(-1).content, 'こんにちは');
  sent.length = 0;
  assert.equal(await A.sendMessage('x', 's', [], { model: 'lite' }), 'cc-hi');
  assert.equal(sent[0].ep, 'openai');
  assert.equal(Array.isArray(sent[0].b.tools), true);   // Lunaは従来どおりChat Completionsでツール可
});

test('sendMessage: スイッチOFFなら Responses を一切呼ばない・Terra/Astraはツール無し（従来どおり）', async () => {
  const { A, sent } = env({ mode: 'off' });
  assert.equal(await A.sendMessage('x', 's', [], { model: 'high' }), 'cc-hi');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ep, 'openai');
  assert.equal(sent[0].b.tools, undefined);
});

test('sendMessage: Responses失敗（中継未対応の404等）→ Chat Completionsへ自動フォールバックし、5分は再試行しない', async () => {
  const { A, R, sent } = env({ mode: 'hosted', handler: async () => { throw new Error('openai-responses: HTTP 404'); } });
  assert.equal(await A.sendMessage('x', 's', [], { model: 'high' }), 'cc-hi');
  assert.deepEqual(sent.map(s => s.ep), ['openai-responses', 'openai']);
  assert.equal(sent[1].b.tools, undefined);
  assert.equal(sent[1].b.model, 'gpt-6-astra');
  sent.length = 0;
  assert.equal(await A.sendMessage('y', 's', [], { model: 'high' }), 'cc-hi');
  assert.deepEqual(sent.map(s => s.ep), ['openai']);    // クールダウン中
  R.resetFailure();                                      // 設定を保存し直すと再度試す
  sent.length = 0;
  await A.sendMessage('z', 's', [], { model: 'high' });
  assert.equal(sent[0].ep, 'openai-responses');
});

test('sendMessage: ユーザーの中断(AbortError)はフォールバックせずそのまま投げる', async () => {
  const { A, sent } = env({ mode: 'function', handler: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  await assert.rejects(A.sendMessage('x', 's', [], { model: 'standard' }), e => e.name === 'AbortError');
  assert.deepEqual(sent.map(s => s.ep), ['openai-responses']);
});

test('設定UI: ツール切替の選択欄が出て、保存でスイッチに反映される', () => {
  const mkEl = () => ({ value: '', innerHTML: '', style: {}, checked: false, addEventListener() {}, classList: { add() {}, remove() {} } });
  const area = mkEl(); const selects = {};
  const doc = { getElementById: id => (id === 'model-settings-area' ? area : (id === 'key-gemini' ? mkEl() : (selects[id] || null))) };
  const storage = makeStorage();
  const e = load(['model-tiers.js', 'characters.js', 'model-migration.js', 'api-openai-responses.js', 'mode-switcher.js', 'app-settings.js'],
    ['AppSettings', 'ApiOpenAIResponses'], { localStorage: storage, document: doc, window: {}, ApiCommon: undefined });
  e.AppSettings.loadSettingsToForm();   // モデル設定UI（選択欄）を組み立てる
  assert.match(area.innerHTML, /id="openai-responses-mode"/);
  assert.match(area.innerHTML, /<option value="off" selected>/);
  selects['openai-responses-mode'] = { value: 'hosted' };
  e.AppSettings.saveSettings();
  assert.equal(storage.getItem('cocomitalk-openai-responses'), 'hosted');
  assert.equal(e.ApiOpenAIResponses.getMode(), 'hosted');
});
