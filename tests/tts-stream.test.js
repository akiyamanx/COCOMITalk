// COCOMITalk - Gemini TTS を受け取りながら鳴らす(v3.96〜v3.98)のテスト（pcm-stream-player.js / gemini-tts-provider.js v1.6〜v1.8）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, makeStorage } = require('./_load.js');

function fakeCtx() {
  const c = { currentTime: 10, state: 'running', destination: {}, sources: [], resume() { this.state = 'running'; },
    createBuffer: (ch, n, rate) => { const d = new Float32Array(n); return { duration: n / rate, getChannelData: () => d, copyToChannel(f) { d.set(f); }, data: d }; },
    createBufferSource() { const s = { playbackRate: { value: 1 }, connect() {}, start(at) { s.at = at; }, stop() { s.stopped = true; } }; c.sources.push(s); return s; } };
  return c;
}
function readerOf(chunks, opt = {}) {
  let i = 0; const r = { cancelled: false,
    async read() { await null; if (r.cancelled) return { done: true }; if (opt.failAt === i) throw new Error('net'); return i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }; },
    cancel() { r.cancelled = true; } };
  return r;
}
const flush = () => new Promise(r => setTimeout(r, 5));
const P = (extra = {}) => load(['pcm-stream-player.js'], ['PcmStreamPlayer'], { window: {}, ...extra }).PcmStreamPlayer;

test('PCM: Int16LE → Float32 と奇数バイトの持ち越し', () => {
  const p = P(); const cut = p.makeCarry();
  assert.equal(cut(new Uint8Array([0x00, 0x40, 0xff])).length, 2);
  const b = cut(new Uint8Array([0x7f])); // 0xff,0x7f → 32767
  assert.deepEqual([...b], [0xff, 0x7f]);
  assert.ok(Math.abs(p.toFloat(b)[0] - 32767 / 32768) < 1e-9);
  assert.equal(p.toFloat(new Uint8Array([0x00, 0x80]))[0], -1);
});

test('PCM: 隙間なく start(at) で並べ、最後のかたまりが鳴り終わってから ended', async () => {
  const p = P(), c = fakeCtx(); let ended = 0;
  const a = p.create(readerOf([new Uint8Array(4800), new Uint8Array(4801), new Uint8Array(1)]), new Uint8Array(4800), { ctx: c });
  a.addEventListener('ended', () => ended++);
  await a.play(); await flush();
  assert.equal(c.sources.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(c.sources[i].at - (c.sources[i - 1].at + 0.1)) < 1e-9, `contiguous ${i}`);
  assert.ok(c.sources[0].at >= 10);
  for (let i = 0; i < 3; i++) c.sources[i].onended();
  assert.equal(ended, 0, '最後が鳴り終わるまでは ended を出さない（マイクは閉じたまま）');
  c.sources[3].onended(); assert.equal(ended, 1);
});

test('PCM: pause(停止ボタン) で fetch を止め、鳴っている音も止める・ended は出さない', async () => {
  const p = P(), c = fakeCtx(); let aborted = 0, ended = 0;
  const r = readerOf([new Uint8Array(100)]);
  const a = p.create(r, new Uint8Array(100), { ctx: c, abort: () => aborted++ });
  a.addEventListener('ended', () => ended++);
  await a.play(); await flush(); a.pause();
  assert.equal(aborted, 1); assert.ok(r.cancelled); assert.ok(c.sources.every(s => s.stopped));
  assert.equal(ended, 0);
});

test('PCM: 途中で切れたら truncated を記録して、そこまで鳴らして ended', async () => {
  const p = P(), c = fakeCtx(), logs = []; let ended = 0;
  const a = p.create(readerOf([new Uint8Array(100)], { failAt: 1 }), new Uint8Array(100), { ctx: c, log: t => logs.push(t) });
  a.addEventListener('ended', () => ended++);
  await a.play(); await flush();
  assert.ok(a.truncated); assert.ok(logs.some(t => t.includes('truncated')));
  c.sources.forEach(s => s.onended()); assert.equal(ended, 1);
});

function provider(resps, { flag = null, ctx = fakeCtx() } = {}) {
  const calls = [];
  const storage = makeStorage(flag ? { 'cocomitalk-gemini-tts-stream': flag } : {});
  const win = { AudioContext: function () { return ctx; } };
  class FakeAudio { constructor(src) { this.src = src; } addEventListener() {} }
  const e = load(['tts-provider.js', 'pcm-stream-player.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider', 'PcmStreamPlayer'], {
    window: win, AudioContext: win.AudioContext, localStorage: storage, Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob:x' }, AbortController, Blob,
    ApiCommon: { getWorkerURL: () => 'https://w', getAuthToken: () => 't', hasAuthToken: () => true },
    fetch: async (u, o) => { calls.push({ u, o, body: JSON.parse(o.body) }); return resps.shift(); },
  });
  const g = new e.GeminiTTSProvider(); g._recordUsage = () => {};
  return { g, calls };
}
const hdr = (h) => ({ get: k => h[k.toLowerCase()] ?? null });
const pcmRes = (chunks) => ({ ok: true, status: 200, headers: hdr({ 'content-type': 'audio/L16; rate=24000; channels=1', 'server-timing': 'upstream-ttfb;dur=900, upstream-first;dur=1200' }), body: { getReader: () => readerOf(chunks) } });
const wavRes = () => ({ ok: true, status: 200, headers: hdr({ 'content-type': 'audio/wav' }), blob: async () => ({ size: 48044 }), arrayBuffer: async () => new ArrayBuffer(48044) });

