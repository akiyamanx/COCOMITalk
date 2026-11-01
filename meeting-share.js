// COCOMITalk - 会議の結果の共有ボタン（手動配達）
// このファイルは会議画面の「📤 結果を共有」ボタン。書記のまとめ（cocomi.meeting.v1）を作り、結果のMarkdownだけを共有する（議事ログは入れない）
// v1.0 2026-11-01 - 新規（会議システム Phase A・クロ§5-⑤）。navigator.share → 無ければクリップボード＋葵のメール宛 mailto
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';

const MeetingShare = (() => {
  const AOI_MAIL = 'cocomi.aoi@mail.grokbot.com';
  let _cache = null; // { sig, out }  同じ会議・同じ発言数なら書記を呼び直さない
  let _busy = null;

  function _sysMsg(t) { if (typeof MeetingUI !== 'undefined') MeetingUI.addSystemMessage(t); }

  function _sig(history) { // 相談IDはキーに入れない（📤と相談回答で書記を2回呼ばない。IDは呼ぶ側で入れる）
    const id = (typeof MeetingRelay !== 'undefined' && MeetingRelay.getCurrentMeetingId) ? MeetingRelay.getCurrentMeetingId() : '';
    return `${id}|${history.length}|${history.length ? history[history.length - 1].timestamp || '' : ''}`;
  }

  /** 今の会議の結果を作る（書記1回＋再試行1回・キャッシュあり）。{ result, ok, ... } か null */
  async function getResult({ topic, consultationId } = {}) {
    if (typeof MeetingRelay === 'undefined' || typeof MeetingResult === 'undefined') return null;
    const history = MeetingRelay.getHistory().filter(m => m.sister !== 'user');
    if (!history.length) return null;
    const sig = _sig(history);
    if (_cache && _cache.sig === sig) return _cache.out;
    if (_busy && _busy.sig === sig) return _busy.p;
    const t = topic || (MeetingRelay.getTopic ? MeetingRelay.getTopic() : '') || '（議題なし）';
    _sysMsg('🧾 書記がまとめ中…（安いモデルで1回・失敗したら1回だけやり直し）');
    const p = MeetingResult.runScribe({ topic: t, history, consultationId }).then(out => {
      if (!out.ok) {
        console.warn('[MeetingShare] 書記まとめ失敗:', out.errors);
        _sysMsg('⚠️ 書記のまとめが作れなかったので、議事ログのみの結果にしたよ（未決事項に「要約失敗」）');
      }
      _cache = { sig, out }; _busy = null;
      return out;
    });
    _busy = { sig, p };
    return p;
  }

  /** 共有する本文（結果のMarkdownだけ） */
  function shareText(result) { return MeetingResult.toMarkdown(result); }

  async function _copy(text) {
    try { if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; } } catch (_) { /* 失敗は下で案内 */ }
    return false;
  }

  /** ボタンの処理 */
  async function share(opts = {}) {
    const out = await getResult(opts);
    if (!out) { _sysMsg('まだ発言がないよ。会議を始めてから📤を押してね'); return null; }
    const text = shareText(out.result);
    const title = `COCOMI会議の結果: ${out.result.topic}`.slice(0, 80);
    try {
      if (navigator.share) { await navigator.share({ title, text }); _sysMsg('📤 結果を共有したよ（葵・澪・クロに渡してね）'); return text; }
    } catch (e) {
      if (e && e.name === 'AbortError') return text; // キャンセル
    }
    const copied = await _copy(text);
    _sysMsg(copied ? '📋 結果をコピーしたよ。葵のメールを開くね' : '⚠️ コピーできなかったので、葵のメールに入れて開くね');
    location.href = `mailto:${AOI_MAIL}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text.slice(0, 1800))}`;
    return text;
  }

  function init() {
    const btn = document.getElementById('btn-meeting-share');
    if (btn) btn.addEventListener('click', () => { share().catch(e => _sysMsg(`❌ 共有エラー: ${e.message}`)); });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  return { getResult, share, shareText, AOI_MAIL, _resetCache: () => { _cache = null; _busy = null; } };
})();
