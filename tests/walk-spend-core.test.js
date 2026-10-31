// COCOMITalk - お散歩費用上限テスト（計算部品: 期間・締め日・金額・判定・保存データの読み取り）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./_load');

const { WalkSpendCore: C } = load(['walk-spend-core.js'], ['WalkSpendCore']);
const plain = x => JSON.parse(JSON.stringify(x));
/** 日本時間の y-m-d h:mi を時刻(ms)に */
const jst = (y, m, d, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const per = (ms, closing) => plain(C.periodFor(ms, closing));

test('期間: 月末締め（既定）。月末の23:59まで同じ期、翌日0:00に次の期', () => {
  assert.deepEqual(per(jst(2026, 10, 28), 'eom'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(per(jst(2026, 10, 31, 23, 59), 'eom'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(per(jst(2026, 11, 1, 0, 0), 'eom'), { start: '2026-11-01', end: '2026-11-30' });
});

test('期間: 25日締め。25日23:59までは当期、26日0:00から次の期。年またぎも正しい', () => {
  assert.deepEqual(per(jst(2026, 10, 25, 23, 59), 25), { start: '2026-09-26', end: '2026-10-25' });
  assert.deepEqual(per(jst(2026, 10, 26, 0, 0), 25), { start: '2026-10-26', end: '2026-11-25' });
  assert.deepEqual(per(jst(2026, 12, 26), 25), { start: '2026-12-26', end: '2027-01-25' });
  assert.deepEqual(per(jst(2027, 1, 3), 25), { start: '2026-12-26', end: '2027-01-25' });
});

test('短い月: 31日締めは2月なら28日（うるう年は29日）、4月なら30日', () => {
  assert.deepEqual(per(jst(2027, 2, 10), 31), { start: '2027-02-01', end: '2027-02-28' });
  assert.deepEqual(per(jst(2028, 2, 10), 31), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(per(jst(2026, 4, 15), 31), { start: '2026-04-01', end: '2026-04-30' });
  assert.deepEqual(per(jst(2027, 3, 1), 31), { start: '2027-03-01', end: '2027-03-31' });   // 2月28日の翌日から
  assert.deepEqual(per(jst(2026, 1, 31), 31), { start: '2026-01-01', end: '2026-01-31' });
});

test('短い月: 30日締めは1月31日が2月の期（2/28まで）、29日締めの非うるう2月は28日', () => {
  assert.deepEqual(per(jst(2026, 1, 31), 30), { start: '2026-01-31', end: '2026-02-28' });
  assert.deepEqual(per(jst(2026, 2, 28), 30), { start: '2026-01-31', end: '2026-02-28' });
  assert.deepEqual(per(jst(2026, 3, 1), 30), { start: '2026-03-01', end: '2026-03-30' });
  assert.deepEqual(per(jst(2027, 2, 28), 29), { start: '2027-01-30', end: '2027-02-28' });
  assert.deepEqual(per(jst(2027, 3, 1), 29), { start: '2027-03-01', end: '2027-03-29' });
  assert.deepEqual(per(jst(2028, 2, 29), 29), { start: '2028-01-30', end: '2028-02-29' });  // うるう年は29日がある
});

test('締め日31と月末は、どの月でも同じ期になる', () => {
  for (let m = 1; m <= 12; m++) for (const d of [1, 15, 28]) {
    assert.deepEqual(per(jst(2028, m, d), 31), per(jst(2028, m, d), 'eom'), `${m}/${d}`);
  }
  assert.equal(C.closingDayIn(2027, 2, 31), 28);
  assert.equal(C.closingDayIn(2028, 2, 'eom'), 29);
  assert.equal(C.closingDayIn(2026, 4, 31), 30);
});

test('性質: どの締め日でも毎日がちょうど1つの期に入り、期は隙間も重なりもなく続く（2年分）', () => {
  for (const closing of [1, 2, 15, 28, 29, 30, 31, 'eom']) {
    let prev = null;
    for (let i = 0; i < 740; i++) {
      const ms = jst(2027, 1, 1) + i * 86400000;
      const key = C.todayKey(ms), p = per(ms, closing);
      assert.ok(p.start <= key && key <= p.end, `${closing} ${key}`);
      if (prev && prev.end !== p.end) assert.equal(C.addDays(prev.end, 1), p.start, `${closing} ${key} 隙間/重なり`);
      if (prev && prev.end === p.end) assert.equal(prev.start, p.start);
      prev = p;
    }
  }
});

test('タイムゾーン: 端末がどこでも日本時間で切り替わる（UTC 15:00 = 日本の0:00）', () => {
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(C.todayKey(Date.UTC(2026, 9, 31, 14, 59, 59)), '2026-10-31', tz);
      assert.equal(C.todayKey(Date.UTC(2026, 9, 31, 15, 0, 0)), '2026-11-01', tz);
      assert.deepEqual(per(Date.UTC(2026, 9, 31, 15, 0, 0), 'eom'), { start: '2026-11-01', end: '2026-11-30' }, tz);
      assert.deepEqual(per(Date.UTC(2026, 9, 31, 14, 59, 59), 'eom'), { start: '2026-10-01', end: '2026-10-31' }, tz);
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test('締め日が過ぎたか: 締め日当日はまだ（その日いっぱい当期）、翌日から過ぎた', () => {
  assert.equal(C.isPast(jst(2026, 10, 31, 23, 59), '2026-10-31'), false);
  assert.equal(C.isPast(jst(2026, 11, 1, 0, 0), '2026-10-31'), true);
});

test('締め日の正規化: 1〜31と月末だけ。変な値は月末', () => {
  assert.equal(C.normClosing('15'), 15);
  assert.equal(C.normClosing(31), 31);
  for (const bad of [0, 32, -1, 15.5, 'abc', null, undefined, NaN, {}]) assert.equal(C.normClosing(bad), 'eom', String(bad));
  assert.equal(C.normClosing('end'), 'eom');
});

test('金額の入力チェック: 円は整数、ドルは小数2桁。範囲外/数字でないものは拒否', () => {
  assert.deepEqual(plain(C.parseAmount('1,500', 'JPY')), { ok: true, amount: 1500 });
  assert.deepEqual(plain(C.parseAmount('¥ 1500.6', 'JPY')), { ok: true, amount: 1501 });
  assert.deepEqual(plain(C.parseAmount('$10.456', 'USD')), { ok: true, amount: 10.46 });
  for (const bad of ['', 'abc', 0, -5, null, undefined, NaN, Infinity, 1e9]) assert.equal(C.parseAmount(bad, 'JPY').ok, false, String(bad));
  assert.equal(C.parseAmount(0.001, 'USD').ok, false);
  assert.equal(C.parseAmount(200000, 'USD').ok, false);
});

test('通貨換算: TokenMonitorと同じレート(1ドル=150円)。変なレートは既定に戻す', () => {
  assert.equal(C.toUSD(1500, 'JPY', 150), 10);
  assert.equal(C.toUSD(10, 'USD', 150), 10);
  assert.equal(C.fromUSD(2, 'JPY', 150), 300);
  assert.equal(C.toUSD(150, 'JPY', 0), 1);
  assert.equal(C.toUSD(150, 'JPY', NaN), 1);
  assert.equal(C.fmtMoney(1.001, 'JPY', 150), '¥151');   // 円は切り上げ（少なく見せない）
  assert.equal(C.fmtMoney(1.234, 'USD', 150), '$1.23');
});

test('判定: オフ / ok / 警告ライン / 上限（ちょうどの値も含む）', () => {
  const cfg = { capOn: true, amount: 1500, currency: 'JPY', warnPct: 80 };   // = $10
  assert.equal(C.statusOf({ ...cfg, capOn: false }, 99, 150).state, 'off');
  assert.equal(C.statusOf({ ...cfg, amount: 0 }, 99, 150).state, 'off');
  assert.equal(C.statusOf(null, 99, 150).state, 'off');
  assert.equal(C.statusOf(cfg, 7.99, 150).state, 'ok');
  assert.equal(C.statusOf(cfg, 8, 150).state, 'warn');
  assert.equal(C.statusOf(cfg, 9.99, 150).state, 'warn');
  assert.equal(C.statusOf(cfg, 10, 150).state, 'capped');
  assert.equal(C.statusOf(cfg, 10.5, 150).state, 'capped');
  assert.equal(C.statusOf({ ...cfg, amount: 10, currency: 'USD' }, 10, 150).state, 'capped');
  assert.equal(C.statusOf({ ...cfg, warnPct: 50 }, 5, 150).state, 'warn');
});

test('1回の費用: 100万トークンあたりの単価で計算。料金が無いモデルは高めの既定で known:false', () => {
  assert.deepEqual(plain(C.callCostUSD({ input: 1, output: 2 }, 1e6, 5e5)), { usd: 2, known: true });
  const u = C.callCostUSD(null, 1e6, 1e6);
  assert.equal(u.known, false);
  assert.equal(u.usd, 30);                       // 5 + 25
  assert.equal(C.callCostUSD({ input: 1, output: 2 }, -5, 'x').usd, 0);
  assert.equal(C.callCostUSD({ input: 'a', output: 2 }, 1, 1).known, false);
});

test('保存データ: 空 / 壊れたJSON / 配列 / 数字 は安全に扱う', () => {
  assert.equal(C.parseStored(null).status, 'empty');
  assert.equal(C.parseStored(undefined).status, 'empty');
  for (const bad of ['{bad', '', '[]', '123', '"x"', 'null']) assert.equal(C.parseStored(bad).status, 'corrupt', bad);
});

test('保存データ: 値が壊れていても例外にせず、使える値だけ拾う', () => {
  const r = C.parseStored(JSON.stringify({ v: 1, cfg: { capOn: true, amount: 'abc', currency: 'EUR', closingDay: 99, warnPct: 12 },
    cur: { start: '2026-10-01', end: '2026-10-31', spendUSD: -3, calls: 'x', unknown: 1.7 }, history: [{ start: 'x', end: 'y' }, null, { start: '2026-09-01', end: '2026-09-30', spendUSD: 2, calls: 4 }] }));
  assert.equal(r.status, 'ok');
  assert.deepEqual(plain(r.state.cfg), { capOn: false, amount: 0, currency: 'JPY', closingDay: 'eom', warnPct: 80 });
  assert.equal(r.state.cur.spendUSD, 0);
  assert.equal(r.state.cur.calls, 0);
  assert.equal(r.state.cur.unknown, 1);
  assert.deepEqual(plain(r.state.history), [{ start: '2026-09-01', end: '2026-09-30', spendUSD: 2, calls: 4 }]);
  assert.equal(C.parseStored({ v: 1, cur: { start: '2026-10-31', end: '2026-10-01' } }).state.cur, null);
});

test('保存データ: 新しい版(v2)は「newer」（上書きしない合図）。正しい値はそのまま読める', () => {
  const r = C.parseStored({ v: 2, cfg: { capOn: true, amount: 1000, currency: 'JPY', closingDay: 25, warnPct: 90 } });
  assert.equal(r.status, 'newer');
  assert.equal(r.state.cfg.amount, 1000);
  assert.equal(r.state.cfg.closingDay, 25);
  assert.equal(r.state.cfg.capOn, true);
});

test('既定: 上限はオフ・金額は未設定（アプリ側で金額を決めない）・締め日は月末・警告80%', () => {
  assert.deepEqual(plain(C.DEFAULT_CFG), { capOn: false, amount: 0, currency: 'JPY', closingDay: 'eom', warnPct: 80 });
});
