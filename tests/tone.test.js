// COCOMITalk - 声のトーンタグ（tone-style.js）のテスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
const T = () => { const t = load(['tone-style.js'], ['ToneStyle'], { window: {} }).ToneStyle; t._reset(); return t; };

test('トーン: 6種類だけ・基本はcheerful・styleは英語の自由文で200字以内', () => {
  const t = T();
  assert.deepEqual(plain(t.TONES), ['cheerful', 'calm', 'gentle-sad', 'serious', 'excited', 'explaining']);
  assert.equal(t.DEFAULT_TONE, 'cheerful');
  for (const k of t.TONES) { assert.ok(t.STYLES[k].length > 0 && t.STYLES[k].length <= 200, k); assert.ok(/^[\x20-\x7e]+$/.test(t.STYLES[k]), `${k} はASCIIのみ`); }
  assert.equal(t.styleFor('???'), t.STYLES.cheerful);   // 不明は基本トーン
  assert.equal(t.styleFor(undefined), t.STYLES.cheerful);
});

test('タグ: 先頭の正しいタグを読み取り、本文から外す（大文字小文字・全角括弧・別名・空白ゆれ）', () => {
  const t = T();
  const cases = [
    ['[tone:calm] こんにちは', 'calm', 'こんにちは'],
    ['[TONE: Gentle-Sad]\nそっか、大変だったね', 'gentle-sad', 'そっか、大変だったね'],
    ['［tone：excited］やった！', 'excited', 'やった！'],
    ['【tone:explaining】 まず手順から', 'explaining', 'まず手順から'],
    ['  \u200b[tone:serious] 注意してね', 'serious', '注意してね'],
    ['[tone:gentle_sad] うん', 'gentle-sad', 'うん'],
    ['[tone:sad] うん', 'gentle-sad', 'うん'],
    ['[tone:explain] ええと', 'explaining', 'ええと'],
    ['［ＴＯＮＥ：ｃａｌｍ］ はい', 'calm', 'はい'],
    ['[トーン:優しい] うん', 'gentle-sad', 'うん'],
  ];
  for (const [raw, tone, text] of cases) assert.deepEqual(plain(t.parse(raw)), { text, tone, hadTag: true }, raw);
});

test('タグ: 壊れたタグでも本文は消えず、タグ部分だけ外れる（不明語・閉じ忘れ・文中・複数）', () => {
  const t = T();
  assert.deepEqual(plain(t.parse('[tone:zzz] こんにちは')), { text: 'こんにちは', tone: null, hadTag: true });
  assert.deepEqual(plain(t.parse('[tone:] こんにちは')), { text: 'こんにちは', tone: null, hadTag: true });
  assert.deepEqual(plain(t.parse('[tone:calm今日は静かだね')), { text: '今日は静かだね', tone: 'calm', hadTag: true });
  assert.deepEqual(plain(t.parse('こんにちは[tone:excited]やった')), { text: 'こんにちはやった', tone: 'excited', hadTag: true });
  assert.deepEqual(plain(t.parse('[tone:calm] [tone:serious] はい')), { text: 'はい', tone: 'calm', hadTag: true });
  // タグでないものは触らない
  for (const s of ['普通の文章', '[1] 項目', '(tone is nice)', '[tone]', 'toneは大事', '']) assert.deepEqual(plain(t.parse(s)), { text: s, tone: null, hadTag: false }, s);
  // 何が来ても例外を出さない
  for (const v of [null, undefined, 42, {}, [], NaN]) assert.doesNotThrow(() => t.parse(v));
  assert.equal(t.parse(null).text, '');
  assert.equal(t.consume(undefined), '');
  assert.equal(t.consume('[tone:calm]'), '');   // タグだけの返信は空文字（表示側は空を扱える）
});

