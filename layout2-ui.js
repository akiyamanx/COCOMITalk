// layout2-ui.js v1.4
// このファイルは何をするか:
// 画面レイアウトv2（チャット最優先）の画面づくり。次の部品を作って、既存のボタンを「移動」して使い回す（作り直さない）。
//  ・上の細い帯: ☰(左メニュー) / 真ん中=今のキャラ▾(切替) / ⋯(右メニュー=この会話) ・グループの参加者の帯(話している子が光る)
//  ・入力は1行: ＋(シート) / 文字 / 🎤か↑ ・カメラ映像の折りたたみ ・AF/エコの説明
// 既存のid・クラス・イベントは変えない（ボタンの実物を別の場所へ動かすだけ＝ app.js 等の処理はそのまま動く）。
// 戻し方: ☰「旧レイアウト(v1)に戻す」/ URLに ?layout=v1 / index.html の layout2-* の4行を消す。
// v1.0 2026-10-28 - 新規作成（follow-up #7）
// v1.1 2026-10-28 - グループの帯の札をタップ可能に（話しかけ先: 次の1通だけその子が先に答える。もう一度タップで解除。準備中は選べない）
// v1.2 2026-10-28 - 帯に準備中の子(葵・キミ)も淡く並べる（aria-disabled・「準備中」札・タップはtoastのみ）。札の列は横スクロール＋🔄つづきは右端に固定
// v1.3 2026-10-29 - 帯の☰の右に目が動く小さな顔(mascot-eyes.js)を取り付け（無ければ何もしない）
// v1.4 2026-10-29 - 顔は全画面に出すため帯への取り付けをやめ、app.jsからbody直下のfixed表示(MascotEyes.mountFixed)にした（名前ボタンは元の位置に戻る）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';

