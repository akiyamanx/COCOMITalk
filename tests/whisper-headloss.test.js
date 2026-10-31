// COCOMITalk - v4.0 話し始めの頭切れ対策のテスト（静か≠死亡・録音を止めない・すぐ次の録音・マイクを開ける前の音は絶対に入らない）
// このファイルは node --test tests/*.test.js で実行する。MediaRecorder/AudioContext/getUserMedia/時計は偽物（実マイク・実APIなし）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const G = () => load(['whisper-vad-guard.js'], ['WhisperVadGuard']).WhisperVadGuard;

test('判定: ctx停止/trackが生きていない/ミュート=hard、静時の1.6倍以上の録音=bytes、それ以外=quiet', () => {
  const j = G().judgeDead;
  assert.equal(j({ ctxDead: true, trackLive: true }), 'hard');
  assert.equal(j({ ctxDead: false, trackLive: false }), 'hard');
  assert.equal(j({ ctxDead: false, trackLive: true, trackMuted: true }), 'hard');
  assert.equal(j({ ctxDead: false, trackLive: true, recentBps: 4000, quietBps: 2000 }), 'bytes');
  assert.equal(j({ ctxDead: false, trackLive: true, recentBps: 2500, quietBps: 2000 }), 'quiet');
  assert.equal(j({ ctxDead: false, trackLive: true, recentBps: 9000, quietBps: null }), 'quiet');
});

test('段: quietは何回でも1段目。録音を止める3段目はtrackが生きていない時だけ', () => {
  const s = G().stageFor;
  for (let a = 0; a < 9; a++) assert.equal(s('quiet', a, true), 1);
  assert.equal(s('hard', 1, true), 1);
  assert.equal(s('hard', 5, true), 2);
  assert.equal(s('bytes', 9, true), 2);
  assert.equal(s('hard', 1, false), 3);
});

test('静かな部屋: 判定の待ちが 1.5→3→6秒 と延び、声が2秒続けば1.5秒に戻る', () => {
  const t = G().createTracker();
  const until = () => { let n = 0; while (t.tick(0, false) !== 'dead') n++; return n + 1; };
  assert.equal(until(), 15); t.backoff();
  assert.equal(until(), 30); t.backoff();
  assert.equal(until(), 60); t.backoff();
  assert.equal(until(), 60);
  for (let i = 0; i < 20; i++) t.tick(5, false);
  assert.equal(until(), 15);
});

test('bytesPerSec: 直近1.5秒の分だけ数える', () => {
  const b = G().bytesPerSec;
  assert.equal(b([{ t: 100, size: 9999 }, { t: 9000, size: 300 }, { t: 9900, size: 300 }], 10000), 400);
});

