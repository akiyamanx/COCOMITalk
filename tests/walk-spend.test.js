// COCOMITalk - お散歩費用上限テスト（保存・加算・上限ゲート・期の切り替え・配線）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, makeStorage, ROOT } = require('./_load');

const plain = x => JSON.parse(JSON.stringify(x));
const jst = (y, m, d, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h - 9, mi);
const KEY = 'cocomitalk-walk-spend-v1';

/** 1回の「アプリ起動」。同じ ls を渡せば、アプリを閉じて開き直した状態になる */
function boot({ ls = makeStorage(), walking = true, noStorage = false, files } = {}) {
  const flag = { walking };
  const TokenMonitor = { USD_TO_JPY: 150, MODEL_PRICING: { m1: { input: 1, output: 2 } } };
  const extra = { ModeSwitcher: { isWalkMode: () => flag.walking }, TokenMonitor };
  if (!noStorage) extra.localStorage = ls;
  const r = load(files || ['model-tiers.js', 'walk-spend-core.js', 'walk-spend.js'], ['ModelTiers', 'WalkSpendCore', 'WalkSpend'], extra);
  return { WS: r.WalkSpend, C: r.WalkSpendCore, ModelTiers: r.ModelTiers, ls, flag, sandbox: r.sandbox };
}
const NOW = jst(2026, 10, 28);
/** m1: 入力1ドル/出力2ドル（100万トークンあたり）。1回 = $1.00 になる呼び出し */
const dollar = (WS, ms = NOW, n = 1) => { for (let i = 0; i < n; i++) WS.record('m1', 1e6, 0, ms); };

test('既定: 上限オフ・金額なし・締め日は月末・今の期は日本時間の今月・0円', () => {
  const { WS } = boot();
  const v = WS.getState(NOW);
  assert.deepEqual(plain(v.cfg), { capOn: false, amount: 0, currency: 'JPY', closingDay: 'eom', warnPct: 80 });
  assert.equal(v.cur.start, '2026-10-01'); assert.equal(v.cur.end, '2026-10-31');
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.status.state, 'off'); assert.equal(v.prev, null);
});

test('お散歩中だけ数える: お散歩OFFの呼び出しは足さない', () => {
  const { WS, flag } = boot({ walking: false });
  assert.equal(WS.record('m1', 1e6, 0, NOW), 0);
  assert.equal(WS.getState(NOW).cur.spendUSD, 0);
  flag.walking = true;
  assert.equal(WS.record('m1', 1e6, 5e5, NOW), 2);
  const v = WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 2); assert.equal(v.cur.calls, 1); assert.equal(v.cur.unknown, 0);
});

test('再起動しても残る: 保存→開き直し→同じ金額・同じ設定', () => {
  const ls = makeStorage();
  const a = boot({ ls });
  assert.ok(a.WS.setConfig({ capOn: true, amount: 3000, currency: 'JPY', closingDay: 25 }, NOW).ok);
  dollar(a.WS, NOW, 3);
  const b = boot({ ls });                      // アプリを閉じて開き直す
  const v = b.WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 3); assert.equal(v.cur.calls, 3);
  assert.deepEqual(plain(v.cfg), { capOn: true, amount: 3000, currency: 'JPY', closingDay: 25, warnPct: 80 });
  assert.equal(JSON.parse(ls.getItem(KEY)).v, 1);        // 版つき
  dollar(b.WS, NOW);
  assert.equal(boot({ ls }).WS.getState(NOW).cur.spendUSD, 4);
});

test('壊れた保存: 例外にならず、元の文字列を控えて作り直し、その後は正しく保存される', () => {
  const ls = makeStorage({ [KEY]: '{"v":1,"cur":{oops' });
  const { WS } = boot({ ls });
  const v = WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.recovered, true);
  assert.equal(ls.getItem('cocomitalk-walk-spend-v1-corrupt'), '{"v":1,"cur":{oops');
  assert.doesNotThrow(() => dollar(WS));
  assert.equal(JSON.parse(ls.getItem(KEY)).cur.spendUSD, 1);
});

