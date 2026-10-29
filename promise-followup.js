// COCOMITalk - 「調べるね/待っててね」で止まった返事の自動フォローアップ（1対1チャット用）
// このファイルは、ツールを使わずに「調べてみるね」「待っててね」等の約束で終わった返事を見つけ、
// 隠し指示つきでもう1回だけ（ツール有効のまま）問い合わせて、答えを2つ目の吹き出しとして返す
// v1.0 2026-10-30 - 新規作成（1ユーザー発言につき最大1回。隠し指示は画面・履歴・記憶に残さない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';

const PromiseFollowup = (() => {
  /** 自動フォローアップの出力上限（短く） */
  const MAX_TOKENS = 2048;

  /** AIにだけ渡す隠し指示（画面・履歴・記憶には入れない） */
  const HIDDEN_INSTRUCTION = '（システムからの自動指示）さっき「調べる・確認する・待ってて」と言ったので、' +
    '今すぐツール（web_search / get_datetime / calculate）を使って答えを出して。' +
    '調べられないなら正直に「わからない」と言って。また「待ってて」とは言わない。短く答える。';

  // 控えめな判定: 返事の「最後の文」が、調べる/確認する/待ってて系の約束で終わっている時だけ
  const PROMISE_RE = /(調べ(て|る|よう)|確認(して|する|しよう)|検索(して|する|しよう)|チェック(して|する)|(ちょっと|少し|しばらく)?待って(て|ね|てね|ください)?)[^。！？!?\n]{0,16}$/;
  const TAIL_STRIP_RE = /[\s。．！!？?〜~…♪☆★✨🔍💦😊🤗🙏👀⏳…\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/u;

  /** 返事が「まだやっていない約束」で終わっているか */
  function isPromiseOnly(text) {
    if (typeof text !== 'string') return false;
    const t = text.replace(TAIL_STRIP_RE, '');
    if (!t) return false;
    // 最後の文だけを見る（途中の「確認してね」等は無視）
    const parts = t.split(/[。！？!?\n]/);
    const last = parts[parts.length - 1].trim();
    if (!last || last.length > 40) return false;
    // 「調べたよ」「確認した」など完了形は対象外
    if (/(調べた|確認した|検索した|わかった|分かった)/.test(last)) return false;
    return PROMISE_RE.test(last);
  }

  /** フォローアップすべきか（ツール未使用・未実施・約束で終わる） */
  function shouldFollowUp(reply, state) {
    if (!state || state.followedUp || state.toolUsed) return false;
    return isPromiseOnly(reply);
  }

  /**
   * もう1回だけ問い合わせる。state.followedUp を立てて2回目以降は必ず null
   * @param {Object} p - { apiModule, systemPrompt, history(実履歴・ここでは変更しない), firstReply, model, state }
   * @returns {Promise<string|null>} 2つ目の返事（表示・保存は呼び出し側）
   */
  async function run(p) {
    const state = p.state || {};
    if (!shouldFollowUp(p.firstReply, state)) return null;
    state.followedUp = true;
    // 実履歴はコピー（隠し指示はAPIへの userMessage としてだけ渡し、履歴に push しない）
    const history = (p.history || []).slice();
    const last = history[history.length - 1];
    if (!last || last.role !== 'assistant' || last.content !== p.firstReply) {
      history.push({ role: 'assistant', content: p.firstReply });
    }
    const opts = { model: p.model, maxTokens: MAX_TOKENS, followUp: true };
    console.log('[PromiseFollowup] 約束で止まった返事を検出 → 自動で1回だけ追加問い合わせ');
    // トークン記録は各api-*.jsの既存TokenMonitor.recordで自動的に1回分として残る
    return await p.apiModule.sendMessage(HIDDEN_INSTRUCTION, p.systemPrompt, history, opts);
  }

  return { isPromiseOnly, shouldFollowUp, run, HIDDEN_INSTRUCTION, MAX_TOKENS };
})();