test('ストリーミング: タグの途中は空で隠し、タグが閉じたら本文だけ出す（一瞬も見えない）', () => {
  const t = T();
  const full = '[tone:gentle-sad] そっか、つらかったね';
  let shown = '';
  for (let i = 1; i <= full.length; i++) {
    shown = t.streamView(full.slice(0, i));
    assert.ok(!/tone|\[|］|】/.test(shown), `途中${i}文字目でタグが見えた: ${shown}`);
  }
  assert.equal(shown, 'そっか、つらかったね');
  for (const part of ['[', '[t', '[to', '[tone', '[tone:', '[tone:ge', '[tone:gentle-sa', '[tone:gentle-sad', '[tone:gentle-sad]']) assert.equal(t.streamView(part), '', part);
  assert.equal(t.streamView('[1] 項目'), '[1] 項目');   // 普通の [ で始まる文は出す
  assert.equal(t.streamView('こんにちは'), 'こんにちは');
  assert.equal(t.streamView(null), '');
});

test('推定: タグが無い/不明なときのキーワード・絵文字。当てはまらなければcheerful', () => {
  const t = T();
  const cases = [
    ['おじいちゃんが入院したんだね…心配だよね', 'gentle-sad'],
    ['ごめんね、ちゃんと確認できてなかった😢', 'gentle-sad'],
    ['⚠ 重要: このまま送信すると取り消せません', 'serious'],
    ['エラーが出てるみたい。ログを確認してね', 'serious'],
    ['おめでとう！🎉 やったね！', 'excited'],
    ['まず設定を開いて、次にここを押してね。つまり3ステップだよ', 'explaining'],
    ['1. 開く\n2. 押す\n3. 閉じる', 'explaining'],
    ['今日はいい天気だね〜！お散歩しよ！', 'cheerful'],
    ['', 'cheerful'],
  ];
  for (const [text, tone] of cases) assert.equal(t.detect(text), tone, text);
  assert.equal(t.detect(null), 'cheerful');
  assert.equal(t.detect({}), 'cheerful');
});

test('読み上げのトーン: タグで覚えたもの → 推定 → cheerful。本文が少し変わっても先頭で引き当てる', () => {
  const t = T();
  const clean = t.consume('[tone:calm] 今日はゆっくり休もうね。無理しないでね。\n💾SAVE:休養');
  assert.ok(!clean.includes('tone:'));
  assert.equal(t.toneFor(clean), 'calm');
  assert.equal(t.toneFor(clean.replace('\n💾SAVE:休養', '')), 'calm');   // 💾SAVE行を外した後でも
  assert.equal(t.toneFor('[tone:excited] やった！'), 'excited');            // タグが残っていてもそれを優先
  assert.equal(t.toneFor('入院したって聞いて…'), 'gentle-sad');           // 覚えが無ければ推定
  assert.equal(t.toneFor('今日はいい天気'), 'cheerful');
  assert.equal(t.styleForText('[tone:serious] 注意して'), t.STYLES.serious);
  // タグが不明語（tone=null）でも、推定にフォールバック
  assert.equal(t.toneFor(t.consume('[tone:xxx] 悲しいね')), 'gentle-sad');
  // タグ無しの返信は、同じ書き出しの古いトーンを引きずらない
  t.consume('[tone:excited] やったね、すごいね！');
  assert.equal(t.toneFor(t.consume('やったね、すごいね！')), 'excited');  // 推定で同じ結果でも
  t.consume('[tone:calm] そうだね、また今度ね');
  t.consume('そうだね、また今度ね');
  assert.equal(t.recall('そうだね、また今度ね'), null);
});

test('覚える数は上限つき（古いものから忘れる）', () => {
  const t = T();
  for (let i = 0; i < 60; i++) t.consume(`[tone:calm] 発言${String(i).padStart(3, '0')}です`);
  assert.equal(t.recall('発言000です'), null);   // 上限40件
  assert.equal(t.recall('発言059です'), 'calm');
});

test('プロンプト指示: 6種類すべてと「画面に出ない」を含み短い。タグの例が1つだけ', () => {
  const t = T();
  const r = t.promptRule();
  for (const k of t.TONES) assert.ok(r.includes(k), k);
  assert.ok(r.includes('[tone:cheerful]') && r.includes('画面には表示されません'));
  assert.ok(r.length < 600, `長すぎる: ${r.length}`);
  assert.equal((r.match(/\[tone:/g) || []).length, 1);
  assert.equal(t.parse('[tone:cheerful] 今日もいい天気だね！').tone, 'cheerful');   // 指示の例が実際に読める形
});
