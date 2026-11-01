// COCOMITalk - 思考の強さ（reasoning effort / thinking level）の対応表・保存・検証
// このファイルは「どのモデルでどの強さが公式に使えるか」を1か所に持ち、設定画面とAPI呼び出しが同じ表を見る
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
// v1.0 2026-10-28 - 新規作成（OpenAI Luna/Terra/Sol/Astra、Claude 5.5系、Gemini 3.5Lite/3.8/4、xAI、Kimi）
//
// ★未確認★ 下の表は公式docs（2026-10-28閲覧）の転記。実APIでは一度も動かしていない（テストは全部モック）。
//   出典: developers.openai.com/api/docs/models/<id>, /guides/reasoning, /guides/latest-model
//         platform.claude.com/docs/en/build-with-claude/effort
//         ai.google.dev/gemini-api/docs/generate-content/thinking（REST: generationConfig.thinkingConfig.thinkingLevel）
//         docs.x.ai/developers/model-capabilities/text/reasoning, /models/grok-4.7
'use strict';

/**
 * 思考の強さモジュール
 * - SPEC: モデルID → {levels:使える強さ, apiDefault:APIの既定（不明ならnull）, note}
 * - 保存先 localStorage 'cocomitalk-effort-prefs'（新規キー。既存キーには触らない）
 *     { v:1, prefs:{ [provider]:{ [tier]:{ id:モデルID, effort:強さ } } } }
 *   保存時のモデルIDと今のモデルIDが違う／強さがそのモデルで無効なら無視して段階の既定に戻す（モデル入替で壊れない）
 */
