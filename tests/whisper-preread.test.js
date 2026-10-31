// COCOMITalk - v4.2 先読み（案B）＋準備の並行化のテスト（クロの条件①〜⑧を1つずつ固定）
// このファイルは node --test tests/*.test.js で実行する。MediaRecorder/AudioContext/中継は偽物（実マイク・実APIなし）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('./_load');
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const Blob = function (parts, o) { this.parts = parts; this.type = o && o.type; this.size = parts.reduce((n, p) => n + p.size, 0); };
const W = (extra = {}) => load(['whisper-preread.js'], ['WhisperPreread'], { Blob, localStorage: extra.ls || { getItem: () => null, setItem() {} }, ...extra }).WhisperPreread;
const ch = (n, size = 1000) => Array.from({ length: n }, (_, i) => ({ size, i }));
function deps(over = {}) {
  const calls = [], shown = [], logs = [];
  return { calls, shown, logs, d: Object.assign({
    transcribe: (blob, ext, prompt, seq) => { calls.push({ blob, prompt, seq }); return Promise.resolve({ text: `文${seq}。` }); },
    log: m => logs.push(m), show: t => shown.push(t), canSend: () => true,
  }, over) };
}
const flush = () => new Promise(r => setImmediate(r));

test('① 区切りは設定秒数のまま: 先読みは1秒・区切りタイマーは _SILENCE_DURATION のまま', () => {
  assert.equal(W().PROVISIONAL_MS, 1000);
  const wp = src('whisper-provider.js');
  assert.ok(wp.includes('}, this._SILENCE_DURATION);'), '区切りは従来の設定値');
  assert.ok(wp.includes('WhisperPreread.PROVISIONAL_MS < this._SILENCE_DURATION'), '区切りより早い時だけ仮を送る');
});

test('② 仮は最大3回。4回目が要る時は確定で null（＝全体を1回）', async () => {
  const P = W(); const t = deps(); const pre = P.create(t.d);
  const c = ch(4);
  for (let i = 0; i < 3; i++) { pre.onVoice(); assert.equal(pre.provisional(c.concat(ch(4 * i)), 'audio/webm', 'webm'), true); }
  pre.onVoice(); assert.equal(pre.provisional(c.concat(ch(20)), 'audio/webm', 'webm'), false);
  await flush(); assert.equal(t.calls.length, 3); assert.equal(pre.overflow, true);
  assert.equal(await pre.confirm(), null);
});

test('③ 仮の文字は「🎤 聞き取り中:」で薄く表示だけ（確定は別）。準備の検索やり直し判定は1.5倍 or 含まない', async () => {
  const P = W(); const t = deps(); const pre = P.create(t.d);
  pre.onVoice(); pre.provisional(ch(4), 'audio/webm', 'webm'); await flush();
  assert.deepEqual(t.shown, ['🎤 聞き取り中: 文1。']);
  assert.ok(src('voice-ui.js').includes("text.startsWith('🎤 聞き取り中:')) ? '0.55'"));
  const VP = load(['voice-prep.js'], ['VoicePrep']).VoicePrep;
  assert.equal(VP.needRedo('今日の天気', '今日の天気'), false);
  assert.equal(VP.needRedo('今日の天気', '今日の天気は晴れかな教えて'), true, '1.5倍以上');
  assert.equal(VP.needRedo('今日の天気', '明日の天気'), true, '含まない');
  assert.equal(VP.needRedo('', 'なにか'), true);
});

test('③ 準備: 録音停止で文字なし部分を開始・仮の文字で検索・確定文が違えば検索はやり直し（pVecを渡さない）', () => {
  const pf = []; const logs = [];
  const PB = { prefetch: (o) => { pf.push(o); return { pMem: Promise.resolve('M'), pHot: Promise.resolve('H'), pChat: Promise.resolve('C') }; },
    prefetchVector: (t) => Promise.resolve(`V:${t}`) };
  const sb = { PromptBuilder: PB, VoiceFast: { isVoiceOn: () => true, tlog: m => logs.push(m) }, ChatCore: { getCurrentSister: () => 'koko' } };
  const VP = load(['voice-prep.js'], ['VoicePrep'], sb).VoicePrep;
  const key = {};
  assert.equal(VP.begin(key), true); assert.equal(VP.begin(key), false, '同じ発話で2回始めない');
  VP.provisional('今日の天気');
  const same = VP.take('koko', '今日の天気');
  assert.ok(same.pMem && same.pHot && same.pChat && same.pVec);
  VP.begin({}); VP.provisional('今日の天気');
  const diff = VP.take('koko', '全然ちがう長い長い長い確定文');
  assert.ok(diff.pMem && !diff.pVec, '検索は確定文でやり直す');
  VP.begin({}); assert.equal(VP.take('gemini', 'x'), null, 'キャラ違いは使わない');
  assert.ok(logs.some(l => l.startsWith('🧩 準備開始')));
  assert.match(src('chat-core.js'), /VoicePrep\.take\(currentSister, userText\)[^\n]*PromptBuilder\.build\(\{ mode: 'chat', sister: currentSister, userText, prefetched \}\)/);
});

