// COCOMITalk - 5人のGemini TTSの声の割り当て（characters.js / tts-provider.js / gemini-tts-provider.js / voice-output.js）のテスト
// このファイルは node --test tests/ で実行する（実APIは呼ばない。fetchとApiCommonは差し替え）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, makeStorage } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
// オーナー決定（2026-10-28）: 澪(gpt)=Despina / クロ(claude)=Achernar / ここ(koko)=Autonoe / 葵(aoi)=Leda / キミ(kimi)=Zephyr
const EXPECT = { gpt: 'Despina', claude: 'Achernar', koko: 'Autonoe', aoi: 'Leda', kimi: 'Zephyr' };
const OPENAI_OLD = { koko: 'nova', gpt: 'shimmer', claude: 'alloy' };

function tts(provider = 'openai') {
  const e = load(['characters.js', 'tts-provider.js'], ['CharacterRegistry', 'SISTER_VOICE_MAP', 'getSisterVoice', 'setTTSProviderName'],
    { window: {}, localStorage: makeStorage() });
  if (provider) e.setTTSProviderName(provider);
  return e;
}

test('声: 登録簿(characters.js)の gemini 欄が5人とも決定済みの声', () => {
  const { CharacterRegistry: C } = tts();
  for (const [k, v] of Object.entries(EXPECT)) assert.equal(C.get(k).voice.gemini, v, k);
  assert.equal(C.isEnabled('aoi'), false);   // 準備中のまま
  assert.equal(C.isEnabled('kimi'), false);
});

test('声: SISTER_VOICE_MAP の gemini 欄が登録簿と一致し、30声のどれかである', () => {
  const { CharacterRegistry: C, SISTER_VOICE_MAP: MAP } = tts();
  const G = load(['tts-provider.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider'], { window: {}, localStorage: makeStorage() }).GeminiTTSProvider;
  const valid = new Set(G.PREBUILT_VOICES);
  for (const k of Object.keys(EXPECT)) {
    assert.equal(MAP[k].gemini.voice, C.get(k).voice.gemini, `${k} 登録簿と一致`);
    assert.ok(valid.has(MAP[k].gemini.voice), `${k} は公式30声`);
  }
  assert.equal(new Set(Object.values(EXPECT)).size, 5);   // 5人とも別の声
});

test('声: Gemini選択時は getSisterVoice が5人それぞれの声を返す', () => {
  const { getSisterVoice } = tts('gemini');
  for (const [k, v] of Object.entries(EXPECT)) {
    const r = plain(getSisterVoice(k));
    assert.equal(r.voice, v, k); assert.equal(r.provider, 'gemini');
  }
});

test('声: OpenAI選択（既定）では従来の3姉妹の声のまま。VOICEVOX欄も無変更', () => {
  const { getSisterVoice, SISTER_VOICE_MAP: MAP } = tts('openai');
  for (const [k, v] of Object.entries(OPENAI_OLD)) { const r = plain(getSisterVoice(k)); assert.equal(r.voice, v); assert.equal(r.provider, 'openai'); }
  assert.deepEqual(plain(['koko', 'gpt', 'claude'].map(k => MAP[k].voicevox.voice)), ['1', '4', '46']);
});

test('声: 葵・キミはOpenAI/VOICEVOX選択でも例外にならず既定の声(alloy)に戻る', () => {
  for (const p of ['openai', 'voicevox']) {
    const { getSisterVoice } = tts(p);
    for (const k of ['aoi', 'kimi']) { const r = plain(getSisterVoice(k)); assert.equal(r.voice, 'alloy'); assert.equal(r.provider, 'openai'); }
  }
  assert.equal(plain(tts('gemini').getSisterVoice('nobody')).voice, 'alloy');   // 不明IDは従来どおり
});

test('声: Gemini TTSの要求に各キャラの声がそのまま載る（中継へ送る本文）', async () => {
  const { getSisterVoice } = tts('gemini');
  const fetched = [];
  const wavBuf = () => { const b = new ArrayBuffer(44 + 48000); const v = new DataView(b); v.setUint32(0, 0x52494646, false); v.setUint32(28, 48000, true); return b; };
  const e = load(['tts-provider.js', 'gemini-tts-provider.js'], ['GeminiTTSProvider'], {
    window: {}, localStorage: makeStorage(),
    ApiCommon: { hasAuthToken: () => true, getWorkerURL: () => 'https://relay.test', getAuthToken: () => 'T' },
    fetch: async (u, o) => { fetched.push(JSON.parse(o.body)); return { ok: true, arrayBuffer: async () => wavBuf() }; },
    Blob: class {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Audio: class { addEventListener() {} },
  });
  const p = new e.GeminiTTSProvider();
  for (const k of Object.keys(EXPECT)) await p.synthesize('こんにちは', getSisterVoice(k).voice);
  assert.deepEqual(fetched.map(b => b.voice), Object.keys(EXPECT).map(k => EXPECT[k]));
  assert.ok(fetched.every(b => b.model === 'gemini-3.8-flash-lite-tts' && !('style' in b)));   // 場面スタイルはアプリからは送っていない（既存のまま）
});

test('声: Gemini選択で失敗したら、3姉妹はOpenAIの声へ戻る（葵・キミは既定の alloy）', async () => {
  const log = [];
  const e = load(['characters.js', 'tts-provider.js', 'voice-output.js'], ['AudioPlaybackManager', 'setTTSProviderName'], {
    window: {}, localStorage: makeStorage(),
    OpenAITTSProvider: class { isAvailable() { return true; } async synthesize(t, v) { log.push(['openai', v]); return { from: 'openai' }; } },
    VoicevoxTTSProvider: undefined,
    GeminiTTSProvider: class { async synthesize(t, v) { log.push(['gemini', v]); throw new Error('relay down'); } },
  });
  const m = new e.AudioPlaybackManager(); m.switchProvider('gemini');
  for (const k of ['koko', 'gpt', 'claude', 'aoi']) await m._synth('x', EXPECT[k], k, 1);
  assert.deepEqual(plain(log), [['gemini', 'Autonoe'], ['openai', 'nova'], ['gemini', 'Despina'], ['openai', 'shimmer'],
    ['gemini', 'Achernar'], ['openai', 'alloy'], ['gemini', 'Leda'], ['openai', 'alloy']]);
});

test('声: index.html の選択肢が「未割り当て」の古い説明のままではない', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!html.includes('声は未割り当て'));
});
