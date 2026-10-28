// COCOMITalk - モード切替・設定UI・API本文組み立ての結線テスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない。ApiCommonを差し替えて送信本文だけ確認）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, makeStorage } = require('./_load');

const CORE = ['model-tiers.js', 'characters.js', 'model-migration.js'];
const plain = x => JSON.parse(JSON.stringify(x));

/** 最小DOM: getElementById は登録した要素だけ返す */
function makeDoc(elements = {}) {
  return { getElementById: id => elements[id] || null };
}

function modeSwitcher(storageInit = {}, doc = makeDoc()) {
  const storage = makeStorage(storageInit);
  const env = load([...CORE, 'mode-switcher.js'], ['ModeSwitcher', 'ModelTiers', 'CharacterRegistry'], { localStorage: storage, document: doc });
  return { ...env, storage };
}

test('既定: 普段=lite / 開発=standard / 会議=high / お散歩=lite（3人とも）', () => {
  const { ModeSwitcher: M } = modeSwitcher();
  for (const k of ['koko', 'gpt', 'claude']) {
    assert.equal(M.getModelKeyFor('normal', k), 'lite');
    assert.equal(M.getModelKeyFor('dev', k), 'standard');
    assert.equal(M.getModelKeyFor('meeting', k), 'high');
    assert.equal(M.getModelKeyFor('walk', k), 'lite');
  }
  assert.equal(M.getModelKey('gpt'), 'lite'); // 起動時は normal
  M.setMode('meeting');
  assert.equal(M.getModelKey('claude'), 'high');
  assert.deepEqual(plain(M.getSettingModes()), ['normal', 'dev', 'meeting', 'walk']);
  assert.deepEqual(plain(M.getModes()), ['normal', 'dev', 'meeting']); // トーンモード循環にwalkは入らない
});

test('旧キーの保存設定は起動時に段階へ移行され、バックアップが残る', () => {
  const old = JSON.stringify({ normal: { koko: 'flash-25', gpt: 'mini', claude: 'haiku' }, meeting: { koko: 'pro-31', gpt: 'gpt54', claude: 'opus' } });
  const { ModeSwitcher: M, storage } = modeSwitcher({ 'cocomitalk-custom-models': old });
  assert.equal(M.getModelKeyFor('normal', 'koko'), 'lite');
  assert.equal(M.getModelKeyFor('meeting', 'gpt'), 'high');
  assert.equal(M.getModelKeyFor('dev', 'gpt'), 'standard'); // 保存が無いモードは既定
  assert.equal(storage.getItem('cocomitalk-custom-models-v1-backup'), old);
  assert.deepEqual(JSON.parse(storage.getItem('cocomitalk-custom-models')).meeting, { koko: 'high', gpt: 'high', claude: 'high' });
});

test('移行が走らなくても（メモリ上に旧キーがあっても）旧キーを段階として解釈する', () => {
  // setCustomModels は旧キーを段階へ変換して保存する
  const { ModeSwitcher: M, storage } = modeSwitcher();
  M.setCustomModels('dev', { koko: 'flash-3', gpt: 'gpt4o', claude: 'sonnet' });
  assert.deepEqual(JSON.parse(storage.getItem('cocomitalk-custom-models')).dev, { koko: 'standard', gpt: 'standard', claude: 'standard' });
});

test('壊れた保存データでも起動でき、既定が使われる', () => {
  const { ModeSwitcher: M } = modeSwitcher({ 'cocomitalk-custom-models': '{oops' });
  assert.equal(M.getModelKeyFor('meeting', 'koko'), 'high');
});

test('お散歩: ON中は walk 枠、OFFで元のモードへ戻る。walk枠もユーザーが変更できる', () => {
  const { ModeSwitcher: M } = modeSwitcher();
  M.setMode('meeting');
  assert.equal(M.getModelKey('gpt'), 'high');
  M.setWalkMode(true);
  assert.equal(M.isWalkMode(), true);
  assert.equal(M.getModelKey('gpt'), 'lite');
  M.setCustomModels('walk', { gpt: 'standard' });
  assert.equal(M.getModelKey('gpt'), 'standard');
  assert.equal(M.getModelKey('claude'), 'lite');
  M.setWalkMode(false);
  assert.equal(M.getModelKey('gpt'), 'high');
  assert.equal(M.getMode(), 'meeting'); // トーンモードは触っていない
});