const ModelEffort = (() => {

  const PREFS_KEY = 'cocomitalk-effort-prefs';
  const TIERS = ['lite', 'standard', 'high'];

  /** 表示名（設定画面） */
  const LABELS = {
    none: 'なし（思考オフ）', minimal: '最小', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大',
  };

  const L_ALL = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];    // Luna / Terra
  const L_NO_NONE = ['low', 'medium', 'high', 'xhigh', 'max'];        // Astra / Sol: none は 400（公式）
  const L_CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max'];         // Haiku/Sonnet/Opus 5.5

  /**
   * 公式docsの転記。levels の順＝弱→強。apiDefault は「指定しなかった時のAPI側の既定」（公式に無ければ null）
   * provider ごとに本文への入れ方が違う: openai/xai/moonshot=reasoning_effort（Responsesは reasoning.effort）,
   *   anthropic=output_config.effort, gemini=generationConfig.thinkingConfig.thinkingLevel
   */
  const SPEC = {
    openai: {
      'gpt-6-luna':    { levels: L_ALL, apiDefault: 'medium', note: 'Chat Completionsでツールを使えるのは「なし」のときだけ' },
      'gpt-6.1-terra': { levels: L_ALL, apiDefault: 'medium', note: 'ツールは Responses API が必要' },
      'gpt-6.1-sol':   { levels: L_NO_NONE, apiDefault: 'medium', note: '「なし」「最小」は不可。ツールは Responses API が必要' },
      // Astra の既定の強さは公式モデルページに記載なし → 必ず明示して送る
      'gpt-6-astra':   { levels: L_NO_NONE, apiDefault: null, note: '「なし」は不可（400）。ツールは Responses API が必要。高価（出力$50/100万）' },
    },
    anthropic: {
      'claude-haiku-5-5':  { levels: L_CLAUDE, apiDefault: 'medium', note: '' },
      'claude-sonnet-5-5': { levels: L_CLAUDE, apiDefault: 'high', note: '' },
      'claude-opus-5-5':   { levels: L_CLAUDE, apiDefault: 'medium', note: '常に思考あり（無効化不可）' },
    },
    gemini: {
      'gemini-3.5-flash-lite': { levels: ['minimal', 'low', 'medium', 'high'], apiDefault: 'minimal', note: '' },
      'gemini-3.8-flash':      { levels: ['low', 'medium', 'high'], apiDefault: 'medium', note: '「最小」は不可（エラー）' },
      'gemini-4-argon':        { levels: ['low', 'medium', 'high'], apiDefault: 'medium', note: '思考オフ不可' },
    },
    xai: {
      'grok-4.7': { levels: ['low', 'medium', 'high', 'xhigh'], apiDefault: 'high', note: '思考オフ不可' },
      'grok-4.3': { levels: ['none', 'low', 'medium', 'high', 'xhigh'], apiDefault: 'low', note: '' },
    },
    moonshot: {
      'kimi-k3.1-pro': { levels: ['low', 'high', 'max'], apiDefault: 'max', note: 'mediumは無い。強さを変えると先頭キャッシュが無効になる' },
    },
  };

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function getSpec(provider, id) {
    if (typeof provider !== 'string' || typeof id !== 'string') return null;
    return own(SPEC, provider) && own(SPEC[provider], id) ? SPEC[provider][id] : null;
  }

  /** そのモデルで公式に使える強さ（不明なモデルは空配列＝選択肢を出さない） */
  function levelsFor(provider, id) {
    const s = getSpec(provider, id);
    return s ? s.levels.slice() : [];
  }

  function isValid(provider, id, effort) {
    const s = getSpec(provider, id);
    return !!s && typeof effort === 'string' && s.levels.includes(effort);
  }

  // --- 保存（localStorage。壊れていても例外を出さず空として扱う） ---
  function _read() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const o = raw ? JSON.parse(raw) : null;
      return o && o.v === 1 && o.prefs && typeof o.prefs === 'object' ? o.prefs : {};
    } catch (e) { return {}; }
  }
  function _write(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, prefs })); return true; } catch (e) { return false; }
  }

  /** 保存済みの強さ。モデルIDが変わった／無効なら null（段階の既定を使う） */
  function getPref(provider, tier, id) {
    const p = _read();
    const hit = own(p, provider) && p[provider] && own(p[provider], tier) ? p[provider][tier] : null;
    return hit && hit.id === id && isValid(provider, id, hit.effort) ? hit.effort : null;
  }

  /** 強さを保存。effort が空（''/null）なら段階の既定に戻す。無効な値は保存せず false */
  function setPref(provider, tier, id, effort) {
    if (!TIERS.includes(tier) || !getSpec(provider, id)) return false;
    const p = _read();
    if (!own(p, provider) || !p[provider] || typeof p[provider] !== 'object') p[provider] = {};
    if (effort === '' || effort == null) {
      delete p[provider][tier];
    } else {
      if (!isValid(provider, id, effort)) return false;
      p[provider][tier] = { id, effort };
    }
    return _write(p);
  }

  function clearAll() {
    try { localStorage.removeItem(PREFS_KEY); } catch (e) { /* ignore */ }
  }

  /**
   * 実際に送る強さを決める。
   * 優先: ①ユーザーの保存値（有効なら）②段階の既定 tierDefault（そのモデルで有効なら）
   *   ③tierDefault がそのモデルで無効（例: Astraに none）なら最弱の有効値へ寄せる ④tierDefault なし＝送らない（API既定に任せる）
   * ignorePref=true は保存値を無視した「既定」を返す（設定画面の「既定（○）」表示用）
   * @returns {{effort:(string|null), source:('pref'|'tier'|'coerced'|'api'), levels:string[], apiDefault:(string|null)}}
   */
  function resolveEffort(provider, tier, id, tierDefault, ignorePref = false) {
    const s = getSpec(provider, id);
    if (!s) return { effort: tierDefault || null, source: tierDefault ? 'tier' : 'api', levels: [], apiDefault: null };
    const base = { levels: s.levels.slice(), apiDefault: s.apiDefault };
    const pref = ignorePref ? null : getPref(provider, tier, id);
    if (pref) return { ...base, effort: pref, source: 'pref' };
    if (!tierDefault) return { ...base, effort: null, source: 'api' };
    if (s.levels.includes(tierDefault)) return { ...base, effort: tierDefault, source: 'tier' };
    return { ...base, effort: s.levels[0], source: 'coerced' };
  }

  /**
   * 強い設定では思考トークンが出力枠（max_tokens / max_completion_tokens）を食うので、枠を広げる。
   * （公式: 思考トークンも出力上限に含まれる。小さい枠だと途中で切れる／空になる）
   */
  function maxTokensFor(provider, effort, base) {
    if (effort !== 'xhigh' && effort !== 'max') return base;
    const want = provider === 'anthropic' ? 16000 : 32000;
    return Math.max(base, want);
  }

  function note(provider, id) {
    const s = getSpec(provider, id);
    return s ? s.note : '';
  }

  return { PREFS_KEY, LABELS, SPEC, getSpec, levelsFor, isValid, getPref, setPref, clearAll, resolveEffort, maxTokensFor, note };
})();
