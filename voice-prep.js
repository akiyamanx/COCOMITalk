// COCOMITalk - 音声会話の「記憶などの準備」を文字起こしと並行に始める係
// このファイルは whisper-provider/whisper-preread（録音停止・仮の文字）から呼ばれ、chat-core._apiReply が確定文で受け取る。
// クロの条件③: 文字に依存しない部分（HOTトピック・記憶・会話メモリー）は録音停止と同時に開始。文字に依存する記憶検索は「仮」の文字で
//   開始してよいが、確定文が仮と大きく違えば（確定の文字数が仮の1.5倍以上 or 仮を含まない）やり直す。AIへ渡す文字は確定文だけ（ここは文字を作らない）。
//   時刻の1行(nowLine)と設定・検索結果は送る瞬間に PromptBuilder.build が今まで通り作る（古くならない）。
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.0 2026-10-31 - 新規作成（v4.2）
'use strict';

const VoicePrep = (() => {
  const MAX_AGE_MS = 60000; // これより古い準備は使わない
  let cur = null;           // { key, sister, at, parts:{pMem,pHot,pChat}, vecText, pVec }

  const _now = () => Date.now();
  function _log(m) {
    try {
      if (typeof VoiceFast !== 'undefined' && VoiceFast.tlog) { VoiceFast.tlog(m); return; }
      if (typeof window !== 'undefined' && window.DebugLogger) window.DebugLogger.addLog(`[${new Date().toLocaleTimeString('ja-JP', { hour12: false })}] ${m}`);
    } catch (e) { /* ログ失敗は無視 */ }
  }
  function _on() {
    return typeof PromptBuilder !== 'undefined' && !!PromptBuilder.prefetch && typeof VoiceFast !== 'undefined' && VoiceFast.isVoiceOn();
  }
  function _sister() {
    try { return (typeof ChatCore !== 'undefined' && ChatCore.getCurrentSister) ? ChatCore.getCurrentSister() : null; } catch (e) { return null; }
  }

  /** ③ 確定文が仮と大きく違うか（違えば記憶検索をやり直す） */
  function needRedo(prov, fin) {
    const p = String(prov || '').trim(), f = String(fin || '').trim();
    if (!p) return true;
    return f.length >= p.length * 1.5 || !f.includes(p);
  }

  /** 文字に依存しない部分を開始（同じ発話 key なら2回目は何もしない） */
  function begin(key) {
    if (!_on()) return false;
    if (cur && cur.key === key) return false;
    const t0 = _now(); const sister = _sister();
    const parts = PromptBuilder.prefetch({ sister });
    cur = { key, sister, at: t0, parts, vecText: '', pVec: null };
    _log('🧩 準備開始（記憶・HOT・会話メモリー／文字なし）');
    Promise.all([parts.pMem, parts.pHot, parts.pChat]).then(() => _log(`🧩 準備おわり（文字なし）${_now() - t0}ms`)).catch(() => {});
    return true;
  }

  /** 仮の文字が届いた: 記憶検索を仮の文字で開始（つないだ文字が増えたら取り直す） */
  function provisional(text) {
    if (!cur || !text || text === cur.vecText) return;
    const t0 = _now();
    cur.vecText = text; cur.pVec = PromptBuilder.prefetchVector(text, cur.sister);
    _log(`🧩 記憶検索開始（仮の文字 ${text.length}字）`);
    const mine = cur.pVec; cur.pVec.then(() => { if (cur && cur.pVec === mine) _log(`🧩 記憶検索おわり（仮）${_now() - t0}ms`); }).catch(() => {});
  }

  /**
   * 確定文で受け取る（1回きり）。使えなければ null（今まで通り build がその場で全部取る）
   * @returns {{pMem,pHot,pChat,pVec?}|null}
   */
  function take(sister, finalText) {
    const c = cur; cur = null;
    if (!c || !_on()) return null;
    if (c.sister !== sister || _now() - c.at > MAX_AGE_MS) { _log('🧩 準備は使わない（キャラ違い/古い）'); return null; }
    const out = { pMem: c.parts.pMem, pHot: c.parts.pHot, pChat: c.parts.pChat };
    if (c.pVec && !needRedo(c.vecText, finalText)) { out.pVec = c.pVec; _log('🧩 準備を使う（記憶検索も仮の文字のまま）'); }
    else _log(`🧩 準備を使う（記憶検索は確定文でやり直し${c.pVec ? '：仮と大きく違う' : ''}）`);
    return out;
  }

  function reset() { cur = null; }

  return { MAX_AGE_MS, needRedo, begin, provisional, take, reset };
})();
if (typeof window !== 'undefined') window.VoicePrep = VoicePrep;
