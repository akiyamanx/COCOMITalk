// COCOMITalk - 受け取りながら読み上げ(v3.93)のテスト（voice-stream.js / api-common.js / chat-core.js / gemini-tts-provider.js）
// このファイルは node --test tests/ で実行する。最初の1文で鳴り始める・2つ同時・マイクは返事全体で1回だけ開く（ハウリング防止）を確かめる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, ROOT } = require('./_load');

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** 本物の voice-output の代わりの小さな再生係（合成は手動で完了させる） */
function setup() {
  const ev = [];
  class AudioPlaybackManager {
    constructor() { this._gen = 0; this._playing = false; this._preparing = false; this._queuePlaying = false; this.synths = []; }
    _synth(text) { let res; const p = new Promise(r => { res = r; }); this.synths.push({ text, res }); ev.push('synth:' + text); return p; }
    async _speakOneChunk(text, v, s, o, pre) { await pre; ev.push('play:' + text); await tick(1); }
    _cleanTextForTTS(t) { return t.trim(); }
    _tlog() {} _log() {} _ttsInfo() { return ''; }
    stop() { this._gen++; this._playing = false; ev.push('stop'); }
  }
  const e = load(['tone-style.js', 'voice-fast.js', 'voice-stream.js'], ['VoiceStream', 'ToneStyle'],
    { window: {}, AudioPlaybackManager, getSisterVoice: () => ({ voice: 'Leda' }), setTimeout, clearTimeout });
  const pm = new AudioPlaybackManager();
  pm.onPlayStart = () => ev.push('START'); pm.onPlayEnd = () => ev.push('END');
  return { VS: e.VoiceStream, pm, ev };
}

test('切り方: 1つ目は最初の1文（30字以内）、短すぎる1文は次とつなぐ、まだ終わらない文は待つ', () => {
  const { VS } = setup();
  assert.equal(VS.nextPiece('こんにちは、今日はいい天気だね！それでね', 0, 0).piece, 'こんにちは、今日はいい天気だね！');
  assert.equal(VS.nextPiece('うん！', 0, 0), null, '8字未満は次の文を待つ');
  assert.equal(VS.nextPiece('うん！', 0, 0, { done: true }).piece, 'うん！', '返事が終わっていれば短いまま');
  assert.equal(VS.nextPiece('うん！そうだね、いいと思うよ。次', 0, 0).piece, 'うん！そうだね、いいと思うよ。');
  assert.equal(VS.nextPiece('今日は', 0, 0), null, '文の途中は待つ');
  const long = 'あのね今日はね、とっても長いお話があってね、それはもう本当に長いんだけど聞いてくれる';
  const r = VS.nextPiece(long, 0, 0);
  assert.ok(r && r.piece.endsWith('、') && r.piece.length <= 31, '30字を超えたら「、」で切る');
});

test('切り方: 2つ目以降は終わった文だけ、上限60/150字、急がない時は貯める', () => {
  const { VS } = setup();
  const t = 'はじめの文です、ここまで。二つ目。三つ目の文。';
  const p0 = 'はじめの文です、ここまで。'.length;
  assert.equal(VS.nextPiece(t + '四つ', p0, 1, { need: false }), null, '枠が空いてない時は貯める');
  assert.equal(VS.nextPiece(t + '四つ', p0, 1, { need: true }).piece, '二つ目。三つ目の文。');
  assert.equal(VS.nextPiece(t + '四つ', p0, 1, { done: true }).piece, '二つ目。三つ目の文。四つ');
  assert.equal(VS.limitFor(0), 30); assert.equal(VS.limitFor(1), 60); assert.equal(VS.limitFor(5), 150);
  assert.equal(VS.view('[tone:cheer]やった！💾SAVE:秘密'), 'やった！', 'トーンタグと💾以降は読まない');
});

test('読み上げ: 最初の1文が届いたら合成開始、2つまで同時、END は最後に1回（間でマイクを開けない）', async () => {
  const { pm, ev } = setup();
  const ss = pm.speakStream('koharu', {});
  ss.push('[tone:cheer]やっほー、元気だった？');
  assert.deepEqual(ev, ['START', 'synth:やっほー、元気だった？'], '1文目ですぐ鳴らす準備');
  assert.equal(pm._playing, true);
  ss.push('今日はね、公園に行ったよ。そしたら猫がいてね。');
  await tick(5);
  assert.equal(pm.synths.length, 2, '2つ目も同時に作り始める');
  pm.synths[0].res({}); await tick(20);
  assert.ok(ev.includes('play:やっほー、元気だった？'));
  assert.ok(!ev.includes('END'), '返事が届き終わるまでマイクは止めたまま');
  pm.synths[1].res({}); await tick(300);
  assert.ok(!ev.includes('END'), '到着待ちの間も話し中');
  assert.equal(ss.finish('やっほー、元気だった？今日はね、公園に行ったよ。そしたら猫がいてね。かわいかった！'), true);
  await tick(5);
  pm.synths.slice(2).forEach(s => s.res({})); await tick(50);
  assert.equal(ev.filter(x => x === 'END').length, 1);
  assert.equal(ev[ev.length - 1], 'END');
  const said = ev.filter(x => x.startsWith('play:')).map(x => x.slice(5)).join('');
  assert.equal(said, 'やっほー、元気だった？今日はね、公園に行ったよ。そしたら猫がいてね。かわいかった！', '重なり・抜けなし');
  assert.equal(pm._playing, false);
});