test('provider: stream:true を送り、audio/L16 なら受け取りながら鳴らす', async () => {
  const { g, calls } = provider([pcmRes([new Uint8Array(480)])]);
  const a = await g.synthesize('こんにちは', 'Kore', { speed: 1.25 });
  assert.equal(calls.length, 1); assert.equal(calls[0].body.stream, true); assert.ok(calls[0].o.signal);
  assert.ok(String(a._ttsModel).endsWith('stream')); assert.equal(a._ttsTtfbMs, 900);
  a.playbackRate = 1.25; assert.equal(a.playbackRate, 1, '音程を変えないため1.0倍');
});

test('provider: 本番(中継未対応)が WAV を返したら今まで通り WAV で鳴らす', async () => {
  const { g, calls } = provider([wavRes()]);
  const a = await g.synthesize('こんにちは', 'Kore', {});
  assert.equal(calls.length, 1); assert.equal(a.src, 'blob:x');
});

test('provider: stream が0バイト/502 なら stream なしで送り直す', async () => {
  let { g, calls } = provider([pcmRes([]), wavRes()]);
  let a = await g.synthesize('やあ', 'Kore', {});
  assert.equal(calls.length, 2); assert.equal(calls[1].body.stream, undefined); assert.equal(a.src, 'blob:x');
  ({ g, calls } = provider([{ ok: false, status: 502, headers: hdr({}), json: async () => ({}) }, wavRes()]));
  a = await g.synthesize('やあ', 'Kore', {});
  assert.equal(calls.length, 2); assert.equal(calls[1].body.stream, undefined);
});

test("provider: 設定 'off' なら stream を送らない", async () => {
  const { g, calls } = provider([wavRes()], { flag: 'off' });
  await g.synthesize('やあ', 'Kore', {});
  assert.equal(calls[0].body.stream, undefined);
});

test('v3.97(j): stream で 400/401/403/500/502/504 など !ok(429以外) なら必ず1回だけ WAV で送り直す', async () => {
  for (const status of [400, 401, 403, 500, 502, 504]) {
    const { g, calls } = provider([{ ok: false, status, headers: hdr({}), json: async () => ({}) }, wavRes()]);
    const a = await g.synthesize('やあ', 'Kore', {});
    assert.equal(calls.length, 2, `status ${status}`); assert.equal(calls[0].body.stream, true); assert.equal(calls[1].body.stream, undefined); assert.equal(a.src, 'blob:x');
  }
});

test('v3.97(j): 送り直し(WAV)も失敗したらそれ以上は繰り返さずエラー', async () => {
  const bad = (s) => ({ ok: false, status: s, headers: hdr({}), json: async () => ({ error: 'x' + s }) });
  const { g, calls } = provider([bad(500), bad(503), wavRes()]);
  await assert.rejects(g.synthesize('やあ', 'Kore', {}), /x503/);
  assert.equal(calls.length, 2);
  const p2 = provider([pcmRes([]), bad(500), wavRes()]);
  await assert.rejects(p2.g.synthesize('やあ', 'Kore', {}));
  assert.equal(p2.calls.length, 2);
});

test('v3.97(i): AudioContext が running でなければ stream を付けず WAV の <audio>', async () => {
  const ctx = fakeCtx(); ctx.state = 'suspended'; ctx.resume = function () {}; // 起こせない（ユーザー操作前）
  const { g, calls } = provider([wavRes()], { ctx });
  const a = await g.synthesize('やあ', 'Kore', {});
  assert.equal(calls.length, 1); assert.equal(calls[0].body.stream, undefined); assert.ok(!calls[0].o.signal); assert.equal(a.src, 'blob:x');
});

test('v3.97(i): PcmStreamPlayer.isRunning は state===running の時だけ true', () => {
  const ctx = fakeCtx(); const p = P({ window: { AudioContext: function () { return ctx; } } });
  assert.equal(p.isRunning(), false); p.ctx(); assert.equal(p.isRunning(), true);
  ctx.state = 'suspended'; assert.equal(p.isRunning(), false);
});

// ---- v3.98(j'): 429 は送り直さず、しばらく Google を呼ばない ----
const r429 = (ra) => ({ ok: false, status: 429, headers: hdr(ra == null ? {} : { 'retry-after': ra }), json: async () => ({ error: 'rate' }) });
test("v3.98(j'): stream で 429 → WAV で送り直さずエラー（呼び出しは1回）", async () => {
  const { g, calls } = provider([r429('5'), wavRes()]);
  await assert.rejects(g.synthesize('やあ', 'Kore', {}), /429/);
  assert.equal(calls.length, 1); assert.ok(g.inCooldown());
});
test("v3.98(j'): Retry-After 秒の間は fetch せずすぐ例外、過ぎたらまた呼ぶ", async () => {
  const { g, calls } = provider([r429('5'), wavRes()]);
  const t = Date.now();
  await assert.rejects(g.synthesize('やあ', 'Kore', {}));
  assert.ok(Math.abs(g._cooldownUntil - (t + 5000)) < 1000);
  await assert.rejects(g.synthesize('もう一回', 'Kore', {}), /待ち中/);
  assert.equal(calls.length, 1, '待ち中は Google（中継）を呼ばない');
  g._cooldownUntil = Date.now() - 1;
  const a = await g.synthesize('やあ', 'Kore', { noStream: true });
  assert.equal(a.src, 'blob:x'); assert.equal(calls.length, 2);
});
test("v3.98(j'): Retry-After が無い/読めない時は20秒、WAV(noStream)の429でも同じ", async () => {
  for (const ra of [null, 'abc']) {
    const { g } = provider([r429(ra)]);
    const t = Date.now();
    await assert.rejects(g.synthesize('やあ', 'Kore', { noStream: true }), /429/);
    assert.ok(Math.abs(g._cooldownUntil - (t + 20000)) < 1000, String(ra));
  }
});
