// COCOMITalk - 間を置いて話すと拾えない問題(v3.99)のテスト: 耳の死亡判定・区切りの送信判断・連続重複・マイク表示・配線
// このファイルは node --test tests/*.test.js で実行する（実マイク/実APIは使わない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const G = () => load(['whisper-vad-guard.js'], ['WhisperVadGuard']).WhisperVadGuard;

test('耳の死亡: maxVol=0 が1.5秒(15回)続いたら dead。14回では出ない', () => {
  const t = G().createTracker();
  for (let i = 0; i < 14; i++) assert.equal(t.tick(0, false), null);
  assert.equal(t.wasBlind(), true);
  assert.equal(t.tick(0, false), 'dead');
});

test('耳の死亡: ctxがrunningでない(ctxDead)も同じく数える', () => {
  const t = G().createTracker();
  let r; for (let i = 0; i < 15; i++) r = t.tick(10, true);
  assert.equal(r, 'dead');
});

test('復活は maxVol>0 が2秒(20回)続いてから一度だけ。途中で0に戻ると数え直し（旧: 1回で即リセット）', () => {
  const t = G().createTracker();
  for (let i = 0; i < 10; i++) assert.equal(t.tick(3, false), null);
  t.tick(0, false);
  const got = []; for (let i = 0; i < 25; i++) got.push(t.tick(3, false));
  assert.equal(got.filter(x => x === 'alive').length, 1);
  assert.equal(got.indexOf('alive'), 19);
});

test('区切り送信: 発話あり→送る / 発話なしで普通の無音→送らない', () => {
  const g = G();
  assert.equal(g.shouldSend({ hadVoice: true, blind: false, forced: false, bytes: 100, durationMs: 2000 }), true);
  assert.equal(g.shouldSend({ hadVoice: false, blind: false, forced: false, bytes: 60000, durationMs: 25000 }), false);
});

test('区切り送信: VADが見えていなかった/25秒の最大で切った区切りは、大きければ送る（13:19:33 の捨てられた区切り）', () => {
  const g = G();
  assert.equal(g.shouldSend({ hadVoice: false, blind: true, forced: true, bytes: 40000, durationMs: 25000 }), true);
  assert.equal(g.shouldSend({ hadVoice: false, blind: false, forced: true, bytes: 40000, durationMs: 25000 }), true);
  assert.equal(g.shouldSend({ hadVoice: false, blind: true, forced: true, bytes: 2000, durationMs: 25000 }), false);
  assert.equal(g.shouldSend({ hadVoice: true, blind: false, forced: false, bytes: 9000, durationMs: 500 }), false);
});

test('連続重複: X。X。X。→X。 / 句読点だけ違っても同じ扱い / 間に別の文があれば残す', () => {
  const d = G().dedupeRepeats;
  assert.equal(d('まだだよ。まだだよ。まだだよ。'), 'まだだよ。');
  assert.equal(d('まだだよ。まだだよ！'), 'まだだよ。');
  assert.equal(d('うん。まだだよ。うん。'), 'うん。まだだよ。うん。');
  assert.equal(d('ありがとうね。ココちゃん、聞こえてる？'), 'ありがとうね。ココちゃん、聞こえてる？');
  assert.equal(d('こんにちは'), 'こんにちは');
  assert.equal(d(''), '');
});

test('音量レベル: 0〜1に収まり、閾値を超えると上がる', () => {
  const lv = G().level;
  assert.equal(lv(0), 0);
  assert.equal(lv(255), 1);
  assert.ok(lv(45) > lv(36) && lv(36) > 0);
});

test('マイク表示: 相手が話し中は必ず「お休み」、listening中だけ細かい状態が出る', () => {
  const M = load(['mic-indicator.js'], ['MicIndicator']).MicIndicator;
  assert.equal(M.resolve('speaking', 'voice'), 'speaking');
  assert.equal(M.resolve('idle', 'voice'), 'idle');
  assert.equal(M.resolve('recovering', 'listening'), 'recovering');
  assert.equal(M.resolve('listening', 'voice'), 'voice');
  assert.equal(M.resolve('listening', 'transcribing'), 'transcribing');
  assert.equal(M.resolve('listening', 'asleep'), 'asleep');
  assert.equal(M.resolve('listening', 'bogus'), 'listening');
  assert.match(M.LABELS.voice, /聞いてるよ/);
  assert.match(M.LABELS.transcribing, /文字にしてるよ/);
  // DOMが無くても落ちない
  M.update('voice', 0.5); M.setBase('listening');
});

test('マイク表示: ラベルは aria-live で伝え、動きを減らす設定も尊重', () => {
  const s = read('mic-indicator.js');
  assert.ok(s.includes("'aria-live', 'polite'") && s.includes('prefers-reduced-motion'));
  assert.ok(read('voice-ui.js').includes('window.MicIndicator.setBase(state)'));
});

test('配線: whisper-provider は guard を使い、旧「1回で即はしごリセット」と「発話なしなら必ず捨てる」が無い', () => {
  const s = read('whisper-provider.js');
  assert.ok(s.includes('this._vad.tick(maxVolume, ctxDead)'));
  assert.ok(s.includes('WhisperVadGuard.shouldSend('));
  assert.ok(s.includes('WhisperVadGuard.dedupeRepeats('));
  assert.ok(!s.includes('if (this._chunks.length > 0 && this._hasVoiceStarted) {\n      const duration'));
  const r = read('whisper-recovery.js');
  assert.ok(r.includes("tr.readyState !== 'live'") && r.includes('new MediaStream(live)'));
  assert.ok(s.split('\n').length <= 500);
});

test('守るべきこと: 読み上げ後1.5秒待ち・こだま除けは残っている', () => {
  const vi = read('voice-input.js');
  assert.ok(vi.includes('await new Promise(r => setTimeout(r, 1500)); // ★ハウリング防止'));
  assert.ok(vi.includes('VoiceFast.isEcho(text)'));
});

test('読み込み順とキャッシュ: guard → provider → indicator、sw.js v4.0 に入り、全CACHE_FILESが実在', () => {
  const idx = read('index.html');
  const i = f => idx.indexOf(`src="${f}"`);
  assert.ok(i('whisper-vad-guard.js') > 0 && i('whisper-vad-guard.js') < i('whisper-provider.js') && i('whisper-provider.js') < i('whisper-recovery.js') && i('whisper-recovery.js') < i('mic-indicator.js'));
  const sw = read('sw.js');
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v4.0';"));
  assert.ok(sw.includes("'./whisper-recovery.js'"));
  const files = [...sw.match(/const CACHE_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(Boolean);
  assert.ok(files.includes('whisper-vad-guard.js') && files.includes('mic-indicator.js'));
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});