test('壊れた保存: JSONとしては正しいが中身がでたらめでも動く（負の金額・文字・配列）', () => {
  const ls = makeStorage({ [KEY]: JSON.stringify({ v: 1, cfg: 'x', cur: { start: 5, end: [] }, history: 'no' }) });
  const { WS } = boot({ ls });
  const v = WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.history.length, 0); assert.equal(v.cfg.capOn, false);
  ls.setItem(KEY, '[1,2,3]');
  assert.equal(boot({ ls }).WS.getState(NOW).recovered, true);
});

test('新しい版のデータは上書きしない（読むだけ）', () => {
  const raw = JSON.stringify({ v: 2, cfg: { capOn: true, amount: 500, currency: 'JPY' }, future: { keep: 'me' } });
  const ls = makeStorage({ [KEY]: raw });
  const { WS } = boot({ ls });
  dollar(WS); WS.setConfig({ warnPct: 90 }, NOW);
  assert.equal(ls.getItem(KEY), raw);
  assert.equal(WS.getState(NOW).readOnly, true);
});

test('保存できない端末（容量/例外/localStorageなし）でも、その起動中は加算と判定ができ、警告が出る', () => {
  const bad = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} };
  const a = boot({ ls: bad });
  a.WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, NOW);
  dollar(a.WS);
  const v = a.WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 1); assert.equal(v.persistOk, false); assert.equal(v.status.state, 'capped');
  const b = boot({ noStorage: true });
  dollar(b.WS, NOW, 2);
  assert.equal(b.WS.getState(NOW).cur.spendUSD, 2); assert.equal(b.WS.getState(NOW).persistOk, false);
  const c = boot({ ls: { getItem: () => { throw new Error('denied'); }, setItem() {} } });
  assert.doesNotThrow(() => dollar(c.WS));
});

test('上限の入力チェック: 金額なし/不正でオンにしようとしたら拒否し、設定は変わらない', () => {
  const { WS } = boot();
  for (const amount of ['', 'abc', 0, -1, 1e9]) {
    const r = WS.setConfig({ capOn: true, amount }, NOW);
    assert.equal(r.ok, false, String(amount)); assert.ok(r.error);
  }
  assert.equal(WS.getState(NOW).cfg.capOn, false);
  assert.equal(WS.setConfig({ capOn: false, amount: '' }, NOW).ok, true);   // オフにするのは常にできる
});

test('オフのときは、いくら使っても止めない（記録と表示だけ）', () => {
  const { WS } = boot();
  dollar(WS, NOW, 50);
  assert.equal(WS.gate(NOW).allow, true); assert.equal(WS.gate(NOW).state, 'off');
  assert.equal(WS.getState(NOW).cur.spendUSD, 50);
});

test('警告と上限: 80%で警告を1回だけ、上限で止める。円とドルの上限が同じ重みで効く', () => {
  const { WS } = boot();
  const events = []; WS.on(e => { if (e.type !== 'change') events.push(e.type); });
  WS.setConfig({ capOn: true, amount: 1500, currency: 'JPY' }, NOW);     // = $10
  dollar(WS, NOW, 7); assert.equal(WS.getState(NOW).status.state, 'ok');
  dollar(WS); assert.equal(WS.getState(NOW).status.state, 'warn');       // $8 = 80%
  dollar(WS);                                                           // $9 もう警告済み
  assert.deepEqual(events, ['warn']);
  assert.equal(WS.gate(NOW).allow, true);                               // 警告だけでは止めない
  dollar(WS);                                                           // $10 = 上限
  assert.deepEqual(events, ['warn', 'capped']);
  assert.equal(WS.getState(NOW).status.state, 'capped');
  const usd = boot();
  usd.WS.setConfig({ capOn: true, amount: 10, currency: 'USD' }, NOW);
  dollar(usd.WS, NOW, 10);
  assert.equal(usd.WS.gate(NOW).allow, false);
});

test('上限到達: 自動送信を止める。ダイアログは1回だけ（first）。止めている間も勝手に再開しない', () => {
  const { WS } = boot();
  WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, NOW);     // $1
  const seen = []; WS.on(e => { if (e.type === 'blocked' || e.type === 'capped') seen.push(`${e.type}:${e.first}`); });
  dollar(WS);                                                           // 到達の瞬間にダイアログ用イベント
  const g1 = WS.gate(NOW), g2 = WS.gate(NOW), g3 = WS.gate(NOW);
  assert.deepEqual([g1.allow, g2.allow, g3.allow], [false, false, false]);
  assert.equal(g1.reason, 'cap-reached');
  assert.deepEqual(seen, ['capped:undefined', 'blocked:false', 'blocked:false', 'blocked:false']);
});

