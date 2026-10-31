// COCOMITalk - 会議 Phase A（共通の進め方・書記まとめ cocomi.meeting.v1・共有・名前は登録簿）のテスト
// このファイルは node --test tests/*.test.js で実行する（実APIは呼ばない。書記は偽APIで試す）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./_load');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const PROMPTS = ['tone-style.js', 'prompts/common-env.js', 'prompts/koko-system.js', 'prompts/gpt-system.js', 'prompts/claude-system.js',
  'prompts/aoi-system.js', 'prompts/kimi-system.js', 'prompts/meeting-procedure.js', 'characters.js'];
const relayEnv = () => load([...PROMPTS, 'meeting-relay.js'], ['MeetingRelay', 'MeetingProcedure'], { window: {}, realRegistry: true });
const resEnv = () => load(['characters.js', 'meeting-result.js'], ['MeetingResult', 'CharacterRegistry'], { realRegistry: true });
const HIST = [
  { round: 1, sister: 'koko', isLead: true, content: 'ここの意見', timestamp: 't1' },
  { round: 1, sister: 'aoi', isLead: false, content: '葵の意見', timestamp: 't2' },
  { round: 1, sister: 'kimi', isLead: false, content: 'きみの意見', timestamp: 't3' },
];
const GOOD = { conclusion: 'こうする', decisions: ['Aにする'], open_questions: ['Bは?'], risks: [],
  tasks: [{ owner: '仮', title: '実装', detail: 'アプリ側', depends_on: [], needs_akiya_go: true }] };
const fakeApi = replies => { const calls = []; return { calls, sendMessage: async (u, s, h, o) => { calls.push(o); const r = replies.shift(); if (r instanceof Error) throw r; return r; } }; };

test('③ 進め方ブロック: 会議モードの時だけ5人全員の末尾に1回。通常・開発モードには入らない', () => {
  const { MeetingRelay, MeetingProcedure } = relayEnv();
  for (const k of ['koko', 'gpt', 'claude', 'aoi', 'kimi']) {
    for (const g of ['meeting-lite', 'meeting', 'meeting-full', undefined]) {
      const p = MeetingRelay.SISTERS[k].prompt(g);
      assert.equal(p.split(MeetingProcedure.MARK).length, 2, `${k}/${g} に1回`);
      assert.ok(p.endsWith(MeetingProcedure.getBlock()), `${k}/${g} 末尾`);
    }
  }
  assert.equal(MeetingProcedure.append('x', 'normal'), 'x');
  assert.equal(MeetingProcedure.append('x', 'dev'), 'x');
  const once = MeetingProcedure.append('x', 'meeting');
  assert.equal(MeetingProcedure.append(once, 'meeting'), once, '二重に足さない');
  // 元のプロンプトファイル（通常会話）には入っていない
  for (const f of ['koko', 'gpt', 'claude', 'aoi', 'kimi']) assert.ok(!read(`prompts/${f === 'gpt' ? 'gpt' : f}-system.js`).includes('COCOMI会議の進め方'));
});

test('② 結果の形: MDに 結論/決まったこと/やることの一覧/未決事項 と schema cocomi.meeting.v1 のJSONブロック。受け取りは葵/澪/クロ', () => {
  const { MeetingResult } = resEnv();
  const r = MeetingResult.normalize(GOOD, { topic: '議題', consultationId: 7, participants: ['koko', 'aoi', 'kimi'], createdAt: 'T' });
  assert.ok(MeetingResult.validate(r).ok, JSON.stringify(MeetingResult.validate(r).errors));
  const md = MeetingResult.toMarkdown(r);
  for (const h of ['## 結論', '## 決まったこと', '## やることの一覧', '## 未決事項']) assert.ok(md.includes(h), h);
  assert.ok(md.includes('受け取り: 葵・澪・クロ'));
  assert.ok(md.includes('参加: ここちゃん・葵ちゃん・きみちゃん'));
  assert.ok(md.includes('アキヤのGOが必要'));
  const j = MeetingResult.extractJson(md);
  assert.equal(j.schema, 'cocomi.meeting.v1');
  assert.deepEqual(plain(j.recipients), ['aoi', 'mio', 'kuro']);
  assert.equal(j.consultation_id, 7);
  assert.equal(j.tasks.length, 1);
  // resolution = 結果MD＋議事ログ。JSONは議事ログより前で取り出せる
  const res = MeetingResult.toResolution(r, HIST);
  assert.ok(res.startsWith(md));
  assert.ok(res.includes('## 議事ログ') && res.includes('葵の意見'));
  assert.deepEqual(plain(MeetingResult.extractJson(res)), plain(j));
});

