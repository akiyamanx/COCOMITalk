// COCOMITalk - 読み上げの既定Gemini化・旧設定の移行・場面ごとの話し方(style)・戻し先のテスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない。fetch/Audio/ApiCommonは差し替え）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, makeStorage } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
const KEY = 'cocomitalk-settings';
const FLAG = 'cocomitalk-tts-gemini-default-v1';
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function mig(init = {}) {
  const storage = makeStorage(init);
  const e = load(['tts-provider.js'], ['migrateTTSProviderDefault', 'getTTSProviderName', 'getSisterVoice', 'setTTSProviderName'], { window: {}, localStorage: storage });
  return { ...e, storage, saved: () => JSON.parse(storage.getItem(KEY)) };
}

test('既定: 新規インストールの読み上げはGemini（5人とも決定済みの声）', () => {
  const e = mig();
  assert.equal(e.getTTSProviderName(), 'gemini');
  const v = Object.fromEntries(['gpt', 'claude', 'koko', 'aoi', 'kimi'].map(k => [k, e.getSisterVoice(k).voice]));
  assert.deepEqual(v, { gpt: 'Despina', claude: 'Achernar', koko: 'Autonoe', aoi: 'Leda', kimi: 'Zephyr' });
});

test('移行: 未設定/openaiは一度だけgeminiへ。voicevoxは本人の選択として残す。他の設定は触らない', () => {
  for (const [init, want, changed] of [[{ ttsSpeed: '1.5' }, 'gemini', true], [{ ttsProvider: 'openai', ttsSpeed: '1.5', vvApiKey: 'k' }, 'gemini', true], [{ ttsProvider: 'voicevox', vvApiKey: 'k' }, 'voicevox', false], [{ ttsProvider: 'gemini' }, 'gemini', false]]) {
    const e = mig({ [KEY]: JSON.stringify(init) });
    assert.equal(e.migrateTTSProviderDefault().changed, changed, JSON.stringify(init));
    const s = e.saved();
    assert.equal(s.ttsProvider || 'gemini', want);
    for (const k of Object.keys(init)) if (k !== 'ttsProvider') assert.equal(s[k], init[k], k);
    assert.equal(e.storage.getItem(FLAG), '1');
  }
});

test('移行: 一度きり（その後に自分でOpenAIを選んでも戻されない）。新規インストールでも印は付く', () => {
  const e = mig({ [KEY]: JSON.stringify({ ttsProvider: 'openai' }) });
  e.migrateTTSProviderDefault();
  e.storage.setItem(KEY, JSON.stringify({ ttsProvider: 'openai' }));   // ユーザーが後でOpenAIを選ぶ
  assert.equal(e.migrateTTSProviderDefault().changed, false);
  assert.equal(e.saved().ttsProvider, 'openai');
  const fresh = mig();
  assert.equal(fresh.migrateTTSProviderDefault().changed, false);
  assert.equal(fresh.storage.getItem(FLAG), '1');
  assert.equal(fresh.storage.getItem(KEY), null);                      // 設定は作らない
  fresh.storage.setItem(KEY, JSON.stringify({ ttsProvider: 'openai' }));
  assert.equal(fresh.migrateTTSProviderDefault().changed, false);      // 新規の人が後でOpenAIにしても戻さない
});

