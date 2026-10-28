// COCOMITalk - 葵(xAI)/きみ(Kimi)のAPIモジュールと呼び出しの表（SISTER_API/SISTERS）のテスト（step2: 有効化の準備・無効のまま）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// ★全部モック。実際の中継・xAI・Kimiには一度もつないでいない。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, makeStorage, ROOT } = require('./_load');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

/** 偽の登録簿: flags に入れたキーだけ enabled */
function fakeRegistry(flags) { return { isEnabled: k => !!flags[k] }; }

function dispatchEnv(flags) {
  const e = load(['api-compat-core.js', 'api-xai.js', 'api-kimi.js', 'prompts/common-env.js', 'prompts/aoi-system.js', 'prompts/kimi-system.js',
    'chat-core.js', 'meeting-relay.js'],
    ['ApiXai', 'ApiKimi', 'ChatCore', 'MeetingRelay'],
    { window: {}, localStorage: makeStorage(), CharacterRegistry: fakeRegistry(flags) });
  return e;
}

test('呼び出しの表: 登録簿を enabled:true に見せると aoi→ApiXai / kimi→ApiKimi（chat-coreの表とmeeting-relayの表の両方）', () => {
  const e = dispatchEnv({ aoi: true, kimi: true });
  const api = e.ChatCore.getGroupContext().SISTER_API;
  assert.equal(api.aoi.module(), e.ApiXai);
  assert.equal(api.kimi.module(), e.ApiKimi);
  assert.match(api.aoi.prompt(), /葵/);
  assert.match(api.kimi.prompt(), /きみ/);
  const S = e.MeetingRelay.SISTERS;
  assert.equal(S.aoi.api(), e.ApiXai);
  assert.equal(S.kimi.api(), e.ApiKimi);
  assert.match(S.aoi.prompt('meeting'), /葵/);
  assert.equal(S.aoi.name, '葵ちゃん'); assert.equal(S.kimi.name, 'きみちゃん');
});

test('呼び出しの表: 片方だけ有効なら、その子だけ返る', () => {
  const e = dispatchEnv({ aoi: true });
  const api = e.ChatCore.getGroupContext().SISTER_API;
  assert.equal(api.aoi.module(), e.ApiXai);
  assert.equal(api.kimi.module(), null);
  assert.equal(e.MeetingRelay.SISTERS.kimi.api(), null);
});

test('呼び出しの表: 無効（enabled:false）の間は両方 null＝何も呼ばれない。三姉妹の行は今まで通り（他のスクリプトが未読込なら null）', () => {
  const e = dispatchEnv({});
  const api = e.ChatCore.getGroupContext().SISTER_API;
  assert.equal(api.aoi.module(), null); assert.equal(api.kimi.module(), null);
  assert.equal(e.MeetingRelay.SISTERS.aoi.api(), null); assert.equal(e.MeetingRelay.SISTERS.kimi.api(), null);
  assert.deepEqual(plain(Object.keys(api)), ['koko', 'gpt', 'claude', 'aoi', 'kimi']);
  assert.equal(api.koko.module(), null); // この環境には ApiGemini を読み込んでいないだけ。三姉妹の行の形は変えていない
  // 登録簿そのものが無い環境でも例外にならず null
  const bare = load(['api-compat-core.js', 'api-xai.js', 'chat-core.js'], ['ChatCore'], { window: {}, localStorage: makeStorage() });
  assert.equal(bare.ChatCore.getGroupContext().SISTER_API.aoi.module(), null);
});

test('本物の登録簿: aoi/kimi は enabled:false のまま・有効一覧は三姉妹だけ・provider/apiModule は新モジュールと一致', () => {
  const R = load(['characters.js'], ['CharacterRegistry']).CharacterRegistry;
  assert.deepEqual(plain(R.enabledList().map(c => c.key)), ['koko', 'gpt', 'claude']);
  for (const [k, p, m] of [['aoi', 'xai', 'ApiXai'], ['kimi', 'moonshot', 'ApiKimi']]) {
    const c = R.get(k);
    assert.equal(c.enabled, false); assert.equal(c.status, 'coming-soon'); assert.equal(c.provider, p); assert.equal(c.apiModule, m);
  }
  // 無効の間は ChatCore の1対1の表(SISTERS)・会話履歴にも出ない＝選べない
  const e = load(['chat-core.js'], ['ChatCore'], { window: {}, localStorage: makeStorage() });
  assert.deepEqual(plain(Object.keys(e.ChatCore.SISTERS)), ['koko', 'gpt', 'claude']);
});

