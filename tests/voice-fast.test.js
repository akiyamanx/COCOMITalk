// COCOMITalk - 音声の速さ改善(v3.91)のテスト（voice-fast.js / voice-output.js / voice-input.js / stt-model.js / chat-core.js）
// このファイルは node --test tests/ で実行する。ハウリング防止（再生中はマイクを開けない・1.5秒待ち・こだま除け）も確かめる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, ROOT } = require('./_load');

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function vf(win = {}) {
  const logs = [];
  win.DebugLogger = { addLog: (m) => logs.push(String(m)) };
  const e = load(['voice-fast.js'], ['VoiceFast'], {
    window: win, console: { log() {} },
  });
  return { V: e.VoiceFast, logs };
}

test('こだま除け: 直前にAIが話した文とそっくりな文字起こしは捨てる', () => {
  const { V } = vf();
  V.rememberSpoken('そっか、今日はお散歩に行ったんだね！楽しかった？', 1000);
  V.endSpeaking(5000);
  assert.equal(V.isEcho('今日はお散歩に行ったんだね', 6000), true, '一部分でもこだま');
  assert.equal(V.isEcho('そっか今日はお散歩に行ったんだね楽しかった', 6000), true);
  assert.equal(V.isEcho('明日は雨らしいよ', 6000), false, '違う話は通す');
  assert.equal(V.isEcho('うん', 6000), false, '短い返事は捨てない');
});

test('こだま除け: 話し終わりから10秒を過ぎたら同じ文でも通す', () => {
  const { V } = vf();
  V.rememberSpoken('お散歩に行ったんだね', 0);
  V.endSpeaking(1000);
  assert.equal(V.isEcho('お散歩に行ったんだね', 10500), true);
  assert.equal(V.isEcho('お散歩に行ったんだね', 11500), false);
});

test('⏱ 計測: 話し終わりからの秒数をデバッグログに出す（音声は1回だけ）', () => {
  const { V, logs } = vf();
  V.mark('segment', { silenceMs: 1500 }, 10000);
  V.mark('stt', null, 9500 + 1200);
  V.mark('send', null, 12000);
  V.mark('llm', null, 14000);
  V.mark('tts', null, 15000);
  V.mark('tts', null, 16000);
  assert.equal(logs.filter(l => l.includes('⏱')).length, 5);
  assert.ok(logs.some(l => l.includes('+3.5')), logs.join('\n'));
  assert.ok(logs.some(l => l.includes('+6.5')), logs.join('\n'));
});

test('音声中は lite＋短く。じっくり等を頼まれたら短くしない。音声オフは普段どおり', () => {
  const { V } = vf({ voiceController: { isEnabled: () => true } });
  assert.equal(V.modelKey('high'), 'lite');
  assert.equal(V.modelKey('high', false), 'high');
  assert.match(V.promptExtra('今日どうだった？'), /2〜3文/);
  assert.equal(V.promptExtra('じっくり教えて'), '');
  assert.equal(V.promptExtra('今日どうだった？', false), '');
  const off = vf({ voiceController: { isEnabled: () => false } }).V;
  assert.equal(off.modelKey('standard'), 'standard');
});

test('voice-input: 送信前の待ち1.0秒・話し中/文字起こし中は待ちを延ばす・こだま除け・再開待ち1500msはそのまま', () => {
  const s = src('voice-input.js');
  assert.match(s, /_BUFFER_DELAY = 1000/);
  assert.match(s, /_hasVoiceStarted \|\| this\._stt\._processing/);
  assert.match(s, /VoiceFast\.isEcho/);
  assert.match(s, /1500\)/, 'ハウリング防止の1.5秒待ちは短くしない');
  assert.ok(src('chat-core.js').includes('VoiceFast.modelKey(normalKey)'));
  assert.ok(src('chat-core.js').includes('VoiceFast.promptExtra(userText)'));
});

test('無音区切り: 旧既定3秒の保存値は1回だけ1.5秒へ。4秒/5秒や選び直した3秒は尊重', () => {
  const mk = (init) => {
    const { makeStorage } = require('./_load');
    const st = makeStorage ? makeStorage(init) : null;
    return { S: load(['stt-model.js'], ['SttModel'], { window: {}, localStorage: st }).SttModel, st };
  };
  let { S } = mk({ 'cocomitalk-stt-silence-ms': '3000' });
  assert.equal(S.getSilenceMs(), 1500);
  ({ S } = mk({ 'cocomitalk-stt-silence-ms': '4000' }));
  assert.equal(S.getSilenceMs(), 4000);
  const r = mk({});
  r.S.setSilenceMs(3000);
  assert.equal(r.S.getSilenceMs(), 3000, '自分で選び直した3秒はそのまま');
  assert.ok(src('index.html').includes('<option value="1500">'));
});

