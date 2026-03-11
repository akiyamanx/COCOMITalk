// COCOMITalk - ツールレジストリ（Function Calling用ツール一元管理）
// このファイルは全ツール定義・3社フォーマット変換・実行振り分けを一元管理する
// search-caller.jsと連携し、新ツール追加はこのファイルに定義を足すだけでOK
// v1.0 2026-03-11 - Phase 2c 新規作成（web_search + get_datetime + calculate）
'use strict';

/**
 * ツールレジストリモジュール
 *
 * 責務:
 *   1. 全ツールの定義を保持（名前・説明・パラメータ）
 *   2. 3社（Gemini/OpenAI/Claude）のフォーマットに変換
 *   3. ツール名から実行関数を呼び出す振り分け
 *
 * 新ツール追加手順:
 *   ① TOOLS配列にツール定義を追加
 *   ② executorsオブジェクトに実行関数を追加
 *   → 3社のフォーマット変換は自動！api-*.jsの変更不要！
 *
 * 安全ガイド準拠:
 *   - 1メッセージにつきツール呼び出しは最大1回（各api-*.jsのループ防止で担保）
 *   - get_datetime / calculate はAPI呼び出しなし（コスト0）
 */
const ToolRegistry = (() => {

  // =========================================
  // ツール定義（共通フォーマット）
  // =========================================

  const TOOLS = [
    {
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
    },
    {
      name: 'get_datetime',
      description: '現在の正確な日本時間（JST）を取得する。今日の日付、現在時刻、曜日、年月日を正確に知りたい時に必ず使う。「今何時？」「今日は何曜日？」「今日の日付は？」「今日は何日？」などの質問では、自分の知識で答えずに必ずこのツールを使って正確な時刻を取得すること。AIの学習データの日時は古いため、このツールなしでは正確な現在時刻を答えられない。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'calculate',
      description: '数式を正確に計算する。四則演算、べき乗、平方根、三角関数、対数など数学的な計算を正確に行う時に使う。「123 × 456は？」「消費税10%込みの金額は？」「割り勘でいくら？」などの計算問題では、暗算せずにこのツールを使って正確な結果を返すこと。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '計算式（JavaScript式形式。例: "123 * 456", "Math.sqrt(144)", "(1500 * 1.1)"）',
          },
        },
        required: ['expression'],
      },
    },
  ];

  // =========================================
  // ツール実行関数
  // =========================================

  const executors = {
    /**
     * web_search — SearchCallerに委譲（既存の検索機能を流用）
     */
    async web_search(args) {
      if (typeof SearchCaller === 'undefined') {
        return '検索モジュールが読み込まれていないため検索できません。';
      }
      return await SearchCaller.execute(args?.query || '');
    },

    /**
     * get_datetime — 現在の日本時間を返す（API呼び出しなし・コスト0）
     * v1.0.1修正 — toLocaleStringでJST確実取得（UTC+9手動計算のバグ修正）
     */
    async get_datetime(_args) {
      try {
        const now = new Date();

        // Intl.DateTimeFormatで確実にJST取得
        const jstOptions = { timeZone: 'Asia/Tokyo' };
        const year = now.toLocaleString('en', { ...jstOptions, year: 'numeric' });
        const month = now.toLocaleString('en', { ...jstOptions, month: 'numeric' });
        const day = now.toLocaleString('en', { ...jstOptions, day: 'numeric' });
        const weekday = now.toLocaleString('ja', { ...jstOptions, weekday: 'short' });
        const hours = now.toLocaleString('en', { ...jstOptions, hour: '2-digit', hour12: false });
        const minutes = now.toLocaleString('en', { ...jstOptions, minute: '2-digit' });
        const seconds = now.toLocaleString('en', { ...jstOptions, second: '2-digit' });

        // 0埋め
        const hh = hours.padStart(2, '0');
        const mm = minutes.padStart(2, '0');
        const ss = seconds.padStart(2, '0');

        return `【現在の日本時間（JST・UTC+9）】\n` +
          `日付: ${year}年${month}月${day}日（${weekday}曜日）\n` +
          `時刻: ${hh}時${mm}分${ss}秒\n` +
          `※この情報はユーザーの端末から取得した正確な現在時刻です。AIの学習データの日時ではありません。`;
      } catch (e) {
        return `日時取得エラー: ${e.message}`;
      }
    },

    /**
     * calculate — 安全な数式計算（API呼び出しなし・コスト0）
     * 許可: 数値、四則演算、Math関数、括弧
     * 禁止: 変数代入、関数定義、eval攻撃
     */
    async calculate(args) {
      const expr = args?.expression;
      if (!expr || typeof expr !== 'string') {
        return '計算式が空です。';
      }

      // 安全チェック: 許可するパターンのみ通す
      const sanitized = expr.trim().slice(0, 500);

      // 危険なパターンを拒否
      const dangerous = /[;={}\[\]`'"\\]|function|var |let |const |import|require|fetch|eval|alert|document|window|this/i;
      if (dangerous.test(sanitized)) {
        return `計算エラー: 安全でない式が含まれています。数値と演算子のみ使えます。`;
      }

      // 許可するパターン: 数値、演算子、括弧、Math関数、小数点、スペース
      const allowed = /^[\d\s+\-*/().%^,eE]+$|Math\.(sqrt|pow|abs|ceil|floor|round|log|log10|sin|cos|tan|PI|E|min|max)/;
      // Math関数を含む場合、または純粋な数式の場合のみ許可
      const hasMath = /Math\./.test(sanitized);
      const pureCalc = /^[\d\s+\-*/().%^eE]+$/.test(sanitized);

      if (!hasMath && !pureCalc) {
        return `計算エラー: 計算式として認識できません。数値と演算子（+, -, *, /, (, )）またはMath関数を使ってください。`;
      }

      try {
        // ^をMath.powに変換（べき乗サポート）
        const processed = sanitized.replace(/(\d+(?:\.\d+)?)\s*\^\s*(\d+(?:\.\d+)?)/g, 'Math.pow($1,$2)');
        // Function構文で安全に評価（グローバル汚染なし）
        const result = new Function('Math', `'use strict'; return (${processed});`)(Math);

        if (typeof result !== 'number' || !isFinite(result)) {
          return `計算結果が数値になりませんでした（結果: ${result}）。式を確認してください。`;
        }

        // 整数ならそのまま、小数なら適切な桁数で表示
        const formatted = Number.isInteger(result) ? result.toString() : result.toPrecision(10).replace(/\.?0+$/, '');

        return `【計算結果】\n` +
          `式: ${sanitized}\n` +
          `結果: ${formatted}`;
      } catch (e) {
        return `計算エラー: ${e.message}。式を確認してください。`;
      }
    },
  };

  // =========================================
  // 3社フォーマット変換
  // =========================================

  /**
   * Gemini用のツール定義を取得
   * @returns {Object} Gemini tools形式（functionDeclarations配列）
   */
  function getGeminiTools() {
    return {
      functionDeclarations: TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };
  }

  /**
   * OpenAI用のツール定義を取得
   * @returns {Array} OpenAI tools配列
   */
  function getOpenAITools() {
    return TOOLS.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Claude用のツール定義を取得
   * @returns {Array} Anthropic tools配列
   */
  function getClaudeTools() {
    return TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  // =========================================
  // ツール実行
  // =========================================

  /**
   * ツール名から実行関数を呼び出す
   * @param {string} name - ツール名（web_search / get_datetime / calculate）
   * @param {Object} args - ツール引数
   * @returns {Promise<string>} ツール実行結果テキスト
   */
  async function execute(name, args) {
    const executor = executors[name];
    if (!executor) {
      console.warn(`[ToolRegistry] 未知のツール: ${name}`);
      return `未知のツール「${name}」が呼ばれました。`;
    }
    console.log(`[ToolRegistry] ツール実行: ${name}(${JSON.stringify(args)})`);
    return await executor(args);
  }

  /**
   * 登録済みツール名の一覧を取得
   * @returns {Array<string>}
   */
  function getToolNames() {
    return TOOLS.map(t => t.name);
  }

  /**
   * 指定ツール名が登録済みか確認
   * @param {string} name
   * @returns {boolean}
   */
  function hasTool(name) {
    return !!executors[name];
  }

  return {
    execute,
    getGeminiTools,
    getOpenAITools,
    getClaudeTools,
    getToolNames,
    hasTool,
  };
})();
