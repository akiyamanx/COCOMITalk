// このファイルはお姉ちゃん（GPT）の標準・高頭脳（Terra/Astra）でツール（Web検索等）を使うための Responses API 経路を担当する
// v1.0 2026-10-28 - 新規作成（既定オフ。オンのとき Terra/Astra だけ中継 /openai-responses 経由。失敗したら呼び出し側が従来のChat Completionsへ戻す）
// 2026-10-30 - ツール使用時に options.toolUsed を立てる（自動フォローアップ判定用）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
//
// ★未確認★ 実APIでは一度も動かしていない。リクエスト/応答の形は公式docs（2026-10-28閲覧）を元にした推定で、
//   テストは全部モック。中継Workerに /openai-responses が無い間は 404 になり、自動でChat Completions（ツール無し）へ戻る。
// 参考: developers.openai.com/api/docs/guides/latest-model, /guides/tools-web-search, /models/gpt-6.1-terra
'use strict';

/**
 * 切替スイッチ localStorage 'cocomitalk-openai-responses'
 *   'off'      … 使わない（既定）。Terra/Astra はツール無しのChat Completions（従来どおり）
 *   'function' … アプリ側ツール（ToolRegistry: web_search/get_datetime/calculate）を Responses API の関数ツールとして渡す
 *   'hosted'   … OpenAI内蔵の web_search（出典つき・1回$0.01＋検索トークン）＋ get_datetime/calculate だけ関数ツール
 */