test('④ 確定は飛んでいる仮を待つ（新しく送らない）。新しい仮の結果が勝ち・後から来た古い応答で上書きしない', async () => {
  const P = W(); let r1;
  const t = deps({ transcribe: (b, e, p, seq) => { t.calls.push(seq); return seq === 1 ? new Promise(r => { r1 = r; }) : Promise.resolve({ text: 'はじめ。つづき。' }); } });
  const pre = P.create(t.d);
  pre.onVoice(); pre.provisional(ch(4), 'audio/webm', 'webm');
  pre.onVoice(); pre.provisional(ch(8), 'audio/webm', 'webm');
  await flush();
  assert.deepEqual(t.shown, ['🎤 聞き取り中: はじめ。つづき。']);
  let done = null; const c = pre.confirm().then(v => { done = v; });
  await flush(); assert.equal(done, null, 'まだ待っている');
  r1({ text: 'はじめ。' }); await c;
  assert.equal(JSON.stringify(done), JSON.stringify({ text: 'はじめ。つづき。', sends: 2 }), '最新の仮（全部の音）で確定');
  assert.equal(t.shown.at(-1), '🎤 聞き取り中: はじめ。つづき。', '古い仮1は表示を上書きしない');
  assert.equal(t.calls.length, 2, '確定で新しい送信はしない');
});

test('⑤(v4.3) 仮2・仮3も最初から全部（正しいwebm・続きの切り出しなし）・結果は置き換え。最後の仮の後に声があれば全体1回。保険ONも全体1回', async () => {
  const t = deps({ transcribe: (blob, e, prompt, seq) => { t.calls.push({ blob, prompt, seq }); return Promise.resolve({ text: `全部${seq}` }); } });
  const pre = W().create(t.d);
  const c = ch(9).map((x, i) => ({ size: 1000 + i }));
  pre.onVoice(); pre.provisional(c.slice(0, 4), 'audio/webm', 'webm'); await flush();
  pre.onVoice(); pre.provisional(c.slice(0, 6), 'audio/webm', 'webm'); await flush();
  pre.onVoice(); pre.provisional(c, 'audio/webm', 'webm'); await flush();
  assert.equal(t.calls[1].blob.parts.map(p => p.size).join(','), '1000,1001,1002,1003,1004,1005');
  assert.equal(t.calls[2].blob.parts.length, 9);
  assert.ok(t.calls.every(x => x.prompt === ''), '直前の文字をpromptに足さない');
  assert.equal(t.shown.at(-1), '🎤 聞き取り中: 全部3', '置き換え（つながない）');
  assert.equal(JSON.stringify(await pre.confirm()), JSON.stringify({ text: '全部3', sends: 3 }));
  assert.ok(!src('whisper-preread.js').includes('[chunks[0]].concat'), '続きの切り出しは廃止');
  const t3 = deps(); const pre3 = W().create(t3.d);
  pre3.onVoice(); pre3.provisional(ch(4), 'audio/webm', 'webm'); pre3.onVoice();
  assert.equal(await pre3.confirm(), null, '最後の仮の後に声→全体1回');
  const m = new Map([['cocomitalk-stt-confirm-resend', '1']]);
  const P2 = W({ ls: { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v) } });
  assert.equal(P2.resendOn(), true);
  const t2 = deps(); const pre2 = P2.create(t2.d); pre2.onVoice(); pre2.provisional(ch(4), 'audio/webm', 'webm');
  assert.equal(await pre2.confirm(), null, '保険ON→全体1回');
  assert.equal(W().resendOn(), false, '既定OFF');
  assert.ok(src('index.html').includes('id="sel-stt-confirm-resend"'));
});

