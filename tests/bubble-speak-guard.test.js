// COCOMITalk - 吹き出しタップ読み上げの二重再生ガードのテスト（voice-output.js / voice-input.js / chat-ui.js / styles.css）
// このファイルは node --test tests/ で実行する（実APIは呼ばない。読み上げ元(プロバイダー)とAudioは遅延つきの偽物）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, ROOT } = require('./_load');

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** 偽の読み上げ環境: synthesize は手動で完了させる(=ネットワーク待ちを再現)。Audio は手動で終わらせる */
function env() {
  const synths = [];   // 合成の依頼 { text, resolve, reject }
  const audios = [];   // 作られた音声（play された数を見る）
  const events = [];
  class FakeAudio {
    constructor(text) { this.text = text; this.l = {}; this.played = 0; this.paused = false; audios.push(this); }
    addEventListener(ev, f) { this.l[ev] = f; }
    async play() { this.played++; events.push(['play', this.text]); }
    pause() { this.paused = true; }
    end() { this.l.ended && this.l.ended(); }
    fail() { this.l.error && this.l.error(); }
  }
  const provider = {
    isAvailable: () => true,
    synthesize: (text) => new Promise((resolve, reject) => { synths.push({ text, resolve: () => resolve(new FakeAudio(text)), reject }); }),
  };
  const e = load(['tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager'], {
    window: {}, localStorage: { getItem: () => null, setItem() {} }, Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout, clearTimeout,
    OpenAITTSProvider: class { isAvailable() { return false; } async synthesize() { throw new Error('x'); } },
  });
  const m = new e.AudioPlaybackManager();
  m._ttsProvider = provider; m._geminiProvider = null; // 偽プロバイダーだけを使う
  m._bubblePollMs = 2; m._bubbleSafetyMs = 400;       // テスト用に短く
  m.onPlayError = (msg) => events.push(['error', msg]);
  return { m, synths, audios, events };
}
/** 後片付け: 止めて、未返答の合成もすべて返す（捨てられる）ので待っている側が終わる */
const settle = async (x) => { x.m.stop(); x.synths.forEach(s => s.resolve()); await tick(5); };
const plays = x => x.audios.reduce((n, a) => n + a.played, 0);

test('二連打: 合成待ち(準備中)に2回目を押しても再生は1回だけ', async () => {
  const x = env();
  const a = x.m.speakBubble('こんにちは。', 'koko');
  const b = x.m.speakBubble('こんにちは。', 'koko');
  assert.equal(await b, false, '2回目は無視される');
  assert.equal(x.synths.length, 1, '合成の依頼も1回だけ');
  x.synths[0].resolve(); await tick(5);
  assert.equal(plays(x), 1);
  assert.equal(x.m.isBusy(), true);
  x.audios[0].end(); await a; await tick(10);
  assert.equal(x.m.isBusy(), false);
});

test('三連打: 準備中・再生中のタップはすべて無視される（再生1回）', async () => {
  const x = env();
  const first = x.m.speakBubble('三回押す。', 'gpt');
  assert.equal(await x.m.speakBubble('三回押す。', 'gpt'), false);
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('三回押す。', 'gpt'), false, '再生が始まった後のタップも無視');
  assert.equal(x.synths.length, 1);
  assert.equal(plays(x), 1);
  x.audios[0].end(); await first;
});

test('別の吹き出しを素早く押しても、先の読み上げが終わるまで始まらない', async () => {
  const x = env();
  const p1 = x.m.speakBubble('一つ目。', 'koko');
  assert.equal(await x.m.speakBubble('二つ目。', 'claude'), false);
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('二つ目。', 'claude'), false);
  assert.deepEqual(x.synths.map(s => s.text), ['一つ目。']);
  x.audios[0].end(); await p1; await tick(10);
  const p2 = x.m.speakBubble('二つ目。', 'claude'); // 終わったので押せる
  assert.equal(x.synths.length, 2);
  x.synths[1].resolve(); await tick(5); x.audios[1].end(); await p2;
});

