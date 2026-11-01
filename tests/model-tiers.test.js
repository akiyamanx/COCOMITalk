// COCOMITalk - model-tiers / characters / model-migration の単体テスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, makeStorage } = require('./_load');

const FILES = ['model-tiers.js', 'characters.js', 'model-migration.js'];
const NAMES = ['ModelTiers', 'CharacterRegistry', 'ModelMigration'];
const plain = x => JSON.parse(JSON.stringify(x)); // vmの別レルム対策
function env(extra) { return load(FILES, NAMES, extra); }

test('全プロバイダ×3段階にID・価格・ラベルがある', () => {
  const { ModelTiers: T } = env();
  for (const p of ['openai', 'anthropic', 'gemini', 'xai', 'moonshot']) {
    for (const t of ['lite', 'standard', 'high']) {
      const r = T.resolve(p, t);
      assert.ok(r.id && r.label, `${p}/${t}`);
      assert.equal(r.tier, t);
      assert.ok(T.getPricing(r.id, '2026-10-28').input > 0, `${p}/${t} price`);
    }
  }
});

test('検証済みモデル表と一致する（仕様書§2）', () => {
  const { ModelTiers: T } = env();
  const ids = p => ['lite', 'standard', 'high'].map(t => T.resolve(p, t).id);
  assert.deepEqual(ids('openai'), ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6-astra']);
  assert.deepEqual(ids('anthropic'), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  assert.deepEqual(ids('gemini'), ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-argon']);
  // xAI: 最上位は grok-4.7（4.6は同額の旧世代なので使わない）。標準/高頭脳は同モデルの思考量違い
  assert.deepEqual(ids('xai'), ['grok-4.3', 'grok-4.7', 'grok-4.7']);
  assert.deepEqual(['lite', 'standard', 'high'].map(t => T.resolve('xai', t).params.reasoning_effort), ['none', 'low', 'high']);
  // Kimi: 廃止予定のK2.6は使わず、K3.1 Pro の low/high/max（mediumは存在しない）
  assert.deepEqual(ids('moonshot'), ['kimi-k3.1-pro', 'kimi-k3.1-pro', 'kimi-k3.1-pro']);
  assert.deepEqual(['lite', 'standard', 'high'].map(t => T.resolve('moonshot', t).params.reasoning_effort), ['low', 'high', 'max']);
  assert.ok(!JSON.stringify(plain(T.TIERS)).includes('kimi-k2'));
  assert.ok(!JSON.stringify(plain(T.TIERS)).includes('grok-4.6'));
});

test('旧キーは全て最も近い段階に変換される', () => {
  const { ModelTiers: T } = env();
  const expect = {
    gemini: { 'flash-lite': 'lite', flash: 'lite', 'flash-25': 'lite', 'flash-3': 'standard', pro: 'high', 'pro-31': 'high' },
    openai: { mini: 'lite', gpt4o: 'standard', gpt54: 'high' },
    anthropic: { haiku: 'lite', sonnet: 'standard', opus: 'high' },
  };
  for (const [p, m] of Object.entries(expect)) {
    for (const [k, tier] of Object.entries(m)) assert.equal(T.normalizeKey(p, k), tier, `${p}/${k}`);
  }
});

test('不明なキー・型は例外にならず既定段階（lite）へ', () => {
  const { ModelTiers: T } = env();
  for (const bad of ['???', '', null, undefined, 42, {}, '__proto__', 'constructor']) {
    assert.equal(T.resolve('openai', bad).tier, 'lite');
  }
  assert.equal(T.resolve('openai', 'zzz', 'high').tier, 'high');
  assert.throws(() => T.resolve('nobody', 'lite'));
});

test('idMap は旧getModels互換（旧キー→その段階のID）', () => {
  const { ModelTiers: T } = env();
  const m = T.idMap('anthropic');
  assert.equal(m.haiku, 'claude-haiku-5-5');
  assert.equal(m.opus, 'claude-opus-5-5');
  assert.equal(m.lite, 'claude-haiku-5-5');
});

test('期間つき価格が日付で切り替わる（Gemini 3.8 Flash / 4 Argon）', () => {
  const { ModelTiers: T } = env();
  assert.equal(T.getPricing('gemini-3.8-flash', '2026-12-31').input, 0.75);
  assert.equal(T.getPricing('gemini-3.8-flash', '2027-01-01').input, 1.5);
  assert.equal(T.getPricing('gemini-3.8-flash', '2027-01-01').output, 7.5);
  assert.equal(T.getPricing('gemini-4-argon', '2026-11-30').input, 2);
  assert.equal(T.getPricing('gemini-4-argon', '2026-12-01').input, 4);
});

test('getPricing: 未知IDはnull、姉妹キーが付く', () => {
  const { ModelTiers: T } = env();
  assert.equal(T.getPricing('gpt-4o-mini'), null);
  assert.equal(T.getPricing('claude-opus-5-5', '2026-10-28').sister, 'claude');
  assert.equal(T.getPricing('gpt-6-luna', '2026-10-28').sister, 'gpt');
  assert.equal(T.getPricing('gemini-3.5-flash-lite', '2026-10-28').sister, 'koko');
});

test('Claude/Kimi は temperature を送らない、OpenAI Terra/Astra は Chat tools 無し', () => {
  const { ModelTiers: T } = env();
  for (const t of ['lite', 'standard', 'high']) {
    assert.equal(T.resolve('anthropic', t).sendTemperature, false);
    assert.equal(T.resolve('moonshot', t).sendTemperature, false);
  }
  assert.equal(T.resolve('openai', 'lite').chatTools, true);
  assert.equal(T.resolve('openai', 'standard').chatTools, false);
  assert.equal(T.resolve('openai', 'high').chatTools, false);
});

test('isReasoningOpenAI', () => {
  const { ModelTiers: T } = env();
  assert.ok(T.isReasoningOpenAI('gpt-6-luna'));
  assert.ok(T.isReasoningOpenAI('gpt-5.4'));
  assert.ok(!T.isReasoningOpenAI('gpt-4o-mini'));
  assert.ok(!T.isReasoningOpenAI(undefined));
});

test('廃止予定の警告（Kimi K2.6）', () => {
  const { ModelTiers: T } = env();
  // 現在の段階表に廃止予定のモデルは無い（K2.6を外した）。仕組みは一時的に印を付けて確認する
  assert.equal(T.deprecationNote('moonshot', 'lite', new Date('2026-11-01T00:00:00')), null);
  T.TIERS.moonshot.lite.deprecatedAfter = '2026-12-31';
  try {
    assert.match(T.deprecationNote('moonshot', 'lite', new Date('2026-11-01T00:00:00')), /2026-12-31/);
    assert.equal(T.deprecationNote('moonshot', 'lite', new Date('2026-05-01T00:00:00')), null);
  } finally { delete T.TIERS.moonshot.lite.deprecatedAfter; }
  assert.equal(T.deprecationNote('openai', 'lite', new Date('2026-12-30T00:00:00')), null);
});

test('resolve の結果を書き換えても表は汚れない', () => {
  const { ModelTiers: T } = env();
  const r = T.resolve('openai', 'lite');
  r.params.reasoning_effort = 'CHANGED';
  assert.equal(T.resolve('openai', 'lite').params.reasoning_effort, 'none');
});

test('登録簿: 5人・aoi/kimiは準備中・声はGeminiのみ決定済み', () => {
  const { CharacterRegistry: C } = env();
  assert.deepEqual(plain(C.keys()), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  assert.deepEqual(plain(C.enabledList().map(c => c.key)), ['koko', 'gpt', 'claude']);
  assert.equal(C.isEnabled('aoi'), false);
  assert.equal(C.isEnabled('kimi'), false);
  assert.equal(C.get('aoi').provider, 'xai');
  assert.equal(C.get('kimi').provider, 'moonshot');
  assert.equal(C.get('gpt').provider, 'openai');
  assert.equal(C.get('koko').provider, 'gemini');
  assert.equal(C.get('claude').provider, 'anthropic');
  for (const c of C.list()) {
    assert.deepEqual(plain([c.voice.voicevox, c.voice.openai]), [null, null], `${c.key} voicevox/openai欄は未使用`);
    assert.equal(typeof c.voice.gemini, 'string', `${c.key} gemini声あり`);
    assert.equal(c.defaultTiers.walk, 'lite');
  }
  assert.equal(C.get('nobody'), null);
  assert.equal(C.displayName('koko'), '🌸 ここちゃん');
});

test('登録簿: 取得結果を書き換えても本体は変わらない', () => {
  const { CharacterRegistry: C } = env();
  const c = C.get('koko'); c.enabled = false; c.defaultTiers.walk = 'high';
  assert.equal(C.isEnabled('koko'), true);
  assert.equal(C.defaultTier('koko', 'walk'), 'lite');
});

test('登録簿の全キャラの既定段階はモードごとに有効な段階', () => {
  const { CharacterRegistry: C, ModelTiers: T } = env();
  for (const c of C.list()) for (const m of ['normal', 'dev', 'meeting', 'walk']) {
    assert.ok(T.isTier(c.defaultTiers[m]), `${c.key}/${m}`);
    assert.ok(T.TIERS[c.provider], `${c.key} provider`);
  }
});

// ---- 移行 ----
const OLD = { normal: { koko: 'flash-25', gpt: 'mini', claude: 'haiku' }, dev: { koko: 'pro-31', gpt: 'gpt54', claude: 'opus' }, meeting: { koko: 'flash-3', gpt: 'gpt4o', claude: 'sonnet' } };
const KEY = 'cocomitalk-custom-models';

test('移行: 旧キーが段階に変換され、元データはバックアップに残る', () => {
  const { ModelMigration: M } = env();
  const orig = JSON.stringify(OLD);
  const st = makeStorage({ [KEY]: orig, 'cocomitalk-settings': '{"a":1}' });
  const r = M.run(st);
  assert.equal(r.status, 'migrated');
  assert.deepEqual(JSON.parse(st.getItem(KEY)), {
    normal: { koko: 'lite', gpt: 'lite', claude: 'lite' },
    dev: { koko: 'high', gpt: 'high', claude: 'high' },
    meeting: { koko: 'standard', gpt: 'standard', claude: 'standard' },
  });
  assert.equal(st.getItem(M.BACKUP_KEY), orig);
  assert.equal(st.getItem('cocomitalk-settings'), '{"a":1}'); // 他の設定は無傷
  assert.equal(st.getItem(M.SCHEMA_KEY), '2');
});

test('移行: 2回実行しても同じ結果で、バックアップは最初の原本のまま', () => {
  const { ModelMigration: M } = env();
  const orig = JSON.stringify(OLD);
  const st = makeStorage({ [KEY]: orig });
  M.run(st);
  const after1 = st.getItem(KEY);
  const r2 = M.run(st);
  assert.equal(r2.status, 'unchanged');
  assert.equal(st.getItem(KEY), after1);
  assert.equal(st.getItem(M.BACKUP_KEY), orig);
});

test('移行: すでに段階名ならバックアップも作らない', () => {
  const { ModelMigration: M } = env();
  const st = makeStorage({ [KEY]: JSON.stringify({ normal: { koko: 'high' } }) });
  assert.equal(M.run(st).status, 'unchanged');
  assert.equal(st.getItem(M.BACKUP_KEY), null);
});

test('移行: 保存なしなら何もしない', () => {
  const { ModelMigration: M } = env();
  const st = makeStorage();
  assert.equal(M.run(st).status, 'none');
  assert.equal(st.getItem(KEY), null);
});

test('移行: 壊れたJSONは退避して例外にならない', () => {
  const { ModelMigration: M } = env();
  const st = makeStorage({ [KEY]: '{broken' });
  assert.equal(M.run(st).status, 'corrupt');
  assert.equal(st.getItem(KEY), null);
  assert.equal(st.getItem(M.BACKUP_KEY), '{broken');
});

test('移行: 未知の値・型違いは落とし、他の値は残す（元は退避）', () => {
  const { ModelMigration: M } = env();
  const orig = JSON.stringify({ normal: { koko: 'flash-3', gpt: 'zzz', nobody: 'lite' }, dev: 'oops', walk: { claude: 'high' } });
  const st = makeStorage({ [KEY]: orig });
  const r = M.run(st);
  assert.equal(r.status, 'migrated');
  assert.deepEqual(JSON.parse(st.getItem(KEY)), { normal: { koko: 'standard' }, walk: { claude: 'high' } });
  assert.equal(r.dropped.length, 3);
  assert.equal(st.getItem(M.BACKUP_KEY), orig);
});

test('移行: JSONが配列・null・数値でも落ちない', () => {
  const { ModelMigration: M } = env();
  for (const raw of ['[]', 'null', '123', '"x"']) {
    const st = makeStorage({ [KEY]: raw });
    assert.doesNotThrow(() => M.run(st));
    assert.deepEqual(JSON.parse(st.getItem(KEY)), {});
  }
});

test('移行: storageが例外を投げても呼び出し元に伝わらない', () => {
  const { ModelMigration: M } = env();
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.doesNotThrow(() => M.run(bad));
});
