// COCOMITalk - 声のトーンタグが画面・履歴・読み上げに漏れないかの現実的なケースのテスト（step2 Step3）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const T = () => load(['tone-style.js'], ['ToneStyle'], { window: {} }).ToneStyle;
const P = (s) => { const r = T().parse(s); return [r.text, r.tone]; };

test('先頭タグ: 大文字小文字・全角/日本語の括弧とラベル・先頭の空白や改行・BOM でも外れて、トーンが取れる', () => {
  for (const [raw, tone] of [
    ['[TONE:CALM]本文', 'calm'], ['[Tone: Calm ] 本文', 'calm'], ['［ｔｏｎｅ：ｃａｌｍ］本文', 'calm'], ['【tone:calm】本文', 'calm'],
    ['[トーン:落ち着いた]本文', 'calm'], ['[口調：優しい]本文', 'gentle-sad'], ['\n\n  [tone:calm]本文', 'calm'], ['\uFEFF[tone:calm]本文', 'calm'],
    ['[tone: GENTLE_SAD]本文', 'gentle-sad'], ['[ tone : calm ]本文', 'calm'],
  ]) assert.deepEqual(P(raw), ['本文', tone], raw);
});

test('繰り返し・文中・文末: 2回目以降や途中のタグも消える（最初のトーンを採用）', () => {
  assert.deepEqual(P('[tone:calm][tone:calm] 本文'), ['本文', 'calm']);
  assert.deepEqual(P('[tone:calm]\n[tone:serious]\n本文'), ['本文', 'calm']);
  assert.deepEqual(P('[tone:cheerful]\n[tone:calm]\n本文'), ['本文', 'cheerful']);
  assert.deepEqual(P('文末です。[tone:calm]'), ['文末です。', 'calm']);
  assert.equal(P('こんにちは [tone:calm] 元気？')[0].replace(/\s+/g, ' '), 'こんにちは 元気？');
  assert.deepEqual(P('[tone:calm]'), ['', 'calm']);
});

test('壊れたタグ: 閉じ括弧なし・別種の閉じ括弧・知らない名前でも、見えるところにタグが残らない', () => {
  assert.deepEqual(P('[tone:cheerful こんにちは'), ['こんにちは', 'cheerful']);
  assert.deepEqual(P('[tone:cheerful\nこんにちは'), ['こんにちは', 'cheerful']);
  assert.deepEqual(P('[tone:calm】本文'), ['本文', 'calm']);
  assert.deepEqual(P('[tone:wild] 本文'), ['本文', null]);       // 知らない名前: 消すがトーンは null（読み上げは推定へ）
  assert.deepEqual(P('[tone:] 本文'), ['本文', null]);
});

test('★v1.1で修正した漏れ: 角括弧なしの先頭行「Tone: calm」「トーン：落ち着いた」も外す。ただし本文の文は外さない', () => {
  assert.deepEqual(P('Tone: calm\n本文'), ['本文', 'calm']);
  assert.deepEqual(P('トーン：落ち着いた\n本文'), ['本文', 'calm']);
  assert.deepEqual(P('tone=calm\r\n本文'), ['本文', 'calm']);
  assert.deepEqual(P('Tone: calm'), ['', 'calm']);
  // 同じ行に本文が続く・知らない値・文中の説明は、本文として残す（誤って消さない）
  assert.deepEqual(P('Tone: calm and steady wins the race'), ['Tone: calm and steady wins the race', null]);
  assert.deepEqual(P('tone:calm 本文'), ['tone:calm 本文', null]);
  assert.deepEqual(P('Tone: wild\n本文'), ['Tone: wild\n本文', null]);
  assert.deepEqual(P('今日のtone: calm\nです'), ['今日のtone: calm\nです', null]);
});

test('ストリーミング: 1文字ずつ増える途中の文に、タグの断片が一瞬も出ない（半角/全角/大文字/日本語/空白始まり/角括弧なし）', () => {
  const S = T();
  const frag = /\[|［|【|tone|トーン|口調|ｔｏｎｅ/i;
  for (const full of ['[tone:calm] こんにちは', '［tone：calm］こんにちは', '\n[TONE:CALM] こんにちは', '[tone:gentle-sad] こんにちは',
    '[トーン:落ち着いた] こんにちは', '【口調：優しい】こんにちは', '[tone:cheerful] こんにちは', 'Tone: calm\nこんにちは']) {
    for (let i = 1; i <= full.length; i++) {
      const v = S.streamView(full.slice(0, i));
      if (full.startsWith('Tone:') && i <= 4) continue;  // 「Tone」まで（コロン前）は本文の書き出しと区別できないので出る（コロンが来たら隠す）
      assert.ok(!frag.test(v), `${JSON.stringify(full.slice(0, i))} -> ${JSON.stringify(v)}`);
    }
    assert.equal(S.streamView(full), 'こんにちは', full);
  }
  assert.equal(S.streamView('['), ''); assert.equal(S.streamView('[to'), '');
  assert.equal(S.streamView('こんにちは'), 'こんにちは');
  assert.equal(S.streamView('Tokyo'), 'Tokyo');             // Tで始まる普通の語は隠さない
  assert.equal(S.streamView('[1] 参考'), '[1] 参考');         // タグではない [ は隠さない
  assert.equal(S.streamView(undefined), '');
});

test('consume/履歴/読み上げ: 消した本文を返し、トーンを覚え、元の文を読み上げに渡しても同じトーンで読める', () => {
  const S = T();
  const shown = S.consume('[TONE:Serious]\n大事な連絡です。');
  assert.equal(shown, '大事な連絡です。');
  assert.equal(S.toneFor(shown), 'serious');
  assert.equal(S.toneFor('[tone:calm]大事な連絡です。'), 'calm');                 // 読み上げ側に生の文が来ても外して読める
  assert.equal(S.consume('Tone: excited\nやったね！'), 'やったね！');
  assert.equal(S.toneFor('やったね！'), 'excited');
  assert.equal(S.consume(null), ''); assert.equal(S.consume(undefined), '');      // 何が来ても例外を出さない
});

test('既知の限界（直さない・記録のみ）: 30字超の名前のタグ、閉じ括弧なしの文中タグは外れない', () => {
  assert.equal(P('[tone:very-long-unknown-tone-name-abcdefghijklmnop] 本文')[0], '[tone:very-long-unknown-tone-name-abcdefghijklmnop] 本文');
  assert.equal(P('こんにちは [tone:cheerful')[0], 'こんにちは [tone:cheerful');
});
