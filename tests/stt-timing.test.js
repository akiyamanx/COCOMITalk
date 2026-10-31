// COCOMITalk - v4.1 文字起こし⏱計測ログのテスト（ログが4区間そろう・計測なしなら挙動不変・既存の安全設定はそのまま）
// このファイルは node --test tests/*.test.js で実行する。fetch/Blob/マイクは偽物（実APIなし）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./_load');
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('SttTiming: a)〜d)と合計の5行が順に出る（サイズ・形式・rate/ch入り）', () => {
  const { SttTiming } = load(['stt-timing.js'], ['SttTiming']);
  const lines = [];
  const stream = { getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 48000, channelCount: 1 }) }] };
  const tm = SttTiming.start(l => lines.push(l), { stopAt: SttTiming.now(), recStartAt: 1000, firstChunkAt: 1100, lastChunkAt: 4200, stream, ctxRate: 48000 });
  tm.blobReady({ size: 12345, type: 'audio/webm;codecs=opus' }, 'webm');
  tm.hook('fetchStart', { model: 'gpt-transcribe' }); tm.hook('headers', { status: 200 }); tm.hook('parsed'); tm.done(7);
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^⏱ STT a\) 録音停止→blob: \d+ms \| 12345B audio\/webm;codecs=opus \(webm\) 長さ≈3\.2s rate=48000Hz ch=1 ctx=48000Hz$/);
  assert.match(lines[1], /^⏱ STT b\) blob→fetch開始: \d+ms model=gpt-transcribe$/);
  assert.match(lines[2], /^⏱ STT c\) fetch開始→応答ヘッダ: \d+ms HTTP 200$/);
  assert.match(lines[3], /^⏱ STT d\) 応答→文字パース: \d+ms$/);
  assert.match(lines[4], /^⏱ STT 合計 録音停止→文字: \d+ms \(7字\)$/);
});

test('SttTiming: ログ関数が壊れていても投げない', () => {
  const { SttTiming } = load(['stt-timing.js'], ['SttTiming']);
  const tm = SttTiming.start(() => { throw new Error('x'); }, {});
  assert.doesNotThrow(() => { tm.blobReady(null, 'webm'); tm.hook('fetchStart'); tm.done(); });
});

test('配線: index/sw に stt-timing.js、sw は v4.1、既存の安全設定は変えていない', () => {
  assert.ok(src('index.html').includes('<script src="stt-timing.js"></script>'));
  const sw = src('sw.js');
  assert.ok(sw.includes("'./stt-timing.js'") && sw.includes("const CACHE_NAME = 'cocomitalk-v4.2';"));
  const ac = src('api-common.js');
  assert.ok(ac.includes("if (!options.onTiming) return response.json();"), '計測なしなら従来どおり');
  const wp = src('whisper-provider.js');
  assert.ok(wp.includes('_canOpenNow()') && wp.includes("window.voiceState.isSpeaking()"), '読み上げ中はマイクを開けない');
});
