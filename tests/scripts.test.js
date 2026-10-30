// COCOMITalk - index.html の読み込み順・sw.js のキャッシュ一覧・新規ファイルのヘッダの確認テスト
// このファイルは node --test tests/ で実行する
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const order = (re) => [...html.matchAll(re)].map(m => m[1]);
const scripts = order(/<script[^>]*src="([^"?]+)(?:\?[^"]*)?"/g);
const idx = f => scripts.indexOf(f);

test('新規スクリプトが index.html に1回ずつあり、依存より後に読み込まれる', () => {
  for (const f of ['model-effort.js', 'gemini-tts-provider.js', 'stt-model.js', 'effort-settings-ui.js', 'tone-style.js', 'walk-spend-core.js', 'walk-spend.js', 'walk-spend-ui.js', 'layout-ui.js', 'layout2-core.js', 'layout2-ui.js']) assert.equal(scripts.filter(s => s === f).length, 1, f);
  assert.ok(idx('model-effort.js') > idx('model-tiers.js'));
  assert.ok(idx('model-effort.js') < idx('api-openai.js'));          // 各APIより前
  assert.ok(idx('gemini-tts-provider.js') > idx('tts-provider.js'));  // 基底クラスの後
  assert.ok(idx('gemini-tts-provider.js') < idx('voice-output.js'));
  assert.ok(idx('stt-model.js') < idx('whisper-provider.js'));
  assert.ok(idx('effort-settings-ui.js') < idx('app-settings.js'));
  assert.ok(idx('effort-settings-ui.js') > idx('model-effort.js'));
});

test('sw.js のキャッシュ一覧に新規ファイルがあり、index.html の全scriptが含まれる', () => {
  const sw = read('sw.js');
  for (const f of ['model-effort.js', 'gemini-tts-provider.js', 'stt-model.js', 'effort-settings-ui.js']) assert.ok(sw.includes(`'./${f}'`) || sw.includes(`'/${f}'`) || sw.includes(`'${f}'`), f);
  for (const f of scripts.filter(s => !/^https?:/.test(s))) assert.ok(sw.includes(f), `sw.js に ${f} が無い`);
});

test('新規ファイルのヘッダ（作成: 葵(Aoi) / 最終更新）と行数上限', () => {
  for (const f of ['model-effort.js', 'gemini-tts-provider.js', 'stt-model.js', 'effort-settings-ui.js', 'tests/model-effort.test.js', 'tests/stt-tts.test.js', 'tone-style.js', 'tests/tone.test.js', 'tests/gemini-default.test.js', 'walk-spend-core.js', 'walk-spend.js', 'walk-spend-ui.js', 'tests/walk-spend-core.test.js', 'tests/walk-spend.test.js', 'layout-ui.js', 'layout-main.css', 'layout-panels.css', 'tests/layout-ui.test.js', 'layout2-core.js', 'layout2-ui.js', 'layout2-main.css', 'layout2-panels.css', 'tests/layout2.test.js']) {
    const s = read(f);
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-(28|29|30)/.test(s), f);
    assert.ok(s.split('\n').length <= 500, f);
  }
  assert.ok(read('whisper-provider.js').split('\n').length <= 500);
});
