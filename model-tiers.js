// COCOMITalk - モデル3段階設定（軽量/標準/高頭脳）
// このファイルは各AIプロバイダの「3段階（lite/standard/high）→ モデルID・追加パラメータ・価格」を1か所で定義する
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
// v1.0 2026-10-28 - 新規作成（step1: 段階表・旧キー互換・価格引き）
// v1.1 2026-10-28 - xAIを4.3/4.7(low)/4.7(high)、KimiをK3.1 Pro low/high/maxに更新（公式docs再確認）
// v1.2 2026-10-28 - OpenAI高頭脳をSol→GPT-6 Astraに変更（オーナー決定）。思考の強さ(model-effort.js)を resolve に合流。Sol/TTSの価格を追加
//
// ★重要★ 下のモデルID・価格・パラメータは「公式ドキュメントを2026-10-27に読んだ結果」を転記したもの。
//   実APIでは一度も動かしていない【未確認】。実キーで GET /v1/models 等で存在確認するまで本番投入しないこと。
//   仕様書: cocomitalk_spec_models.md §2 / §3
'use strict';

/**
 * モデル段階モジュール
 * - 段階: lite（軽量・既定・お散歩用）/ standard（標準）/ high（高頭脳）
 * - 設定画面・ModeSwitcher・各api-*.js・TokenMonitor はここだけを見てモデルIDを決める
 */
