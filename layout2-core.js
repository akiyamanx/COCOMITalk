// layout2-core.js v1.2
// このファイルは何をするか:
// 画面レイアウトv2（チャット最優先）の「判断」だけを集めた純粋関数。画面(DOM)は触らない＝テストしやすい。
//  ・v1/v2のどちらで表示するか ・キャラのドロップダウンの中身 ・話している子の見分け方
//  ・🎤/↑のどちらを出すか ・会議へ行くのにモードボタンを何回押すか ・AF/エコの説明文
//  ・グループで「この子に話しかける」(帯の札をタップ): 選択の切替・準備中は選べない・発言順を先頭に寄せる
// 画面を作るのは layout2-ui.js。このファイルを外す時は layout2-ui.js も一緒に外す（index.htmlのscript行を消す）。
// v1.0 2026-10-28 - 新規作成（follow-up #7）
// v1.1 2026-10-28 - グループの話しかけ先: toggleTarget / applyTarget / targetHint を追加（札タップ=次の1通だけその子が先に答える）
// v1.2 2026-10-28 - 帯に準備中の子も出す: stripChips / soonAria を追加（使える子が先・準備中は後ろで淡く。選べない・発言順には入らない）
// v1.3 2026-10-29 - 表示名を「きみちゃん」（ひらがな）に統一（コメントのみ。表示は登録簿から）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';

const Layout2Core = (() => {
  const STORE_KEY = 'cocomitalk_layout';           // 'v1' を入れると旧レイアウト（v2が既定）
  const SOON_ICON = '✨';                           // アイコン未決定（きみちゃん）の仮置き
  const MODES = ['normal', 'dev', 'meeting'];       // mode-switcher.js の循環順と同じ
  /** 準備中の2人の色（葵=青い蝶 / キミ=金の星）。点の色=dot、札の薄い地=bg。文字は常に濃い茶(#3A322C)で読める */
  const SOON_COLORS = {
    aoi: { dot: '#3BA7D9', bg: '#E3F2FB' },
    kimi: { dot: '#E0A21B', bg: '#FFF4D6' },
  };
  const NEUTRAL = { dot: '#8B7E74', bg: '#F1EEEA' };

  /** どのレイアウトで出すか。URL(?layout=v1|v2)が最優先 → 保存値 → 既定v2 */
  function pickLayout(search, stored) {
    const m = /[?&]layout=(v1|v2)\b/.exec(search || '');
    if (m) return m[1];
    return stored === 'v1' ? 'v1' : 'v2';
  }

  function soonColor(key) { return SOON_COLORS[key] || NEUTRAL; }

  /** キャラ登録簿 → ドロップダウンの行。使える子が先、準備中の子はあと（色つき）。 */
  function charMenu(list, currentKey) {
    const rows = (list || []).filter(Boolean).map(c => ({
      key: c.key, name: c.name, icon: c.icon || SOON_ICON, soon: !c.enabled,
      note: c.enabled ? '' : '準備中', current: !!c.enabled && c.key === currentKey,
      color: c.enabled ? null : soonColor(c.key),
    }));
    return [...rows.filter(r => !r.soon), ...rows.filter(r => r.soon)];
  }

  /** グループの参加者（使える子だけ） */
  function groupChips(list) {
    return (list || []).filter(c => c && c.enabled).map(c => ({ key: c.key, name: c.name, icon: c.icon || SOON_ICON }));
  }

  /**
   * グループの帯の札（使える子→準備中の子の順）。準備中の子も並べるが soon:true（選べない・色と「準備中」札つき）。
   * レジストリで enabled:true になれば soon:false の普通の札になる＝characters.js を直すだけ。発言順(chat-group)はこれを使わない。
   */
  function stripChips(list) {
    return charMenu(list, null).map(r => ({
      key: r.key, name: r.name, icon: r.icon, soon: r.soon, note: r.note, color: r.color,
      label: r.soon ? soonAria(r.name) : `${r.name}に話しかける`,
    }));
  }

  /** 準備中の札の読み上げ名（aria-label）: 「葵ちゃんは準備中です」 */
  function soonAria(name) { return `${name}は準備中です`; }

  /** 準備中の札を押した時の一言 */
  function soonMessage(row) { return `${row.icon} ${row.name}は準備中だよ。もうすぐ会えるよ`; }

  /** 画面の文字（「ここちゃん」「クロちゃん 👑」など）→ 話している子のkey。見つからなければ null */
  function speakerFromText(text, list) {
    const t = String(text || '').replace(/[\u{1F451}\s]+/gu, ' ').trim();
    if (!t) return null;
    for (const c of (list || [])) {
      if (!c || !c.enabled) continue;
      if (t === c.name || t.startsWith(c.name)) return c.key;
    }
    return null;
  }

  /**
   * 札タップ: 話しかけ先の切替。同じ子をもう一度=解除。準備中・知らない子は選べない（今の選択は変えない）。
   * 戻り値 { target, rejected: null|'soon'|'unknown', row }。rejected='soon' の時 row を soonMessage に渡してtoastを出す。
   */
  function toggleTarget(current, key, list) {
    const keep = current || null;
    const c = (list || []).find(x => x && x.key === key);
    if (!c) return { target: keep, rejected: 'unknown', row: null };
    if (!c.enabled) return { target: keep, rejected: 'soon', row: charMenu([c], null)[0] };
    return { target: keep === key ? null : key, rejected: null, row: null };
  }

  /**
   * 発言順に話しかけ先を反映: 話しかけ先を先頭にして主担当(lead)にする。他の子は元の順で続く（家族の会話は保つ）。
   * 話しかけ先が無効（空・準備中・知らない子）なら元のまま。入力の配列は書き換えない。
   */
  function applyTarget(order, lead, target, list) {
    const base = { order: [...(order || [])], lead, targeted: false };
    const c = target ? (list || []).find(x => x && x.key === target) : null;
    if (!c || !c.enabled) return base;
    return { order: [target, ...base.order.filter(k => k !== target)], lead: target, targeted: true };
  }

  /** 入力欄のヒント（「ここちゃんに話しかける」）。無効なら null */
  function targetHint(key, list) {
    const c = key ? (list || []).find(x => x && x.key === key && x.enabled) : null;
    return c ? `${c.name}に話しかける` : null;
  }

  /** 右の1つのボタン: 打った文字がある／送れる状態なら ↑(送信)、なければ 🎤 */
  function showSend(text, sendDisabled) { return String(text || '').trim().length > 0 || !sendDisabled; }

  /** 会議へ行くには btn-mode を何回押すか（normal→dev→meeting の循環）。ずっと同じなら0 */
  function modeClicks(current, target) {
    const a = MODES.indexOf(current), b = MODES.indexOf(target);
    if (a < 0 || b < 0) return 0;
    return (b - a + MODES.length) % MODES.length;
  }

  const HELP = {
    af: 'AF = ピント（オートフォーカス）。緑なら合っています。写真を撮る前に📌でピント合わせもできるよ',
    res: '画質: 🌿エコ（軽くて安い）→ 標準 → 高精細。押すと順に切り替わります。細かい文字を読ませたい時だけ上げてね',
  };

  return { STORE_KEY, SOON_ICON, MODES, SOON_COLORS, pickLayout, soonColor, charMenu, groupChips, stripChips, soonAria, soonMessage, speakerFromText, toggleTarget, applyTarget, targetHint, showSend, modeClicks, HELP };
})();
if (typeof window !== 'undefined') window.Layout2Core = Layout2Core;
