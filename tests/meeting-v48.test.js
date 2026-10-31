// COCOMITalk - v4.8 会議まわりの修正（JST日付・二重保存防止・人のID統一・答え方ルール・送信ボタン・クロ失敗理由）のテスト
// このファイルは node --test tests/*.test.js で実行する（実APIは呼ばない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./_load');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

function docActionsEnv(history = [{ round: 1, sister: 'koko', content: 'a' }]) {
  const msgs = [];
  const env = load(['characters.js', 'meeting-doc-actions.js'], ['MeetingDocActions'], {
    realRegistry: true,
    MeetingUI: { addSystemMessage: t => msgs.push(t) },
    MeetingRelay: { getHistory: () => history, getCurrentMeetingId: () => 'MTG-1' },
  });
  return { ...env, msgs };
}

test('1 JST: 2026-10-31T22:49Z（=11/1 07:49 JST）は 2026-11-01 07:49', () => {
  const { MeetingDocActions } = docActionsEnv();
  assert.deepEqual(plain(MeetingDocActions.jstParts(Date.UTC(2026, 9, 31, 22, 49))), { date: '2026-11-01', time: '07:49' });
  assert.deepEqual(plain(MeetingDocActions.jstParts(Date.UTC(2026, 10, 1, 15, 0))), { date: '2026-11-02', time: '00:00' });
  // UTC日付＋端末時刻の組み合わせが残っていない
  assert.ok(!read('meeting-doc-actions.js').includes('toISOString().slice(0, 10)'));
  for (const f of ['meeting-history.js', 'debug-logger.js', 'consultation-ui.js', 'file-handler.js', 'token-monitor.js']) {
    assert.ok(!/(new Date\(\)|now)\.toISOString\(\)\.(slice\(0, 10\)|split\('T'\))/.test(read(f)), f);
  }
});

test('2 二重保存: 同じ会議・同じ内容の2回目は「もう保存したよ」、10秒以内の3回目は保存し直し、内容が増えたら保存できる', () => {
  const { MeetingDocActions, msgs } = docActionsEnv();
  const A = MeetingDocActions;
  assert.equal(A._allowSave('minutes', 'M#3', 1000), true);
  A._markSaved('minutes', 'M#3');
  assert.equal(A._allowSave('minutes', 'M#3', 2000), false);
  assert.ok(msgs.some(m => m.includes('もう保存したよ')));
  assert.equal(A._allowSave('minutes', 'M#3', 5000), true, '10秒以内にもう一度=保存し直し');
  A._markSaved('minutes', 'M#3');
  assert.equal(A._allowSave('minutes', 'M#3', 6000), false);
  assert.equal(A._allowSave('minutes', 'M#3', 20000), false, '10秒過ぎたらまた警告から');
  assert.equal(A._allowSave('minutes', 'M#4', 21000), true, '発言が増えたら保存できる');
  assert.equal(A._allowSave('doc:all', 'M#3', 21000), true, '種類ごとに別');
  const src = read('meeting-doc-actions.js');
  assert.ok(src.includes("_setBtn('btn-meeting-doc', true)") && src.includes("_setBtn('btn-meeting-minutes', true)"), '処理中はボタン無効');
});

test('3 人のID: participants も koko/mio/kuro/aoi/kimi。旧データ gpt/claude/onee も読める', () => {
  const { MeetingResult, CharacterRegistry } = load(['characters.js', 'meeting-result.js'], ['MeetingResult', 'CharacterRegistry'], { realRegistry: true });
  assert.deepEqual(['koko', 'gpt', 'claude', 'aoi', 'kimi'].map(CharacterRegistry.personIdOf), ['koko', 'mio', 'kuro', 'aoi', 'kimi']);
  assert.equal(CharacterRegistry.keyFromPersonId('mio'), 'gpt');
  assert.equal(CharacterRegistry.keyFromPersonId('onee'), 'gpt');
  assert.equal(CharacterRegistry.keyFromPersonId('claude'), 'claude');
  const hist = [{ round: 1, sister: 'gpt', content: 'x' }, { round: 1, sister: 'claude', content: 'y' }, { round: 1, sister: 'gpt', content: 'z' }];
  assert.deepEqual(plain(MeetingResult.participantsOf(hist)), ['mio', 'kuro']);
  const r = MeetingResult.normalize({ conclusion: 'c', tasks: [] }, { topic: 't', participants: ['gpt', 'kuro', 'koko'] });
  assert.deepEqual(plain(r.participants), ['mio', 'kuro', 'koko']);
  assert.ok(MeetingResult.toMarkdown(r).includes('参加: お姉ちゃん・クロちゃん・ここちゃん'));
  const old = '```json\n{"schema":"cocomi.meeting.v1","participants":["gpt","claude"],"recipients":["aoi","mio","kuro"]}\n```';
  assert.deepEqual(plain(MeetingResult.extractJson(old).participants), ['mio', 'kuro']);
});

test('4/5 会議の答え方ルール: 全項目に答える・未確認・後回しにしない・調べてないのに確認したと言わない・記憶では。短すぎる返答は1回聞き直し', () => {
  const { MeetingProcedure } = load(['prompts/meeting-procedure.js'], ['MeetingProcedure']);
  const b = MeetingProcedure.getBlock();
  for (const w of ['全部', '未確認', '後回し', '公式情報を確認した', '記憶では']) assert.ok(b.includes(w), w);
  assert.equal(MeetingProcedure.isTooShort('公式情報を確認してから答えるね'), true);
  assert.equal(MeetingProcedure.isTooShort('あ'.repeat(45)), false);
  const relay = read('meeting-relay.js');
  assert.ok(relay.includes('MeetingProcedure.isTooShort(reply)') && relay.includes('MeetingProcedure.RETRY_NOTE'));
});

test('6 会議の送信ボタン: 📎と🎤の隣に▶があり、読み上げ名あり、lx2でも常に表示', () => {
  const html = read('index.html');
  assert.ok(/id="btn-meeting-start"[^>]*aria-label="送信/.test(html));
  assert.ok(read('layout2-main.css').includes('html.lx2 .meeting-input-area .input-wrapper > #btn-meeting-start { display: flex !important;'));
});

test('7 クロのチェック失敗理由: HTTP番号/種類を分類し、鍵は伏せる', () => {
  const { DocGenerator } = load(['doc-generator.js'], ['DocGenerator']);
  const d = m => DocGenerator.describeError(new Error(m));
  assert.ok(d('API中継エラー（claude）: HTTP 402（3.1秒）').startsWith('クレジット不足'));
  assert.ok(d('API中継エラー（claude）: Your credit balance is too low（1.0秒）').startsWith('クレジット不足'));
  assert.ok(d('API中継エラー（claude）: HTTP 429（1.0秒）').startsWith('回数・トークン上限(429)'));
  assert.ok(d('API中継エラー（claude）: Overloaded（2.0秒）').startsWith('混雑'));
  assert.ok(d('Failed to fetch').startsWith('タイムアウト/通信切れ'));
  assert.ok(d('応答が空（途中で切れた）').startsWith('空の応答'));
  const e = new Error('x'); e.name = 'AbortError';
  assert.ok(DocGenerator.describeError(e).startsWith('中断'));
  assert.ok(!d('bad key sk-ant-abcdefghijklmnop').includes('abcdefghijklmnop'));
  const src = read('doc-generator.js');
  assert.ok(src.includes('reviewFailures.push') && read('meeting-doc-actions.js').includes('クロのチェック失敗'));
});