test('読み上げ: 1つも声にしないまま終わったら false（呼び出し側が今まで通り読む）、途中で stop されたら END を出さない', async () => {
  const { pm, ev } = setup();
  const ss = pm.speakStream('koharu', {});
  ss.push('うん');
  assert.equal(ss.finish('うん'), false);
  assert.deepEqual(ev, []);
  const s2 = pm.speakStream('koharu', {});
  s2.push('こんにちは、元気にしてた？');
  pm.stop(); pm.synths.forEach(s => s.res({})); s2.finish('こんにちは、元気にしてた？');
  await tick(50);
  assert.ok(!ev.includes('END'));
});

test('配線: 音声会話中かつ対応API(openai/claude)だけストリーム。sw v3.93、index.html は voice-output の後', () => {
  const { VS } = setup();
  assert.equal(VS.begin({ supportsStream: false }, 'x', { voiceController: { isEnabled: () => true } }), null);
  assert.equal(VS.begin({ supportsStream: true }, 'x', { voiceController: { isEnabled: () => false } }), null);
  assert.match(src('api-openai.js'), /supportsStream: true/);
  assert.match(src('api-claude.js'), /supportsStream: true/);
  for (const f of ['api-gemini.js', 'api-xai.js', 'api-kimi.js']) if (fs.existsSync(path.join(ROOT, f))) assert.doesNotMatch(src(f), /supportsStream: true/, f);
  const cc = src('chat-core.js');
  assert.match(cc, /ss\.finish\(reply\)\)\) window\.voiceController\.speakResponse/);
  assert.match(cc, /if \(ss\) ss\.finish\(null\)/);
  const html = src('index.html');
  assert.ok(html.indexOf('src="voice-output.js"') < html.indexOf('src="voice-stream.js"'));
  assert.ok(src('sw.js').includes("'./voice-stream.js'"));
  assert.ok(src('voice-stream.js').split('\n').length <= 500);
  assert.match(src('voice-input.js'), /1500/, '1.5秒待ちはそのまま');
});

test('api-common: SSEを受け取りながら onDelta、ツール呼び出しなら null（通常送信へ）', async () => {
  const enc = new TextEncoder();
  const mk = (lines) => async () => ({ ok: true, body: { getReader() { let i = 0; return { read: async () => i < lines.length ? { done: false, value: enc.encode(lines[i++]) } : { done: true }, cancel: async () => {} }; } } });
  const run = async (lines, ep = 'openai') => {
    const e = load(['api-common.js'], ['ApiCommon'], { window: {}, localStorage: { getItem: () => '{"geminiKey":"tok"}', setItem() {} }, fetch: mk(lines), TextEncoder, TextDecoder, AbortController });
    const got = []; const t = await e.ApiCommon.streamText(ep, { model: 'm' }, d => got.push(d)); return { t, got };
  };
  const a = await run(['data: {"choices":[{"delta":{"content":"やあ"}}]}\n', 'data: {"choices":[{"delta":{"content":"！"}}]}\ndata: [DONE]\n']);
  assert.equal(a.t, 'やあ！'); assert.deepEqual(a.got, ['やあ', '！']);
  const b = await run(['data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}\n']);
  assert.equal(b.t, null);
  const c = await run(['data: {"type":"content_block_delta","delta":{"text":"はい"}}\n', 'data: {"type":"content_block_start","content_block":{"type":"tool_use"}}\n'], 'claude');
  assert.equal(c.t, null);
});

test('Gemini TTS: Server-Timing の upstream ms を読む', () => {
  const e = load(['tts-provider.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider'], { window: {}, localStorage: { getItem: () => null, setItem() {} } });
  assert.equal(e.GeminiTTSProvider.upstreamMs('upstream;dur=1234.6'), 1235);
  assert.equal(e.GeminiTTSProvider.upstreamMs('cache;desc=x, upstream;dur=50'), 50);
  assert.equal(e.GeminiTTSProvider.upstreamMs(''), null);
});