/** 偽の読み上げ: 合成は手動で完了、Audioも手動で終わらせる */
function env() {
  const synths = [], audios = [], ev = [];
  class FakeAudio {
    constructor(t) { this.text = t; this.l = {}; audios.push(this); }
    addEventListener(e, f) { this.l[e] = f; }
    async play() { ev.push('play:' + this.text); }
    pause() {}
    end() { this.l.ended && this.l.ended(); }
  }
  const e = load(['voice-fast.js', 'tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager', 'VoiceFast'], {
    window: {}, localStorage: { getItem: () => null, setItem() {} }, Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout, clearTimeout,
    DebugLogger: { log() {} },
    OpenAITTSProvider: class { isAvailable() { return false; } async synthesize() { throw new Error('x'); } },
  });
  const m = new e.AudioPlaybackManager();
  m._ttsProvider = { isAvailable: () => true, synthesize: (t) => new Promise(r => synths.push({ text: t, ok: () => r(new FakeAudio(t)) })) };
  m._geminiProvider = null;
  m.onPlayStart = () => ev.push('start'); m.onPlayEnd = () => ev.push('end'); m.onQueueEnd = () => ev.push('qend');
  return { m, synths, audios, ev, V: e.VoiceFast };
}

test('最初の1文を先に鳴らし、鳴っている間に次を先読み。文の間もずっと「話し中」（マイクを開けない）', async () => {
  const x = env();
  const text = 'こんにちは、今日もいい天気だね。お散歩に行くならお昼過ぎがちょうどいいと思うよ。帽子と水筒を忘れずに持っていってね。';
  const p = x.m.speak(text, 'koko');
  await tick(5);
  assert.equal(x.synths.length, 1);
  assert.equal(x.synths[0].text, 'こんにちは、今日もいい天気だね。', '最初の1文だけ先に作る');
  x.synths[0].ok(); await tick(5);
  assert.equal(x.ev.filter(e => e.startsWith('play')).length, 1, '1文目がすぐ鳴る');
  assert.equal(x.synths.length, 2, '鳴っている間に次を先読みしている');
  x.synths[1].ok(); await tick(5);
  assert.equal(x.m.isPlaying(), true);
  x.audios[0].end(); await tick(5);
  assert.equal(x.m.isPlaying(), true, '文と文の間も話し中のまま');
  assert.equal(x.ev.filter(e => e === 'end' || e === 'qend').length, 0, '途中でマイク再開の合図を出さない');
  assert.equal(x.ev.filter(e => e.startsWith('play')).length, 2, '先読み済みなので待たずに次が鳴る');
  for (let i = 0; i < 5; i++) { x.synths.forEach(s => s.ok()); await tick(5); x.audios.forEach(a => a.end()); await tick(5); }
  await p;
  assert.equal(x.ev.filter(e => e === 'start').length, 1, '話し始めの合図は1回');
  assert.ok(x.ev.filter(e => e === 'end' || e === 'qend').length >= 1);
  assert.equal(x.m.isPlaying(), false);
  assert.equal(x.V.isEcho('お散歩に行くならお昼過ぎがちょうどいい'), true, '話した文はこだま除けに記録');
});

test('CI: voice-fast.js は sw.js と index.html に入っていて、ヘッダと行数上限を守る', () => {
  assert.ok(src('sw.js').includes("'./voice-fast.js'"));
  assert.ok(src('index.html').includes('<script src="voice-fast.js">'));
  for (const f of ['voice-fast.js', 'chat-core.js', 'stt-model.js']) {
    const s = src(f);
    assert.ok(s.split('\n').length <= 500, f);
    assert.ok(s.split('\n').slice(0, 5).join('\n').match(/このファイルは|COCOMITalk/), f);
  }
  for (const f of ['voice-output.js', 'voice-input.js']) assert.ok(src(f).split('\n').length <= 550, f);
  assert.ok(src('whisper-provider.js').split('\n').length <= 500);
});