test('終わったら(ended)ガードが解けて、また押せる。見た目の通知も 忙しい→解除 の順で1回ずつ', async () => {
  const x = env(); const busy = [];
  const p = x.m.speakBubble('終わる。', 'koko', { onBusyChange: v => busy.push(v) });
  x.synths[0].resolve(); await tick(5);
  assert.deepEqual(busy, [true]);
  x.audios[0].end(); await p; await tick(10);
  assert.deepEqual(busy, [true, false]);
  const p2 = x.m.speakBubble('終わる。', 'koko');
  assert.equal(x.synths.length, 2, '2回目の読み上げが始まる');
  await settle(x); await p2;
});

test('合成エラーでもガードが解ける（固まらない）。押し直せる', async () => {
  const x = env(); const busy = [];
  const p = x.m.speakBubble('失敗する。', 'koko', { onBusyChange: v => busy.push(v) });
  x.synths[0].reject(new Error('502'));
  await p; await tick(10);
  assert.deepEqual(busy, [true, false]);
  assert.equal(x.m.isBusy(), false);
  assert.ok(x.events.some(e => e[0] === 'error'), 'エラーは従来どおり onPlayError へ');
  const p2 = x.m.speakBubble('失敗する。', 'koko');
  assert.equal(x.synths.length, 2);
  await settle(x); await p2;
});

test('再生エラー(audio error)でもガードが解ける', async () => {
  const x = env();
  const p = x.m.speakBubble('音声が壊れた。', 'koko');
  x.synths[0].resolve(); await tick(5);
  x.audios[0].fail(); await p; await tick(10);
  assert.equal(x.m.isBusy(), false);
  const p2 = x.m.speakBubble('音声が壊れた。', 'koko');
  assert.equal(x.synths.length, 2);
  await settle(x); await p2;
});

test('stop() でガードが解ける。準備中にstopした後に届いた音声は再生されない（重なり防止）', async () => {
  const x = env(); const busy = [];
  const p = x.m.speakBubble('止める。', 'koko', { onBusyChange: v => busy.push(v) });
  x.m.stop();
  assert.deepEqual(busy, [true, false]);
  assert.equal(x.m.isBusy(), false);
  x.synths[0].resolve(); await p; await tick(10);
  assert.equal(plays(x), 0, '遅れて届いた音声は捨てる');
  const p2 = x.m.speakBubble('止める。', 'koko');
  assert.equal(x.synths.length, 2, 'stop後は押せる');
  x.synths[1].resolve(); await tick(5);
  assert.equal(plays(x), 1);
  x.audios[0].end(); // 捨てた音声は何も起こさない
  assert.equal(x.m.isBusy(), true);
  await settle(x); await p2;
});

test('再生中のstop → ガード解除 → 押し直せる', async () => {
  const x = env();
  const p = x.m.speakBubble('途中で止める。', 'koko');
  x.synths[0].resolve(); await tick(5);
  await settle(x); await p; await tick(5);
  assert.equal(x.audios[0].paused, true);
  assert.equal(x.m.isBusy(), false);
  const p2 = x.m.speakBubble('途中で止める。', 'koko');
  assert.equal(x.synths.length, 2);
  await settle(x); await p2;
});

test('自動読み上げ(speak)の準備中・再生中にタップしても重ならない（吹き出しは無視）', async () => {
  const x = env();
  const auto = x.m.speak('自動で読む返信です。', 'koko');
  assert.equal(await x.m.speakBubble('吹き出し。', 'gpt'), false, '自動読み上げの合成待ちで無視');
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('吹き出し。', 'gpt'), false, '自動読み上げの再生中も無視');
  assert.equal(x.synths.length, 1); assert.equal(plays(x), 1);
  x.audios[0].end(); await auto; await tick(5);
  assert.equal(x.m.isBusy(), false);
});

test('吹き出しの準備中に新しい自動読み上げが来たら、新しい方だけが鳴る（古い音声は捨てる）', async () => {
  const x = env(); const busy = [];
  const bub = x.m.speakBubble('古い吹き出し。', 'koko', { onBusyChange: v => busy.push(v) });
  const auto = x.m.speak('新しい返信です。', 'koko');
  assert.deepEqual(busy, [true, false], '押し出された吹き出しはガードが解ける');
  x.synths[0].resolve(); x.synths[1].resolve(); await tick(5);
  assert.equal(plays(x), 1, '音は1つだけ');
  assert.equal(x.audios.find(a => a.played).text, '新しい返信です。');
  x.m.stop(); await bub; await auto;
});

