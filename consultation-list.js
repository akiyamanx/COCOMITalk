// COCOMITalk - 相談トピック一覧（全件表示・選択・取り消し）
// このファイルは何をするか:
// 会議画面の「クロちゃんからの相談」を全件リストで出し、タップで中身を見る／この相談で会議する相談を選ぶ／
// 「取り消し」で既存の中継 POST /consultation/resolve に「取り消し（済み）」を書いて未回答(pending)から外す。
// サーバー・中継・D1 は変更しない（既存エンドポイントをそのまま使う）。
// v1.0 2026-11-01 - 新規作成（COCOMITalk v4.7）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';

const ConsultationList = (() => {
  const CANCEL_RESOLUTION = '取り消し（済み）';
  const FETCH_LIMIT = 10; // 中継側の上限が10

  /** 誰からの相談か（source 列） */
  function fromWhom(source) {
    const s = String(source || '');
    if (!s || s === 'web-claude' || /claude/i.test(s)) return 'クロちゃん';
    if (/cocomitalk|akiya/i.test(s)) return 'アキヤ';
    return s;
  }

  /** D1 の created_at（UTC 'YYYY-MM-DD HH:MM:SS'）→ 日本時間 'M/D HH:MM' */
  function formatDate(createdAt) {
    if (!createdAt) return '';
    const raw = String(createdAt);
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw.replace(' ', 'T') : raw.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return raw;
    const j = new Date(d.getTime() + 9 * 3600 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
  }

  /** バーの文言（取得上限に届いたら「以上」） */
  function barText(count) {
    return `クロちゃんからの相談が${count}件${count >= FETCH_LIMIT ? '以上' : ''}あるよ！`;
  }

  /** 取り消し用の resolve 本文 */
  function cancelBody(id) {
    return { id, resolution: CANCEL_RESOLUTION, akiya_comment: null };
  }

  /** 一覧から id を除いた新しい配列 */
  function without(list, id) {
    return (list || []).filter(c => String(c.id) !== String(id));
  }

  /** 中継で取り消し（pending→resolved, resolution=取り消し（済み））。成功で true */
  async function cancelOnServer(id, fetchFn, workerUrl, authToken) {
    if (!workerUrl || !authToken) return false;
    try {
      const res = await fetchFn(`${workerUrl}/consultation/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-COCOMI-AUTH': authToken },
        body: JSON.stringify(cancelBody(id)),
      });
      return !!(res && res.ok);
    } catch (e) {
      console.warn('[ConsultationList] 取り消し失敗:', e.message);
      return false;
    }
  }

  /**
   * 一覧を描画。handlers: { onSelect(c), onCancel(c) }
   * selectedId の行は選択中表示
   */
  function render(container, list, selectedId, handlers) {
    if (!container) return;
    container.innerHTML = '';
    (list || []).forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'consultation-list-item' + (String(c.id) === String(selectedId) ? ' selected' : '');
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'consultation-list-info';
      const title = document.createElement('span');
      title.className = 'consultation-list-title';
      title.textContent = `${i + 1}. ${c.topic || '（無題）'}`;
      const meta = document.createElement('span');
      meta.className = 'consultation-list-meta';
      meta.textContent = `${fromWhom(c.source)}・${formatDate(c.created_at)}`;
      info.appendChild(title);
      info.appendChild(meta);
      info.addEventListener('click', (e) => { e.stopPropagation(); handlers.onSelect(c); });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'consultation-list-cancel';
      cancel.textContent = '取り消し';
      cancel.setAttribute('aria-label', `「${c.topic || ''}」を取り消し`);
      cancel.addEventListener('click', (e) => { e.stopPropagation(); handlers.onCancel(c); });
      row.appendChild(info);
      row.appendChild(cancel);
      container.appendChild(row);
    });
  }

  return { CANCEL_RESOLUTION, FETCH_LIMIT, fromWhom, formatDate, barText, cancelBody, without, cancelOnServer, render };
})();
