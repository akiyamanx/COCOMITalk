// COCOMITalk - 機能リストの共通化テスト: 5人のプロンプトすべてが CocomiCommonEnv.featureBlock() をちょうど1回含む（step2 Step1）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const E = load(['tone-style.js', 'prompts/common-env.js', 'prompts/koko-system.js', 'prompts/gpt-system.js', 'prompts/claude-system.js',
  'prompts/aoi-system.js', 'prompts/kimi-system.js'],
['CocomiCommonEnv', 'KokoSystemPrompt', 'GptSystemPrompt', 'ClaudeSystemPrompt', 'AoiSystemPrompt', 'KimiSystemPrompt'], { window: {} });
const PROMPTS = { koko: E.KokoSystemPrompt, gpt: E.GptSystemPrompt, claude: E.ClaudeSystemPrompt, aoi: E.AoiSystemPrompt, kimi: E.KimiSystemPrompt };
const count = (s, sub) => s.split(sub).length - 1;

test('5人×全モード: getPrompt に featureBlock が完全一致でちょうど1回入る', () => {
  const block = E.CocomiCommonEnv.featureBlock();
  assert.ok(block.length > 300);
  for (const [k, P] of Object.entries(PROMPTS)) {
    const modes = P.getAvailableModes();
    assert.ok(modes.length >= 5, `${k} modes`);
    for (const m of modes) assert.equal(count(P.getPrompt(m), block), 1, `${k}/${m}`);
  }
});

test('重複の掃除: 機能リストの見出し・存在しない機能・「知らないことは…」は各プロンプトに1回だけ（共通ブロック内のみ）', () => {
  for (const [k, P] of Object.entries(PROMPTS)) {
    const t = P.getPrompt('normal');
    for (const s of ['＜COCOMITalkの機能＞', '＜存在しない機能（聞かれても「ない」と答える）＞', '知らないことは正直に「わからない」と言う。推測で機能を説明しない。']) {
      assert.equal(count(t, s), 1, `${k}: ${s}`);
    }
  }
  // 三姉妹のソースに機能リストの本文が残っていない（正本は common-env.js だけ）
  for (const f of ['koko', 'gpt', 'claude']) {
    const src = read(`prompts/${f}-system.js`);
    assert.ok(!src.includes('＜COCOMITalkの機能＞'), f);
    assert.ok(src.includes('CocomiCommonEnv.featureBlock()'), f);
  }
});

test('和集合: 3人の差だった gpt の「★重要: このリストにない機能は存在しない」が共通ブロックに入り、5人全員が持つ', () => {
  for (const [k, P] of Object.entries(PROMPTS)) {
    const t = P.getPrompt('normal');
    assert.ok(t.includes('★重要: このリストにない機能は存在しない。'), k);
    assert.ok(t.includes('知らない機能を勝手に作り上げないこと。'), k);
  }
});

test('人格・ルールの本文は無傷: 三姉妹それぞれの「動作環境」「ハルシネーション防止」と固有の声・APIが残る。葵/きみの文は共通ブロック以外の機能説明を持たない', () => {
  assert.match(E.KokoSystemPrompt.getPrompt('normal'), /あなた（ここちゃん）の動作環境[\s\S]*Google Gemini API/);
  assert.match(E.GptSystemPrompt.getPrompt('normal'), /あなた（お姉ちゃん）の動作環境[\s\S]*OpenAI GPT API/);
  assert.match(E.ClaudeSystemPrompt.getPrompt('normal'), /あなた（クロちゃん）の動作環境[\s\S]*Anthropic Claude API/);
  for (const k of ['koko', 'gpt', 'claude']) assert.match(PROMPTS[k].getPrompt('normal'), /葵/);   // 家族の1〜2行（葵/きみ）は保持
});

test('読み込み順: index.html で common-env.js が三姉妹・葵・きみのプロンプトより前、sw.js のプリキャッシュにも載っている。声のトーン指示は引き続き末尾に1回', () => {
  const html = read('index.html'), sw = read('sw.js');
  const pos = f => html.indexOf(`src="${f}"`);
  assert.ok(sw.includes("'./prompts/common-env.js'"));
  for (const f of ['koko', 'gpt', 'claude', 'aoi', 'kimi']) assert.ok(pos('prompts/common-env.js') > 0 && pos('prompts/common-env.js') < pos(`prompts/${f}-system.js`), f);
  for (const [k, P] of Object.entries(PROMPTS)) assert.equal(count(P.getPrompt('normal'), '【声のトーンタグ（読み上げ用）】'), 1, k);
});

test('防御: common-env.js が読めなかった場合も三姉妹のプロンプトは壊れず、最小の「作り話をしない」1行が入る', () => {
  const only = load(['tone-style.js', 'prompts/koko-system.js'], ['KokoSystemPrompt'], { window: {} }).KokoSystemPrompt;
  const t = only.getPrompt('normal');
  assert.match(t, /知らない機能を勝手に作り上げないこと/);
  assert.ok(!t.includes('＜COCOMITalkの機能＞'));
});
