// COCOMITalk - OpenAI互換(Chat Completions形式)APIの共通処理（xAI Grok / Moonshot Kimi 用）
// このファイルは api-xai.js と api-kimi.js が共有する「メッセージ組み立て・送信・本文取り出し・使用量記録」を1か所に持つ
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.1 2026-10-30 - ツール（web_search/get_datetime/calculate）を三姉妹と同じに使う: tools+tool_choice:auto で送り、tool_calls が来たら
//   ToolRegistryで実行→tool役で結果を返して最終回答（ツールは1回だけ＝api-openai.jsと同じループ防止）。会議(skipTools)では付けない。
//   2回目が失敗したら、結果を本文に入れてツール無しでもう1回だけ聞く（Kimiの思考モデルは tool_calls 付きの発言に reasoning_content を要求することがあり、中継はそれを通さないため）
// v1.0 2026-10-29 - 新規作成（step2 有効化の準備。まだ使われない: characters.js で aoi/kimi が enabled:false の間は呼ばれない）
//
// ★未確認★ 実際の中継(cocomi-api-relay)・xAI・Kimiには一度もつないでいない。テストは全部モック。
//   中継の /xai /kimi は提案パッチ（deliverables_v2/relay_xai_kimi_v2.patch・未デプロイ）の仕様に合わせた:
//   ・stream などは送らない（中継が400で拒否する）。tools(関数のみ・8個まで)/tool_choice(auto/none)は v1.1 から送る（中継対応済み）　・temperature等は送らない（Kimiは固定値のため）
//   ・出力上限は max_completion_tokens（中継の上限32000）　・再試行しない（429や失敗課金を繰り返さないため。中継も再試行0）
//   ・reasoning_content（考えの途中経過）は画面にも履歴にも出さない。※公式はK3で複数ターンの履歴に含める設計。
//     今は1回ごとの返答テキストだけを履歴に保存するので、含めない（実接続で挙動を見てから別途判断）。
'use strict';

