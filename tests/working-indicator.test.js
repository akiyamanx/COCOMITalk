// tests/working-indicator.test.js v1.0
// このファイルは COCOMITalk の作業中表示（working-indicator.js / working-hooks.js）のテスト：参照カウント・自動停止・各機能への差し込み
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function clock() {
  let now = 0, seq = 0; const q = new Map();
  return { st: (fn, ms) => { const id = ++seq; q.set(id, { at: now + ms, fn }); return id; }, ct: (id) => q.delete(id),
    advance(ms) { now += ms; for (const [id, t] of [...q]) if (t.at <= now) { q.delete(id); t.fn(); } }, size: () => q.size };
}
function fresh() {
  const { WorkingIndicator: WI, WorkingHooks: WH } = load(['working-indicator.js', 'working-hooks.js'], ['WorkingIndicator', 'WorkingHooks']);
  const c = clock(); WI.configure({ doc: null, setTimeoutFn: c.st, clearTimeoutFn: c.ct });
  return { WI, WH, c };
}

test('参照カウント: 重なった作業は最後が終わるまで出る・同じtokenの二重stopは無害', () => {
  const { WI, c } = fresh();
  const a = WI.start('think', 'ここちゃん考え中…');
  const b = WI.start('write', '書記まとめ中…');
  assert.equal(WI.state().active, 2); assert.equal(WI.state().anim, 'typing');
  assert.equal(WI.stop(b), true); assert.equal(WI.stop(b), false);
  assert.equal(WI.state().anim, 'wobble'); assert.equal(WI.state().label, 'ここちゃん考え中…');
  WI.stop(a); assert.equal(WI.isActive(), false); assert.equal(c.size(), 0);
});

test('自動停止: 120秒で止め忘れを片付ける', () => {
  const { WI, c } = fresh();
  assert.equal(WI.TIMEOUT_MS, 120000);
  WI.start('speak', 'おしゃべり中…'); c.advance(119999); assert.equal(WI.isActive(), true);
  c.advance(1); assert.equal(WI.isActive(), false);
});

test('wrap: 成功でも失敗でも止まり、結果/例外はそのまま', async () => {
  const { WI } = fresh();
  const ok = WI.wrap('write', 'x', async (v) => { assert.equal(WI.isActive(), true); return v * 2; });
  assert.equal(await ok(3), 6); assert.equal(WI.isActive(), false);
  const ng = WI.wrap('write', 'x', async () => { throw new Error('boom'); });
  await assert.rejects(ng(), /boom/); assert.equal(WI.isActive(), false);
  const sync = WI.wrap('think', 'y', () => { throw new Error('s'); });
  assert.throws(() => sync(), /s/); assert.equal(WI.isActive(), false);
});

test('hooks: 会議の考え中・チャット・読み上げ・書類/議事録/書記/共有に差し込む（元の処理は呼ばれる）', async () => {
  const { WI, WH } = fresh();
  const calls = [];
  class AudioPlaybackManager { async speak(t, s) { calls.push('speak'); return WI.state().label; } async speakQueue() { calls.push('q'); } }
  const g = { WorkingIndicator: WI, AudioPlaybackManager,
    MeetingUI: { showTyping: (k) => calls.push('show:' + k), hideTyping: () => calls.push('hide') },
    ChatUi: { showTyping: () => calls.push('cshow'), hideTyping: () => calls.push('chide') }, ChatCore: { getCurrentSister: () => 'claude' },
    DocGenerator: { generate: async () => WI.state().label }, MeetingDocActions: { downloadMinutes: () => WI.state().label },
    MeetingResult: { runScribe: async () => WI.state().label }, MeetingShare: { share: async () => 'ok' } };
  const done = WH.install(g);
  assert.deepEqual([...done], ['meeting-typing', 'chat-typing', 'tts-speak', 'tts-queue', 'doc', 'minutes', 'scribe', 'share']);
  assert.equal(WH.install(g).length, 0, '二重には付けない');
  g.MeetingUI.showTyping('koko'); assert.equal(WI.state().label, 'ここちゃん考え中…');
  g.MeetingUI.showTyping('kimi'); assert.equal(WI.state().active, 1); assert.equal(WI.state().label, 'きみちゃん考え中…');
  g.MeetingUI.hideTyping(); assert.equal(WI.isActive(), false);
  g.ChatUi.showTyping(); assert.equal(WI.state().label, 'クロちゃん考え中…'); g.ChatUi.hideTyping(); assert.equal(WI.isActive(), false);
  assert.equal(await new AudioPlaybackManager().speak('hi', 'gpt'), 'お姉ちゃんおしゃべり中…'); assert.equal(WI.isActive(), false);
  assert.equal(await g.DocGenerator.generate(), '書類つくり中…');
  assert.equal(g.MeetingDocActions.downloadMinutes(), '議事録つくり中…');
  assert.equal(await g.MeetingResult.runScribe(), '書記まとめ中…');
  assert.equal(await g.MeetingShare.share(), 'ok'); assert.equal(WI.isActive(), false);
  assert.deepEqual(calls, ['show:koko', 'show:kimi', 'hide', 'cshow', 'chide', 'speak']);
});

test('配線: index.html で app.js の前に読み、sw.js v4.9 にキャッシュ・CSSは動きを減らす設定に対応', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('working-indicator.js') < html.indexOf('working-hooks.js') && html.indexOf('working-hooks.js') < html.indexOf('src="app.js"'));
  const sw = read('sw.js');
  for (const f of ['working-indicator.js', 'working-hooks.js', 'working-indicator.css']) assert.ok(sw.includes(`'./${f}'`));
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v4.9';"));
  const css = read('working-indicator.css');
  for (const k of ['@keyframes wi-wobble', '@keyframes wi-bounce', '@keyframes wi-keys', 'prefers-reduced-motion', 'wi-pulse']) assert.ok(css.includes(k), k);
  assert.ok(read('working-indicator.js').includes("'aria-live', 'polite'"));
  assert.ok(read('voice-input.js').split('\n').length <= 520, 'voice-input.js は増やさない');
});
