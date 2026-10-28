// layout-ui.js v1.0
// このファイルは何をするか:
// 画面レイアウト改善（follow-up #6）の小さな部品。見た目は layout-main.css / layout-panels.css が担当し、ここは次の2つだけ。
//  1) 設定画面の見出しを「開く/閉じる」にする（長すぎる設定画面を、見出しの一覧にして短くする）。開閉は端末に覚える。
//  2) キャラ選択に、準備中の葵ちゃん🦋・きみちゃんを押せない形で並べる（5人そろった見た目。押すと「準備中だよ」と一言出す）。
// 既存のid・クラス・動作は変えない。このファイルを外す（index.htmlのscript行を消す）と、設定は全部開いた元の状態に戻る。
// v1.0 2026-10-28 - 新規作成
// v1.1 2026-10-28 - 準備中の一言(toast)をv2からも使えるよう公開（follow-up #7）
// v1.2 2026-10-29 - 表示名を「きみちゃん」（ひらがな）に統一（コメントのみ。表示は登録簿から）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';

const LayoutUi = (() => {
  const STORE_KEY = 'cocomitalk_layout_open';
  /** 初めて開いたときの状態。認証だけ開く（最初に必要なのでトークン入力が迷子にならない） */
  const DEFAULT_OPEN = { 'sec-auth': true };
  const SOON_ICON = '✨'; // アイコン未決定（きみちゃん）の仮置き

  // ---------- 純粋関数（テスト対象） ----------
  /** 保存文字列 → 開閉状態。壊れていたら空 */
  function parseState(raw) {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }
  function isOpen(state, key) { return Object.prototype.hasOwnProperty.call(state, key) ? !!state[key] : !!DEFAULT_OPEN[key]; }
  function toggled(state, key) { return { ...state, [key]: !isOpen(state, key) }; }
  /** 準備中キャラ → 並べる札の情報（アイコン未決定は ✨） */
  function soonTabs(list) {
    return (list || []).filter(c => c && !c.enabled).map(c => ({
      key: c.key, icon: c.icon || SOON_ICON, name: c.name, note: c.statusNote || '準備中',
    }));
  }
  /** 札を押したときの一言 */
  function soonMessage(t) { return `${t.icon} ${t.name}は準備中だよ。もうすぐ会えるよ`; }

  // ---------- 開閉の保存 ----------
  function _load() { try { return parseState(window.localStorage.getItem(STORE_KEY)); } catch (e) { return {}; } }
  function _save(state) { try { window.localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても動く */ } }

  /** el の見出し titleEl を押すと開閉するようにする（二重適用しない） */
  function makeCollapsible(el, titleEl, key) {
    if (!el || !titleEl || el.dataset.lx === '1') return;
    el.dataset.lx = '1';
    el.classList.add('lx-collapsible');
    titleEl.classList.add('lx-title');
    titleEl.setAttribute('role', 'button');
    titleEl.setAttribute('tabindex', '0');
    const apply = () => {
      const open = isOpen(_load(), key);
      el.classList.toggle('lx-open', open);
      titleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const flip = () => { _save(toggled(_load(), key)); apply(); };
    titleEl.addEventListener('click', flip);
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    });
    apply();
  }

  function _setupSettings() {
    document.querySelectorAll('#settings-modal .settings-section').forEach((sec, i) => {
      makeCollapsible(sec, sec.querySelector(':scope > h3'), sec.id || `sec-${i}`);
    });
    // モデル設定の中身（普段/開発/会議/お散歩/準備中/思考の強さ）は設定を開くたびに作り直されるので、作られたら畳む
    const area = document.getElementById('model-settings-area');
    if (!area) return;
    const wire = () => area.querySelectorAll('.model-mode-block').forEach(b =>
      makeCollapsible(b, b.querySelector(':scope > .model-mode-title'), `mode-${b.dataset.mode || 'x'}`));
    wire();
    if (typeof MutationObserver !== 'undefined') new MutationObserver(wire).observe(area, { childList: true });
  }

  // ---------- 準備中のキャラ札 ----------
  let _toastTimer = null;
  function _toast(text) {
    let t = document.getElementById('lx-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'lx-toast'; t.className = 'lx-toast'; t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('lx-toast-on');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('lx-toast-on'), 2400);
  }

  function _setupSoonTabs() {
    const nav = document.querySelector('.sister-tabs');
    if (!nav || typeof CharacterRegistry === 'undefined' || nav.querySelector('.tab-soon')) return;
    soonTabs(CharacterRegistry.list()).forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab-soon';
      b.dataset.character = t.key; // data-sister は付けない（既存のタブ処理・音声処理に拾われないため）
      b.setAttribute('aria-disabled', 'true');
      b.title = `${t.name}: ${t.note}`;
      b.innerHTML = '<span class="tab-icon"></span><span class="tab-name"></span>';
      b.firstChild.textContent = t.icon;
      b.lastChild.textContent = t.name;
      b.addEventListener('click', () => _toast(soonMessage(t)));
      nav.appendChild(b);
    });
  }

  function init() { _setupSoonTabs(); _setupSettings(); }

  if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { STORE_KEY, DEFAULT_OPEN, parseState, isOpen, toggled, soonTabs, soonMessage, makeCollapsible, init, toast: _toast };
})();
if (typeof window !== 'undefined') window.LayoutUi = LayoutUi;