test('移行: 壊れた設定・保存失敗でも例外にならず、壊れた設定は上書きしない', () => {
  const bad = mig({ [KEY]: '{oops' });
  assert.doesNotThrow(() => bad.migrateTTSProviderDefault());
  assert.equal(bad.storage.getItem(KEY), '{oops');
  const e = load(['tts-provider.js'], ['migrateTTSProviderDefault'], { window: {}, localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  assert.deepEqual(plain(e.migrateTTSProviderDefault()), { changed: false });
});

test('設定画面: 既定はgemini、選択肢はGemini→OpenAI→VOICEVOXの順。読み込み/保存の既定値もgemini', () => {
  const html = read('index.html');
  const opts = [...html.match(/<select id="sel-tts-provider"[\s\S]*?<\/select>/)[0].matchAll(/<option value="(\w+)">([^<]*)/g)];
  assert.deepEqual(opts.map(m => m[1]), ['gemini', 'openai', 'voicevox']);
  assert.ok(opts[0][2].includes('標準') && opts[1][2].includes('控え') && opts[2][2].includes('控え'));
  const app = read('app-settings.js');
  assert.equal((app.match(/\|\| 'openai'/g) || []).length, 0);
  assert.ok(app.includes("settings.ttsProvider || 'gemini'") && app.includes("s.ttsProvider || 'gemini'") && app.includes(": 'gemini',"));
  assert.ok(app.indexOf('migrateTTSProviderDefault()') < app.indexOf("if (!saved) return;"));  // 保存が無くても印を付ける
});

// ---- 話し方(style)が中継へ届くか ----
function wav(seconds) {
  const n = Math.round(seconds * 48000), b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function env({ geminiFail = false, openaiFail = false, vvImpl = true } = {}) {
  const fetched = [], log = [], rec = [], storage = makeStorage();
  class Audio {
    constructor(u) { this.url = u; this.l = {}; }
    addEventListener(ev, f) { this.l[ev] = f; }
    async play() { this.played = true; setTimeout(() => this.l.ended && this.l.ended(), 0); }
    pause() {}
  }
  const ApiCommon = { hasAuthToken: () => true, getWorkerURL: () => 'https://w.example', getAuthToken: () => 'tok' };
  const e = load(['tone-style.js', 'tts-provider.js', 'gemini-tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager', 'ToneStyle', 'GeminiTTSProvider'], {
    window: {}, localStorage: storage, ApiCommon, Audio, Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    TokenMonitor: { record: (...a) => rec.push(a) }, setTimeout, clearTimeout,
    fetch: async (u, o) => { fetched.push({ u, body: JSON.parse(o.body) }); if (geminiFail) return { ok: false, status: 502, json: async () => ({ error: 'gemini down' }) }; return { ok: true, arrayBuffer: async () => wav(2) }; },
    OpenAITTSProvider: class { isAvailable() { return true; } async synthesize(t, v) { log.push(['openai', v, t]); if (openaiFail) throw new Error('openai down'); return new Audio('o'); } },
    VoicevoxTTSProvider: vvImpl ? class { isAvailable() { return true; } async synthesize(t, v) { log.push(['voicevox', v, t]); return new Audio('v'); } } : undefined,
  });
  return { m: new e.AudioPlaybackManager(), T: e.ToneStyle, G: e.GeminiTTSProvider, fetched, log, rec };
}

test('起動直後はGeminiが使われる。タグ付き返信は「タグ抜きの文＋声＋場面のstyle」を /gemini-tts へ送る', async () => {
  const x = env();
  assert.equal(x.m._ttsProvider, x.m._geminiProvider);
  const raw = '[tone:gentle-sad] そっか、つらかったね。ゆっくりでいいよ。';
  await x.m.speak(x.T.consume(raw), 'gpt');
  assert.equal(x.fetched.length, 1);
  assert.deepEqual(plain(x.fetched[0].body), { text: 'そっか、つらかったね。ゆっくりでいいよ。', voice: 'Despina', model: 'gemini-3.8-flash-lite-tts', style: x.T.STYLES['gentle-sad'] });
  assert.ok(!JSON.stringify(x.fetched).includes('tone:'));
});

test('タグが残ったまま読み上げに渡っても、タグは読まれずトーンは効く', async () => {
  const x = env();
  await x.m.speak('[tone:excited] やったね！おめでとう！', 'claude');
  assert.equal(x.fetched[0].body.text, 'やったね！おめでとう！');
  assert.equal(x.fetched[0].body.voice, 'Achernar');
  assert.equal(x.fetched[0].body.style, x.T.STYLES.excited);
});

test('タグ無し/不明タグ/壊れたタグ: 推定→cheerfulで必ず読み上げる（表示も読み上げも壊れない）', async () => {
  const x = env();
  await x.m.speak('今日はいい天気だね、お散歩しよ！', 'koko');
  await x.m.speak('入院したって聞いて…心配だよ', 'koko');
  await x.m.speak('[tone:zzz] こんにちは、元気？', 'koko');
  await x.m.speak('[tone:calm', 'koko');             // タグだけ → 読むものが無いので何もしない（例外にしない）
  await x.m.speak('[tone:こんにちは', 'koko');         // 閉じ忘れの不明語 → 本文として読む
  const st = x.fetched.map(f => f.body.style);
  assert.deepEqual(plain(st.slice(0, 3)), [x.T.STYLES.cheerful, x.T.STYLES['gentle-sad'], x.T.STYLES.cheerful]);
  assert.equal(x.fetched.length, 4);
  assert.equal(x.fetched[2].body.text, 'こんにちは、元気？');
});

test('長文は分割しても返信全体で同じ話し方（チャンクごとに変わらない）', async () => {
  const x = env();
  const long = '[tone:serious] ' + '重要なお知らせです。確認してください。'.repeat(25);
  await x.m.speak(x.T.consume(long), 'gpt');
  assert.ok(x.fetched.length >= 2);
  assert.equal(new Set(x.fetched.map(f => f.body.style)).size, 1);
  assert.equal(x.fetched[0].body.style, x.T.STYLES.serious);
});

test('キュー読み上げ（グループ/会議）も1人ずつ別のトーン・別の声', async () => {
  const x = env();
  const a = x.T.consume('[tone:excited] やったー！');
  const b = x.T.consume('[tone:gentle-sad] そっか、残念だったね');
  await x.m.speakQueue([{ text: a, sisterId: 'koko' }, { text: b, sisterId: 'claude' }]);
  assert.deepEqual(plain(x.fetched.map(f => [f.body.voice, f.body.style])), [['Autonoe', x.T.STYLES.excited], ['Achernar', x.T.STYLES['gentle-sad']]]);
});

test('styleはGeminiにだけ送る: OpenAI/VOICEVOX選択では声の指示を送らず従来どおり', async () => {
  const x = env();
  x.m.switchProvider('openai');
  await x.m.speak('[tone:calm] こんにちは', 'gpt');
  assert.equal(x.fetched.length, 0);
  assert.deepEqual(plain(x.log), [['openai', 'shimmer', 'こんにちは']]);
  x.m.switchProvider('voicevox');
  await x.m.speak('こんにちは', 'gpt');
  assert.deepEqual(plain(x.log[1]), ['voicevox', '4', 'こんにちは']);
});

test('Gemini失敗→OpenAIの声、さらに失敗→VOICEVOXの声へ自動で戻す。styleは戻し先に渡さない', async () => {
  const a = env({ geminiFail: true });
  await a.m.speak('[tone:calm] こんにちは', 'gpt');
  assert.deepEqual(plain(a.log), [['openai', 'shimmer', 'こんにちは']]);
  const b = env({ geminiFail: true, openaiFail: true });
  await b.m.speak('こんにちは', 'claude');
  assert.deepEqual(plain(b.log.map(l => [l[0], l[1]])), [['openai', 'alloy'], ['voicevox', '46']]);
  const c = env({ geminiFail: true, openaiFail: true, vvImpl: false });   // 戻し先が無ければ、音声エラーとして通知（例外を握りつぶさない）
  let err = '';
  c.m.onPlayError = (msg) => { err = msg; };
  await c.m.speak('こんにちは', 'gpt');
  assert.ok(err.includes('openai down'));
});

test('Gemini提供側が無い環境では選択名もOpenAIへ揃う（Geminiの声名をOpenAIへ渡さない）', () => {
  const e = load(['tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager', 'getSisterVoice', 'getTTSProviderName'], {
    window: {}, localStorage: makeStorage(), OpenAITTSProvider: class { isAvailable() { return true; } }, VoicevoxTTSProvider: undefined, GeminiTTSProvider: undefined,
  });
  new e.AudioPlaybackManager();
  assert.equal(e.getTTSProviderName(), 'openai');
  assert.equal(e.getSisterVoice('koko').voice, 'nova');
});

test('Gemini TTSの費用: styleの分の入力トークンを足して記録し、単価は2027-01-01から2倍のまま', async () => {
  const x = env();
  await x.m.speak('[tone:calm] あ'.padEnd(16, 'あ'), 'gpt');   // 本文 'あ'x? 文字数は下で確認
  const body = x.fetched[0].body;
  const inTok = Math.ceil(body.text.length / 2) + Math.ceil(body.style.length / 4);
  assert.deepEqual(plain(x.rec[0]), ['gemini-3.8-flash-lite-tts', inTok, 50]);   // 2秒×25
  const T = load(['model-tiers.js'], ['ModelTiers'], { localStorage: makeStorage() }).ModelTiers;
  assert.equal(T.getPricing('gemini-3.8-flash-lite-tts', '2026-12-31').output, 6);
  assert.equal(T.getPricing('gemini-3.8-flash-lite-tts', '2027-01-01').output, 12);
});

// ---- プロンプト・受け取り口・読み込み ----
test('プロンプト: ここ/澪/クロの全モードの末尾にトーン指示が入る（共通の1か所から）。tone-style.jsが無くても動く', () => {
  const rule = load(['tone-style.js'], ['ToneStyle'], { window: {} }).ToneStyle.promptRule();
  for (const [f, name] of [['prompts/koko-system.js', 'KokoSystemPrompt'], ['prompts/gpt-system.js', 'GptSystemPrompt'], ['prompts/claude-system.js', 'ClaudeSystemPrompt']]) {
    const P = load(['tone-style.js', f], [name], { window: {} })[name];
    for (const mode of P.getAvailableModes()) assert.ok(P.getPrompt(mode).endsWith(rule), `${name}:${mode}`);
    const base = load([f], [name], { window: {} })[name];   // ToneStyleが無い環境
    for (const mode of base.getAvailableModes()) assert.ok(!base.getPrompt(mode).includes('[tone:'), `${name}:${mode} 無しでも動く`);
  }
});

test('受け取り口: 1対1・グループ・会議の返信はすべてToneStyle.consumeを通り、index.html/sw.jsに載る', () => {
  assert.ok(/_stripTone\(await apiModule\.sendMessage/.test(read('chat-core.js')));
  assert.ok(/ToneStyle\.consume\(raw\)/.test(read('chat-group.js')));
  assert.ok(/ToneStyle\.consume\(reply\)/.test(read('meeting-relay.js')));
  const html = read('index.html'), sw = read('sw.js');
  const pos = f => html.indexOf(`src="${f}"`);
  assert.ok(pos('tone-style.js') > 0 && pos('tone-style.js') < pos('prompts/koko-system.js'));
  assert.ok(pos('tone-style.js') < pos('tts-provider.js') && pos('tone-style.js') < pos('voice-output.js'));
  assert.ok(sw.includes("'./tone-style.js'") && sw.includes("'cocomitalk-v3.96'"));
});
