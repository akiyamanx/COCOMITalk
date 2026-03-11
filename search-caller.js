// COCOMITalk - 検索呼び出し共通モジュール（Function Calling用）
// このファイルはWorker /search エンドポイントを呼び出す共通関数を提供する
// api-gemini.js / api-openai.js / api-claude.js のFunction Callingから使われる
// search-ui.jsの手動検索とは別に、AIが自動判断で検索する時に使う
// v1.0 2026-03-11 - Phase 2a+ 新規作成
'use strict';

/**
 * 検索呼び出し共通モジュール
 *
 * Function Callingフロー:
 *   1. 各api-*.jsがtoolsを定義してAI APIに送信
 *   2. AIが「検索が必要」と判断 → functionCall/tool_calls/tool_use応答
 *   3. 各api-*.jsがSearchCaller.execute(query)を呼ぶ
 *   4. Worker /searchからBrave Search結果を取得
 *   5. 結果をAI APIに返して最終回答を生成
 *
 * 安全ガイド準拠:
 *   - 1回のメッセージにつき最大1回の検索（ループ防止）
 *   - Brave API月間使用量はUsage Limit $5.00で保護済み
 */
const SearchCaller = (() => {

  /**
   * Function Calling用のツール定義（3社共通の中身）
   * 各api-*.jsがそれぞれのフォーマットに変換して使う
   */
  const TOOL_DEFINITION = {
    name: 'web_search',
    description: 'インターネットでリアルタイム検索する。最新のニュース、人物情報、天気、時事問題など、学習データにない情報が必要な時に使う。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '検索キーワード（日本語OK、最大200文字）',
        },
      },
      required: ['query'],
    },
  };

  /**
   * Worker /search を呼び出して検索結果を取得
   * @param {string} query - 検索キーワード
   * @returns {Promise<string>} 検索結果テキスト（AIに返すフォーマット）
   */
  async function execute(query) {
    if (!query || typeof query !== 'string') {
      return '検索キーワードが空です。';
    }

    // 200文字制限（Worker側でもバリデーションあり）
    const trimmedQuery = query.trim().slice(0, 200);

    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      return '認証トークンが未設定のため検索できません。';
    }

    try {
      const url = `${ApiCommon.getWorkerURL()}/search`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-COCOMI-AUTH': ApiCommon.getAuthToken(),
        },
        body: JSON.stringify({ query: trimmedQuery, count: 5 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[SearchCaller] 検索エラー:', err.error || res.status);
        return `検索エラー: ${err.error || 'HTTP ' + res.status}`;
      }

      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        return `「${trimmedQuery}」の検索結果は見つかりませんでした。`;
      }

      // 検索結果をテキスト形式に変換（AIに渡すフォーマット）
      let resultText = `【検索結果】「${data.query}」（${data.totalCount}件中上位${data.results.length}件）\n`;
      for (const r of data.results) {
        resultText += `\n${r.rank}. ${r.title}\n`;
        resultText += `   ${r.description}\n`;
        resultText += `   URL: ${r.url}\n`;
      }

      console.log(`[SearchCaller] 検索成功: 「${trimmedQuery}」 ${data.results.length}件`);
      return resultText;

    } catch (e) {
      console.error('[SearchCaller] 検索実行エラー:', e);
      return `検索実行エラー: ${e.message}`;
    }
  }

  /**
   * Gemini用のツール定義を取得
   * @returns {Object} Gemini functionDeclarations形式
   */
  function getGeminiTool() {
    return {
      functionDeclarations: [{
        name: TOOL_DEFINITION.name,
        description: TOOL_DEFINITION.description,
        parameters: TOOL_DEFINITION.parameters,
      }],
    };
  }

  /**
   * OpenAI用のツール定義を取得
   * @returns {Object} OpenAI tools形式
   */
  function getOpenAITool() {
    return {
      type: 'function',
      function: {
        name: TOOL_DEFINITION.name,
        description: TOOL_DEFINITION.description,
        parameters: TOOL_DEFINITION.parameters,
      },
    };
  }

  /**
   * Claude用のツール定義を取得
   * @returns {Object} Anthropic tools形式
   */
  function getClaudeTool() {
    return {
      name: TOOL_DEFINITION.name,
      description: TOOL_DEFINITION.description,
      input_schema: TOOL_DEFINITION.parameters,
    };
  }

  return {
    execute,
    getGeminiTool,
    getOpenAITool,
    getClaudeTool,
    TOOL_NAME: TOOL_DEFINITION.name,
  };
})();
