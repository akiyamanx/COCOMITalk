// working-hooks.js v1.0
// このファイルは COCOMITalk の各機能（会議の返事待ち・ふつうのチャット・読み上げ・書類/議事録/書記/共有）に WorkingIndicator の開始/終了だけを差し込む
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
// v1.0 2026-11-01 - 新規作成（v4.9）。元の関数を包むだけで、中の処理（音声・ハウリング対策など）は一切変えない。表示の失敗は本処理に影響させない
'use strict';

const WorkingHooks = (() => {
  const NAMES = { koko: 'ここちゃん', gpt: 'お姉ちゃん', claude: 'クロちゃん', aoi: '葵ちゃん', kimi: 'きみちゃん' };
  function nameOf(key) {
    try { if (typeof CharacterRegistry !== 'undefined' && CharacterRegistry.displayMap) { const m = CharacterRegistry.displayMap(); if (m[key]?.name) return m[key].name; } } catch (_) { /* 既定名へ */ }
    return NAMES[key] || 'みんな';
  }

  // 「考え中」の表示: show で始め、hide か次の show で終える（1枠）
  function slot(WI, obj, showName, hideName, labelFn) {
    if (!obj || typeof obj[showName] !== 'function' || typeof obj[hideName] !== 'function' || obj[showName]._wi) return false;
    let token = null;
    const show = obj[showName], hide = obj[hideName];
    obj[showName] = function (...a) { const r = show.apply(this, a); WI.stop(token); token = WI.start('think', labelFn(...a)); return r; };
    obj[hideName] = function (...a) { WI.stop(token); token = null; return hide.apply(this, a); };
    obj[showName]._wi = true;
    return true;
  }
  function wrapFn(WI, obj, name, kind, label) {
    if (!obj || typeof obj[name] !== 'function' || obj[name]._wi) return false;
    obj[name] = WI.wrap(kind, label, obj[name]);
    obj[name]._wi = true;
    return true;
  }

  /** g: グローバル（テストでは偽物を渡す）。付けられた箇所の名前一覧を返す */
  function install(g) {
    const WI = g.WorkingIndicator; const done = [];
    if (!WI) return done;
    const add = (ok, n) => { if (ok) done.push(n); };
    add(slot(WI, g.MeetingUI, 'showTyping', 'hideTyping', (k) => `${nameOf(k)}考え中…`), 'meeting-typing');
    add(slot(WI, g.ChatUi, 'showTyping', 'hideTyping', () => {
      try { return `${nameOf(g.ChatCore && g.ChatCore.getCurrentSister())}考え中…`; } catch (_) { return '考え中…'; }
    }), 'chat-typing');
    const P = g.AudioPlaybackManager && g.AudioPlaybackManager.prototype;
    add(wrapFn(WI, P, 'speak', 'speak', (t, sid) => `${nameOf(sid)}おしゃべり中…`), 'tts-speak');
    add(wrapFn(WI, P, 'speakQueue', 'speak', 'おしゃべり中…'), 'tts-queue');
    add(wrapFn(WI, g.DocGenerator, 'generate', 'write', '書類つくり中…'), 'doc');
    add(wrapFn(WI, g.MeetingDocActions, 'downloadMinutes', 'write', '議事録つくり中…'), 'minutes');
    add(wrapFn(WI, g.MeetingResult, 'runScribe', 'write', '書記まとめ中…'), 'scribe');
    add(wrapFn(WI, g.MeetingShare, 'share', 'write', '共有の準備中…'), 'share');
    return done;
  }

  return { install, nameOf };
})();

if (typeof window !== 'undefined' && typeof WorkingIndicator !== 'undefined') {
  try {
    const g = { WorkingIndicator,
      MeetingUI: typeof MeetingUI !== 'undefined' ? MeetingUI : undefined,
      ChatUi: typeof ChatUi !== 'undefined' ? ChatUi : undefined,
      ChatCore: typeof ChatCore !== 'undefined' ? ChatCore : undefined,
      AudioPlaybackManager: typeof AudioPlaybackManager !== 'undefined' ? AudioPlaybackManager : undefined,
      DocGenerator: typeof DocGenerator !== 'undefined' ? DocGenerator : undefined,
      MeetingDocActions: typeof MeetingDocActions !== 'undefined' ? MeetingDocActions : undefined,
      MeetingResult: typeof MeetingResult !== 'undefined' ? MeetingResult : undefined,
      MeetingShare: typeof MeetingShare !== 'undefined' ? MeetingShare : undefined,
    };
    WorkingHooks.install(g);
  } catch (e) { console.warn('[WorkingHooks] 取り付け失敗', e); }
}