test('setCustomModels: 渡した姉妹だけ上書き・他は保持・不正値と不明モードは無視', () => {
  const { ModeSwitcher: M, storage } = modeSwitcher();
  M.setCustomModels('normal', { koko: 'high', gpt: 'standard', claude: 'lite' });
  M.setCustomModels('normal', { gpt: 'high', claude: 'BAD!', nobody: 'lite' });
  assert.deepEqual(JSON.parse(storage.getItem('cocomitalk-custom-models')).normal, { koko: 'high', gpt: 'high', claude: 'lite' });
  M.setCustomModels('weird', { koko: 'high' });
  assert.equal(JSON.parse(storage.getItem('cocomitalk-custom-models')).weird, undefined);
});

test('getAvailableModels: 有効な3人のみ・各3段階（葵/キミは選べない）', () => {
  const { ModeSwitcher: M } = modeSwitcher();
  const a = plain(M.getAvailableModels());
  assert.deepEqual(Object.keys(a), ['koko', 'gpt', 'claude']);
  for (const k of Object.keys(a)) assert.deepEqual(a[k].map(m => m.key), ['lite', 'standard', 'high']);
  assert.equal(a.gpt[0].name, 'GPT-6 Luna');
});

test('インジケーターに段階のモデル名が出る（お散歩中は🚶）', () => {
  const ind = { textContent: '' };
  const { ModeSwitcher: M } = modeSwitcher({}, makeDoc({ 'model-indicator': ind }));
  M.setMode('dev');
  assert.equal(ind.textContent, 'D | Gemini 3.8 Flash');
  M.setWalkMode(true);
  assert.equal(ind.textContent, '🚶 | Gemini 3.5 Flash-Lite');
});

// ---- API 本文 ----
function apiEnv(files, names, response) {
  const sent = [];
  const ApiCommonStub = `const ApiCommon = { hasAuthToken: () => true, callAPI: async (p, b) => { __sent.push({ p, b: JSON.parse(JSON.stringify(b)) }); return __resp; }, callAPIStream: async (p, b) => { __sent.push({ p, b: JSON.parse(JSON.stringify(b)), stream: true }); return __resp; } };`;
  const env = load([...CORE], ['ModelTiers'], { __sent: sent, __resp: response });
  // ApiCommon 差し替え版を同一コンテキストで実行
  const vm = require('node:vm');
  vm.runInContext(ApiCommonStub, env.sandbox);
  const fs = require('node:fs'); const path = require('node:path');
  const src = files.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n;\n');
  const out = vm.runInContext(`${src}\n;({${names.join(',')}})`, env.sandbox);
  return { ...out, sent };
}

function openaiEnv(withTools) {
  const resp = { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  const sent = [];
  const env = load(CORE, ['ModelTiers'], { __sent: sent, __resp: resp });
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  vm.runInContext(`${withTools ? "var ToolRegistry = { getOpenAITools: () => [{ type: 'function' }] };" : ''}
    const ApiCommon = { hasAuthToken: () => true, callAPI: async (p, b) => { __sent.push(JSON.parse(JSON.stringify(b))); return __resp; } };`, env.sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'api-openai.js'), 'utf8');
  const out = vm.runInContext(`${src}\n;({ApiOpenAI})`, env.sandbox);
  return { A: out.ApiOpenAI, sent };
}

