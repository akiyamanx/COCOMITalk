// このファイルはきみちゃん（Kimi / Moonshot）APIとの通信を、中継(cocomi-api-relay)の /kimi 経由で行う
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// v1.0 2026-10-29 - 新規作成（step2 有効化の準備。キャラ登録簿 characters.js で kimi が enabled:false の間は誰も呼ばない）
//
// ★未確認★ 中継の /kimi は提案パッチ（未デプロイ）にしか無い。実際に動かしたことはない（テストは全部モック）。
// ★有効化のスイッチ: characters.js の kimi を enabled:true にする（chat-core.js SISTER_API / meeting-relay.js SISTERS は
//   登録簿がenabledの時だけこのモジュールを返す）。ただし中継Workerの /kimi デプロイが先。詳細は chat-core.js 冒頭の「有効化の手順」。
// モデルIDと追加パラメータ(reasoning_effort)は model-tiers.js の provider 'moonshot'（lite/standard/high）が唯一の定義元。
// Kimiは temperature 等が固定値のため送らない（api-compat-core.js は temperature を一切送らない）。
'use strict';

/** きみちゃん（Kimi / Moonshot）API接続モジュール。形は api-openai.js と同じ（sendMessage/hasApiKey/getModels） */
const ApiKimi = (() => {
  const PROVIDER = 'moonshot';     // model-tiers.js の provider ID（中継のパスは 'kimi' と名前が違う点に注意）
  const ENDPOINT = 'kimi';         // 中継のパス（POST {Worker}/kimi）
  const DEFAULT_MODEL = 'lite';

  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    return ApiCompatCore.send({ provider: PROVIDER, endpoint: ENDPOINT, who: 'きみちゃん(Kimi)' },
      userMessage, systemPrompt, history, options);
  }

  function hasApiKey() { return ApiCommon.hasAuthToken(); }

  function getModels() { return ModelTiers.idMap(PROVIDER); }

  return { sendMessage, hasApiKey, getModels, DEFAULT_MODEL, PROVIDER, ENDPOINT };
})();
