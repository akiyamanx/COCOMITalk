// walk-spend-core.js v1.0
// このファイルは何をするか:
// お散歩モードの費用上限で使う「計算だけ」の部品（保存・画面は持たない）。
//  - 締め日つきの期間計算（日本時間JST固定。端末のタイムゾーンに依存しない）
//  - 保存データの安全な読み取り（壊れた値は捨てて既定へ）
//  - 上限の判定（off / ok / warn / capped）と、1回の呼び出しの概算費用
// ★概算です。請求額の保証ではありません（確実な上限は各事業者の管理画面の月額上限）。
// v1.0 2026-10-28 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';

const WalkSpendCore = (() => {
  const SCHEMA = 1;
  const JST_MS = 9 * 3600 * 1000;
  const DEFAULT_RATE = 150;              // TokenMonitorと同じ固定レート（USD→JPY）
  const FALLBACK_PRICING = { input: 5, output: 25 }; // 料金表に無いモデルは高め（安全側）。表示では「料金未登録」を数える
  const HISTORY_MAX = 12;
  const WARN_CHOICES = [50, 70, 80, 90];
  const LIMITS = { JPY: { min: 1, max: 10000000 }, USD: { min: 0.01, max: 100000 } };
  const DEFAULT_CFG = Object.freeze({ capOn: false, amount: 0, currency: 'JPY', closingDay: 'eom', warnPct: 80 });

  const p2 = n => String(n).padStart(2, '0');
  const keyOf = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`;
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m は 1〜12

  /** 時刻(ms) → 日本時間の {y,m,d} */
  function jstParts(ms) {
    const t = new Date(ms + JST_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  const todayKey = ms => { const p = jstParts(ms); return keyOf(p.y, p.m, p.d); };

  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  /** 締め日の正規化: 'eom'(月末) または 1〜31。それ以外は月末 */
  function normClosing(v) {
    if (v === 'eom' || v === 'end') return 'eom';
    const n = typeof v === 'string' && /^\d{1,2}$/.test(v.trim()) ? parseInt(v, 10) : v;
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 'eom';
  }

  /** その月の実際の締め日（日数が足りない月は月末日になる。例: 31日締めの2月 → 28/29日） */
  function closingDayIn(y, m, closing) {
    const c = normClosing(closing), last = dim(y, m);
    return c === 'eom' ? last : Math.min(c, last);
  }

  function shiftMonth(y, m, delta) {
    const i = (y * 12 + (m - 1)) + delta;
    return { y: Math.floor(i / 12), m: (i % 12) + 1 };
  }

  /** 今(ms)が含まれる期間 {start,end}（'YYYY-MM-DD'、両端を含む。end=締め日の当日いっぱい） */
  function periodFor(ms, closing) {
    const t = jstParts(ms), c = closingDayIn(t.y, t.m, closing);
    let endM, prevEnd;
    if (t.d <= c) {
      endM = { y: t.y, m: t.m };
      const pm = shiftMonth(t.y, t.m, -1);
      prevEnd = keyOf(pm.y, pm.m, closingDayIn(pm.y, pm.m, closing));
    } else {
      endM = shiftMonth(t.y, t.m, 1);
      prevEnd = keyOf(t.y, t.m, c);
    }
    return { start: addDays(prevEnd, 1), end: keyOf(endM.y, endM.m, closingDayIn(endM.y, endM.m, closing)) };
  }

  /** 保存済みの期間(endKey)を、今(ms)が過ぎたか（＝締め日が過ぎたか） */
  const isPast = (ms, endKey) => todayKey(ms) > endKey;

  // ---- 金額 ----
  const rateOf = r => (Number.isFinite(r) && r > 0 ? r : DEFAULT_RATE);
  const toUSD = (amount, cur, rate) => (cur === 'USD' ? amount : amount / rateOf(rate));
  const fromUSD = (usd, cur, rate) => (cur === 'USD' ? usd : usd * rateOf(rate));
  const round6 = x => Math.round(x * 1e6) / 1e6;

  /** 上限額の入力チェック。{ok, amount|error}（円は整数に丸める） */
  function parseAmount(raw, currency) {
    const cur = currency === 'USD' ? 'USD' : 'JPY';
    const n = typeof raw === 'number' ? raw : Number(String(raw == null ? '' : raw).replace(/[,\s¥$円]/g, ''));
    const L = LIMITS[cur];
    if (!Number.isFinite(n) || n < L.min || n > L.max) {
      return { ok: false, error: `${cur === 'JPY' ? '円' : 'ドル'}で ${L.min.toLocaleString()}〜${L.max.toLocaleString()} の数字を入れてください` };
    }
    return { ok: true, amount: cur === 'JPY' ? Math.round(n) : Math.round(n * 100) / 100 };
  }

  /** 1回の呼び出しの概算USD。pricing={input,output}(100万トークンあたりUSD)。無ければ高めの既定で known:false */
  function callCostUSD(pricing, inTok, outTok) {
    const known = !!(pricing && Number.isFinite(pricing.input) && Number.isFinite(pricing.output));
    const p = known ? pricing : FALLBACK_PRICING;
    const i = Math.max(0, Number(inTok) || 0), o = Math.max(0, Number(outTok) || 0);
    return { usd: round6((i / 1e6) * p.input + (o / 1e6) * p.output), known };
  }

  /** 判定。state: off(上限なし) / ok / warn(警告ライン以上) / capped(上限以上) */
  function statusOf(cfg, spendUSD, rate) {
    const capOk = cfg && cfg.capOn && Number.isFinite(cfg.amount) && cfg.amount > 0;
    if (!capOk) return { state: 'off', pct: 0, capUSD: 0, spendUSD, remainUSD: null };
    const capUSD = toUSD(cfg.amount, cfg.currency, rate);
    const pct = capUSD > 0 ? (spendUSD / capUSD) * 100 : 0;
    const state = spendUSD >= capUSD - 1e-9 ? 'capped' : (pct >= cfg.warnPct ? 'warn' : 'ok');
    return { state, pct, capUSD, spendUSD, remainUSD: Math.max(0, capUSD - spendUSD) };
  }

  /** 表示用の金額（円は切り上げ、ドルは小数2桁） */
  function fmtMoney(usd, cur, rate) {
    const v = fromUSD(usd, cur, rate);
    return cur === 'USD' ? `$${v.toFixed(2)}` : `¥${Math.ceil(v - 1e-9).toLocaleString('ja-JP')}`;
  }

  // ---- 保存データの読み取り ----
  const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
  const keyOk = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

  function sanitizeCfg(c) {
    const o = c && typeof c === 'object' ? c : {};
    const cur = o.currency === 'USD' ? 'USD' : 'JPY';
    const amt = parseAmount(o.amount, cur);
    return {
      capOn: o.capOn === true && amt.ok,          // 金額が不正ならオフ（勝手に止めない/勝手に金額を作らない）
      amount: amt.ok ? amt.amount : 0,
      currency: cur,
      closingDay: normClosing(o.closingDay),
      warnPct: WARN_CHOICES.includes(o.warnPct) ? o.warnPct : DEFAULT_CFG.warnPct,
    };
  }

  function sanitizeCur(c) {
    if (!c || typeof c !== 'object' || !keyOk(c.start) || !keyOk(c.end) || c.start > c.end) return null;
    return { start: c.start, end: c.end, spendUSD: round6(num(c.spendUSD)), calls: Math.floor(num(c.calls)), unknown: Math.floor(num(c.unknown)),
      warned: c.warned === true, capNotified: c.capNotified === true, prompted: c.prompted === true, credit: Math.min(3, Math.floor(num(c.credit))) };
  }

  function sanitizeHist(h) {
    return (Array.isArray(h) ? h : []).filter(x => x && keyOk(x.end) && keyOk(x.start))
      .map(x => ({ start: x.start, end: x.end, spendUSD: round6(num(x.spendUSD)), calls: Math.floor(num(x.calls)) })).slice(0, HISTORY_MAX);
  }

  /** 保存された値（JSON文字列 or オブジェクト）→ 安全な状態。{state, status: 'ok'|'empty'|'corrupt'|'newer'} */
  function parseStored(raw) {
    if (raw == null) return { state: null, status: 'empty' };
    let o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { return { state: null, status: 'corrupt' }; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { state: null, status: 'corrupt' };
    const newer = Number.isInteger(o.v) && o.v > SCHEMA;       // 新しい版のデータは読むだけ（上書きしない）
    return { state: { v: SCHEMA, cfg: sanitizeCfg(o.cfg), cur: sanitizeCur(o.cur), history: sanitizeHist(o.history) }, status: newer ? 'newer' : 'ok' };
  }

  return { SCHEMA, JST_MS, DEFAULT_RATE, FALLBACK_PRICING, HISTORY_MAX, WARN_CHOICES, LIMITS, DEFAULT_CFG,
    jstParts, todayKey, addDays, dim, normClosing, closingDayIn, periodFor, isPast,
    toUSD, fromUSD, parseAmount, callCostUSD, statusOf, fmtMoney, sanitizeCfg, parseStored };
})();
if (typeof window !== 'undefined') window.WalkSpendCore = WalkSpendCore;
