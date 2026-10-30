// COCOMITalk - 音声認識モデル設定(stt-model.js)・Gemini TTS・読み上げの戻し先・単価の日付切替のテスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない。fetch/ApiCommonは差し替え）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, makeStorage } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));

// ---- SttModel ----
class FD { constructor() { this.m = new Map(); } append(k, v) { this.m.set(k, v); } set(k, v) { this.m.set(k, v); } get(k) { return this.m.get(k); } }

function stt(init = {}, behave) {
  const calls = [];
  const storage = makeStorage(init);
  const ApiCommon = { callAPI: async (p, fd, o) => { calls.push({ p, model: fd.get('model'), lang: fd.get('language'), prompt: fd.get('prompt'), o }); return behave(fd.get('model'), calls.length); } };
  const e = load(['stt-model.js'], ['SttModel'], { localStorage: storage, FormData: FD, ApiCommon });
  return { S: e.SttModel, calls, storage };
}
const ok = async () => ({ text: 'こんにちは' });

test('STT: 既定は gpt-transcribe。不正な保存値は既定へ。whisper-1 も選べる', () => {
  assert.equal(stt({}, ok).S.get(), 'gpt-transcribe');
  assert.equal(stt({ 'cocomitalk-stt-model': 'constructor' }, ok).S.get(), 'gpt-transcribe');
  assert.equal(stt({ 'cocomitalk-stt-model': 'bogus' }, ok).S.get(), 'gpt-transcribe');
  const { S, storage } = stt({}, ok);
  assert.equal(S.set('whisper-1'), 'whisper-1');
  assert.equal(storage.getItem('cocomitalk-stt-model'), 'whisper-1');
  assert.equal(S.set('nope'), 'gpt-transcribe');
});

test('STT: 通常は選んだモデルで1回だけ呼ぶ（language=ja・promptを送る）', async () => {
  const { S, calls } = stt({}, ok);
  const r = await S.transcribe('blob', 'webm', 'ほげ');
  assert.equal(r.text, 'こんにちは');
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].p, calls[0].model, calls[0].lang, calls[0].prompt, calls[0].o.isFormData], ['whisper', 'gpt-transcribe', 'ja', 'ほげ', true]);
});

test('STT: 新モデルが失敗したら whisper-1 で1回だけやり直し、10分は旧モデルで送る', async () => {
  const { S, calls } = stt({}, async (m) => { if (m === 'gpt-transcribe') throw new Error('400'); return { text: 'ok' }; });
  assert.equal((await S.transcribe('b', 'webm')).text, 'ok');
  assert.deepEqual(calls.map(c => c.model), ['gpt-transcribe', 'whisper-1']);
  assert.equal(S.effectiveModel(), 'whisper-1');
  calls.length = 0;
  await S.transcribe('b', 'webm');
  assert.deepEqual(calls.map(c => c.model), ['whisper-1']);              // 失敗記憶中は最初から旧モデル
  assert.equal(S.effectiveModel(Date.now() + 11 * 60 * 1000), 'gpt-transcribe'); // 10分後は新モデルに戻す
  S.resetFailure();
  assert.equal(S.effectiveModel(), 'gpt-transcribe');
});

test('STT: 中断(AbortError)はやり直さない。旧モデル自身の失敗もやり直さない', async () => {
  const a = stt({}, async () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; });
  await assert.rejects(() => a.S.transcribe('b', 'webm'), { name: 'AbortError' });
  assert.equal(a.calls.length, 1);
  const w = stt({ 'cocomitalk-stt-model': 'whisper-1' }, async () => { throw new Error('boom'); });
  await assert.rejects(() => w.S.transcribe('b', 'webm'), /boom/);
  assert.equal(w.calls.length, 1);
});

test('STT: 旧モデル停止日(2027-02-26)の翌日以降は戻さない', async () => {
  const { S } = stt({}, ok);
  assert.equal(S.legacyAlive('2027-02-26'), true);
  assert.equal(S.legacyAlive('2027-02-27'), false);
  assert.equal(S.LEGACY_RETIRE, '2027-02-26');
});