test('① 検証: 必須キー・owner値・型の誤りを拾う', () => {
  const { MeetingResult } = resEnv();
  const ok = MeetingResult.normalize(GOOD, { topic: 't', participants: [] });
  assert.ok(MeetingResult.validate(ok).ok);
  const bad = (f) => { const x = plain(ok); f(x); return MeetingResult.validate(x); };
  assert.equal(MeetingResult.validate(null).ok, false);
  assert.equal(MeetingResult.validate([]).ok, false);
  assert.equal(bad(x => { x.schema = 'v0'; }).ok, false);
  assert.equal(bad(x => { x.conclusion = ' '; }).ok, false);
  assert.equal(bad(x => { x.decisions = 'A'; }).ok, false);
  assert.equal(bad(x => { x.recipients = ['aoi']; }).ok, false);
  assert.equal(bad(x => { x.tasks[0].owner = 'koko'; }).ok, false);
  assert.equal(bad(x => { x.tasks[0].title = ''; }).ok, false);
  assert.equal(bad(x => { x.tasks[0].needs_akiya_go = 'yes'; }).ok, false);
  assert.equal(bad(x => { x.tasks = {}; }).ok, false);
  // 書記の返答の読み取り: 囲みあり・前置きあり・壊れたJSON
  assert.equal(MeetingResult.parseScribeReply('```json\n{"a":1}\n```').a, 1);
  assert.equal(MeetingResult.parseScribeReply('はい。{"a":2} 以上').a, 2);
  assert.equal(MeetingResult.parseScribeReply('{"a":'), null);
  assert.equal(MeetingResult.parseScribeReply(null), null);
});

test('① 書記: 安いモデル(lite)で1回。成功ならその結果、owner不正は「仮」にそろう', async () => {
  const { MeetingResult } = resEnv();
  const api = fakeApi([JSON.stringify({ ...GOOD, tasks: [{ ...GOOD.tasks[0], owner: 'koko' }] })]);
  const out = await MeetingResult.runScribe({ topic: '議題', history: HIST, api });
  assert.equal(out.ok, true); assert.equal(out.attempts, 1);
  assert.equal(api.calls[0].model, 'lite'); assert.equal(api.calls[0].skipTools, true);
  assert.equal(out.result.tasks[0].owner, '仮');
  assert.deepEqual(plain(out.result.participants), ['koko', 'aoi', 'kimi']);
});

test('① 書記: 失敗したら1回だけやり直し。2回ともだめなら議事ログのみ＋未決事項に「要約失敗」', async () => {
  const { MeetingResult } = resEnv();
  const a1 = fakeApi(['だめ', JSON.stringify(GOOD)]);
  const o1 = await MeetingResult.runScribe({ topic: 't', history: HIST, api: a1 });
  assert.equal(o1.ok, true); assert.equal(o1.attempts, 2);
  const a2 = fakeApi([new Error('timeout'), JSON.stringify({ conclusion: '' })]);
  const o2 = await MeetingResult.runScribe({ topic: 't', history: HIST, api: a2 });
  assert.equal(o2.ok, false); assert.equal(o2.attempts, 2); assert.equal(a2.calls.length, 2, '3回目は呼ばない');
  assert.deepEqual(plain(o2.result.open_questions), [MeetingResult.FAIL_NOTE]);
  assert.ok(MeetingResult.validate(o2.result).ok, '失敗時の結果も形は正しい');
  const o3 = await MeetingResult.runScribe({ topic: 't', history: [], api: fakeApi([]) });
  assert.equal(o3.ok, false); assert.equal(o3.attempts, 0);
});