const Layout2Ui = (() => {
  const $ = (id) => document.getElementById(id);
  const PANELS = { drawer: 'lx2-drawer', chars: 'lx2-chars', more: 'lx2-more', sheet: 'lx2-sheet' };
  const OPENERS = { drawer: 'lx2-menu-btn', chars: 'lx2-char-btn', more: 'lx2-more-btn', sheet: 'lx2-plus' };
  let _open = null;
  let _speakerTimer = null;
  let _lastTag = null;
  let _phBase = null, _phSet = null;   // 入力欄の元の文言と、こちらが出した文言（解除時に他が書き換えていたら戻さない）

  function _el(tag, cls, text, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }
  function _toast(msg) { if (typeof LayoutUi !== 'undefined' && LayoutUi.toast) LayoutUi.toast(msg); }
  function _click(id) { const b = $(id); if (b) b.click(); }
  function _row(icon, label, onClick, id) {
    const b = _el('button', 'lx2-row', null, { type: 'button' });
    if (id) b.id = id;
    b.append(_el('span', 'lx2-row-icon', icon), _el('span', 'lx2-row-label', label));
    b.addEventListener('click', onClick);
    return b;
  }
  /** 実物のボタンを行として使う（移動のみ。中身・id・イベントはそのまま）。labelはCSSの::afterで出す */
  function _adopt(parent, id, label) {
    const b = $(id);
    if (!b) return null;
    b.dataset.lx2Label = label;
    b.classList.add('lx2-adopted');
    parent.appendChild(b);
    return b;
  }

  // ---------- 開閉（いつも1つだけ開く。スクリムか戻るボタンで閉じる） ----------
  function _hideAll() {
    Object.entries(PANELS).forEach(([k, id]) => {
      const p = $(id); if (p) p.classList.remove('lx2-on');
      const o = $(OPENERS[k]); if (o) o.setAttribute('aria-expanded', 'false');
    });
    const s = $('lx2-scrim'); if (s) s.classList.remove('lx2-on');
    const pl = $('lx2-plus'); if (pl) pl.classList.remove('lx2-x');
    _open = null;
  }
  function closeAll() {
    const wasDrawer = _open === 'drawer';
    _hideAll();
    if (wasDrawer && window.history.state && window.history.state.lx2) window.history.back();
  }
  function openPanel(name) {
    if (_open === name) { closeAll(); return; }
    _hideAll();
    const p = $(PANELS[name]); if (!p) return;
    p.classList.add('lx2-on');
    const o = $(OPENERS[name]); if (o) o.setAttribute('aria-expanded', 'true');
    const s = $('lx2-scrim'); if (s) s.classList.add('lx2-on');
    if (name === 'sheet') { const pl = $('lx2-plus'); if (pl) pl.classList.add('lx2-x'); }
    if (name === 'drawer') { try { window.history.pushState({ lx2: 1 }, ''); } catch (e) { /* なくても動く */ } }
    _open = name;
  }

  // ---------- 上の帯 ----------
  function _buildTopBar() {
    const h = document.querySelector('.app-header');
    if (!h) return;
    const menu = _el('button', 'lx2-hbtn', '☰', { id: 'lx2-menu-btn', type: 'button', 'aria-label': 'メニュー', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    const ch = _el('button', 'lx2-char', null, { id: 'lx2-char-btn', type: 'button', 'aria-label': '話す相手を選ぶ', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    ch.append(_el('span', 'lx2-char-icon'), _el('span', 'lx2-char-name'), _el('span', 'lx2-caret', '▾'));
    const more = _el('button', 'lx2-hbtn', '⋯', { id: 'lx2-more-btn', type: 'button', 'aria-label': 'この会話のメニュー', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    menu.addEventListener('click', () => openPanel('drawer'));
    ch.addEventListener('click', () => openPanel('chars'));
    more.addEventListener('click', () => openPanel('more'));
    h.prepend(menu, ch);
    h.appendChild(more);
  }
  function _updateChar() {
    const grp = document.querySelector('#btn-people')?.dataset.people === 'group';
    const app = $('app'); if (app) app.classList.toggle('lx2-group', grp);
    const a = document.querySelector('.tab.active');
    const icon = grp ? '👥' : (a?.querySelector('.tab-icon')?.textContent || '🌸');
    const name = grp ? 'みんな' : (a?.querySelector('.tab-name')?.textContent || 'ここちゃん');
    const i = document.querySelector('#lx2-char-btn .lx2-char-icon'); if (i) i.textContent = icon;
    const n = document.querySelector('#lx2-char-btn .lx2-char-name'); if (n) n.textContent = name;
    _fillChars();
  }

  // ---------- キャラのドロップダウン ----------
  function _fillChars() {
    const box = $('lx2-chars'); if (!box || typeof CharacterRegistry === 'undefined') return;
    const grp = document.querySelector('#btn-people')?.dataset.people === 'group';
    const cur = document.querySelector('.tab.active')?.dataset.sister;
    box.textContent = '';
    Layout2Core.charMenu(CharacterRegistry.list(), grp ? null : cur).forEach((r) => {
      const b = _el('button', 'lx2-char-row' + (r.soon ? ' lx2-soon' : '') + (r.current ? ' lx2-cur' : ''), null, { type: 'button', 'data-character': r.key });
      b.append(_el('span', 'lx2-char-row-icon', r.icon), _el('span', 'lx2-row-label', r.name));
      if (r.soon) {
        b.style.setProperty('--lx2-soon-dot', r.color.dot);
        b.style.setProperty('--lx2-soon-bg', r.color.bg);
        b.setAttribute('aria-disabled', 'true');
        b.append(_el('span', 'lx2-pill', r.note));
        b.addEventListener('click', () => { closeAll(); _toast(Layout2Core.soonMessage(r)); });
      } else {
        if (r.current) b.append(_el('span', 'lx2-check', '✓'));
        b.addEventListener('click', () => _pickChar(r.key));
      }
      box.appendChild(b);
    });
    const g = _row(grp ? '👤' : '👥', grp ? '1対1に戻る' : 'みんなで話す', () => { closeAll(); _click('btn-people'); });
    g.classList.add('lx2-char-row', 'lx2-char-group');
    box.appendChild(g);
  }
  function _pickChar(key) {
    closeAll();
    if ($('btn-people')?.dataset.people === 'group') _click('btn-people'); // 1対1に戻してから切替
    const tab = document.querySelector(`.tab[data-sister="${key}"]`);
    if (tab && !tab.classList.contains('active')) tab.click();
    _updateChar();
  }

  // ---------- 左ドロワー（アプリ全体） ----------
  function _goMeeting() {
    closeAll();
    const n = Layout2Core.modeClicks($('btn-mode')?.dataset.mode, 'meeting');
    for (let i = 0; i < n; i++) _click('btn-mode');
  }
  function _walkEntry() {
    closeAll();
    const panel = $('vision-panel');
    if (panel && panel.classList.contains('hidden')) _click('btn-vision-toggle');
    _toast('📷 カメラを出すよ。🚶 を押すとお散歩スタート');
    const w = $('btn-vision-walk'); if (w) { w.classList.add('lx2-hint'); setTimeout(() => w.classList.remove('lx2-hint'), 4000); }
  }
  function _openSection(id) {
    closeAll();
    _click('btn-settings');
    const sec = $(id); if (!sec) return;
    const t = sec.querySelector(':scope > .lx-title');
    if (t && !sec.classList.contains('lx-open')) t.click();
    setTimeout(() => sec.scrollIntoView({ block: 'start' }), 50);
  }
  function _buildDrawer() {
    const d = _el('aside', 'lx2-drawer', null, { id: 'lx2-drawer', role: 'dialog', 'aria-label': 'メニュー' });
    const head = _el('div', 'lx2-drawer-head');
    head.append(_el('span', 'lx2-drawer-title', '🎙️ COCOMITalk'));
    const x = _el('button', 'lx2-hbtn', '✕', { type: 'button', 'aria-label': '閉じる' });
    x.addEventListener('click', closeAll);
    head.appendChild(x);
    const body = _el('div', 'lx2-drawer-body');
    body.append(_el('div', 'lx2-sec-title', 'アプリ'));
    body.append(_row('🏛️', '会議室を開く', _goMeeting), _row('🚶', 'お散歩モード（カメラを出す）', _walkEntry));
    body.append(_row('🔍', 'ウェブ検索', () => { closeAll(); _click('btn-search'); }));
    body.append(_row('🧠', '記憶管理', () => { closeAll(); _click('btn-open-memory-ui'); }));
    body.append(_row('📁', '記憶インポート', () => { closeAll(); _click('btn-open-memory-import'); }));
    // 入れ子: 設定（既存の折りたたみカードへ直行）
    const tg = _row('⚙️', '設定', () => {
      const on = nest.classList.toggle('lx2-nest-on');
      tg.setAttribute('aria-expanded', String(on));
    }, 'lx2-settings-toggle');
    tg.setAttribute('aria-expanded', 'false');
    tg.append(_el('span', 'lx2-caret', '▾'));
    const nest = _el('div', 'lx2-nest');
    ['sec-auth', 'sec-models', 'sec-voice', 'sec-memory', 'sec-history', 'sec-walk', 'sec-tokens'].forEach((id) => {
      const sec = $(id); if (!sec) return;
      const h = sec.querySelector('h3');
      const label = (h ? h.textContent : id).trim();
      const r = _row('', label, () => _openSection(id));
      r.classList.add('lx2-nest-row');
      nest.appendChild(r);
    });
    body.append(tg, nest);
    const st = _adopt(body, 'btn-settings', '設定をすべて開く');
    if (st) st.classList.add('lx2-row');
    body.append(_el('div', 'lx2-sec-title', '表示'));
    body.append(_row('🔁', '旧レイアウト(v1)に戻す', () => {
      try { window.localStorage.setItem(Layout2Core.STORE_KEY, 'v1'); } catch (e) { /* 戻せない時はURLの ?layout=v1 */ }
      window.location.reload();
    }));
    d.append(head, body);
    document.body.appendChild(d);
  }

  // ---------- 右メニュー（この会話） ----------
  function _buildMore() {
    const m = _el('div', 'lx2-more', null, { id: 'lx2-more', role: 'dialog', 'aria-label': 'この会話のメニュー' });
    const st = _el('div', 'lx2-status');
    m.appendChild(st);
    const ind = $('model-indicator'); if (ind) st.appendChild(ind);
    const tc = $('token-cost'); if (tc) st.appendChild(tc);
    _adopt(m, 'btn-style', '会話のスタイル');
    _adopt(m, 'btn-mode', 'モード');
    _adopt(m, 'btn-people', '1対1 ⇄ みんな');
    _adopt(m, 'btn-generate-doc', '指示書を作る');
    _adopt(m, 'btn-download', '会話を保存');
    m.addEventListener('click', (e) => { if (e.target.closest('.lx2-adopted') && e.target.closest('#btn-mode, #btn-generate-doc, #btn-download')) closeAll(); });
    document.body.appendChild(m);
  }

  // ---------- ＋シートと入力の1行 ----------
  function _buildInput() {
    const w = document.querySelector('.input-area .input-wrapper');
    const area = document.querySelector('.input-area');
    if (!w || !area) return;
    const plus = _el('button', 'lx2-plus', '＋', { id: 'lx2-plus', type: 'button', 'aria-label': 'カメラ・ファイル・検索など', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    plus.addEventListener('click', () => openPanel('sheet'));
    w.prepend(plus);
    const sheet = _el('div', 'lx2-sheet', null, { id: 'lx2-sheet', role: 'dialog', 'aria-label': 'ツール' });
    _adopt(sheet, 'btn-vision-toggle', 'カメラ');
    _adopt(sheet, 'btn-attach', 'ファイル');
    _adopt(sheet, 'btn-search', '検索');
    _adopt(sheet, 'btn-continue-talk', 'みんなで話す');
    sheet.addEventListener('click', (e) => { if (e.target.closest('.lx2-adopted')) closeAll(); });
    area.prepend(sheet);
    const input = $('msg-input'), send = $('btn-send');
    const sync = () => w.classList.toggle('lx2-can-send', Layout2Core.showSend(input?.value, send ? send.disabled : true));
    if (input) input.addEventListener('input', sync);
    if (send) new MutationObserver(sync).observe(send, { attributes: true, attributeFilter: ['disabled'] });
    sync();
  }

  // ---------- グループの帯（話している子が光る／タップで話しかけ先を選ぶ） ----------
  function _buildStrip() {
    if (typeof CharacterRegistry === 'undefined') return;
    const s = _el('div', 'lx2-strip', null, { id: 'lx2-strip', role: 'group', 'aria-label': 'いっしょに話している子（タップでその子に話しかける）' });
    const go = _el('button', 'lx2-chip-act', '🔄 つづき', { type: 'button', 'aria-label': 'みんなで話して', title: '姉妹たちだけで会話を続ける' });
    go.addEventListener('click', () => _click('btn-continue-talk'));
    s.append(_el('div', 'lx2-strip-scroll'), go);   // 札は横スクロールの列に入れ、🔄つづきは列の外(右端に固定)
    const h = document.querySelector('.app-header');
    if (h) h.after(s);
    refreshStrip(s);
    document.addEventListener('cocomi:group-target', (e) => _showTarget(e.detail && e.detail.target));
  }
  /** 札を登録簿から作り直す（使える子→準備中の子の順）。準備中の札はaria-disabled（disabled属性にしない＝タップでtoast・Tabでも止まる） */
  function refreshStrip(strip) {
    const s = strip || $('lx2-strip'); if (!s || typeof CharacterRegistry === 'undefined') return;
    const col = s.querySelector('.lx2-strip-scroll') || s;   // 札の列だけ作り直す（🔄つづきは列の外なので触らない）
    const chips = Layout2Core.stripChips(CharacterRegistry.list()).map((c) => {
      const attrs = { type: 'button', 'data-sister': c.key, 'aria-label': c.label };
      if (!c.soon) attrs['aria-pressed'] = 'false';
      const chip = _el('button', 'lx2-chip' + (c.soon ? ' lx2-chip-soon' : ''), null, attrs);
      chip.append(_el('span', 'lx2-chip-icon', c.icon), _el('span', 'lx2-chip-name', c.name));
      if (c.soon) {
        chip.style.setProperty('--lx2-soon-dot', c.color.dot);
        chip.style.setProperty('--lx2-soon-bg', c.color.bg);
        chip.setAttribute('aria-disabled', 'true');
        chip.append(_el('span', 'lx2-pill', c.note));
      }
      chip.addEventListener('click', () => pickTarget(c.key));
      return chip;
    });
    col.replaceChildren(...chips);
    _showTarget(typeof ChatGroup !== 'undefined' && ChatGroup.getTarget ? ChatGroup.getTarget() : null);
  }
  /** 札をタップ: 切替（同じ子=解除）。準備中の子は選べずtoast。実際の保持はChatGroup（次の1通で自動解除） */
  function pickTarget(key) {
    if (typeof CharacterRegistry === 'undefined' || typeof ChatGroup === 'undefined' || !ChatGroup.setTarget) return;
    const r = Layout2Core.toggleTarget(ChatGroup.getTarget(), key, CharacterRegistry.list());
    if (r.rejected === 'soon') { _toast(Layout2Core.soonMessage(r.row)); return; }
    if (r.rejected) return;
    ChatGroup.setTarget(r.target);
  }
  /** 選択中の見た目（aria-pressed＋入力欄のヒント）。話している子の光(lx2-speaking)とは別の状態 */
  function _showTarget(key) {
    document.querySelectorAll('#lx2-strip .lx2-chip:not(.lx2-chip-soon)').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.sister === key)));
    const inp = $('msg-input'); if (!inp) return;
    const hint = typeof CharacterRegistry !== 'undefined' ? Layout2Core.targetHint(key, CharacterRegistry.list()) : null;
    if (hint) {
      if (_phSet === null) _phBase = inp.placeholder;
      inp.placeholder = _phSet = hint;
    } else if (_phSet !== null) {
      if (inp.placeholder === _phSet) inp.placeholder = _phBase;
      _phBase = _phSet = null;
    }
  }
  function _setSpeaker(key) {
    document.querySelectorAll('#lx2-strip .lx2-chip').forEach((c) => c.classList.toggle('lx2-speaking', c.dataset.sister === key));
  }
  function refreshSpeaker() {
    if (typeof CharacterRegistry === 'undefined') return;
    const list = CharacterRegistry.list();
    clearTimeout(_speakerTimer);
    const typing = $('typing-msg');
    if (typing) { _setSpeaker(Layout2Core.speakerFromText(typing.querySelector('.typing-name')?.textContent, list)); return; }
    const tags = document.querySelectorAll('#chat-area .msg-sister-name');
    const last = tags[tags.length - 1];
    if (!last) { _lastTag = null; _setSpeaker(null); return; }
    if (last !== _lastTag) {
      _lastTag = last;
      _setSpeaker(Layout2Core.speakerFromText(last.textContent, list));
      _speakerTimer = setTimeout(() => _setSpeaker(null), 3500);
    }
  }

  // ---------- カメラ（映像の折りたたみ・AF/エコの説明） ----------
  function _setupVision() {
    const ctr = document.querySelector('.vision-controls');
    const panel = $('vision-panel');
    if (ctr && panel) {
      const t = _el('button', 'vision-btn lx2-prev-toggle', null, { id: 'lx2-preview-toggle', type: 'button', 'aria-label': '映像を隠す/見る', 'aria-pressed': 'true', title: '映像を隠す/見る' });
      t.addEventListener('click', () => {
        const off = panel.classList.toggle('lx2-preview-off');
        t.setAttribute('aria-pressed', String(!off));
      });
      ctr.appendChild(t);
    }
    const af = $('vision-focus-indicator'), rs = $('btn-vision-resolution');
    if (af) {
      af.setAttribute('role', 'button'); af.tabIndex = 0; af.title = Layout2Core.HELP.af;
      af.addEventListener('click', () => _toast(`${Layout2Core.HELP.af}\n${Layout2Core.HELP.res}`));
    }
    if (rs) rs.title = Layout2Core.HELP.res;
  }

  function init() {
    if (document.documentElement.classList.contains('lx2-ready')) return;
    document.documentElement.classList.add('lx2-ready');
    _buildTopBar(); _buildDrawer(); _buildMore(); _buildInput(); _buildStrip(); _setupVision();
    const scrim = _el('div', 'lx2-scrim', null, { id: 'lx2-scrim' });
    scrim.addEventListener('click', closeAll);
    document.body.appendChild(scrim);
    const chars = _el('div', 'lx2-chars', null, { id: 'lx2-chars', role: 'menu', 'aria-label': '話す相手' });
    document.body.appendChild(chars);
    _updateChar();
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setTimeout(_updateChar, 0)));
    const ppl = $('btn-people'); if (ppl) new MutationObserver(_updateChar).observe(ppl, { attributes: true });
    const chat = $('chat-area'); if (chat) new MutationObserver(refreshSpeaker).observe(chat, { childList: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _open) closeAll(); });
    window.addEventListener('popstate', () => { if (_open === 'drawer') _hideAll(); });
  }

  function boot() {
    const stored = (() => { try { return window.localStorage.getItem(Layout2Core.STORE_KEY); } catch (e) { return null; } })();
    if (Layout2Core.pickLayout(window.location.search, stored) !== 'v2') return;
    document.documentElement.classList.add('lx2');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.localStorage !== undefined) boot();

  return { init, closeAll, openPanel, refreshSpeaker, pickTarget, refreshStrip };
})();
if (typeof window !== 'undefined') window.Layout2Ui = Layout2Ui;
