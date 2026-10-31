// walk-spend.js v1.0
// このファイルは何をするか:
// お散歩モード中のAPI費用（チャット・Gemini読み上げなど、TokenMonitorが概算しているもの）を足し上げて
// localStorageに保存し、上限（80%で警告 / 上限で自動送信を止める）を判定する。
//  - 保存: 'cocomitalk-walk-spend-v1'（版つき。壊れていたら控えを残して作り直す。新しい版は上書きしない）
//  - 締め日: 日本時間。締め日を過ぎたら今期を履歴へ移して0から（前の期の合計は履歴で見られる）
//  - 上限に達したら: お散歩の自動送信だけ止める。「今回だけ続ける」は自動送信を1回だけ許可（その後また止まる）
// ★端末内の概算で、請求額の保証ではありません。確実な上限は各事業者の管理画面の月額上限です。
// ★含まない: STT(文字起こし)・OpenAI/VOICEVOXの読み上げ（料金表と記録が無い）・他の端末・アプリ外の利用
// v1.0 2026-10-28 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';

const WalkSpend = (() => {
  const C = WalkSpendCore;
  const KEY = 'cocomitalk-walk-spend-v1';
  const BACKUP_KEY = 'cocomitalk-walk-spend-v1-corrupt';
  let mem = null;               // 保存できない時の控え（メモリ内）
  let persistOk = true;         // 直近の保存が成功したか
  let readOnly = false;         // 新しい版のデータを見つけたら書かない
  let recovered = false;        // 壊れた保存を作り直した
  const listeners = [];

  const _ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
  const _now = n => (Number.isFinite(n) ? n : Date.now());
  const _rate = () => (typeof TokenMonitor !== 'undefined' && TokenMonitor.USD_TO_JPY) || C.DEFAULT_RATE;
  const _clone = s => JSON.parse(JSON.stringify(s));
  const _fresh = () => ({ v: C.SCHEMA, cfg: { ...C.DEFAULT_CFG }, cur: null, history: [] });
  const _emit = (type, extra) => { for (const f of listeners.slice()) { try { f({ type, ...extra }); } catch (e) { /* 通知側の失敗で止めない */ } } };

  /** 保存から読む（毎回読み直す＝別タブの加算も拾う）。壊れていたら控えを残して作り直す */
  function _read() {
    const ls = _ls();
    if (ls) {
      let raw = null;
      try { raw = ls.getItem(KEY); } catch (e) { raw = undefined; persistOk = false; }
      if (raw !== undefined) {
        const r = C.parseStored(raw);
        if (r.status === 'corrupt') {
          try { ls.setItem(BACKUP_KEY, String(raw).slice(0, 20000)); } catch (e) { /* 控え失敗は無視 */ }
          recovered = true;
          return _fresh();
        }
        readOnly = r.status === 'newer';
        if (r.state) return r.state;
        return mem ? _clone(mem) : _fresh();
      }
    }
    return mem ? _clone(mem) : _fresh();
  }

  function _write(s) {
    mem = _clone(s);
    const ls = _ls();
    if (!ls) { persistOk = false; return; }
    if (readOnly) return;                 // 新しい版のデータは上書きしない
    try { ls.setItem(KEY, JSON.stringify(s)); persistOk = true; } catch (e) { persistOk = false; }
  }

  /** 締め日が過ぎていたら今期を履歴へ移して新しい期を作る。無ければ作る */
  function _roll(s, ms) {
    const cur = s.cur;
    if (cur && !C.isPast(ms, cur.end)) return false;
    const p = C.periodFor(ms, s.cfg.closingDay);
    if (cur) {
      s.history.unshift({ start: cur.start, end: cur.end, spendUSD: cur.spendUSD, calls: cur.calls });
      s.history = s.history.slice(0, C.HISTORY_MAX);
      const after = C.addDays(cur.end, 1);
      if (p.start < after) p.start = after;           // 期が重ならないように
    }
    s.cur = { start: p.start, end: p.end, spendUSD: 0, calls: 0, unknown: 0, warned: false, capNotified: false, prompted: false, credit: 0 };
    return !!cur;
  }

  function _load(ms) {
    const s = _read();
    const rolled = _roll(s, ms);
    return { s, rolled };
  }

  function _view(s) {
    const st = C.statusOf(s.cfg, s.cur.spendUSD, _rate());
    return { cfg: { ...s.cfg }, cur: { ...s.cur }, prev: s.history[0] || null, history: s.history.slice(), status: st,
      rate: _rate(), persistOk, recovered, readOnly };
  }

  /** 今の状態（読むだけ。期が変わっていれば切り替えて保存する） */
  function getState(nowMs) {
    const { s, rolled } = _load(_now(nowMs));
    if (rolled) { _write(s); _emit('rollover', _view(s)); }
    return _view(s);
  }

  /** 設定を変える。{ok} か {ok:false, error}。上限額が不正なら変更しない。締め日の変更は次の期から */
  function setConfig(patch, nowMs) {
    const ms = _now(nowMs);
    const { s } = _load(ms);
    const next = { ...s.cfg, ...(patch || {}) };
    const a = C.parseAmount(next.amount, next.currency);
    if (next.capOn && !a.ok) return { ok: false, error: a.error };   // 不正な金額では上限をオンにしない
    if (a.ok) next.amount = a.amount;
    const closingChanged = C.normClosing(next.closingDay) !== s.cfg.closingDay;
    s.cfg = C.sanitizeCfg(next);
    // 締め日の変更は「次の期から」。ただし今期にまだ使っていなければ、すぐ新しい締め日で期を作り直す
    if (closingChanged && s.cur.spendUSD === 0 && s.cur.calls === 0) { s.cur = null; _roll(s, ms); }
    const st = C.statusOf(s.cfg, s.cur.spendUSD, _rate());
    if (st.state === 'ok' || st.state === 'off') { s.cur.warned = false; s.cur.capNotified = false; s.cur.prompted = false; }
    else if (st.state === 'warn') { s.cur.capNotified = false; s.cur.prompted = false; }
    _write(s);
    _emit('change', _view(s));
    return { ok: true };
  }

  const _walking = () => { try { return typeof ModeSwitcher !== 'undefined' && !!ModeSwitcher.isWalkMode(); } catch (e) { return false; } };
  function _pricing(model, ms) {
    try {
      if (typeof TokenMonitor !== 'undefined' && TokenMonitor.MODEL_PRICING && TokenMonitor.MODEL_PRICING[model]) return TokenMonitor.MODEL_PRICING[model];
      if (typeof ModelTiers !== 'undefined') return ModelTiers.getPricing(model, C.todayKey(ms));   // 日付つきの価格（例: 2027-01-01にGemini TTSが値上がり）
    } catch (e) { /* 料金が引けなければ高めの既定 */ }
    return null;
  }

  /** TokenMonitor.record から呼ばれる。お散歩中の分だけ足す。戻り値は足した概算USD（足さなければ0） */
  function record(model, inTok, outTok, nowMs) {
    try {
      if (!_walking()) return 0;
      const ms = _now(nowMs);
      const { s } = _load(ms);
      const c = C.callCostUSD(_pricing(model, ms), inTok, outTok);
      s.cur.spendUSD = Math.round((s.cur.spendUSD + c.usd) * 1e6) / 1e6;
      s.cur.calls += 1;
      if (!c.known) s.cur.unknown += 1;
      const st = C.statusOf(s.cfg, s.cur.spendUSD, _rate());
      let ev = null;
      if (st.state === 'capped' && !s.cur.capNotified) { s.cur.capNotified = true; s.cur.warned = true; s.cur.prompted = true; ev = 'capped'; }
      else if (st.state === 'warn' && !s.cur.warned) { s.cur.warned = true; ev = 'warn'; }
      _write(s);
      if (ev) _emit(ev, _view(s));
      _emit('change', _view(s));
      return c.usd;
    } catch (e) { return 0; }   // 記録の失敗でAPI呼び出しを壊さない
  }

  /**
   * お散歩の自動送信の前に呼ぶ。{allow, state, reason?}
   * 上限に達していたら止める（allow:false）。「今回だけ続ける」の許可が残っていれば1回だけ通す
   */
  function gate(nowMs) {
    const ms = _now(nowMs);
    const { s, rolled } = _load(ms);
    if (rolled) _write(s);
    const st = C.statusOf(s.cfg, s.cur.spendUSD, _rate());
    if (st.state !== 'capped') return { allow: true, state: st.state };
    if (s.cur.credit > 0) {
      s.cur.credit -= 1; s.cur.prompted = false; s.cur.capNotified = false;   // 使い切ったら次はまた止まって聞く
      _write(s); _emit('change', _view(s));
      return { allow: true, state: 'capped', usedOnce: true };
    }
    const first = !s.cur.prompted;
    if (first) { s.cur.prompted = true; _write(s); }
    _emit('blocked', { ..._view(s), first });
    return { allow: false, state: 'capped', reason: 'cap-reached', first };
  }

  /** 「今回だけ続ける」: 自動送信を1回だけ許可 */
  function grantOnce(nowMs) {
    const { s } = _load(_now(nowMs));
    s.cur.credit = 1; s.cur.prompted = false;
    _write(s); _emit('change', _view(s));
    return { ok: true };
  }

  /** 今期の記録を0に戻す（履歴は残す）。設定画面の確認つきボタンから */
  function resetCurrent(nowMs) {
    const { s } = _load(_now(nowMs));
    s.cur = { ...s.cur, spendUSD: 0, calls: 0, unknown: 0, warned: false, capNotified: false, prompted: false, credit: 0 };
    _write(s); _emit('change', _view(s));
    return { ok: true };
  }

  function on(f) { if (typeof f === 'function') listeners.push(f); }
  function off(f) { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
  function _reset() { mem = null; persistOk = true; readOnly = false; recovered = false; listeners.length = 0; }

  return { KEY, BACKUP_KEY, getState, setConfig, record, gate, grantOnce, resetCurrent, on, off, _reset };
})();
if (typeof window !== 'undefined') window.WalkSpend = WalkSpend;