test('④ 名前は登録簿から: 葵・きみも名前で出る。3人だけの名前表は consultation-ui から消えた', () => {
  const { MeetingResult } = resEnv();
  assert.equal(MeetingResult.nameOf('aoi'), '葵ちゃん');
  assert.equal(MeetingResult.nameOf('kimi'), 'きみちゃん');
  assert.equal(MeetingResult.nameOf('gpt'), 'お姉ちゃん');
  assert.ok(MeetingResult.transcriptMd(HIST).includes('**きみちゃん**'));
  const cu = read('consultation-ui.js');
  assert.ok(!/koko: 'ここちゃん', gpt: 'お姉ちゃん', claude: 'クロちゃん' \}/.test(cu));
  for (const f of ['meeting-ui.js', 'meeting-doc-actions.js', 'meeting-archive-ui.js', 'memory-ui.js', 'chat-memory.js']) {
    const s = read(f); assert.ok(s.includes('CharacterRegistry') && s.includes('きみちゃん') && s.includes('葵ちゃん'), f);
  }
});

test('⑤ 共有: 結果のMarkdownだけ（議事ログは入れない）。navigator.share が無ければコピー＋葵のメール', async () => {
  const shared = [];
  let href = '';
  const sandbox = { window: {}, navigator: { share: async d => shared.push(d) }, location: { set href(v) { href = v; } },
    MeetingUI: { addSystemMessage() {} } };
  const e = load(['characters.js', 'meeting-result.js', 'meeting-share.js'], ['MeetingResult', 'MeetingShare'], { ...sandbox, realRegistry: true });
  e.sandbox.MeetingRelay = { getHistory: () => HIST, getCurrentMeetingId: () => 'm1', getTopic: () => '議題' };
  e.sandbox.ApiGemini = fakeApi([JSON.stringify(GOOD)]);
  const text = await e.MeetingShare.share();
  assert.equal(shared.length, 1);
  assert.equal(shared[0].text, text);
  assert.ok(text.includes('## 結論') && text.includes('cocomi.meeting.v1'));
  assert.ok(!text.includes('## 議事ログ') && !text.includes('葵の意見'), '議事ログは入れない');
  // 2回目はキャッシュ（書記を呼び直さない）
  await e.MeetingShare.share();
  assert.equal(e.sandbox.ApiGemini.calls.length, 1);
  // share 無し → mailto 葵
  e.sandbox.navigator.share = undefined;
  await e.MeetingShare.share();
  assert.ok(href.startsWith('mailto:cocomi.aoi@mail.grokbot.com?subject='));
});

test('配線: index.html・sw.js(v4.5・CACHE_FILESは全部存在)・📤ボタン。新ファイルは500行以内・表記あり', () => {
  const html = read('index.html'), sw = read('sw.js');
  assert.ok(sw.includes("const CACHE_NAME = 'cocomitalk-v4.9';"));
  const files = [...sw.matchAll(/'\.\/([^']+)'/g)].map(m => m[1]).filter(Boolean);
  for (const f of files) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${f} が存在`);
  for (const f of ['prompts/meeting-procedure.js', 'meeting-result.js', 'meeting-share.js']) {
    assert.ok(sw.includes(`'./${f}'`), `sw: ${f}`);
    assert.ok(html.includes(`<script src="${f}"></script>`), `html: ${f}`);
    const s = read(f), head = s.split('\n').slice(0, 5).join('\n');
    assert.ok(s.split('\n').length <= 500 && /(このファイルは|COCOMITalk)/.test(head) && /v[0-9]+\.[0-9]+/.test(s));
    assert.ok(head.includes('作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01'), f);
  }
  assert.ok(html.indexOf('prompts/meeting-procedure.js') < html.indexOf('meeting-relay.js'));
  assert.ok(html.indexOf('meeting-share.js') < html.indexOf('consultation-ui.js'));
  assert.ok(html.includes('id="btn-meeting-share"'));
  assert.ok(read('meeting-relay.js').split('\n').length <= 500);
});
