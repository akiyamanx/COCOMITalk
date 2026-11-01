// COCOMITalk - テスト: 指示文の「今の日本時間」1行（prompt-builder v1.9）と、約束だけの「調べるね」指示がないこと
// このファイルは時計を差し替えて、決まった時刻で日付行が正しく出るかを確かめる
// v1.0 2026-10-29 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

const { PromptBuilder } = load(['prompt-builder.js'], ['PromptBuilder'], { Intl, Date, String, Number });

test('nowLine: UTC 14:39 → 日本時間 2026年10月29日(木) 23:39', () => {
  const line = PromptBuilder.nowLine(Date.UTC(2026, 9, 29, 14, 39));
  assert.ok(line.includes('今は2026年10月29日(木) 23:39（日本時間）'), line);
});

test('nowLine: 日付をまたぐ（UTC 15:05 → 翌日 00:05）', () => {
  const line = PromptBuilder.nowLine(Date.UTC(2026, 9, 29, 15, 5));
  assert.ok(line.includes('今は2026年10月30日(金) 00:05（日本時間）'), line);
});

test('build: どのモードでも先頭に日時の1行が入る（時計は options.now で注入）', async () => {
  for (const mode of ['chat', 'group', 'meeting']) {
    const out = await PromptBuilder.build({ mode, now: Date.UTC(2026, 9, 29, 14, 39),
      skipMemory: true, skipSearch: true, skipHotTopic: true, skipVector: true, skipChatMemory: true });
    assert.ok(out.includes('今は2026年10月29日(木) 23:39（日本時間）'), mode);
  }
});

test('プロンプト: 「調べてみるね」の約束だけの指示がなく、その場で調べる指示がある', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'prompts')).filter(f => f.endsWith('.js') && !f.includes('backup'))) {
    const s = fs.readFileSync(path.join(ROOT, 'prompts', f), 'utf8');
    assert.ok(!/調べてみるね|あとで調べるね|確認してみるね/.test(s), f);
  }
  const koko = fs.readFileSync(path.join(ROOT, 'prompts/koko-system.js'), 'utf8');
  assert.ok(koko.includes('あとで調べる、と約束だけしない。'));
});