test('OpenAI: 各段階のモデルID・reasoning_effort・ロール・トークン指定', async () => {
  const { A, sent } = openaiEnv(false);
  for (const [key, id, eff] of [['lite', 'gpt-6-luna', 'none'], ['standard', 'gpt-6.1-terra', 'low'], ['high', 'gpt-6-astra', 'medium']]) {
    sent.length = 0;
    assert.equal(await A.sendMessage('こんにちは', 'sys', [], { model: key }), 'hi');
    const b = sent[0];
    assert.equal(b.model, id);
    assert.equal(b.reasoning_effort, eff);
    assert.equal(b.messages[0].role, 'developer');
    assert.equal(b.max_completion_tokens, 8192);
    assert.equal(b.max_tokens, undefined);
    assert.equal(b.temperature, undefined);
  }
  sent.length = 0; await A.sendMessage('x', 's', [], { model: 'gpt54' }); assert.equal(sent[0].model, 'gpt-6-astra');
  sent.length = 0; await A.sendMessage('x', 's', [], { model: 'nonsense' }); assert.equal(sent[0].model, 'gpt-6-luna');
  sent.length = 0; await A.sendMessage('x', 's', []); assert.equal(sent[0].model, 'gpt-6-luna');
  assert.equal(A.getModels().mini, 'gpt-6-luna');
});

test('OpenAI: ツールは Luna だけに付く（Terra/Astraは Responses API 必須のため付けない）', async () => {
  const { A, sent } = openaiEnv(true);
  await A.sendMessage('x', 's', [], { model: 'lite' });
  await A.sendMessage('x', 's', [], { model: 'standard' });
  await A.sendMessage('x', 's', [], { model: 'high' });
  assert.equal(Array.isArray(sent[0].tools), true);
  assert.equal(sent[0].tool_choice, 'auto');
  assert.equal(sent[1].tools, undefined);
  assert.equal(sent[2].tools, undefined);
});