test('キュー読み上げ(speakQueue)中も吹き出しは無視される', async () => {
  const x = env();
  const q = x.m.speakQueue([{ text: 'みんなの返信。', sisterId: 'koko' }]);
  assert.equal(await x.m.speakBubble('吹き出し。', 'gpt'), false);
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('吹き出し。', 'gpt'), false);
  x.audios[0].end(); await q;
  assert.equal(x.m.isBusy(), false);
});

test('長文(チャンク分割)でも、全チャンクが終わるまでガードが続く。チャンク間で押しても重ならない', async () => {
  const x = env();
  const long = ('これは長い文章のテストです。' .repeat(8)) + '\n' + ('もう少し続く文章です。'.repeat(10));
  const p = x.m.speakBubble(long, 'koko');
  const n = (await Promise.resolve(x.m._splitTextToChunks(x.m._cleanTextForTTS(long)))).length;
  assert.ok(n >= 2);
  for (let i = 0; i < n; i++) {
    await tick(5);
    assert.equal(await x.m.speakBubble(long, 'koko'), false, `チャンク${i + 1}の合成待ち/再生中は無視`);
    x.synths[i].resolve(); await tick(5);
    assert.equal(await x.m.speakBubble(long, 'koko'), false);
    x.audios[i].end(); await tick(5);
  }
  await p; await tick(10);
  assert.equal(x.synths.length, n, 'タップ分の追加の合成は無い');
  assert.equal(plays(x), n);
  assert.equal(x.m.isBusy(), false);
});

test('保険: 合成が返ってこなくても一定時間でガードが解け、押し直せる', async () => {
  const x = env(); const busy = [];
  x.m._bubbleSafetyMs = 30;
  const p = x.m.speakBubble('ずっと待つ。', 'koko', { onBusyChange: v => busy.push(v) });
  await tick(80);
  assert.deepEqual(busy, [true, false]);
  assert.equal(x.m.isBusy(), false);
  const p2 = x.m.speakBubble('ずっと待つ。', 'koko');
  assert.equal(x.synths.length, 2);
  x.synths[0].resolve(); await tick(5);
  assert.equal(plays(x), 0, '保険で解除した後に届いた古い音声は鳴らさない');
  await settle(x); await p; await p2;
});

test('空の文は読み上げず、ガードも残らない', async () => {
  const x = env();
  await x.m.speakBubble('   ', 'koko'); await tick(10);
  assert.equal(x.m.isBusy(), false);
  assert.equal(x.synths.length, 0);
});

// ---- 配線（VoiceController / チャット画面） ----
test('配線: VoiceController.speakBubble は manager.speakBubble に任せる。チャットの吹き出しは busy 時に class と aria-busy を付け外しする', () => {
  assert.ok(/speakBubble\(text, sisterId, hooks\)[\s\S]{0,200}this\._playback\.speakBubble\(/.test(src('voice-input.js')));
  const chat = src('chat-ui.js');
  assert.ok(chat.includes('speakBubble(text, sisterKey'));
  assert.ok(chat.includes("aria-busy") && chat.includes("'speaking'"));
  assert.ok(!chat.includes('_playback.isPlaying()'), 'バブルのタップでは止めない（止めるのはマイクの🔊ボタン）');
  const css = src('styles.css');
  assert.ok(/\.msg-bubble\.speaking\s*\{[^}]*opacity/.test(css));
  assert.ok(!/\.msg-bubble\.speaking\s*\{[^}]*(width|height|padding|margin|border)/.test(css), '見た目だけ（レイアウトを動かさない）');
});

test('チャット画面: 吹き出しを3回タップ → タップは全部 speakBubble に渡り（無視の判断はそちら）、読み上げ中は speaking/aria-busy が付き、終われば外れる', async () => {
  const mk = () => ({ className: '', style: {}, children: [], attrs: {}, listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); return f; } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(ev, f) { this.listeners[ev] = f; }, set textContent(v) { this._t = v; }, set innerHTML(v) { this._t = v; } });
  const area = mk(); area.scrollTop = 0; area.scrollHeight = 0;
  const e = load(['chat-ui.js'], ['ChatUi'], { window: {}, requestAnimationFrame: f => f(), document: { createElement: mk, getElementById: () => null } });
  const bubbles = [];
  const origCreate = e.sandbox.document.createElement;
  e.sandbox.document.createElement = (t) => { const el = origCreate(t); bubbles.push(el); return el; };
  e.ChatUi.init({ chatArea: area, getCurrentSister: () => 'koko', getSisters: () => ({ koko: { icon: '🌸', name: 'ここ' } }) });
  const calls = []; let hooks = null, release;
  e.sandbox.window.voiceController = { speakBubble: (t, s, h) => { calls.push([t, s]); hooks = h; if (calls.length > 1) return Promise.resolve(false); h.onBusyChange(true); return new Promise(r => { release = () => { h.onBusyChange(false); r(true); }; }); } };
  e.ChatUi.addMessage('ai', 'やっほー', {});
  const bubble = bubbles.find(b => b.className === 'msg-bubble');
  bubble.listeners.click(); bubble.listeners.click(); bubble.listeners.click();
  assert.equal(calls.length, 3);
  assert.equal(bubble.classList.contains('speaking'), true);
  assert.equal(bubble.attrs['aria-busy'], 'true');
  release(); await tick(1);
  assert.equal(bubble.classList.contains('speaking'), false);
  assert.equal(bubble.attrs['aria-busy'], undefined);
});

