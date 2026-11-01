// COCOMITalk - 吹き出しMarkdownの太字補正
// このファイルは marked が処理しきれなかった **太字** を <strong> にし、対にならない ** を消す
// 原因: CommonMarkの規則では「）**に」のように全角記号の直後で日本語が続くと閉じ**と見なされない
// v1.0 2026-10-30 - 新規作成（chat-ui.js / meeting-ui.js から使用）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';

const MdFix = (() => {
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** エスケープ済みの文字片で **x** → <strong>x</strong>、残った ** は削除 */
  function fixText(seg) {
    return seg.replace(/\*\*(?!\s)([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '');
  }

  /** HTML（markedの出力）のタグ外テキストだけを補正。code/pre の中は触らない */
  function fixHtml(html) {
    const parts = String(html).split(/(<[^>]*>)/);
    let codeDepth = 0;
    return parts.map(p => {
      if (p.startsWith('<')) {
        const m = /^<(\/?)(code|pre)\b/i.exec(p);
        if (m) codeDepth = Math.max(0, codeDepth + (m[1] ? -1 : 1));
        return p;
      }
      return codeDepth ? p : fixText(p);
    }).join('');
  }

  /** Markdown文字列 → 安全なHTML（marked が無い時はエスケープ＋改行＋太字のみ） */
  function render(text, markedLib) {
    const mk = markedLib || (typeof marked !== 'undefined' ? marked : null);
    if (mk && mk.parse) {
      try { return fixHtml(mk.parse(String(text), { breaks: true, gfm: true })); } catch (e) { /* fallthrough */ }
    }
    return fixText(escapeHtml(text)).replace(/\n/g, '<br>');
  }

  return { render, fixHtml, fixText, escapeHtml };
})();