const ApiOpenAIResponses = (() => {

  const MODE_KEY = 'cocomitalk-openai-responses';
  const MODES = ['off', 'function', 'hosted'];
  const ENDPOINT = 'openai-responses';
  const COOLDOWN_MS = 5 * 60 * 1000;   // 失敗後はしばらく使わない（毎回の無駄な往復と二重待ちを避ける）
  const MAX_TOOL_CALLS = 4;            // 1回の返答で実行する関数ツールの上限（ループ防止）

  let _failedAt = 0;
  let _last = { citations: [], searches: 0, mode: 'off' };

  function getMode() {
    try { const v = localStorage.getItem(MODE_KEY); return MODES.includes(v) ? v : 'off'; } catch (e) { return 'off'; }
  }
  function setMode(mode) {
    const m = MODES.includes(mode) ? mode : 'off';
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 保存できない環境では off のまま */ }
    return m;
  }

  /** この段階の呼び出しを Responses API で行うか（Terra/Astra等 chatTools:false の段階。Lunaも強さがnone以外ならここ。none時は従来経路） */
  function isActiveFor(tier, now = Date.now()) {
    return !!tier && tier.chatTools === false && getMode() !== 'off' && (now - _failedAt) > COOLDOWN_MS;
  }
  function markFailed(now = Date.now()) { _failedAt = now; }
  function resetFailure() { _failedAt = 0; }
  function getLast() { return { ..._last, citations: _last.citations.slice() }; }

  /** Chat Completions形式の messages → Responses の input */
  function toInput(messages) {
    return messages.map(m => {
      const role = (m.role === 'system' || m.role === 'developer') ? 'developer' : m.role;
      if (typeof m.content === 'string') return { role, content: m.content };
      const parts = (m.content || []).map(p => {
        if (p.type === 'image_url') return { type: 'input_image', image_url: p.image_url && p.image_url.url };
        return { type: 'input_text', text: p.text || '' };
      });
      return { role, content: parts };
    });
  }

  /** ToolRegistry の関数ツール（Chat形式）→ Responses形式（function が外に出る）。hostedのときは web_search を除く */
  function _functionTools(mode) {
    if (typeof ToolRegistry === 'undefined') return [];
    return ToolRegistry.getOpenAITools()
      .map(t => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters }))
      .filter(t => !(mode === 'hosted' && t.name === 'web_search'));
  }

  /** リクエスト本文を作る（純粋関数に近い。テスト対象） */
  function buildBody(tier, messages, options = {}, mode = getMode()) {
    const tools = _functionTools(mode);
    if (mode === 'hosted') tools.unshift({ type: 'web_search' });
    let effort = (tier.params && tier.params.reasoning_effort) || undefined;
    // 公式docs: 検索は reasoning none だと品質が下がる場合がある → 内蔵検索のときは low まで上げる
    if (mode === 'hosted' && effort === 'none') effort = 'low';
    const maxOut = options.maxTokens || (typeof ModelEffort !== 'undefined' ? ModelEffort.maxTokensFor('openai', effort, 8192) : 8192);
    const body = { model: tier.id, input: toInput(messages), max_output_tokens: maxOut };
    if (effort) body.reasoning = { effort };
    if (tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    return body;
  }

  /** 応答（output配列）→ {text, calls, citations, searches, incomplete} */
  function extract(data) {
    const out = Array.isArray(data && data.output) ? data.output : [];
    const r = { text: '', calls: [], citations: [], searches: 0, incomplete: false };
    for (const it of out) {
      if (it.type === 'message') {
        for (const c of (it.content || [])) {
          if (c.type === 'output_text') {
            r.text += c.text || '';
            (c.annotations || []).filter(a => a.type === 'url_citation').forEach(a => r.citations.push({ url: a.url, title: a.title || '' }));
          }
        }
      } else if (it.type === 'function_call') r.calls.push(it);
      else if (it.type === 'web_search_call') r.searches++;
    }
    if (data && data.status === 'incomplete') r.incomplete = true;
    return r;
  }

  function _record(modelId, data) {
    const u = data && data.usage;
    if (u && typeof TokenMonitor !== 'undefined') TokenMonitor.record(modelId, u.input_tokens || 0, u.output_tokens || 0);
  }

  /**
   * Responses API で1回答を作る。関数ツールが呼ばれたら実行して結果を返し、最終回答を得る（1往復まで）。
   * 失敗（通信・空応答・途中打ち切り）は例外を投げる → 呼び出し側（api-openai.js）が従来経路へ戻す
   */
  async function run({ tier, messages, options = {} }) {
    const mode = getMode();
    const body = buildBody(tier, messages, options, mode);
    const data = await ApiCommon.callAPI(ENDPOINT, body);
    if (data && data.error) throw new Error(`Responses API: ${data.error.message || '不明なエラー'}`);
    _record(tier.id, data);
    let r = extract(data);
    let searches = r.searches;
    const citations = r.citations.slice();

    if (r.calls.length && typeof ToolRegistry !== 'undefined') {
      const outputs = [];
      options.toolUsed = true; // 自動フォローアップ判定用
      for (const [i, c] of r.calls.entries()) {
        let args = {};
        try { args = JSON.parse(c.arguments || '{}'); } catch (e) { /* 空の引数として扱う */ }
        const known = i < MAX_TOOL_CALLS && ToolRegistry.hasTool(c.name);
        outputs.push({ type: 'function_call_output', call_id: c.call_id, output: known ? String(await ToolRegistry.execute(c.name, args)) : '（このツールは実行しませんでした）' });
      }
      // 2回目はツール定義なし（ループ防止）。出力項目（reasoning等）はそのまま渡し直す
      const follow = { ...body, input: [...body.input, ...data.output, ...outputs] };
      delete follow.tools; delete follow.tool_choice;
      const data2 = await ApiCommon.callAPI(ENDPOINT, follow);
      if (data2 && data2.error) throw new Error(`Responses API: ${data2.error.message || '不明なエラー'}`);
      _record(tier.id, data2);
      r = extract(data2);
      searches += r.searches;
      citations.push(...r.citations);
    }

    if (!r.text) throw new Error(r.incomplete ? 'Responses API: 出力が途中で打ち切られました' : 'Responses API: 空の応答');
    _last = { citations, searches, mode };
    return r.text;
  }

  return { MODE_KEY, MODES, ENDPOINT, getMode, setMode, isActiveFor, markFailed, resetFailure, getLast, toInput, buildBody, extract, run };
})();
