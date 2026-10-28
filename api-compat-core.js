// COCOMITalk - OpenAI互換(Chat Completions形式)APIの共通処理（xAI Grok / Moonshot Kimi 用）
// このファイルは api-xai.js と api-kimi.js が共有する「メッセージ組み立て・送信・本文取り出し・使用量記録」を1か所に持つ
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// v1.0 2026-10-29 - 新規作成（step2 有効化の準備。まだ使われない: characters.js で aoi/kimi が enabled:false の間は呼ばれない）
//
// ★未確認★ 実際の中継(cocomi-api-relay)・xAI・Kimiには一度もつないでいない。テストは全部モック。
//   中継の /xai /kimi は提案パッチ（deliverables_v2/relay_xai_kimi_v2.patch・未デプロイ）の仕様に合わせた:
//   ・tools / tool_choice / stream などは送らない（中継が400で拒否する）　・temperature等は送らない（Kimiは固定値のため）
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
    // tools / tool_choice / stream / temperature / n / stop は付けない（中継が拒否または不要）。opts.skipTools は無視でよい

    const data = await ApiCommon.callAPI(cfg.endpoint, body);

    if (typeof TokenMonitor !== 'undefined' && data && data.usage) {
      TokenMonitor.record(tier.id, Number(data.usage.prompt_tokens) || 0, outputTokens(data.usage));
    }
    if (data && data.error) {
      const msg = (data.error && data.error.message) || '不明なエラー';
      throw new Error(`${cfg.who}側でエラーが起きました: ${msg}`);
    }
    const text = extractText(data);
    if (!text) {
      const reason = data && data.choices && data.choices[0] && data.choices[0].finish_reason || 'unknown';
      throw new Error(`${cfg.who}の返答が空でした（finish_reason: ${reason}）`);
    }
    return text;
  }

  return { DEFAULT_MAX_TOKENS, buildMessages, extractText, outputTokens, send };
})();