const ModelTiers = (() => {

  const TIER_ORDER = ['lite', 'standard', 'high'];
  const DEFAULT_TIER = 'lite';

  /** 段階の表示（設定画面・インジケーター用） */
  const TIER_DISPLAY = {
    lite: { icon: '🪶', label: '軽量' },
    standard: { icon: '⚖️', label: '標準' },
    high: { icon: '🧠', label: '高頭脳' },
  };

  /** プロバイダ → 価格集計用の姉妹キー（xai/moonshotは未対応なのでnull＝TokenMonitor側の既定に任せる） */
  const PROVIDER_SISTER = { gemini: 'koko', openai: 'gpt', anthropic: 'claude', xai: null, moonshot: null };

  /**
   * 段階表。price は USD/100万トークン。配列なら期間つき（until=その日まで / from=その日から、YYYY-MM-DD）。
   * params は本文にそのまま足す追加パラメータ（reasoning_effort 等）【未確認】。
   * sendTemperature=false は temperature を送らない（Claude 4.7以降は非デフォルト値で400／Kimiは固定値）。
   * chatTools=false は Chat Completions でツール呼び出し（web_search）を付けない（GPT-6: Terra/Astra/SolはResponses API必須）。
   */
  const TIERS = {
    openai: {
      // 強さ(reasoning_effort)の既定: Luna=none / Terra=low / Astra=medium。設定画面で変更可（model-effort.js・モデルごとの有効値のみ）
      // GPT-6 Luna は reasoning_effort=none の時だけ Chat Completions でツール可（chatToolsNeedsNone）。強さを上げるとResponses API経路が必要
      lite: { id: 'gpt-6-luna', label: 'GPT-6 Luna', params: { reasoning_effort: 'none' }, chatTools: true, chatToolsNeedsNone: true,
        price: { input: 0.10, output: 0.50 } },
      standard: { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', params: { reasoning_effort: 'low' }, chatTools: false,
        price: { input: 1.00, output: 5.00 } },
      // Astra（2026-10-28 公式モデルページ）: ID gpt-6-astra、$10/$50（キャッシュ入力$1）。272K超の入力はその1リクエスト全体が入力2倍・出力1.5倍
      //  noneは400（lowが最弱）。既定の強さは公式に記載なし→明示して送る。Chat Completionsは関数呼び出し不可＝ツールはResponses API必須
      high: { id: 'gpt-6-astra', label: 'GPT-6 Astra', params: { reasoning_effort: 'medium' }, chatTools: false,
        price: { input: 10.00, output: 50.00 } },
    },
    anthropic: {
      // 100Kトークン超のプロンプトは単価が上がる（haiku: 0.50/2.50）が、ここでは基本単価のみ
      lite: { id: 'claude-haiku-5-5', label: 'Haiku 5.5', params: {}, sendTemperature: false,
        price: { input: 0.10, output: 0.50 } },
      standard: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', params: {}, sendTemperature: false,
        price: { input: 2.00, output: 10.00 } },
      high: { id: 'claude-opus-5-5', label: 'Opus 5.5', params: {}, sendTemperature: false,
        price: { input: 4.00, output: 20.00 } },
    },
    gemini: {
      lite: { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', params: {},
        price: { input: 0.30, output: 2.50 } },
      standard: { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', params: {},
        price: [{ until: '2026-12-31', input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.50, output: 7.50 }] },
      high: { id: 'gemini-4-argon', label: 'Gemini 4 Argon', params: {},
        price: [{ until: '2026-11-30', input: 2.00, output: 10.00 }, { from: '2026-12-01', input: 4.00, output: 20.00 }] },
    },
    // --- 以下2社は中継(Worker)が未対応のため、UIでは「準備中」。値は将来用 ---
    // xAI（2026-10-28 公式docs再確認）: 最上位は grok-4.7（9/21公開）。4.6は4.7と同額で旧世代なので使わない。
    //  grok-4.7 は reasoning_effort = low/medium/high(既定)/xhigh で「無効化は不可」。標準＝同モデルのlow、高頭脳＝high。
    //  grok-4.3 は none〜xhigh（既定low）。軽量は思考なし(none)で応答速度優先【未確認: 4.3のnoneの挙動は実機未検証】
    //  reasoning_effort は Chat Completions では最上位、Responses API では reasoning:{effort} に入れる（中継側で変換する）
    xai: {
      lite: { id: 'grok-4.3', label: 'Grok 4.3', params: { reasoning_effort: 'none' }, price: { input: 1.25, output: 2.50 } },
      standard: { id: 'grok-4.7', label: 'Grok 4.7 (low)', params: { reasoning_effort: 'low' }, price: { input: 2.00, output: 6.00 } },
      high: { id: 'grok-4.7', label: 'Grok 4.7 (high)', params: { reasoning_effort: 'high' }, price: { input: 2.00, output: 6.00 } },
    },
    // Moonshot（2026-10-28 公式docs再確認）: kimi-k3.1-pro は常時思考。reasoning_effort は low/high/max のみ（mediumは無い）。
    //  K2.6 は年末廃止予定のため使わない。temperature/top_p等は固定値で、送るとエラーになるので送らない。
    //  段階: 軽量=low / 標準=high / 高頭脳=max（既定は max）。同じIDなので価格は共通。効果の切替は先頭キャッシュが無効になる点に注意
    moonshot: {
      lite: { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro (low)', params: { reasoning_effort: 'low' }, sendTemperature: false,
        price: { input: 2.00, output: 10.00 } },
      standard: { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro (high)', params: { reasoning_effort: 'high' }, sendTemperature: false,
        price: { input: 2.00, output: 10.00 } },
      high: { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro (max)', params: { reasoning_effort: 'max' }, sendTemperature: false,
        price: { input: 2.00, output: 10.00 } },
    },
  };

  /**
   * 段階表に載らないが課金計算に使うモデルの価格（過去に選んだSol等・Gemini TTS）。USD/100万トークン、配列は期間つき。
   * Gemini TTS: 音声出力は25トークン/秒。2027-01-01から出力単価が2倍（公式価格表 2026-10-28）。input=テキスト入力
   */
  const EXTRA_PRICES = {
    'gpt-6.1-sol': { sister: 'gpt', label: 'GPT-6.1 Sol', price: { input: 2.00, output: 10.00 } },
    'gemini-3.8-flash-lite-tts': { sister: 'koko', label: 'Gemini 3.8 Flash-Lite TTS',
      price: [{ until: '2026-12-31', input: 0.50, output: 6.00 }, { from: '2027-01-01', input: 1.00, output: 12.00 }] },
    'gemini-3.8-flash-tts': { sister: 'koko', label: 'Gemini 3.8 Flash TTS',
      price: [{ until: '2026-12-31', input: 0.50, output: 9.00 }, { from: '2027-01-01', input: 1.00, output: 18.00 }] },
  };

  /**
   * 旧モデルキー（localStorage 'cocomitalk-custom-models' に残っている値）→ 新しい段階。仕様書 §3-3
   * 旧ID(gemini-2.0系・gpt-4o系・haiku-4-5)は停止/期限切れ済みor間近のため、最も近い段階へ寄せる。
   */
  const LEGACY_ALIASES = {
    gemini: { 'flash-lite': 'lite', 'flash': 'lite', 'flash-25': 'lite', 'flash-3': 'standard', 'pro': 'high', 'pro-31': 'high' },
    openai: { 'mini': 'lite', 'gpt4o': 'standard', 'gpt54': 'high' },
    anthropic: { 'haiku': 'lite', 'sonnet': 'standard', 'opus': 'high' },
    xai: {},
    moonshot: {},
  };

  function isTier(key) { return TIER_ORDER.includes(key); }

  function hasProvider(provider) {
    return Object.prototype.hasOwnProperty.call(TIERS, provider);
  }

  /**
   * 段階名 または 旧キー → 段階名。解釈できなければ null（呼び出し側が既定を使う）
   */
  function normalizeKey(provider, key) {
    if (!hasProvider(provider) || typeof key !== 'string') return null;
    if (isTier(key)) return key;
    // 'constructor' 等のプロトタイプ上の名前を拾わないよう自前プロパティだけ見る
    const aliases = LEGACY_ALIASES[provider];
    return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : null;
  }

  /**
   * 段階（または旧キー）→ 設定エントリ。不明なキーは既定段階にフォールバック（例外を投げない）
   * @returns {{provider,tier,key,id,label,params,price,sendTemperature,chatTools,effort,effortLevels,effortSource,effortDefault,deprecatedAfter,icon,tierLabel}}
   */
  function resolve(provider, key, fallbackTier = DEFAULT_TIER) {
    if (!hasProvider(provider)) throw new Error(`[ModelTiers] 不明なプロバイダ: ${provider}`);
    const tier = normalizeKey(provider, key) || (isTier(fallbackTier) ? fallbackTier : DEFAULT_TIER);
    const e = TIERS[provider][tier];
    const params = { ...e.params };
    // 思考の強さ: 保存値（有効なら）→段階の既定。モデルごとに無効な値は送らない。model-effort.js が無ければ従来どおり
    let effort = params.reasoning_effort || null, effortLevels = [], effortSource = effort ? 'tier' : 'api', effortDefault = null;
    if (typeof ModelEffort !== 'undefined') {
      const r = ModelEffort.resolveEffort(provider, tier, e.id, effort);
      effort = r.effort; effortLevels = r.levels; effortSource = r.source; effortDefault = r.apiDefault;
      // OpenAI/xAI/Kimi は本文の reasoning_effort。Claude(output_config.effort)/Gemini(thinkingLevel)は各api-*.jsが tier.effort から組み立てる
      if (effort && ['openai', 'xai', 'moonshot'].includes(provider)) params.reasoning_effort = effort;
    }
    return {
      provider, tier, key: tier,
      id: e.id, label: e.label, params, price: e.price,
      sendTemperature: e.sendTemperature !== false,
      // Luna: Chat Completionsのツールは強さ none のときだけ（公式）。それ以外はツール無し or Responses API経路
      chatTools: e.chatTools !== false && !(e.chatToolsNeedsNone && params.reasoning_effort !== 'none'),
      effort, effortLevels, effortSource, effortDefault,
      deprecatedAfter: e.deprecatedAfter || null,
      icon: TIER_DISPLAY[tier].icon, tierLabel: TIER_DISPLAY[tier].label,
    };
  }

  /** 旧 getModels() 互換: { 段階名: ID, 旧キー: ID（=その旧キーが寄る段階のID） } */
  function idMap(provider) {
    const map = {};
    TIER_ORDER.forEach(t => { map[t] = TIERS[provider][t].id; });
    Object.entries(LEGACY_ALIASES[provider]).forEach(([k, t]) => { map[k] = TIERS[provider][t].id; });
    return map;
  }

  /** 設定画面用の選択肢（3段階）。旧 getAvailableModels() と同じ {key,name,tier} 形に label/icon を追加 */
  function listForProvider(provider) {
    return TIER_ORDER.map(t => {
      const r = resolve(provider, t);
      return { key: t, name: r.label, tier: r.icon, label: r.tierLabel, id: r.id, deprecatedAfter: r.deprecatedAfter };
    });
  }

  /** 価格（期間つき対応）。date は 'YYYY-MM-DD'（省略=今日） */
  function _priceAt(price, date) {
    if (!Array.isArray(price)) return price;
    const hit = price.find(p => (!p.until || date <= p.until) && (!p.from || date >= p.from));
    return hit || price[price.length - 1];
  }

  function _today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * モデルID → {input, output, sister, label}。段階表に無いIDは null（TokenMonitor既存表に任せる）
   */
  function getPricing(modelId, date) {
    const day = date || _today();
    for (const provider of Object.keys(TIERS)) {
      for (const t of TIER_ORDER) {
        const e = TIERS[provider][t];
        if (e.id === modelId) {
          const p = _priceAt(e.price, day);
          return { input: p.input, output: p.output, sister: PROVIDER_SISTER[provider], label: e.label };
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(EXTRA_PRICES, modelId)) {
      const x = EXTRA_PRICES[modelId], p = _priceAt(x.price, day);
      return { input: p.input, output: p.output, sister: x.sister, label: x.label };
    }
    return null;
  }

  /** OpenAIの推論系（gpt-5 / gpt-6）か。developerロール・max_completion_tokens・temperature無し の分岐に使う */
  function isReasoningOpenAI(modelName) {
    return typeof modelName === 'string' && /^gpt-(5|6)/.test(modelName);
  }

  /** 廃止予定が withinDays 日以内（または過ぎている）なら警告文、そうでなければ null */
  function deprecationNote(provider, key, now, withinDays = 90) {
    const r = resolve(provider, key);
    if (!r.deprecatedAfter) return null;
    const limit = new Date(`${r.deprecatedAfter}T23:59:59`).getTime();
    const cur = (now ? new Date(now) : new Date()).getTime();
    return (limit - cur) <= withinDays * 86400000
      ? `⚠️ ${r.label} は ${r.deprecatedAfter} までに廃止予定` : null;
  }

  return {
    TIER_ORDER, DEFAULT_TIER, TIER_DISPLAY, TIERS, EXTRA_PRICES, LEGACY_ALIASES,
    isTier, normalizeKey, resolve, idMap, listForProvider,
    getPricing, isReasoningOpenAI, deprecationNote,
  };
})();