test('Claude: 各段階のモデルID・temperature を送らない', async () => {
  const resp = { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' };
  const { ApiClaude: A, sent } = apiEnv(['api-claude.js'], ['ApiClaude'], resp);
  for (const [key, id] of [['lite', 'claude-haiku-5-5'], ['standard', 'claude-sonnet-5-5'], ['high', 'claude-opus-5-5'], ['haiku', 'claude-haiku-5-5'], ['opus', 'claude-opus-5-5'], ['zzz', 'claude-haiku-5-5']]) {
    sent.length = 0;
    await A.sendMessage('こんにちは', 'sys', [], { model: key, skipTools: true });
    assert.equal(sent[0].b.model, id);
    assert.equal('temperature' in sent[0].b, false, `${key} temperature`);
  }
  assert.equal(A.getModels().sonnet, 'claude-sonnet-5-5');
});

test('Gemini: 各段階のモデルID（旧キー・不明キー含む）', async () => {
  const resp = { candidates: [{ content: { parts: [{ text: 'hi' }] } }], usageMetadata: {} };
  const { ApiGemini: A, sent } = apiEnv(['api-gemini.js'], ['ApiGemini'], resp);
  for (const [key, id] of [['lite', 'gemini-3.5-flash-lite'], ['standard', 'gemini-3.8-flash'], ['high', 'gemini-4-argon'], ['flash-25', 'gemini-3.5-flash-lite'], ['pro-31', 'gemini-4-argon'], ['???', 'gemini-3.5-flash-lite']]) {
    sent.length = 0;
    await A.sendMessage('こんにちは', 'sys', [], { model: key });
    assert.equal(sent[0].b.model, id, key);
  }
});

// ---- 設定UI ----
function el() { return { value: '', checked: false, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, style: {}, addEventListener() {}, dataset: {} }; }

/** html中の <select id=...> の selected な option の value */
function selectedOf(html, id) {
  const sel = html.split(`<select id="${id}"`)[1].split('</select>')[0];
  return (sel.match(/<option value="([a-z]+)" selected>/) || [])[1];
}

function settingsEnv(storageInit = {}) {
  const area = el();
  const selects = {};
  const doc = {
    getElementById: id => (id === 'model-settings-area' ? area : (id === 'key-gemini' ? el() : (selects[id] || null))),
  };
  const storage = makeStorage(storageInit);
  const env = load([...CORE, 'mode-switcher.js', 'app-settings.js'], ['ModeSwitcher', 'AppSettings', 'CharacterRegistry'],
    { localStorage: storage, document: doc, window: {}, ApiCommon: undefined });
  return { ...env, area, selects, storage };
}

test('設定UI: 4モード×有効3人=12個の選択欄＋準備中の葵/キミは disabled で選択IDなし', () => {
  const { AppSettings: S, area } = settingsEnv();
  S.loadSettingsToForm();
  const h = area.innerHTML;
  for (const mode of ['normal', 'dev', 'meeting', 'walk']) for (const k of ['koko', 'gpt', 'claude']) assert.ok(h.includes(`id="model-${mode}-${k}"`), `${mode}/${k}`);
  assert.equal((h.match(/class="model-select"/g) || []).length, 14); // 12 + 準備中の2つ
  assert.equal((h.match(/<select[^>]*disabled/g) || []).length, 2);
  assert.ok(!/id="model-[a-z]+-(aoi|kimi)"/.test(h));
  assert.ok(h.includes('葵ちゃん') && h.includes('きみちゃん') && h.includes('準備中'));
  assert.ok(h.includes('🚶 お散歩'));
  // 既定の選択状態: 会議のここちゃん=高頭脳 / お散歩のお姉ちゃん=軽量
  assert.equal(selectedOf(h, 'model-meeting-koko'), 'high');
  assert.equal(selectedOf(h, 'model-walk-gpt'), 'lite');
});

test('設定UI: 保存済みの値（移行後）が選択状態に反映される', () => {
  const old = JSON.stringify({ walk: { gpt: 'high' }, normal: { claude: 'opus' } });
  const { AppSettings: S, area } = settingsEnv({ 'cocomitalk-custom-models': old });
  S.loadSettingsToForm();
  assert.equal(selectedOf(area.innerHTML, 'model-walk-gpt'), 'high');
  assert.equal(selectedOf(area.innerHTML, 'model-normal-claude'), 'high');
  assert.equal(selectedOf(area.innerHTML, 'model-normal-koko'), 'lite');
});

test('設定UI: 保存でドロップダウンの値が段階として保存される（葵/キミは保存しない）', () => {
  const { AppSettings: S, selects, storage, ModeSwitcher: M } = settingsEnv();
  for (const mode of ['normal', 'dev', 'meeting', 'walk']) for (const k of ['koko', 'gpt', 'claude']) selects[`model-${mode}-${k}`] = { value: mode === 'walk' ? 'standard' : 'high' };
  S.saveSettings();
  const saved = JSON.parse(storage.getItem('cocomitalk-custom-models'));
  assert.deepEqual(saved.walk, { koko: 'standard', gpt: 'standard', claude: 'standard' });
  assert.deepEqual(saved.normal, { koko: 'high', gpt: 'high', claude: 'high' });
  assert.equal(M.getModelKeyFor('walk', 'koko'), 'standard');
  assert.ok(!JSON.stringify(saved).includes('aoi') && !JSON.stringify(saved).includes('kimi'));
});

// ---- TokenMonitor 料金 ----
test('TokenMonitor: 新モデルは段階表の価格、旧モデルは従来の表、期間つき価格は日付で変わる', () => {
  const env = load([...CORE, 'token-monitor.js'], ['TokenMonitor'], { indexedDB: {}, document: makeDoc(), localStorage: makeStorage() });
  const T = env.TokenMonitor;
  const cost = (model) => T.calcCostUSD({ byModel: { [model]: { input: 1e6, output: 1e6 } } });
  assert.ok(Math.abs(cost('gpt-6-luna') - 0.60) < 1e-9);
  assert.ok(Math.abs(cost('claude-opus-5-5') - 24) < 1e-9);
  assert.ok(Math.abs(cost('gpt-4o-mini') - 0.75) < 1e-9); // 従来の表（過去ログ用）はそのまま
  assert.ok(Math.abs(cost('totally-unknown') - 0.75) < 1e-9); // 未知は従来どおり（step4で見直し予定）
});
