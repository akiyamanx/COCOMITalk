// COCOMITalk - 会議の結果（固定の形 cocomi.meeting.v1）: 書記の呼び出し・JSONの検証・Markdown作成
// このファイルは会議の終わりに「書記」（安いモデル1回＋再試行1回）でまとめを作り、検証して、相談回答・共有用のMarkdown（末尾にJSONのコードブロック）にする
// v1.0 2026-11-01 - 新規（会議システム Phase A・クロ§5-①②）。サーバー・relayは変えない（既存の /consultation/resolve の resolution に入れるだけ）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';

const MeetingResult = (() => {
  const SCHEMA = 'cocomi.meeting.v1';
  const RECIPIENTS = ['aoi', 'mio', 'kuro'];              // 受け取る3人（葵・澪・クロ）
  const RECIPIENT_NAMES = { aoi: '葵', mio: '澪', kuro: 'クロ' };
  const OWNERS = ['', '仮', 'aoi', 'mio', 'kuro', 'akiya']; // 担当は会議で決めきらない（空欄か「仮」でよい）
  const SCRIBE_TIER = 'lite';                              // 書記は安いモデル（Gemini lite段）
  const SCRIBE_RETRIES = 1;
  const FAIL_NOTE = '要約失敗（書記のまとめが作れなかったので、議事ログのみ）';

  /** 名前は登録簿から（無い時は key のまま） */
  function nameOf(key) {
    if (typeof CharacterRegistry !== 'undefined') return CharacterRegistry.info(key).name;
    return String(key);
  }

  const _isStrArr = a => Array.isArray(a) && a.every(x => typeof x === 'string');

  /** 検証。{ ok, errors[] } */
  function validate(r) {
    const e = [];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, errors: ['オブジェクトではない'] };
    if (r.schema !== SCHEMA) e.push('schema が違う');
    if (typeof r.topic !== 'string') e.push('topic が文字列でない');
    if (typeof r.conclusion !== 'string' || !r.conclusion.trim()) e.push('conclusion が空');
    for (const k of ['decisions', 'open_questions', 'risks', 'participants']) if (!_isStrArr(r[k])) e.push(`${k} が文字列の配列でない`);
    if (!Array.isArray(r.recipients) || RECIPIENTS.some(x => !r.recipients.includes(x))) e.push('recipients に 葵/澪/クロ がそろっていない');
    if (!Array.isArray(r.tasks)) e.push('tasks が配列でない');
    else r.tasks.forEach((t, i) => {
      if (!t || typeof t !== 'object') { e.push(`tasks[${i}] がオブジェクトでない`); return; }
      if (typeof t.title !== 'string' || !t.title.trim()) e.push(`tasks[${i}].title が空`);
      if (typeof t.detail !== 'string') e.push(`tasks[${i}].detail が文字列でない`);
      if (!OWNERS.includes(t.owner)) e.push(`tasks[${i}].owner が不正: ${t.owner}`);
      if (!_isStrArr(t.depends_on)) e.push(`tasks[${i}].depends_on が文字列の配列でない`);
      if (typeof t.needs_akiya_go !== 'boolean') e.push(`tasks[${i}].needs_akiya_go が真偽値でない`);
    });
    return { ok: e.length === 0, errors: e };
  }

  /** 書記の返答からJSONを取り出す（```json 囲み・前後の文も許す）。だめなら null */
  function parseScribeReply(text) {
    if (typeof text !== 'string') return null;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let s = fence ? fence[1] : text;
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
  }

  /** 書記の出した中身に、アプリが決める欄（schema/議題/参加者/受け取り手/ID/日時）を上書きでそろえる */
  function normalize(raw, meta) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
    return {
      schema: SCHEMA,
      consultation_id: meta.consultationId ?? null,
      topic: String(meta.topic || ''),
      participants: [...meta.participants],
      recipients: [...RECIPIENTS],
      created_at: meta.createdAt || new Date().toISOString(),
      conclusion: typeof r.conclusion === 'string' ? r.conclusion : '',
      decisions: arr(r.decisions),
      tasks: Array.isArray(r.tasks) ? r.tasks.map(t => ({
        owner: (t && OWNERS.includes(t.owner)) ? t.owner : '仮',
        title: (t && typeof t.title === 'string') ? t.title : '',
        detail: (t && typeof t.detail === 'string') ? t.detail : '',
        depends_on: arr(t && t.depends_on),
        needs_akiya_go: !!(t && t.needs_akiya_go),
      })) : r.tasks,
      open_questions: arr(r.open_questions),
      risks: arr(r.risks),
    };
  }

  /** 書記に失敗した時の結果（議事ログのみ・未決事項に「要約失敗」） */
  function fallback(meta) {
    return { ...normalize({}, meta), conclusion: '（まとめなし）', tasks: [], open_questions: [FAIL_NOTE] };
  }

  /** 議事ログ（ラウンド×発言）のMarkdown */
  function transcriptMd(history) {
    let md = '', last = 0;
    for (const m of (history || [])) {
      if (!m || m.sister === 'user') continue;
      if (m.round !== last) { md += `### ラウンド ${m.round}\n\n`; last = m.round; }
      md += `**${nameOf(m.sister)}${m.isLead ? '（主担当）' : ''}**\n\n${m.content}\n\n`;
    }
    return md.trim();
  }

  /** 参加者（発言した順・重複なし） */
  function participantsOf(history) {
    const out = [];
    for (const m of (history || [])) if (m && m.sister && m.sister !== 'user' && !out.includes(m.sister)) out.push(m.sister);
    return out;
  }

  const OWNER_LABEL = o => ({ '': '未定', '仮': '仮', akiya: 'アキヤ' })[o] ?? RECIPIENT_NAMES[o] ?? o;
  const _list = a => (a.length ? a.map(x => `- ${x}`).join('\n') : '- なし');

  /** 結果のMarkdown（共有・resolution用）。末尾にJSONのコードブロック */
  function toMarkdown(r) {
    const tasks = r.tasks.length ? r.tasks.map((t, i) =>
      `${i + 1}. ${t.title}（担当: ${OWNER_LABEL(t.owner)}${t.needs_akiya_go ? '・アキヤのGOが必要' : ''}）${t.detail ? `\n   - ${t.detail}` : ''}`).join('\n') : '- なし';
    return [
      '# COCOMI会議の結果',
      '',
      `- 議題: ${r.topic}`,
      r.consultation_id != null ? `- 相談ID: ${r.consultation_id}` : null,
      `- 参加: ${r.participants.map(nameOf).join('・') || 'なし'}`,
      `- 受け取り: ${r.recipients.map(k => RECIPIENT_NAMES[k] || k).join('・')}（分担は3人で相談して決める）`,
      `- 日時: ${r.created_at}`,
      '', '## 結論', '', r.conclusion || '（なし）',
      '', '## 決まったこと', '', _list(r.decisions),
      '', '## やることの一覧', '', tasks,
      '', '## 未決事項', '', _list(r.open_questions),
      '', '## 気をつけること', '', _list(r.risks),
      '', '```json', JSON.stringify(r, null, 2), '```', '',
    ].filter(x => x !== null).join('\n');
  }

  /** Markdownから JSON コードブロックを取り出す（受け取る側・テスト用） */
  function extractJson(md) {
    const m = String(md || '').match(/```json\s*(\{[\s\S]*?\})\s*```/);  // 最初のJSONブロック（結果MDの末尾＝議事ログより前）
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (_) { return null; }
  }

  /** 書記への指示 */
  function scribePrompt() {
    return [
      'あなたはCOCOMI会議の書記です。議事ログを読み、JSONだけを返してください（前置き・説明なし）。',
      '形: {"conclusion":"結論(1〜3文)","decisions":["決まったこと"],',
      '"tasks":[{"owner":"仮","title":"やること","detail":"中身","depends_on":[],"needs_akiya_go":false}],',
      '"open_questions":["未決事項"],"risks":["気をつけること"]}',
      '- owner は "仮" か ""（誰がやるかは会議後に葵・澪・クロで決める）。',
      '- 本番環境・お金・外への送信に関わる作業は needs_akiya_go を true。',
      '- 議事ログに無いことは書かない。',
    ].join('\n');
  }

  /** 書記を呼ぶ（安いモデル・再試行1回）。結果 { result, ok, attempts, errors } */
  async function runScribe({ topic, history, consultationId, api, createdAt } = {}) {
    const meta = { topic, consultationId, participants: participantsOf(history), createdAt };
    const mod = api || ((typeof ApiGemini !== 'undefined') ? ApiGemini : null);
    const log = transcriptMd(history);
    let errors = ['書記のAPIが無い'];
    if (!mod || !log) return { result: fallback(meta), ok: false, attempts: 0, errors: log ? errors : ['発言が無い'] };
    let attempts = 0;
    for (let i = 0; i <= SCRIBE_RETRIES; i++) {
      attempts++;
      try {
        const reply = await mod.sendMessage(`【議題】${topic}\n\n【議事ログ】\n${log}`, scribePrompt(), [],
          { model: SCRIBE_TIER, maxTokens: 2048, skipTools: true });
        const parsed = parseScribeReply(reply);
        if (!parsed) { errors = ['JSONとして読めない']; continue; }
        const r = normalize(parsed, meta);
        const v = validate(r);
        if (v.ok) return { result: r, ok: true, attempts, errors: [] };
        errors = v.errors;
      } catch (e) {
        errors = [`呼び出しエラー: ${e && e.message ? e.message : e}`];
      }
    }
    return { result: fallback(meta), ok: false, attempts, errors };
  }

  /** 相談回答（resolution）用: 結果MD＋議事ログ */
  function toResolution(r, history) {
    return `${toMarkdown(r)}\n## 議事ログ\n\n${transcriptMd(history) || '（なし）'}\n`;
  }

  return { SCHEMA, RECIPIENTS, OWNERS, SCRIBE_TIER, SCRIBE_RETRIES, FAIL_NOTE, nameOf, validate, parseScribeReply, normalize,
    fallback, transcriptMd, participantsOf, toMarkdown, extractJson, scribePrompt, runScribe, toResolution };
})();
