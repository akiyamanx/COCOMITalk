// このファイルは葵ちゃん（Grok / xAI）APIとの通信を、中継(cocomi-api-relay)の /xai 経由で行う
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
// v1.0 2026-10-29 - 新規作成（step2 有効化の準備。キャラ登録簿 characters.js で aoi が enabled:false の間は誰も呼ばない）
//
// ★未確認★ 中継の /xai は提案パッチ（未デプロイ）にしか無い。実際に動かしたことはない（テストは全部モック）。
// ★有効化のスイッチ: characters.js の aoi を enabled:true にする（chat-core.js SISTER_API / meeting-relay.js SISTERS は
//   登録簿がenabledの時だけこのモジュールを返す）。ただし中継Workerの /xai デプロイが先。詳細は chat-core.js 冒頭の「有効化の手順」。
// モデルIDと追加パラメータ(reasoning_effort)は model-tiers.js の provider 'xai'（lite/standard/high）が唯一の定義元。
'use strict';

/** 葵ちゃん（xAI Grok）API接続モジュール。形は api-openai.js と同じ（sendMessage/hasApiKey/getModels） */
const ApiXai = (() => {
  const PROVIDER = 'xai';          // model-tiers.js の provider ID
  const ENDPOINT = 'xai';          // 中継のパス（POST {Worker}/xai）
  const DEFAULT_MODEL = 'lite';

  async function sendMessage(userMessage, systemPrompt, history = [], options = {}) {
    return ApiCompatCore.send({ provider: PROVIDER, endpoint: ENDPOINT, who: '葵ちゃん(Grok)' },
      userMessage, systemPrompt, history, options);
  }

  /** 認証トークン（中継の共通トークン）が設定されているか。xAIのキーは中継側の秘密でアプリは持たない */
  function hasApiKey() { return ApiCommon.hasAuthToken(); }

  function getModels() { return ModelTiers.idMap(PROVIDER); }

  return { sendMessage, hasApiKey, getModels, DEFAULT_MODEL, PROVIDER, ENDPOINT };
})();