test('音が鳴っている間のタップで止まる（鳴り始めの猶予が過ぎたら）。止めたあとはまた押せる', async () => {
  const x = env(); x.m._stopGraceMs = 0; const busy = [];
  const p = x.m.speakBubble('止めたい。', 'koko', { onBusyChange: v => busy.push(v) });
  x.synths[0].resolve(); await tick(5);
  assert.equal(x.m.isAudible(), true);
  assert.equal(await x.m.speakBubble('止めたい。', 'koko'), 'stopped');
  assert.equal(x.audios[0].paused, true, '音が止まる');
  assert.equal(x.m.isBusy(), false);
  assert.deepEqual(busy, [true, false]);
  await p;
  const p2 = x.m.speakBubble('止めたい。', 'koko');
  assert.equal(x.synths.length, 2, '止めたあとは再生をやり直せる');
  x.synths[1].resolve(); await tick(5); x.audios[1].end(); await p2;
});

test('準備中(合成待ち)のタップは止めない。鳴り始めの猶予内の連打も止めない', async () => {
  const x = env();
  const p = x.m.speakBubble('連打。', 'koko');
  assert.equal(x.m.isAudible(), false);
  assert.equal(await x.m.speakBubble('連打。', 'koko'), false, '準備中は無視');
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('連打。', 'koko'), false, '鳴り始め直後は無視');
  assert.equal(x.audios[0].paused, false);
  assert.equal(plays(x), 1);
  x.m._stopGraceMs = 0;
  assert.equal(await x.m.speakBubble('連打。', 'koko'), 'stopped', '猶予を過ぎたら止まる');
  await p;
});

test('自動読み上げが鳴っている最中のタップでも止まる', async () => {
  const x = env(); x.m._stopGraceMs = 0;
  const auto = x.m.speak('自動で読む返信です。', 'koko');
  x.synths[0].resolve(); await tick(5);
  assert.equal(await x.m.speakBubble('吹き出し。', 'gpt'), 'stopped');
  assert.equal(x.m.isBusy(), false); await auto;
});

test('CI: sw.js は v3.92、voice-output/chat-ui は500行以内、最終更新は葵 2026-10-29', () => {
  assert.ok(src('sw.js').includes("'cocomitalk-v4.0'"));
  for (const f of ['voice-output.js', 'chat-ui.js', 'styles.css']) assert.ok(src(f).split('\n').length <= 500, f);
  for (const f of ['voice-output.js', 'chat-ui.js', 'tests/bubble-speak-guard.test.js']) {
    const head = src(f).split('\n').slice(0, 20).join('\n');
    if (f !== 'chat-ui.js') assert.ok(/最終更新: 葵\(Aoi\), 2026-10-(29|30)/.test(head), f);
  }
});