// ---- WhisperProvider を偽の環境で（⑥⑦⑧） ----
function env(transcribe) {
  let now = 1000; const recs = []; const logs = [];
  class FakeRec { constructor() { this.state = 'inactive'; recs.push(this); } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; }
    emit(size) { this.ondataavailable && this.ondataavailable({ data: { size } }); } static isTypeSupported() { return true; } }
  const track = { readyState: 'live', muted: false, stop() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  let speaking = false; const sent = [];
  const window = { voiceState: { isSpeaking: () => speaking }, DebugLogger: { addLog: l => logs.push(l) } };
  const sandbox = {
    window, document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
    navigator: { mediaDevices: { getUserMedia: async () => stream } }, MediaRecorder: FakeRec, MediaStream: function () {}, Blob,
    Date: class extends Date { static now() { return now; } }, setTimeout: (f, ms) => (ms <= 300 ? setImmediate(f) : 0), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    localStorage: { getItem: () => null, setItem() {} },
    SttModel: { getSilenceMs: () => 3000, transcribe: async (blob, ext, prompt) => { sent.push({ blob, prompt }); return transcribe(sent.length); } },
    SpeechProvider: class { constructor(n) { this.name = n; } },
  };
  window.AudioContext = function () { return { state: 'running', resume: async () => {}, close: async () => {}, createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), createAnalyser: () => ({ frequencyBinCount: 4, getByteFrequencyData() {} }) }; };
  const e = load(['stt-noise-filter.js', 'whisper-vad-guard.js', 'whisper-provider.js', 'whisper-recovery.js', 'whisper-preread.js'], ['WhisperProvider'], sandbox);
  return { P: e.WhisperProvider, recs, sent, logs, setText: () => {}, tick: ms => { now += ms; }, setSpeaking: v => { speaking = v; } };
}
async function talk(E, p) { const r = E.recs.at(-1); for (let i = 0; i < 6; i++) r.emit(1000); p._hasVoiceStarted = true; p._pre.onVoice(); E.tick(2000); }

test('⑥ 読み上げ中/pause中は仮送信しない・先読みはマイク(recorder)の開閉に触らない', async () => {
  const E = env(() => ({ text: 'x' }));
  const p = new E.P(); await p.start(); await talk(E, p);
  const n = E.recs.length; const rec = E.recs.at(-1);
  E.setSpeaking(true); p._provisionalSend();
  assert.equal(E.sent.length, 0, '読み上げ中は送らない');
  E.setSpeaking(false); p._paused = true; p._provisionalSend();
  assert.equal(E.sent.length, 0, 'pause中は送らない'); p._paused = false;
  p._provisionalSend(); await flush();
  assert.equal(E.sent.length, 1, '普段は送る');
  assert.equal(E.recs.length, n); assert.equal(rec.state, 'recording', '録音は止めない・作り直さない');
  assert.equal(p._processing, false, '区切りにはしない（①）');
});

test('⑦ 先読みで確定: 送り直しなし・確定文だけ onFinal・⏱に回数', async () => {
  const E = env(() => ({ text: 'こんにちは。' }));
  const p = new E.P(); const finals = []; const interims = [];
  p.onFinal = t => finals.push(t); p.onInterim = t => interims.push(t);
  await p.start(); await talk(E, p);
  p._provisionalSend(); await flush();
  assert.deepEqual(finals, [], '仮では onFinal しない（③）');
  assert.ok(interims.includes('🎤 聞き取り中: こんにちは。'));
  p._onSegmentEnd(); await p._sttQueue;
  assert.equal(E.sent.length, 1, '確定で送り直さない');
  assert.deepEqual(finals, ['こんにちは。']);
  assert.ok(E.logs.some(l => /⏱ STT 確定\(先読み\).*Whisper回数: 1回/.test(l)));
  assert.ok(src('whisper-preread.js').includes('{ label: `仮${seq}` }'), '仮にも⏱ STT[仮N] が付く');
});

test('⑧ 仮が失敗(5xx)しても確定時に全体を1回送る（発話を落とさない）', async () => {
  const E = env(n => { if (n === 1) throw new Error('HTTP 503'); return { text: '全体。' }; });
  const p = new E.P(); const finals = []; p.onFinal = t => finals.push(t);
  await p.start(); await talk(E, p);
  p._provisionalSend(); await flush();
  p._onSegmentEnd(); await p._sttQueue;
  assert.equal(E.sent.length, 2);
  assert.deepEqual(finals, ['全体。']);
  assert.ok(E.logs.some(l => /Whisper回数: 2回（仮1＋全体1）/.test(l)));
});

test('配線: index/sw に whisper-preread.js・voice-prep.js（provider/recoveryの後）、sw v4.2', () => {
  const html = src('index.html');
  const i = n => html.indexOf(`<script src="${n}"></script>`);
  assert.ok(i('whisper-recovery.js') < i('whisper-preread.js') && i('whisper-preread.js') < i('voice-prep.js') && i('voice-prep.js') > 0);
  const sw = src('sw.js');
  assert.ok(sw.includes("'./whisper-preread.js'") && sw.includes("'./voice-prep.js'") && sw.includes("const CACHE_NAME = 'cocomitalk-v4.4';"));
});