// ---- WhisperProvider を偽の環境で動かす ----
function env() {
  let now = 1000;
  const recs = [];
  class FakeRec {
    constructor() { this.state = 'inactive'; recs.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    emit(size) { this.ondataavailable && this.ondataavailable({ data: { size } }); }
    static isTypeSupported() { return true; }
  }
  const track = { readyState: 'live', muted: false, stop() { this.readyState = 'ended'; } };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  let gum = 0;
  const ctx = () => ({ state: 'running', resume: async () => {}, close: async () => {},
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createAnalyser: () => ({ frequencyBinCount: 4, getByteFrequencyData() {} }) });
  const sent = [];
  let speaking = false;
  const window = { voiceState: { isSpeaking: () => speaking } };
  const sandbox = {
    window, document: { getElementById: () => null, createElement: () => ({ style: {} }), body: { appendChild() {} } },
    navigator: { mediaDevices: { getUserMedia: async () => { gum++; return stream; } } },
    MediaRecorder: FakeRec, MediaStream: function (t) { this.t = t; },
    Blob: function (parts) { this.parts = parts; this.size = parts.reduce((n, p) => n + p.size, 0); },
    Date: class extends Date { static now() { return now; } }, setTimeout: (f, ms) => (ms <= 300 ? setImmediate(f) : 0), clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    SttModel: { getSilenceMs: () => 1500, transcribe: async (blob) => { sent.push(blob); return { text: 'こんにちは。' }; } },
    SpeechProvider: class { constructor(n) { this.name = n; } },
  };
  window.AudioContext = function () { return ctx(); };
  const e = load(['whisper-vad-guard.js', 'whisper-provider.js', 'whisper-recovery.js'], ['WhisperProvider'], sandbox);
  return { P: e.WhisperProvider, recs, track, sent, tick: ms => { now += ms; return now; }, setSpeaking: v => { speaking = v; }, gum: () => gum };
}

test('★マイクを開ける前の音は絶対に区切りに入らない（読み上げ中のチャンクも、pause前の録音も）', async () => {
  const E = env();
  const p = new E.P();
  await p.start();
  E.recs.at(-1).emit(5000);                  // 前のターンの声
  p.pause(); E.setSpeaking(true);            // キャラが話し始める＝マイク完全オフ
  const during = E.recs.at(-1);
  during.emit(7777);                         // 読み上げ中に遅れて来たチャンク
  E.tick(4000);
  assert.equal(p._chunks.length, 0, '読み上げ中/前の音は残っていない');
  E.setSpeaking(false); E.tick(1500);        // voice-input 側の1.5秒待ちの後に resume が呼ばれる
  const r = p.resume(); await r;
  during.emit(8888);                         // 旧recorderの遅延チャンク→世代ガードで捨てる
  const cur = E.recs.at(-1);
  assert.notEqual(cur, during);
  assert.ok(p._micOpenedAt >= 6500, 'この区切りはマイクを開けた時刻以降');
  cur.emit(1200); cur.emit(1300);
  assert.deepEqual([...p._chunks.map(c => c.size)], [1200, 1300]);
  assert.ok(!p._chunks.some(c => c.size === 7777 || c.size === 8888 || c.size === 5000));
});

test('区切りを送ったら文字起こしを待たずに次の録音が始まる（続けて話した頭を拾う）。読み上げ中は始めない', async () => {
  const E = env();
  const p = new E.P();
  await p.start();
  const first = E.recs.at(-1);
  for (let i = 0; i < 10; i++) first.emit(1000);
  p._hasVoiceStarted = true; E.tick(3000);
  p._onSegmentEnd();
  const next = E.recs.at(-1);
  assert.notEqual(next, first);
  assert.equal(next.state, 'recording', '文字起こし中も録音中');
  next.emit(2000);                            // 文字起こし待ちの間に話した頭
  await p._sttQueue;
  assert.equal(E.sent.length, 1);
  assert.equal(E.recs.at(-1), next, '返事の後に録音を作り直さない');
  assert.deepEqual([...p._chunks.map(c => c.size)], [2000]);
  // 読み上げ中なら次の録音は開けない
  E.setSpeaking(true);
  p._hasVoiceStarted = true; for (let i = 0; i < 10; i++) next.emit(1000);
  const n = E.recs.length; p._processing = false; p._onSegmentEnd();
  assert.equal(E.recs.length, n, 'speaking中は新しいrecorderを作らない');
});

test('静かな部屋(maxVol=0・trackは生きている)ではしごを何度上っても録音は止まらず、getUserMediaも呼ばれない', async () => {
  const E = env();
  const p = new E.P();
  await p.start();
  const rec = E.recs.at(-1);
  const gum = E.gum();
  for (let i = 0; i < 8; i++) { for (let k = 0; k < 4; k++) { E.tick(500); rec.emit(200); } p._climbRecoveryLadder('maxVol=0'); p._recovering = false; await new Promise(r => setImmediate(r)); }
  assert.equal(E.gum(), gum, 'getUserMediaを再取得しない');
  assert.equal(E.recs.at(-1), rec, 'MediaRecorderを作り直さない');
  assert.equal(rec.state, 'recording');
  assert.equal(p._recoveryAttempts, 0, '静かなだけなら復帰回数を数えない');
});

test('trackが死んだ時だけ3段目。録れていた分は捨てずに先に送る', async () => {
  const E = env();
  const p = new E.P();
  await p.start();
  const rec = E.recs.at(-1);
  for (let i = 0; i < 10; i++) rec.emit(1000);
  E.track.readyState = 'ended';
  p._climbRecoveryLadder('maxVol=0');
  await new Promise(r => setImmediate(r)); await p._sttQueue;
  assert.equal(E.sent.length, 1);
  assert.equal(E.sent[0].size, 10000);
});

test('発話開始は2回連続(200ms)。こだま除けと読み上げ後1.5秒待ちは voice-input に残っている', () => {
  const E = env();
  assert.equal(new E.P()._VOICE_START_COUNT, 2);
  const vi = require('fs').readFileSync(require('path').join(__dirname, '..', 'voice-input.js'), 'utf8');
  assert.ok(vi.includes('VoiceFast.isEcho(text)'));
  assert.ok(vi.includes('await new Promise(r => setTimeout(r, 1500)); // ★ハウリング防止'));
  assert.ok(vi.includes('this._stt._inflight > 0'));
});