test('「今回だけ続ける」: 自動送信を1回だけ通し、そのあとはまた止まって聞き直す', () => {
  const { WS } = boot();
  WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, NOW);
  dollar(WS);
  const seen = []; WS.on(e => { if (e.type === 'capped' || e.type === 'blocked') seen.push(e.type + (e.first ? '!' : '')); });
  WS.grantOnce(NOW);
  const a = WS.gate(NOW), b = WS.gate(NOW);
  assert.equal(a.allow, true); assert.equal(a.usedOnce, true);
  assert.equal(b.allow, false);                                         // 2回目は通さない
  dollar(WS);                                                           // その1回で使った分（上限超え）
  assert.deepEqual(seen, ['blocked!', 'capped']);                       // 次はまた聞く（到達ダイアログ）
  assert.equal(WS.getState(NOW).cur.spendUSD, 2);
});

test('「上限を上げる」: 上げれば再開、上げた先でも80%と上限がもう一度働く', () => {
  const { WS } = boot();
  WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, NOW);
  dollar(WS); assert.equal(WS.gate(NOW).allow, false);
  const seen = []; WS.on(e => { if (e.type === 'warn' || e.type === 'capped') seen.push(e.type); });
  WS.setConfig({ amount: 500 }, NOW);                                   // $3.33（使用済み$1）
  assert.equal(WS.gate(NOW).allow, true);
  WS.record('m1', 1.7e6, 0, NOW);                                       // 合計$2.7 = 81% → 警告
  dollar(WS);                                                           // 合計$3.7 → 上限超え
  assert.deepEqual(seen, ['warn', 'capped']);
  assert.equal(WS.gate(NOW).allow, false);
});

test('通貨を変えると上限の重みも切り替わる（円1500=10ドル）。固定レート150', () => {
  const { WS } = boot();
  WS.setConfig({ capOn: true, amount: 1500, currency: 'JPY' }, NOW);
  assert.equal(WS.getState(NOW).status.capUSD, 10);
  WS.setConfig({ amount: 20, currency: 'USD' }, NOW);
  assert.equal(WS.getState(NOW).status.capUSD, 20);
});

test('締め日を過ぎたらリセット: 前の期は履歴に残り、今期は0から。再起動しても同じ', () => {
  const ls = makeStorage();
  const a = boot({ ls });
  a.WS.setConfig({ capOn: true, amount: 150, currency: 'JPY', closingDay: 25 }, jst(2026, 10, 20));
  dollar(a.WS, jst(2026, 10, 20), 2);
  assert.equal(a.WS.gate(jst(2026, 10, 25, 23, 59)).allow, false);       // 25日いっぱいは同じ期（上限到達のまま）
  assert.equal(a.WS.getState(jst(2026, 10, 25, 23, 59)).cur.spendUSD, 2);
  const v = a.WS.getState(jst(2026, 10, 26, 0, 0));                      // 26日0:00 = 次の期
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.cur.start, '2026-10-26'); assert.equal(v.cur.end, '2026-11-25');
  assert.deepEqual(plain(v.prev), { start: '2026-09-26', end: '2026-10-25', spendUSD: 2, calls: 2 });
  assert.equal(a.WS.gate(jst(2026, 10, 26)).allow, true);
  const b = boot({ ls }).WS.getState(jst(2026, 10, 27));
  assert.equal(b.prev.spendUSD, 2); assert.equal(b.cur.spendUSD, 0);
});

test('リセットで「今回だけ」「警告済み」も戻る。何期も開かなかったら、使った期だけ履歴に残る', () => {
  const { WS } = boot();
  WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, jst(2026, 8, 10));
  dollar(WS, jst(2026, 8, 10), 2); WS.grantOnce(jst(2026, 8, 10));
  const v = WS.getState(jst(2026, 11, 3));                              // 9, 10月は未使用
  assert.equal(v.cur.start, '2026-11-01'); assert.equal(v.cur.credit, 0); assert.equal(v.cur.warned, false);
  assert.equal(v.history.length, 1); assert.equal(v.history[0].end, '2026-08-31');
  assert.equal(WS.gate(jst(2026, 11, 3)).allow, true);
});