// ---- APIモジュール本体（ApiCommon はモック）----
function apiEnv({ reply, usage, fail, token = true } = {}) {
  const calls = [], recorded = [];
  const ApiCommon = {
    hasAuthToken: () => token,
    callAPI: async (endpoint, body) => {
      calls.push({ endpoint, body: plain(body) });
      if (fail) throw new Error('API中継エラー（xai）: HTTP 500（0.1秒）');
      return reply === undefined ? { choices: [{ message: { content: 'やっほー' }, finish_reason: 'stop' }], usage } : reply;
    },
  };
  const TokenMonitor = { record: (m, i, o) => recorded.push([m, i, o]) };
  const e = load(['model-tiers.js', 'model-effort.js', 'api-compat-core.js', 'api-xai.js', 'api-kimi.js'],
    ['ModelTiers', 'ApiCompatCore', 'ApiXai', 'ApiKimi'],
    { window: {}, localStorage: makeStorage(), ApiCommon, TokenMonitor });
  return { ...e, calls, recorded };
}

test('ApiXai: /xai へ model-tiers の段階ID＋reasoning_effort＋max_completion_tokens。tools/temperature/stream は送らない', async () => {
  const e = apiEnv({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  const hist = [{ role: 'user', content: 'こんにちは' }, { role: 'assistant', content: 'やあ' }];
  for (const [tier, id, eff] of [['lite', 'grok-4.3', 'none'], ['standard', 'grok-4.7', 'low'], ['high', 'grok-4.7', 'high']]) {
    e.calls.length = 0;
    const r = await e.ApiXai.sendMessage('調子は？', 'SYS', hist, { model: tier });
    assert.equal(r, 'やっほー');
    const c = e.calls[0];
    assert.equal(c.endpoint, 'xai');
    assert.equal(c.body.model, id); assert.equal(c.body.reasoning_effort, eff);
    assert.equal(c.body.max_completion_tokens, 8192);
    for (const k of ['tools', 'tool_choice', 'stream', 'temperature', 'top_p', 'n', 'stop', 'max_tokens', 'search_parameters']) assert.ok(!(k in c.body), k);
    assert.deepEqual(c.body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
    assert.equal(c.body.messages[0].content, 'SYS');
    assert.equal(c.body.messages[3].content, '調子は？');
  }
  assert.equal(e.ApiXai.DEFAULT_MODEL, 'lite'); assert.equal(e.ApiXai.hasApiKey(), true);
  assert.deepEqual(plain(e.ApiXai.getModels()), plain(e.ModelTiers.idMap('xai')));
});

test('ApiKimi: /kimi（provider idは moonshot）。kimi-k3.1-pro の low/high/max。maxは出力枠32000。temperatureは送らない', async () => {
  const e = apiEnv();
  for (const [tier, eff, max] of [['lite', 'low', 8192], ['standard', 'high', 8192], ['high', 'max', 32000]]) {
    e.calls.length = 0;
    await e.ApiKimi.sendMessage('やあ', 'SYS', [], { model: tier });
    const b = e.calls[0].body;
    assert.equal(e.calls[0].endpoint, 'kimi');
    assert.equal(b.model, 'kimi-k3.1-pro'); assert.equal(b.reasoning_effort, eff); assert.equal(b.max_completion_tokens, max);
    for (const k of ['temperature', 'top_p', 'n', 'tools', 'stream']) assert.ok(!(k in b), k);
  }
  assert.equal(e.ApiKimi.PROVIDER, 'moonshot'); assert.equal(e.ApiKimi.ENDPOINT, 'kimi');
});

test('ApiXai/Kimi: 履歴は最新20件・末尾の同文userは除外・画像はimage_url・テキスト添付は本文に連結', async () => {
  const e = apiEnv();
  const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  hist.push({ role: 'user', content: '今の質問' });
  await e.ApiXai.sendMessage('今の質問', 'S', hist, {});
  const m = e.calls[0].body.messages;
  assert.equal(m.length, 1 + 19 + 1);  // system + 最新20件のうち末尾の同文を除いた19 + 今回（api-openai.jsと同じ数え方）
  assert.equal(m.filter(x => x.content === '今の質問').length, 1);
  await e.ApiKimi.sendMessage('これ何？', 'S', [], { attachment: { type: 'image', mimeType: 'image/png', content: 'AAA' } });
  const u = e.calls[1].body.messages.at(-1);
  assert.equal(u.content[0].image_url.url, 'data:image/png;base64,AAA'); assert.deepEqual(u.content[1], { type: 'text', text: 'これ何？' });
  await e.ApiKimi.sendMessage('読んで', 'S', [], { attachment: { type: 'text', name: 'a.txt', content: 'BODY' } });
  assert.match(e.calls[2].body.messages.at(-1).content, /a\.txt[\s\S]*BODY[\s\S]*読んで/);
});

test('応答: reasoning_contentは無視して本文だけ／content配列は連結／使用量はTokenMonitorへ（total-promptの方が大きければそちら）', async () => {
  let e = apiEnv({ reply: { choices: [{ message: { content: '本文', reasoning_content: '考え中のメモ' } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 220 } } });
  assert.equal(await e.ApiXai.sendMessage('q', 's'), '本文');
  assert.deepEqual(e.recorded, [['grok-4.3', 100, 120]]);
  e = apiEnv({ reply: { choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }] } });
  assert.equal(await e.ApiKimi.sendMessage('q', 's'), 'AB');
  assert.deepEqual(e.recorded, []);   // usageが無ければ記録しない
  assert.equal(apiEnv().ApiCompatCore.outputTokens({ prompt_tokens: 5, completion_tokens: 9 }), 9);
});

test('失敗: 認証トークン無し／中継エラー／空返答は例外。再試行はしない（1回だけ呼ぶ）', async () => {
  let e = apiEnv({ token: false });
  await assert.rejects(() => e.ApiXai.sendMessage('q', 's'), /トークン/);
  assert.equal(e.calls.length, 0); assert.equal(e.ApiXai.hasApiKey(), false);
  e = apiEnv({ fail: true });
  await assert.rejects(() => e.ApiXai.sendMessage('q', 's'), /中継エラー/);
  assert.equal(e.calls.length, 1);
  e = apiEnv({ reply: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } });
  await assert.rejects(() => e.ApiKimi.sendMessage('q', 's'), /きみちゃん.*空.*length/);
  assert.equal(e.calls.length, 1);
  e = apiEnv({ reply: { error: { message: 'boom' } } });
  await assert.rejects(() => e.ApiXai.sendMessage('q', 's'), /葵ちゃん.*boom/);
});

test('中継の提案パッチ(あれば)との一致: 送るモデルIDが許可リストに入っている・禁止パラメータを送らない。パッチが無い環境ではスキップ', t => {
  const p = '/workspace/cocomitalk_work/deliverables_v2/relay_xai_kimi_v2.patch';
  if (!fs.existsSync(p)) return t.skip('relay patch not on this machine');
  const patch = fs.readFileSync(p, 'utf8');
  const set = name => new Set([...patch.match(new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  const X = set('XAI_ALLOWED_MODELS'), K = set('KIMI_ALLOWED_MODELS');
  const T = load(['model-tiers.js', 'model-effort.js'], ['ModelTiers'], { window: {}, localStorage: makeStorage() }).ModelTiers;
  for (const tier of ['lite', 'standard', 'high']) {
    assert.ok(X.has(T.resolve('xai', tier).id), 'xai ' + tier);
    assert.ok(K.has(T.resolve('moonshot', tier).id), 'kimi ' + tier);
  }
  assert.ok(patch.includes("case 'xai':") && patch.includes("case 'kimi':"));
  const forbidden = patch.match(/FORBIDDEN_PARAMS = \[([^\]]*)\]/)[1];
  const src = read('api-compat-core.js');
  for (const k of [...forbidden.matchAll(/'([^']+)'/g)].map(m => m[1])) assert.ok(!new RegExp(`body\\.${k}\\b|\\b${k}:`).test(src.replace(/\/\/.*$/gm, '')), 'sends ' + k);
});

test('配線: index.html（api-common/model-tiersの後・api-claudeの後）とsw.js（cache v3.76・3ファイル）、1ファイル500行以内、先頭に「このファイルは」', () => {
  const html = read('index.html'), sw = read('sw.js');
  const pos = f => html.indexOf(`src="${f}"`);
  for (const f of ['api-compat-core.js', 'api-xai.js', 'api-kimi.js']) {
    assert.ok(pos(f) > 0, f); assert.ok(sw.includes(`'./${f}'`), 'sw ' + f);
    assert.ok(pos('model-tiers.js') < pos(f) && pos('api-common.js') < pos(f) && pos('api-claude.js') < pos(f), f);
    assert.ok(pos(f) < pos('chat-core.js') && pos(f) < pos('meeting-relay.js'), f);
    const t = read(f); assert.ok(t.split('\n').length <= 500); assert.ok(/このファイルは/.test(t.split('\n').slice(0, 5).join('\n')) || f === 'api-compat-core.js');
    assert.match(t, /作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-29/);
  }
  assert.ok(pos('api-compat-core.js') < pos('api-xai.js') && pos('api-xai.js') < pos('api-kimi.js'));
  assert.ok(sw.includes("'cocomitalk-v3.76'"));
  // 有効化の手順（スイッチの場所）が冒頭に書いてある
  assert.match(read('chat-core.js').split('\n').slice(0, 25).join('\n'), /characters\.js の aoi \/ kimi を enabled:true/);
  assert.match(read('api-xai.js').split('\n').slice(0, 10).join('\n'), /characters\.js の aoi を enabled:true/);
  assert.match(read('api-kimi.js').split('\n').slice(0, 10).join('\n'), /characters\.js の kimi を enabled:true/);
});