// ---- v4.3 雑音ハルシネーション除け ----
const F = () => load(['stt-noise-filter.js'], ['SttNoiseFilter']).SttNoiseFilter;
test('雑音除け: YouTube風の定型句だけ・おやすみ＋定型句は捨てる。話の後ろの定型句は外す', () => {
  const f = F();
  for (const x of ['ご視聴ありがとうございました。', 'おやすみなさい。 ご視聴ありがとうございました。', 'チャンネル登録お願いします', '高評価とチャンネル登録よろしくお願いします！',
    'Thank you for watching!', 'Thanks for watching.', '字幕：山田太郎', 'Subtitles by the Amara.org community', '♪', '(BGM)', '。。。'])
    assert.equal(f.clean(x, 30).drop, true, x);
  const r = f.clean('今日は楽しかったね。ご視聴ありがとうございました。', 30);
  assert.equal(r.drop, false); assert.equal(r.text, '今日は楽しかったね。');
});
test('雑音除け(控えめ): 単独の「おやすみなさい」はほぼ無音の時だけ捨てる・音量不明なら残す・普通の話はそのまま', () => {
  const f = F();
  assert.equal(f.clean('おやすみなさい。', 40).drop, false, '声がしっかりあれば本物');
  assert.equal(f.clean('おやすみなさい。', null).drop, false, '音量が分からなければ残す');
  assert.equal(f.clean('おやすみなさい。', 2).drop, true, 'ほぼ無音なら捨てる');
  for (const x of ['よろしくお願いします', '手伝ってくれてありがとうございました', 'ココちゃんのボイスボックスの声はやっぱりかわいいね。', '次回の旅行どこにする？'])
    { const r = f.clean(x, 30); assert.equal(r.drop, false, x); assert.equal(r.text, x); }
});
test('雑音除け(配線): 確定で捨てたら onFinal しない・⏱ログ。仮の表示にも出さない', async () => {
  const E = env(() => ({ text: 'おやすみなさい。 ご視聴ありがとうございました。' }));
  const p = new E.P(); const finals = []; const interims = [];
  p.onFinal = t => finals.push(t); p.onInterim = t => interims.push(t);
  await p.start(); await talk(E, p);
  p._provisionalSend(); await flush();
  assert.ok(!interims.some(t => t.includes('ご視聴')), '仮の表示に出さない');
  p._onSegmentEnd(); await p._sttQueue;
  assert.deepEqual(finals, []);
  assert.ok(E.logs.some(l => /⏱ STT 雑音除外\(確定\).*捨てた/.test(l)));
  assert.ok(src('index.html').indexOf('stt-noise-filter.js') < src('index.html').indexOf('"whisper-provider.js"') && src('sw.js').includes("'./stt-noise-filter.js'"));
});

// ---- v4.4 長い発話の費用ガード（クロ§2-③） ----
test('長文ガード: 録音30秒超なら以後の仮は送らない・表示は「聞き取り中…（長文）」・確定は全体1回・⏱ログ', async () => {
  const P = W(); const t = deps(); const pre = P.create(t.d);
  assert.equal(P.LONG_MS, 30000);
  pre.onVoice(); assert.equal(pre.provisional(ch(4), 'audio/webm', 'webm', 12000), true); await flush();
  pre.onVoice(); assert.equal(pre.provisional(ch(8), 'audio/webm', 'webm', 30001), false);
  pre.onVoice(); assert.equal(pre.provisional(ch(9), 'audio/webm', 'webm', 31000), false);
  await flush();
  assert.equal(t.calls.length, 1, '30秒を超えた後は送らない');
  assert.equal(t.shown.at(-1), '🎤 聞き取り中…（長文）');
  assert.ok(t.logs.some(l => /⏱ STT 先読み: 録音30\.0秒が30秒超 → 長文ガード/.test(l)));
  assert.equal(t.logs.filter(l => l.includes('長文ガード')).length, 1, 'ログは1回');
  assert.equal(await pre.confirm(), null, '確定時に全体1回');
});
test('長文ガード(配線): 30秒超の録音で _provisionalSend しても送らず、区切りで全体1回', async () => {
  const E = env(() => ({ text: '長い話。' }));
  const p = new E.P(); const finals = []; p.onFinal = t => finals.push(t);
  await p.start(); await talk(E, p); E.tick(30000);
  p._provisionalSend(); await flush();
  assert.equal(E.sent.length, 0);
  p._onSegmentEnd(); await p._sttQueue;
  assert.equal(E.sent.length, 1); assert.deepEqual(finals, ['長い話。']);
  assert.ok(E.logs.some(l => /Whisper回数: 1回（全体1）/.test(l)));
});