test('短い月: 31日締めは2月28日いっぱいが同じ期で、3月1日0:00にリセット', () => {
  const { WS } = boot();
  WS.setConfig({ closingDay: 31 }, jst(2027, 2, 5));
  dollar(WS, jst(2027, 2, 5), 2);
  assert.equal(WS.getState(jst(2027, 2, 28, 23, 59)).cur.spendUSD, 2);
  const v = WS.getState(jst(2027, 3, 1, 0, 0));
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.prev.end, '2027-02-28'); assert.equal(v.cur.end, '2027-03-31');
});

test('日本時間で切り替わる: UTCではまだ10/31でも、日本の11/1 0:30は新しい期に入る', () => {
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York']) {
      process.env.TZ = tz;
      const { WS } = boot();
      dollar(WS, Date.UTC(2026, 9, 31, 14, 59));                          // 日本 10/31 23:59
      dollar(WS, Date.UTC(2026, 9, 31, 15, 30));                          // 日本 11/1 0:30
      const v = WS.getState(Date.UTC(2026, 9, 31, 15, 30));
      assert.equal(v.cur.start, '2026-11-01', tz); assert.equal(v.cur.spendUSD, 1, tz); assert.equal(v.prev.spendUSD, 1, tz);
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});

test('締め日の変更: 使用済みの分は消えず、今の期は元の締め日のまま、次の期から新しい締め日', () => {
  const { WS } = boot();
  dollar(WS, jst(2026, 10, 10), 2);
  WS.setConfig({ closingDay: 15 }, jst(2026, 10, 10));
  let v = WS.getState(jst(2026, 10, 20));
  assert.equal(v.cur.spendUSD, 2); assert.equal(v.cur.end, '2026-10-31');
  v = WS.getState(jst(2026, 11, 2));
  assert.equal(v.prev.spendUSD, 2); assert.equal(v.cur.start, '2026-11-01'); assert.equal(v.cur.end, '2026-11-15');
});

test('締め日の変更: まだ0円なら、すぐ新しい締め日の期になる', () => {
  const { WS } = boot();
  WS.setConfig({ closingDay: 25 }, jst(2026, 10, 10));
  const v = WS.getState(jst(2026, 10, 10));
  assert.equal(v.cur.start, '2026-09-26'); assert.equal(v.cur.end, '2026-10-25');
  assert.equal(WS.setConfig({ closingDay: 'abc' }, jst(2026, 10, 10)).ok, true);   // 変な値は月末へ
  assert.equal(WS.getState(jst(2026, 10, 10)).cfg.closingDay, 'eom');
});

test('今期の記録を0に戻す: 履歴は消さない', () => {
  const { WS } = boot();
  dollar(WS, jst(2026, 9, 10), 3); dollar(WS, NOW, 2);
  WS.resetCurrent(NOW);
  const v = WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 0); assert.equal(v.prev.spendUSD, 3);
});

test('料金: 料金表に無いモデルは高めの単価で数え、「料金未登録」を数える', () => {
  const { WS } = boot();
  WS.record('mystery-model', 1e6, 1e6, NOW);
  const v = WS.getState(NOW);
  assert.equal(v.cur.spendUSD, 30); assert.equal(v.cur.unknown, 1);
});

test('料金: Gemini読み上げ(TTS)は ModelTiers の価格表で数える。2027-01-01の値上げ(2倍)も日付で反映', () => {
  const { WS, ModelTiers } = boot();
  const id = 'gemini-3.8-flash-tts';
  const before = ModelTiers.getPricing(id, '2026-12-31'), after = ModelTiers.getPricing(id, '2027-01-01');
  assert.ok(before && after && after.output > before.output, '価格表に日付つき価格がある');
  WS.record(id, 1e6, 1e6, jst(2026, 12, 31, 12));
  const a = WS.getState(jst(2026, 12, 31, 12)).cur.spendUSD;
  assert.ok(Math.abs(a - (before.input + before.output)) < 1e-6, `before ${a}`);
  WS.record(id, 1e6, 1e6, jst(2027, 1, 1, 12));
  const b = WS.getState(jst(2027, 1, 1, 12)).cur.spendUSD;
  assert.ok(Math.abs(b - (after.input + after.output)) < 1e-6, `after ${b}`);
  assert.equal(WS.getState(jst(2027, 1, 1, 12)).cur.unknown, 0);
});

