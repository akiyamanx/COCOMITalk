// COCOMITalk - v4.6 Gemini TTS を1本ずつ送る・429の送り直し・OpenAIの代わりの声の速さ のテスト（gemini-tts-provider v1.9 / voice-output v3.1）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, makeStorage } = require('./_load.js');

const hdr = (h) => ({ get: k => h[k.toLowerCase()] ?? null });
const wavRes = () => ({ ok: true, status: 200, headers: hdr({ 'content-type': 'audio/wav' }), arrayBuffer: async () => new ArrayBuffer(48044) });
const r429 = (ra) => ({ ok: false, status: 429, headers: hdr(ra == null ? {} : { 'retry-after': ra }), json: async () => ({ error: 'rate' }) });

function provider(handler, logs = []) {
  const calls = [];
  class FakeAudio { constructor(src) { this.src = src; } addEventListener() {} }
  const e = load(['tts-provider.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider'], {
    window: {}, localStorage: makeStorage({ 'cocomitalk-gemini-tts-stream': 'off' }), Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, AbortController, Blob, setTimeout, clearTimeout,
    VoiceFast: { tlog: t => logs.push(t) },
    ApiCommon: { getWorkerURL: () => 'https://w', getAuthToken: () => 't', hasAuthToken: () => true },
    fetch: (u, o) => { const c = { body: JSON.parse(o.body), at: Date.now() }; calls.push(c); return handler(c, calls.length); },
  });
  e.GeminiTTSProvider.RETRY_429_MS = 30;
  const g = new e.GeminiTTSProvider(); g._recordUsage = () => {};
  return { g, calls, G: e.GeminiTTSProvider };
}

test('v4.6: 2つ同時に頼んでも、2つ目は1つ目の応答ヘッダが届いてから送る（1つ目は待たない）', async () => {
  let open1; const first = new Promise(r => { open1 = r; });
  const { g, calls } = provider((c, n) => (n === 1 ? first : Promise.resolve(wavRes())));
  const p1 = g.synthesize('いちばんめ', 'Autonoe', {}), p2 = g.synthesize('にばんめ', 'Autonoe', {});
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 1, '1つ目の応答前は2つ目を送らない');
  assert.equal(calls[0].body.text, 'いちばんめ');
  open1(wavRes());
  const [a1, a2] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 2); assert.equal(calls[1].body.text, 'にばんめ');
  assert.equal(a1.src, 'blob:x'); assert.equal(a2._ttsProvider, 'gemini');
});

test('v4.6: 1つ目が失敗しても2つ目は送れる（止まらない）', async () => {
  const { g, calls } = provider((c, n) => (n === 1 ? Promise.reject(new Error('net')) : Promise.resolve(wavRes())));
  const p1 = g.synthesize('a', 'Kore', {}), p2 = g.synthesize('b', 'Kore', {});
  await assert.rejects(p1, /net/);
  assert.equal((await p2).src, 'blob:x'); assert.equal(calls.length, 2);
});

test('v4.6: 429(Retry-After無し) → 少し待って Gemini で1回だけ送り直し、成功なら Gemini の声のまま', async () => {
  const logs = [];
  const { g, calls } = provider((c, n) => Promise.resolve(n === 1 ? r429(null) : wavRes()), logs);
  const a = await g.synthesize('やあ', 'Autonoe', {});
  assert.equal(calls.length, 2); assert.ok(calls[1].at - calls[0].at >= 25, '待ってから送り直す');
  assert.equal(a._ttsProvider, 'gemini'); assert.ok(!g.inCooldown());
  assert.ok(logs.some(t => t.includes('1回だけ送り直し')));
});

test('v4.6: 送り直しも429なら今まで通り休む（3回目は送らない）・Retry-After が長い時は送り直さない', async () => {
  let p = provider(() => Promise.resolve(r429(null)));
  await assert.rejects(p.g.synthesize('やあ', 'Kore', {}), /429/);
  assert.equal(p.calls.length, 2); assert.ok(p.g.inCooldown());
  p = provider(() => Promise.resolve(r429('10')));
  await assert.rejects(p.g.synthesize('やあ', 'Kore', {}), /429/);
  assert.equal(p.calls.length, 1);
  await assert.rejects(p.g.synthesize('次', 'Kore', {}), /待ち中/);
  assert.equal(p.calls.length, 1);
});

function manager(geminiFails) {
  const logs = [], oa = [];
  const e = load(['tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager'], {
    window: {}, localStorage: makeStorage({}),
    VoiceFast: { tlog: t => logs.push(t), rememberSpoken() {} },
    OpenAITTSProvider: class { isAvailable() { return true; } async synthesize(t, v, o) { oa.push({ v, o }); return { _ttsProvider: 'openai' }; } },
    GeminiTTSProvider: class { isAvailable() { return true; } async synthesize() { if (geminiFails) throw new Error('Gemini TTS エラー: 429'); return { _ttsProvider: 'gemini' }; } },
  });
  const m = new e.AudioPlaybackManager(); m.switchProvider('gemini');
  return { m, logs, oa, A: e.AudioPlaybackManager };
}

test('v4.6: Gemini→OpenAI の代わりの声は speed 0.9（設定1.0のとき）・どのエンジン/声かをログに出す', async () => {
  const { m, logs, oa, A } = manager(true);
  await m._synth('こんにちは', 'Autonoe', 'koko', 1.0, undefined);
  assert.equal(oa.length, 1); assert.equal(oa[0].o.speed, 0.9);
  assert.ok(logs.some(t => t.includes('TTSエンジン=openai(代わり)') && t.includes('speed=0.9')));
  assert.equal(A.fallbackSpeed(1.25), 1.13); assert.equal(A.fallbackSpeed(undefined), 0.9);
});

test('v4.6: Gemini が成功した時は TTSエンジン=gemini 声=… をログに出す', async () => {
  const { m, logs, oa } = manager(false);
  await m._synth('こんにちは', 'Autonoe', 'koko', 1.0, undefined);
  assert.equal(oa.length, 0); assert.ok(logs.some(t => t.includes('TTSエンジン=gemini 声=Autonoe')));
});
