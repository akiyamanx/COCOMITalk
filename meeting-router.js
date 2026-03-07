// COCOMITalk - 会議ルーター（議題分析＋動的ルーティング）
// このファイルは議題を分析して三姉妹の発言順と主担当を動的に決定する
// v0.8 Step 3 - 新規作成

'use strict';

/**
 * 会議ルーターモジュール
 * - 議題テキストをGemini Flash（最安）で分析
 * - カテゴリに応じて主担当＋発言順を決定
 * - フォールバック: API失敗時はデフォルト順（ここ→お姉→クロ）
 */
const MeetingRouter = (() => {

  // --- カテゴリ定義 ---
  const CATEGORIES = {
    'ui-design': {
      label: 'UI/デザイン/画像',
      lead: 'koko',
      order: ['koko', 'claude', 'gpt'],
      reason: 'ここちゃんが画像生成（NanoBanana）やUXデザインに強い',
    },
    'tech-safety': {
      label: '技術/安全/バグ',
      lead: 'claude',
      order: ['claude', 'koko', 'gpt'],
      reason: 'クロちゃんがコーディング精度とセキュリティ判断に強い',
    },
    'strategy': {
      label: '戦略/計画/構造',
      lead: 'gpt',
      order: ['gpt', 'koko', 'claude'],
      reason: 'お姉ちゃんが全体俯瞰と戦略立案に強い',
    },
    'ux-empathy': {
      label: 'ユーザー体験/共感',
      lead: 'koko',
      order: ['koko', 'gpt', 'claude'],
      reason: 'ここちゃんがユーザー視点とReflectに強い',
    },
    'general': {
      label: '汎用/総合',
      lead: 'koko',
      order: ['koko', 'gpt', 'claude'],
      reason: 'デフォルト順（White→Blue→Red）',
    },
  };

  // --- デフォルト順 ---
  const DEFAULT_ORDER = ['koko', 'gpt', 'claude'];
  const DEFAULT_LEAD = 'koko';

  // --- 議題分析用プロンプト ---
  const ANALYSIS_PROMPT = `あなたは議題の分類AIです。以下の議題を1つのカテゴリに分類してください。

カテゴリ:
- ui-design: UI、デザイン、画像、色、レイアウト、フォント、画面設計、NanoBanana、見た目に関する議題
- tech-safety: コード、バグ修正、API、データベース、セキュリティ、パフォーマンス、技術的な実装に関する議題
- strategy: 事業戦略、計画、スケジュール、方針、アーキテクチャ設計、全体構造に関する議題
- ux-empathy: 使いやすさ、UX、ユーザーの気持ち、アクセシビリティ、体験設計に関する議題
- general: 上記に当てはまらない、または複数にまたがる議題

JSONのみ返してください。他のテキストは不要です。
{"category": "カテゴリ名"}`;

  /**
   * 議題を分析して発言順を決定
   * @param {string} topic - アキヤが入力した議題テキスト
   * @returns {Promise<Object>} { category, lead, order, reason }
   */
  async function analyzeTopic(topic) {
    try {
      // まずローカルキーワードマッチを試みる（API節約）
      const localResult = _localAnalysis(topic);
      if (localResult.confidence === 'high') {
        console.log(`[MeetingRouter] ローカル分析: ${localResult.category}（高確度）`);
        return _buildResult(localResult.category);
      }

      // ローカルで判断つかない場合はAPI分析
      const apiResult = await _apiAnalysis(topic);
      return apiResult;

    } catch (error) {
      console.warn('[MeetingRouter] 分析エラー、デフォルト順を使用:', error);
      return _buildResult('general');
    }
  }

  /**
   * ローカルキーワードマッチ（API呼び出し不要の高速判定）
   */
  function _localAnalysis(topic) {
    const lower = topic.toLowerCase();

    // v0.8 - キーワードベースの簡易分類
    const patterns = {
      'ui-design': [
        'ui', 'デザイン', '画像', '色', 'レイアウト', 'フォント', '画面',
        'アイコン', 'css', 'スタイル', 'ボタン', '見た目', 'nanobanana',
        'ロゴ', 'イラスト', '配色', 'テーマ',
      ],
      'tech-safety': [
        'バグ', 'エラー', 'コード', 'api', 'db', 'データベース',
        'セキュリティ', 'パフォーマンス', '修正', 'デバッグ', 'テスト',
        '実装', 'worker', 'cors', '認証', 'トークン',
      ],
      'strategy': [
        '戦略', '計画', 'スケジュール', '方針', 'ロードマップ',
        'アーキテクチャ', '構造', '設計思想', '優先順位', '予算',
        'コスト', 'ビジネス', '事業',
      ],
      'ux-empathy': [
        '使いやすさ', 'ux', 'ユーザー', '体験', 'アクセシビリティ',
        '初心者', '直感的', '操作', 'わかりにくい', '迷う',
      ],
    };

    let bestCategory = 'general';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(patterns)) {
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    // 2つ以上のキーワードマッチで高確度
    const confidence = bestScore >= 2 ? 'high' : (bestScore === 1 ? 'medium' : 'low');

    return { category: bestCategory, confidence, score: bestScore };
  }

  /**
   * Gemini Flash APIで議題分析（ローカルで判断つかない時のみ）
   */
  async function _apiAnalysis(topic) {
    // ApiGeminiが使えない場合はデフォルト
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) {
      return _buildResult('general');
    }

    try {
      const body = {
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: topic }] }],
        systemInstruction: { parts: [{ text: ANALYSIS_PROMPT }] },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50,
        },
      };

      const data = await ApiCommon.callAPI('gemini', body);

      // レスポンスからJSON抽出
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const category = parsed.category || 'general';

        // トークン記録（分析コストも可視化）
        const usage = data?.usageMetadata;
        if (usage && typeof TokenMonitor !== 'undefined') {
          TokenMonitor.record('gemini-2.5-flash',
            usage.promptTokenCount || 0,
            usage.candidatesTokenCount || 0);
        }

        console.log(`[MeetingRouter] API分析: ${category}`);
        return _buildResult(CATEGORIES[category] ? category : 'general');
      }

      return _buildResult('general');

    } catch (error) {
      console.warn('[MeetingRouter] API分析失敗:', error);
      return _buildResult('general');
    }
  }

  /**
   * カテゴリから結果オブジェクトを構築
   */
  function _buildResult(categoryKey) {
    const cat = CATEGORIES[categoryKey] || CATEGORIES.general;
    return {
      category: categoryKey,
      label: cat.label,
      lead: cat.lead,
      order: [...cat.order],
      reason: cat.reason,
    };
  }

  /**
   * カテゴリ一覧を取得（UI表示用）
   */
  function getCategories() {
    return { ...CATEGORIES };
  }

  return {
    analyzeTopic,
    getCategories,
    DEFAULT_ORDER,
    DEFAULT_LEAD,
  };
})();