test('壊れたlistenerや内部エラーがAPI記録を止めない（record は例外を出さない）', () => {
  const { WS } = boot();
  WS.on(() => { throw new Error('ui broke'); });
  WS.setConfig({ capOn: true, amount: 150, currency: 'JPY' }, NOW);
  assert.doesNotThrow(() => dollar(WS, NOW, 2));
  assert.doesNotThrow(() => WS.record(undefined, undefined, undefined, NOW));
  assert.doesNotThrow(() => WS.gate(NOW));
});

test('配線: TokenMonitor.record がお散歩中の呼び出しを数える（DB未初期化でも）。USD_TO_JPY を公開', async () => {
  const flag = { walking: true };
  const r = load(['model-tiers.js', 'walk-spend-core.js', 'token-monitor.js', 'walk-spend.js'], ['TokenMonitor', 'WalkSpend'],
    { ModeSwitcher: { isWalkMode: () => flag.walking }, localStorage: makeStorage() });
  assert.equal(r.TokenMonitor.USD_TO_JPY, 150);
  await r.TokenMonitor.record('gpt-4o-mini', 1e6, 0);                    // db無し → 従来は即return。数えるのはその前
  const v = r.WalkSpend.getState();
  assert.equal(v.cur.calls, 1);
  assert.ok(Math.abs(v.cur.spendUSD - 0.15) < 1e-9, String(v.cur.spendUSD));
  flag.walking = false;
  await r.TokenMonitor.record('gpt-4o-mini', 1e6, 0);
  assert.equal(r.WalkSpend.getState().cur.calls, 1);
});

test('配線: 自動送信の直前（音声・ラリー・入力欄チェックの後）で WalkSpend.gate を呼び、止めたら一時画像を捨てる', () => {
  const src = fs.readFileSync(path.join(ROOT, 'vision-ui-controller.js'), 'utf8');
  const fn = src.slice(src.indexOf('function _autoSendToSister'));
  const iGate = fn.indexOf('WalkSpend.gate()'), iText = fn.indexOf("'inputText'"), iEvent = fn.indexOf("new CustomEvent('vision-auto-send'");
  assert.ok(iText > 0 && iGate > iText && iEvent > iGate, 'gateは最後のチェックで、イベント発火の直前');
  assert.ok(fn.slice(iGate, iEvent).includes("_discardAutoCapture('capReached')"));
});

test('配線: index.html の読み込み順と sw.js のキャッシュ（新ファイル3つ）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const s = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const at = f => s.indexOf(f);
  assert.ok(at('walk-spend-core.js') > at('mode-switcher.js') && at('walk-spend.js') > at('walk-spend-core.js'));
  assert.ok(at('walk-spend.js') < at('vision-ui-controller.js'));
  assert.ok(at('walk-spend-ui.js') > at('walk-spend.js') && at('walk-spend-ui.js') < at('app-settings.js'));
  for (const f of ['walk-spend-core.js', 'walk-spend.js', 'walk-spend-ui.js']) assert.equal(s.filter(x => x === f).length, 1, f);
  assert.ok(html.includes('id="walk-spend-area"') && html.includes('id="walk-spend-badge"'));
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['walk-spend-core.js', 'walk-spend.js', 'walk-spend-ui.js']) assert.ok(sw.includes(`'./${f}'`), f);
});

test('画面の説明文: 概算であること・請求の保証ではないこと・事業者の月額上限が最後の砦であること・数えないものを書いてある', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'walk-spend-ui.js'), 'utf8');
  for (const w of ['概算', '請求額の保証ではありません', '月額上限', '音声認識(STT)', 'OpenAI/VOICEVOX']) assert.ok(ui.includes(w), w);
});
