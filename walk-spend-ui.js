// walk-spend-ui.js v1.0
// このファイルは何をするか:
// お散歩モードの費用上限の画面まわり。
//  - 設定画面「🚶 お散歩の費用上限」（上限の入/切・金額・円/ドル・締め日・警告ライン・今期と前期の表示）
//  - 画面のバッジ（お散歩中だけ。上限到達時はタップでダイアログ）
//  - 警告トースト（上限の約80%）と、上限到達ダイアログ（上限を上げる / 今回だけ続ける / このまま止めておく）
// 計算と保存は walk-spend.js / walk-spend-core.js。ここはDOMだけ。
// v1.0 2026-10-28 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';

const WalkSpendUI = (() => {
  const C = WalkSpendCore;
  const AREA_ID = 'walk-spend-area', BADGE_ID = 'walk-spend-badge', DIALOG_ID = 'walk-spend-dialog';
  const BTN = 'padding:8px 12px;border-radius:8px;border:1px solid #888;background:#fff;color:#222;cursor:pointer;margin:4px 4px 0 0;';
  let _inited = false;

  const $ = id => document.getElementById(id);
  const money = (usd, cur, rate) => C.fmtMoney(usd, cur, rate);
  const WARN_TEXT = '※ この金額は端末内の「概算」で、請求額の保証ではありません。確実な上限は、各事業者（OpenAI / Anthropic / Google など）の管理画面にある月額上限で必ず設定してください。';

  /** 設定欄の説明文（何を数えて何を数えないか） */
  const HELP_HTML = `<p class="setting-hint">お散歩モード中に使った分（チャットの返答・Gemini読み上げ。TokenMonitorが概算しているもの）を足して、警告ライン（既定80%）で知らせ、上限で<b>お散歩の自動送信を止めます</b>。`
    + `${WARN_TEXT}</p><p class="setting-hint">数えないもの: 音声認識(STT)・OpenAI/VOICEVOXの読み上げ（料金表と記録が無いため）、他の端末やアプリ外の利用。`
    + `締め日は日本時間。29〜31日は、その日が無い月は月末日になります。締め日を変えても今の期の分は消えず、次の期から変わります（まだ使っていなければすぐ変わります）。</p>`;

  function _opts(list, sel) { return list.map(([v, t]) => `<option value="${v}"${String(v) === String(sel) ? ' selected' : ''}>${t}</option>`).join(''); }
  const _closingList = () => [['eom', '月末（末日）']].concat(Array.from({ length: 31 }, (_, i) => [i + 1, `${i + 1}日`]));

  function _statusHtml(v) {
    const cur = v.cfg.currency, r = v.rate, s = v.status;
    const per = `${v.cur.start} 〜 ${v.cur.end}`;
    let h = `<p class="setting-hint">今の期（${per}・日本時間）: <b>${money(v.cur.spendUSD, cur, r)}</b>`;
    if (s.state !== 'off') h += ` / 上限 ${money(s.capUSD, cur, r)}（${Math.floor(s.pct)}%）`;
    h += `　呼び出し${v.cur.calls}回`;
    if (v.cur.unknown) h += `（料金未登録のモデル${v.cur.unknown}回は高めの単価で概算）`;
    h += '（概算）</p>';
    if (v.prev) h += `<p class="setting-hint">前の期（${v.prev.start} 〜 ${v.prev.end}）: <b>${money(v.prev.spendUSD, cur, r)}</b>（${v.prev.calls}回・概算）</p>`;
    if (v.history.length > 1) {
      h += `<details><summary class="setting-hint">過去の期</summary>` + v.history.slice(1).map(x =>
        `<p class="setting-hint">${x.start} 〜 ${x.end}: ${money(x.spendUSD, cur, r)}</p>`).join('') + `</details>`;
    }
    if (!v.persistOk) h += `<p class="setting-hint" style="color:#c0392b;">⚠️ この端末に保存できませんでした（アプリを閉じると記録が消えます）</p>`;
    if (v.readOnly) h += `<p class="setting-hint" style="color:#c0392b;">⚠️ 新しい版のデータなので、この版では保存しません</p>`;
    if (v.recovered) h += `<p class="setting-hint" style="color:#c0392b;">⚠️ 保存データが壊れていたため作り直しました（元の文字列は控えてあります）</p>`;
    return h;
  }

  function render() {
    const area = $(AREA_ID);
    if (!area || typeof WalkSpend === 'undefined') return;
    const v = WalkSpend.getState(), c = v.cfg;
    area.innerHTML = `<label class="setting-toggle"><input type="checkbox" id="ws-cap-on"${c.capOn ? ' checked' : ''}> 上限を使う（オフの間は止まりません）</label>`
      + `<div class="setting-item"><label for="ws-amount">上限（1つの期あたり）</label>`
      + `<input type="number" id="ws-amount" min="0" step="${c.currency === 'USD' ? '0.01' : '1'}" inputmode="decimal" placeholder="金額を入れてください" value="${c.amount || ''}" style="width:9em;">`
      + ` <select id="ws-currency" aria-label="通貨">${_opts([['JPY', '円'], ['USD', 'ドル']], c.currency)}</select></div>`
      + `<div class="setting-item"><label for="ws-closing">締め日（日本時間）</label><select id="ws-closing">${_opts(_closingList(), c.closingDay)}</select></div>`
      + `<div class="setting-item"><label for="ws-warn">警告を出すライン</label><select id="ws-warn">${_opts(C.WARN_CHOICES.map(n => [n, `${n}%`]), c.warnPct)}</select></div>`
      + `<p id="ws-err" class="setting-hint" style="color:#c0392b;" role="alert"></p>` + _statusHtml(v)
      + `<button type="button" id="ws-reset" class="btn-danger" style="margin-top:8px;">今の期の記録を0に戻す</button>` + HELP_HTML;
  }

  function _onChange() {
    const patch = { capOn: $('ws-cap-on').checked, amount: $('ws-amount').value, currency: $('ws-currency').value,
      closingDay: $('ws-closing').value, warnPct: Number($('ws-warn').value) };
    const r = WalkSpend.setConfig(patch);
    if (!r.ok) { render(); const e = $('ws-err'); if (e) e.textContent = r.error; return; }
    render(); refreshBadge();
  }

  function _bindArea() {
    const area = $(AREA_ID);
    if (!area || area.dataset.bound) return;
    area.dataset.bound = '1';
    area.addEventListener('change', e => { if (/^ws-(cap-on|amount|currency|closing|warn)$/.test(e.target.id)) _onChange(); });
    area.addEventListener('click', e => {
      if (e.target.id !== 'ws-reset') return;
      if (window.confirm('今の期の費用記録を0に戻します。履歴は残ります。よろしいですか？')) { WalkSpend.resetCurrent(); render(); refreshBadge(); }
    });
  }

  // ---- バッジ ----
  function refreshBadge() {
    const b = $(BADGE_ID);
    if (!b || typeof WalkSpend === 'undefined') return;
    const walking = typeof ModeSwitcher !== 'undefined' && ModeSwitcher.isWalkMode();
    const v = WalkSpend.getState(), s = v.status;
    if (!walking || s.state === 'off') { b.classList.add('hidden'); return; }
    const cur = v.cfg.currency, r = v.rate;
    const txt = s.state === 'capped' ? '⏸ 上限に達したため停止中（タップ）' : `${s.state === 'warn' ? '⚠️' : '💰'} ${money(v.cur.spendUSD, cur, r)} / ${money(s.capUSD, cur, r)}`;
    b.textContent = txt;
    b.style.cssText = `margin-left:6px;font-size:12px;padding:2px 6px;border-radius:8px;cursor:pointer;color:#fff;background:${s.state === 'capped' ? '#c0392b' : s.state === 'warn' ? '#d68910' : '#566573'};`;
    b.classList.remove('hidden');
  }

  function _toast(msg) {
    const t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);max-width:90%;background:#333;color:#fff;padding:10px 14px;border-radius:10px;z-index:10000;font-size:14px;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }

  // ---- 上限到達ダイアログ ----
  function closeDialog() { const d = $(DIALOG_ID); if (d) d.remove(); }

  function showCapDialog() {
    if ($(DIALOG_ID) || typeof WalkSpend === 'undefined') return;
    const v = WalkSpend.getState(), cur = v.cfg.currency, r = v.rate;
    const d = document.createElement('div');
    d.id = DIALOG_ID; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'ws-dlg-title');
    d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';
    d.innerHTML = `<div style="background:#fff;color:#222;border-radius:12px;padding:16px;max-width:420px;width:100%;max-height:90vh;overflow:auto;">`
      + `<h3 id="ws-dlg-title" style="margin:0 0 8px;">🚶 お散歩の費用が上限に達しました</h3>`
      + `<p>今の期の概算 <b>${money(v.cur.spendUSD, cur, r)}</b> / 上限 <b>${money(v.status.capUSD, cur, r)}</b>。お散歩の自動送信を止めています（お散歩モード自体は続いています）。</p>`
      + `<div style="margin:8px 0;"><label for="ws-new-cap">新しい上限（${cur === 'USD' ? 'ドル' : '円'}）</label> `
      + `<input type="number" id="ws-new-cap" min="0" step="${cur === 'USD' ? '0.01' : '1'}" inputmode="decimal" style="width:8em;" placeholder="金額を入れる"> `
      + `<button type="button" id="ws-dlg-raise" style="${BTN}">上限を上げて続ける</button></div>`
      + `<p id="ws-dlg-err" style="color:#c0392b;margin:4px 0;" role="alert"></p>`
      + `<button type="button" id="ws-dlg-once" style="${BTN}">今回だけ続ける（自動送信を1回だけ）</button>`
      + `<button type="button" id="ws-dlg-stop" style="${BTN}">このまま止めておく</button>`
      + `<p style="font-size:12px;color:#555;margin-top:10px;">${WARN_TEXT}</p></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => {
      const id = e.target.id;
      if (id === 'ws-dlg-stop' || e.target === d) { closeDialog(); }
      else if (id === 'ws-dlg-once') { WalkSpend.grantOnce(); closeDialog(); refreshBadge(); _toast('次の自動送信を1回だけ行います。そのあとまた止まります'); }
      else if (id === 'ws-dlg-raise') {
        const a = C.parseAmount($('ws-new-cap').value, cur);
        const msg = $('ws-dlg-err');
        if (!a.ok) { msg.textContent = a.error; return; }
        if (C.toUSD(a.amount, cur, r) <= v.cur.spendUSD) { msg.textContent = '今の概算より大きい金額にしてください'; return; }
        WalkSpend.setConfig({ amount: a.amount }); closeDialog(); render(); refreshBadge(); _toast('上限を上げました。お散歩を続けます');
      }
    });
    const f = $('ws-new-cap'); if (f) f.focus();
  }

  function _onEvent(ev) {
    if (ev.type === 'warn') _toast(`⚠️ お散歩の費用が上限の約${ev.cfg.warnPct}%に達しました（${money(ev.cur.spendUSD, ev.cfg.currency, ev.rate)} / ${money(ev.status.capUSD, ev.cfg.currency, ev.rate)}・概算）`);
    if (ev.type === 'capped' || (ev.type === 'blocked' && ev.first)) showCapDialog();
    refreshBadge();
    const area = $(AREA_ID);
    if (area && !area.contains(document.activeElement)) render();   // 入力中は書き換えない
  }

  function init() {
    if (_inited || typeof WalkSpend === 'undefined') return;
    _inited = true;
    _bindArea(); render(); refreshBadge();
    WalkSpend.on(_onEvent);
    const b = $(BADGE_ID);
    if (b) b.addEventListener('click', () => { if (WalkSpend.getState().status.state === 'capped') showCapDialog(); });
    const open = $('btn-settings');
    if (open) open.addEventListener('click', () => setTimeout(render, 0));   // 設定を開くたびに最新へ
    setInterval(refreshBadge, 3000);                                          // お散歩のON/OFFに合わせて表示
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }
  return { init, render, refreshBadge, showCapDialog, closeDialog };
})();
if (typeof window !== 'undefined') window.WalkSpendUI = WalkSpendUI;