const ApiCompatCore = (() => {

  const DEFAULT_MAX_TOKENS = 8192;  // 推論モデルは思考にも枠を使うので広め（中継の既定16000・上限32000の内側）

  /** OpenAI形式の messages を作る（system → 履歴(最新20件) → 今回のuser（添付つき）） */
  function buildMessages(userMessage, systemPrompt, history, attachment) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

    let recent = (history || []).slice(-20);
    // 末尾が今回のuserMessageと同じなら除外（二重送信防止。他のapi-*.jsと同じ）
    if (recent.length > 0) {
      const last = recent[recent.length - 1];
      if (last.role === 'user' && last.content === userMessage) recent = recent.slice(0, -1);
    }
    for (const m of recent) messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });

    if (attachment && attachment.type === 'image') {
      // 画像の形式はOpenAI互換の image_url（xAI/Kimiで実際に通るかは未確認）
      messages.push({ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.content}` } },
        { type: 'text', text: userMessage },
      ] });
    } else if (attachment && attachment.type === 'text') {
      messages.push({ role: 'user', content: `【添付ファイル: ${attachment.name}】\n${attachment.content}\n\n${userMessage}` });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }
    return messages;
  }

  /** 応答から本文だけ取り出す（reasoning_content は無視）。content が配列ならtext部分を連結 */
  function extractText(data) {
    const c = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => (p && typeof p.text === 'string') ? p.text : '').join('');
    return '';
  }

  /**
   * 出力トークン数。推論トークンが completion_tokens に含まれるかは未確認なので、
   * total_tokens - prompt_tokens の方が大きければそちらを使う（少なく数えて安く見せない側に倒す）
   */
  function outputTokens(usage) {
    if (!usage) return 0;
    const comp = Number(usage.completion_tokens) || 0;
    const viaTotal = (Number(usage.total_tokens) || 0) - (Number(usage.prompt_tokens) || 0);
    return Math.max(comp, viaTotal > 0 ? viaTotal : 0);
  }

  /**
   * 1回送って本文を返す。cfg = { provider(model-tiers側のID), endpoint(中継パス), who(エラー文の呼び名) }
   * 失敗は例外（呼び出し側のグループ/会議の既存処理が表示する）。再試行はしない。
   */
  async function send(cfg, userMessage, systemPrompt, history, options) {
    const opts = options || {};
    if (!ApiCommon.hasAuthToken()) {
      throw new Error('COCOMI認証トークンが設定されていません。設定画面からトークンを入力してください。');
    }
    const tier = ModelTiers.resolve(cfg.provider, opts.model || 'lite');
    const body = {
      model: tier.id,
      messages: buildMessages(userMessage, systemPrompt, history, opts.attachment),
    };
    Object.assign(body, tier.params);   // reasoning_effort（段階ごと。中継は素通し）
    const base = opts.maxTokens || DEFAULT_MAX_TOKENS;
    body.max_completion_tokens = (typeof ModelEffort !== 'undefined') ? ModelEffort.maxTokensFor(cfg.provider, tier.effort, base) : base;
    // stream / temperature / n / stop は付けない（中継が拒否または不要）
    if (!opts.skipTools && typeof ToolRegistry !== 'undefined') {
      body.tools = ToolRegistry.getOpenAITools();
      body.tool_choice = 'auto';
    }

    const data = _check(cfg, await ApiCommon.callAPI(cfg.endpoint, body), tier);
    const tc = toolCallOf(data);
    if (tc) return _answerWithTool(cfg, body, data.choices[0].message, tc, opts, tier);
    return _textOrThrow(cfg, data);
  }

  /** 使用量の記録＋エラー応答なら例外。data をそのまま返す */
  function _check(cfg, data, tier) {
    if (typeof TokenMonitor !== 'undefined' && data && data.usage) {
      TokenMonitor.record(tier.id, Number(data.usage.prompt_tokens) || 0, outputTokens(data.usage));
    }
    if (data && data.error) {
      const msg = (data.error && data.error.message) || '不明なエラー';
      throw new Error(`${cfg.who}側でエラーが起きました: ${msg}`);
    }
    return data;
  }

  function _textOrThrow(cfg, data) {
    const text = extractText(data);
    if (!text) {
      const reason = data && data.choices && data.choices[0] && data.choices[0].finish_reason || 'unknown';
      throw new Error(`${cfg.who}の返答が空でした（finish_reason: ${reason}）`);
    }
    return text;
  }

  /** 応答の最初の tool_call（登録済みツールのものだけ）。無ければ null */
  function toolCallOf(data) {
    const m = data && data.choices && data.choices[0] && data.choices[0].message;
    const tc = m && Array.isArray(m.tool_calls) ? m.tool_calls[0] : null;
    if (!tc || !tc.function || typeof ToolRegistry === 'undefined' || !ToolRegistry.hasTool(tc.function.name)) return null;
    return tc;
  }

  /** ツールを1回実行して結果を渡し、最終回答をもらう（2回目はツールを呼ばせない） */
  async function _answerWithTool(cfg, body, msg, tc, opts, tier) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { /* 引数が壊れていたら空で実行 */ }
    opts.toolUsed = true; (opts.toolNames = opts.toolNames || []).push(tc.function.name); // 自動フォローアップ判定・吹き出しの印用
    const result = await ToolRegistry.execute(tc.function.name, args);
    const assistant = { role: 'assistant', content: (typeof msg.content === 'string') ? msg.content : null, tool_calls: [tc] };
    const second = { ...body, tool_choice: 'none',
      messages: [...body.messages, assistant, { role: 'tool', tool_call_id: String(tc.id || ''), content: String(result) }] };
    try {
      const text = extractText(_check(cfg, await ApiCommon.callAPI(cfg.endpoint, second), tier));
      if (text) return text;
    } catch (e) {
      console.warn(`[ApiCompatCore] ${cfg.who}: ツール結果の返送に失敗。結果を本文に入れて聞き直す`, e && e.message);
    }
    // 予備: ツール無しで、結果を今回の発言の前に添えてもう1回だけ
    const plain = { ...body, messages: body.messages.slice(0, -1).concat([{ role: 'user',
      content: `【ツール ${tc.function.name} の結果】\n${result}\n\n${_lastUserText(body.messages)}` }]) };
    delete plain.tools; delete plain.tool_choice;
    return _textOrThrow(cfg, _check(cfg, await ApiCommon.callAPI(cfg.endpoint, plain), tier));
  }

  /** 最後のuser発言の文字部分（画像つきなら text 部分） */
  function _lastUserText(messages) {
    const c = messages[messages.length - 1].content;
    return Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('') : String(c);
  }

  return { DEFAULT_MAX_TOKENS, buildMessages, extractText, outputTokens, toolCallOf, send };
})();
