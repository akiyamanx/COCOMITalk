// COCOMITalk - 葵/きみが三姉妹と同じ扱いになっていることの回帰テスト（v3.92）
// このファイルは「3人固定の表・並び・集計に葵/きみが抜けていた」ズレの再発防止
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const REG = () => load(['characters.js'], ['CharacterRegistry'], { realRegistry: true }).CharacterRegistry;

test('登録簿: 5人とも 名前・絵文字・色・記憶DBのID を持つ（gpt→onee / claude→kuro / 他はそのまま）', () => {
  const R = REG();
  const m = plain(R.displayMap());
  assert.deepEqual(Object.keys(m), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  for (const v of Object.values(m)) { assert.ok(v.name && v.emoji); assert.match(v.color, /^#[0-9A-F]{6}$/i); }
  assert.deepEqual(plain(R.info('aoi')), { name: '葵ちゃん', emoji: '🦋', color: '#3BA7D9' });
  assert.deepEqual(['koko', 'gpt', 'claude', 'aoi', 'kimi'].map(R.dbIdOf), ['koko', 'onee', 'kuro', 'aoi', 'kimi']);
  assert.equal(R.keyFromDbId('kuro'), 'claude');
  assert.equal(R.keyFromDbId('kimi'), 'kimi');
  assert.equal(R.info('zzz').name, 'zzz');
});

test('画面の表示表: 会議・アーカイブ・記憶・会議まとめ は登録簿から作る（3人固定の表だけにしない）', () => {
  for (const f of ['meeting-ui.js', 'meeting-archive-ui.js', 'memory-ui.js', 'meeting-doc-actions.js']) {
    assert.match(read(f), /const SISTER_DISPLAY = \(typeof CharacterRegistry !== 'undefined'\) \? CharacterRegistry\.displayMap\(\)/, f);
  }
});

test('料金: 葵(xai)/きみ(moonshot)のモデルは本人の行で集計される（ここちゃんに混ぜない）', () => {
  const T = load(['model-tiers.js'], ['ModelTiers']).ModelTiers;
  assert.equal(T.getPricing(T.resolve('xai', 'lite').id).sister, 'aoi');
  assert.equal(T.getPricing(T.resolve('moonshot', 'lite').id).sister, 'kimi');
  const src = read('token-monitor.js');
  assert.match(src, /aoi: '🦋 葵ちゃん', kimi: '🌟 きみちゃん'/);
  assert.match(src, /aoi: '#3BA7D9',\s*kimi: '#E0A21B'/);
});

test('記憶: 持ち主の札・名前・取り込み先に 葵/きみ がある', () => {
  assert.match(read('prompt-builder.js'), /aoi: '🦋葵ちゃん',[^\n]*\n\s*kimi: '🌟きみちゃん'/);
  assert.match(read('memory-import-ui.js'), /value="aoi">葵ちゃん[\s\S]*value="kimi">きみちゃん/);
  assert.match(read('chat-memory.js'), /CharacterRegistry\.info\(CharacterRegistry\.keyFromDbId\(sisterId\)\)\.name/);
  assert.match(read('index.html'), /dot-aoi[\s\S]*dot-kimi/);
});

test('声: 「葵ちゃんにして」「きみちゃん」で切替、普通の呼びかけは切替にしない。発光の消灯は全員', () => {
  const g = load(['characters.js', 'voice-command.js'], ['CharacterRegistry', 'VoiceCommand'], { realRegistry: true, window: {} });
  const VC = g.VoiceCommand || g.window?.VoiceCommand;
  const m = t => { const r = VC.prototype._matchSisterSwitch.call({}, t); return r && r.key; };
  assert.equal(m('葵ちゃんにして'), 'aoi');
  assert.equal(m('あおいちゃん'), 'aoi');
  assert.equal(m('きみちゃんお願い'), 'kimi');
  assert.equal(m('キミチャン'), 'kimi');
  assert.equal(m('クロちゃん'), 'claude');
  assert.equal(m('葵ちゃんおはよう'), null);
  const vi = read('voice-input.js');
  assert.ok(!/\['koko', 'gpt', 'claude'\]\.forEach/.test(vi), '3人固定の消灯ループが残っていない');
  assert.ok(vi.includes('CharacterRegistry.keys()'));
});