test('STT: 無音区切りは 1.2/1.5/3/4/5 秒・既定1.5秒（v3.92で速く）', () => {
  const { S, storage } = stt({}, ok);
  assert.equal(S.getSilenceMs(), 1500);
  assert.equal(S.setSilenceMs(5000), 5000);
  assert.equal(S.getSilenceMs(), 5000);
  assert.equal(S.setSilenceMs(1), 1500);
  storage.setItem('cocomitalk-stt-silence-ms', '999999');
  assert.equal(S.getSilenceMs(), 1500);
  assert.deepEqual(plain(S.SILENCE_CHOICES), [1200, 1500, 2000, 2500, 3000, 4000, 5000]);
});

// ---- Gemini TTS ----
function wav(seconds) { // 24kHz mono 16bit = byteRate 48000
  const n = Math.round(seconds * 48000), b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

function gem(init = {}, fetchImpl) {
  const fetched = [], rec = [], storage = makeStorage(init);
  class Audio { constructor(u) { this.url = u; this.l = {}; } addEventListener(ev, f) { this.l[ev] = f; } }
  const ApiCommon = { hasAuthToken: () => true, getWorkerURL: () => 'https://w.example', getAuthToken: () => 'tok' };
  const win = {};
  const e = load(['tts-provider.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider', 'SISTER_VOICE_MAP'], {
    localStorage: storage, window: win, ApiCommon, Audio, Blob: class { constructor(p, o) { this.p = p; this.o = o; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, TokenMonitor: { record: (...a) => rec.push(a) },
    fetch: async (u, o) => { fetched.push({ u, o: { ...o, body: JSON.parse(o.body) } }); return fetchImpl(); },
  });
  return { G: e.GeminiTTSProvider, MAP: e.SISTER_VOICE_MAP, fetched, rec, storage };
}
const okRes = (secs) => async () => ({ ok: true, arrayBuffer: async () => wav(secs) });

test('Gemini TTS: 声が空なら中継を呼ばずに例外（声が無い時の保険）', async () => {
  const { G, fetched } = gem({}, okRes(1));
  const p = new G();
  await assert.rejects(() => p.synthesize('こんにちは', ''), /未割り当て/);
  await assert.rejects(() => p.synthesize('こんにちは', undefined), /未割り当て/);
  await assert.rejects(() => p.synthesize('  ', 'Kore'), /空/);
  assert.equal(fetched.length, 0);
});

test('Gemini TTS: /gemini-tts へ {text,voice,model} を認証ヘッダ付きで送る。既定は lite、設定で flash', async () => {
  const { G, fetched } = gem({}, okRes(2));
  const a = await new G().synthesize('こんにちは', 'Kore');
  assert.equal(fetched[0].u, 'https://w.example/gemini-tts');
  assert.equal(fetched[0].o.headers['X-COCOMI-AUTH'], 'tok');
  assert.deepEqual(plain(fetched[0].o.body), { text: 'こんにちは', voice: 'Kore', model: 'gemini-3.8-flash-lite-tts' });
  assert.equal(a._ttsProvider, 'gemini');
  G.setQuality('flash');
  await new G().synthesize('x', 'Puck');
  assert.equal(fetched[1].o.body.model, 'gemini-3.8-flash-tts');
  assert.equal(G.setQuality('bogus'), 'lite');
  await new G().synthesize('y', 'Puck', { model: 'gemini-3.8-flash-tts' });
  assert.equal(fetched[2].o.body.model, 'gemini-3.8-flash-tts');
});

test('Gemini TTS: 長文は1500字で切る／エラーJSONのメッセージを例外に／WAV長から25トークン/秒で使用量を記録', async () => {
  const { G, fetched, rec } = gem({}, okRes(4));
  await new G().synthesize('あ'.repeat(2000), 'Kore');
  assert.equal(fetched[0].o.body.text.length, 1500);
  assert.equal(rec.length, 1);
  assert.deepEqual(plain(rec[0]), ['gemini-3.8-flash-lite-tts', 750, 100]);
  const bad = gem({}, async () => ({ ok: false, status: 400, json: async () => ({ error: 'voice not allowed' }) }));
  await assert.rejects(() => new bad.G().synthesize('x', 'Kore'), /voice not allowed/);
  const bad2 = gem({}, async () => ({ ok: false, status: 502, json: async () => { throw new Error('x'); } }));
  await assert.rejects(() => new bad2.G().synthesize('x', 'Kore'), /502/);
});

test('Gemini TTS: wavSeconds はRIFFだけ読む／声は公式30種', () => {
  const { G } = gem({}, okRes(1));
  assert.ok(Math.abs(G.wavSeconds(wav(3)) - 3) < 1e-6);
  assert.equal(G.wavSeconds(new ArrayBuffer(10)), 0);
  assert.equal(G.wavSeconds(new Uint8Array(100).buffer), 0);
  assert.equal(G.PREBUILT_VOICES.length, 30);
  assert.equal(new Set(G.PREBUILT_VOICES).size, 30);
  assert.equal(new G().getAvailableVoices().length, 30);
});

// ---- voice-output: 声が未割り当て/失敗なら OpenAI の声へ戻す ----
function vo(geminiImpl) {
  const log = [];
  const e = load(['tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager', 'SISTER_VOICE_MAP'], {
    window: {}, localStorage: makeStorage(),
    OpenAITTSProvider: class { isAvailable() { return true; } async synthesize(t, v, o) { log.push(['openai', v]); return { from: 'openai' }; } },
    VoicevoxTTSProvider: undefined,
    GeminiTTSProvider: class { async synthesize(t, v, o) { log.push(['gemini', v]); return geminiImpl(v); } },
  });
  const m = new e.AudioPlaybackManager();
  return { m, log, MAP: e.SISTER_VOICE_MAP };
}

test('読み上げ: Gemini選択で声が空（失敗）ならOpenAIの姉妹の声で再生、成功ならそのまま', async () => {
  const bad = vo(async (v) => { if (!v) throw new Error('未割り当て'); return { from: 'gemini' }; });
  bad.m.switchProvider('gemini');
  const r = await bad.m._synth('こんにちは', '', 'gpt', 1);
  assert.equal(r.from, 'openai');
  assert.deepEqual(plain(bad.log), [['gemini', ''], ['openai', bad.MAP.gpt.openai.voice]]);
  const good = vo(async () => ({ from: 'gemini' }));
  good.m.switchProvider('gemini');
  assert.equal((await good.m._synth('x', 'Kore', 'gpt', 1)).from, 'gemini');
  assert.equal(good.log.length, 1);
});

test('読み上げ: OpenAI選択のときはGeminiを呼ばず、失敗はそのまま投げる（従来どおり）', async () => {
  const t = vo(async () => ({ from: 'gemini' }));
  t.m.switchProvider('openai'); // 既定はGeminiになったので明示的にOpenAIへ
  t.m._openaiProvider.synthesize = async () => { throw new Error('openai down'); };
  await assert.rejects(() => t.m._synth('x', 'alloy', 'gpt', 1), /openai down/);
  assert.equal(t.log.length, 0);
});

// ---- 単価（2027-01-01 に Gemini TTS は2倍） ----
test('単価: Gemini TTS は 2026-12-31 まで $6/$9、2027-01-01 から $12/$18（出力100万トークン）', () => {
  const T = load(['model-tiers.js'], ['ModelTiers'], { localStorage: makeStorage() }).ModelTiers;
  const out = (id, d) => T.getPricing(id, d).output;
  assert.equal(out('gemini-3.8-flash-lite-tts', '2026-12-31'), 6);
  assert.equal(out('gemini-3.8-flash-lite-tts', '2027-01-01'), 12);
  assert.equal(out('gemini-3.8-flash-tts', '2026-12-31'), 9);
  assert.equal(out('gemini-3.8-flash-tts', '2027-01-01'), 18);
  assert.equal(T.getPricing('gpt-6-astra', '2026-10-28').output, 50);
});

test('単価: TokenMonitor が Astra と Gemini TTS を段階表から引く（未知モデルの安い単価に落ちない）', () => {
  const env = load(['model-tiers.js', 'characters.js', 'token-monitor.js'], ['TokenMonitor'], { indexedDB: {}, document: { getElementById: () => null }, localStorage: makeStorage() });
  const cost = (m) => env.TokenMonitor.calcCostUSD({ byModel: { [m]: { input: 1e6, output: 1e6 } } });
  assert.ok(Math.abs(cost('gpt-6-astra') - 60) < 1e-9);
  assert.ok(cost('gemini-3.8-flash-lite-tts') > 1);
});
