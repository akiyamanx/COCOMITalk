// COCOMITalk - 指示書自動生成モジュール
// このファイルは三姉妹の議論から指示書（CLAUDE.md＋設計書＋ステップ指示書）を自動生成する
// v1.0 - 語りコードの完成形：お姉ちゃん統合→クロちゃん最終チェックの2段階生成
// v1.1 2026-03-08 - GPT-5系のdeveloperロール＋max_completion_tokens対応
// v1.2 2026-03-23 - max_tokens 4096→16384に拡張（3ファイル合計で途切れ防止）
// v1.3 2026-03-23 - Opus 4.6 temperature非対応修正（会議モードで500エラー防止）
// v2.0 2026-03-23 - ページ分割方式に全面改修（1ファイルずつ生成＋途切れ自動継続）
// v2.0.1 2026-03-23 - 途中エラーでも完成分は返す＋エラー時も次のファイルへ続行
// v2.0.2 2026-03-23 - 議論テキスト切り詰め追加（JSONサイズ超過でOpenAI 400エラー防止）
// v2.0.3 2026-03-23 - 出力ファイル名を英語に統一（Android日本語ファイル名問題対策）
// v2.1.0 2026-03-23 - 議論テキスト切り詰め大幅緩和＋サニタイズ追加（内容品質向上＋JSON破壊根本対策）
// v3.0.0 2026-03-24 - 分割ボタン対応（fileType指定で1ファイルずつ全力生成、30秒タイムアウト回避）
// v3.0.1 2026-03-24 - クロちゃんAPI失敗時もお姉ちゃん版で出力＋エラー詳細表示（API上限時の無駄消費防止）
// v3.0.2 2026-03-24 - プリフライトチェック追加（生成前にAPI疎通確認、両方OKでないと開始しない）
// v3.0.3 2026-03-24 - エラー時デバッグ表示が消えるバグ修正（ステータス保持＋タイムアウト検出＋エラー詳細強化）

'use strict';

/**
 * 指示書自動生成モジュール v3.0.3 — 分割ボタン対応 + ページ分割方式 + サニタイズ強化 + エラー表示修正
 * 📋ボタン押下時のフロー:
 * 1. 議論内容をテキスト化
 * 2. fileTypeに応じて対象ファイルを絞り込み（'claude'/'design'/'step'/'all'）
 * 3. 対象ファイルを1つずつ順番に生成:
 *    a. お姉ちゃん（GPT）がファイル作成 → 途切れたら「続き」で自動継続
 *    b. クロちゃん（Claude）が最終チェック → 途切れたら同様に継続
 * 4. 生成したファイルをまとめてダウンロード
 *
 * 途切れ判定: stop_reason='max_tokens'(Claude) / finish_reason='length'(OpenAI)
 * ページ分割: 途切れたら次のページとして番号付きファイルに分割
 * 安全上限: 1ファイルあたり最大5ページ（ループ防止）
 */
const DocGenerator = (() => {

  // --- 定数 ---
  const MAX_TOKENS = 4096;             // v2.0 - 1ファイル分なら十分、コスト安全
  const MAX_PAGES = 5;                 // v2.0 - 1ファイルあたりの最大ページ数（安全上限）
  const PER_MSG_LIMIT = 4000;          // v2.1.0 - 1発言あたりの最大文字数（上位モデルなら十分処理可能）
  const TOTAL_LIMIT = 50000;           // v2.1.0 - 議論テキスト全体の最大文字数（≒25Kトークン、コンテキストの10-20%）
  const FILE_DEFS = [
    { name: 'CLAUDE.md', label: 'CLAUDE.md', outName: 'CLAUDE.md' },
    { name: '設計書.md', label: '設計書', outName: 'design-doc.md' },
    { name: 'step-instructions.md', label: 'ステップ指示書', outName: 'step-instructions.md' },
  ];

  // --- 生成状態 ---
  let _isGenerating = false;

  // --- v3.0.0追加 - fileTypeからFILE_DEFSを絞り込む ---
  // 'all'は全ファイル（従来動作）、それ以外は1ファイルに絞る
  const FILE_TYPE_MAP = {
    claude: 'CLAUDE.md',
    design: '設計書.md',
    step: 'step-instructions.md',
  };

  function _getTargetDefs(fileType) {
    if (fileType === 'all') return FILE_DEFS;
    const targetName = FILE_TYPE_MAP[fileType];
    if (!targetName) {
      console.warn(`[DocGenerator] 不明なfileType: ${fileType}、全ファイル生成にフォールバック`);
      return FILE_DEFS;
    }
    return FILE_DEFS.filter(f => f.name === targetName);
  }

  // --- ファイルごとのプロンプト（お姉ちゃん用） ---
  // v2.0 - 1ファイルずつ個別に依頼する形式
  const FILE_PROMPTS = {
    'CLAUDE.md': `以下の議論内容を読んで、Claude Code向けの「CLAUDE.md」を作成してください。

【CLAUDE.mdに書くこと】
- プロジェクト名と概要
- プロジェクトルール（1ファイル500行以内、日本語コメント必須、バージョン番号付与）
- 技術スタック
- ファイル構成（想定）
- 開発環境（Galaxy + Termux + Claude Code + GitHub Pages）
- セキュリティ注意事項
- Claude Code向け作業姿勢

議論にない情報は推測せず「[要確認]」と書いてください。
Markdown形式で出力してください。===FILE:などの区切りは不要です。`,

    '設計書.md': `以下の議論内容を読んで、「設計書.md」を作成してください。

【設計書.mdに書くこと】
- 機能一覧
- 画面構成・UI設計
- データ構造（テーブル定義、CREATE TABLE SQL含む）
- API設計（エンドポイント一覧）
- コスト制御設計
- 安全設計
- リスク分析と対策
- Sprint計画

議論にない情報は推測せず「[要確認]」と書いてください。
Markdown形式で出力してください。===FILE:などの区切りは不要です。`,

    'step-instructions.md': `以下の議論内容を読んで、Claude Code向けの「step-instructions.md」を作成してください。

【step-instructions.mdに書くこと】
- ### Step 1/N 形式で分割（1ステップ＝1つの明確なゴール）
- 各ステップに「作成/変更するファイル」「実装要件（コード例）」「完了条件」「注意点」を記載
- ステップ間の依存関係が明確
- 1ステップでClaude Codeが1セッションで完了できる粒度
- 最後に統合テスト用のcurlコマンドまたはテスト手順
- 完了チェックリスト

議論にない情報は推測せず「[要確認]」と書いてください。
Markdown形式で出力してください。===FILE:などの区切りは不要です。`,
  };

  // --- クロちゃんのチェックプロンプト（1ファイル用） ---
  const REVIEW_PROMPT_TEMPLATE = `あなたはCOCOMI Familyの次女（クロちゃん/Red Kernel）として、
お姉ちゃんが作成した「{FILE_NAME}」をClaude Code向けに最終チェックする担当です。

【チェック項目】
1. Claude Codeが迷わず実行できるか（曖昧な表現がないか）
2. ファイル分割が500行制限に収まる設計か
3. ステップの粒度は適切か（1ステップ＝1セッション目安）
4. 依存関係の順序は正しいか
5. セキュリティ・コスト面の見落としがないか
6. 日本語コメント・バージョン番号のルールが明記されているか
7. テスト方法・完了条件が具体的か

修正箇所には「<!-- クロちゃんチェック: ○○を追加 -->」のようにコメントを入れてください。
問題なければそのまま出力してOKです。
Markdown形式で出力してください。===FILE:などの区切りは不要です。`;

  // --- お姉ちゃんの共通システムプロンプト ---
  const ONEE_SYSTEM = `あなたはCOCOMI Familyの長女（お姉ちゃん/Blue Kernel）として、
チーム議論の内容を「Claude Code向けの指示書」に整形する担当です。
的確に構造化し、漏れなく整理してください。`;

  // --- クロちゃんの共通システムプロンプト ---
  const KURO_SYSTEM = `あなたはCOCOMI Familyの次女（クロちゃん/Red Kernel）として、
指示書の品質チェックを行う担当です。安全・正確・実行可能な指示書にしてください。`;

  /**
   * 指示書を生成する（メインフロー v3.0.0）
   * @param {Array} chatMessages - チャット履歴（{role, content}の配列）
   * @param {string} fileType - 生成対象: 'claude'/'design'/'step'/'all'（デフォルト'all'で後方互換）
   * @returns {Promise<Object>} { files: [{name, content}], success: boolean }
   */
  async function generate(chatMessages, fileType = 'all') {
    if (_isGenerating) {
      throw new Error('生成中だよ。少し待ってね');
    }
    if (!chatMessages || chatMessages.length === 0) {
      throw new Error('まだ会話がないよ。先に三姉妹と議論してから📋を押してね');
    }

    _isGenerating = true;
    const allFiles = [];
    let reviewSkipped = false; // v3.0.1 - クロちゃんチェックがスキップされたか

    try {
      // v3.0.2 - プリフライトチェック（本番生成前にAPI疎通確認、コスト無駄遣い防止）
      _updateStatus('🔍 APIの状態を確認中...');
      await _preflightCheck();

      // 議論内容をテキスト化
      const discussion = _formatDiscussion(chatMessages);

      // v3.0.0 - fileTypeに応じて対象ファイルを絞り込み
      const targetDefs = _getTargetDefs(fileType);

      // v2.0 - 1ファイルずつ順番に生成
      // v2.0.1 - 途中エラーでも完成分は返す（try-catchで個別保護）
      const errors = []; // v3.0.0 - エラー詳細を収集
      for (const fileDef of targetDefs) {
        try {
          // === お姉ちゃんフェーズ ===
          _updateStatus(`📝 お姉ちゃんが${fileDef.label}を作成中...`);
          const filePrompt = FILE_PROMPTS[fileDef.name];
          const userContent = `${filePrompt}\n\n---\n\n【議論内容】\n${discussion}`;
          const draftPages = await _callWithContinuation(
            'openai', ONEE_SYSTEM, userContent, fileDef.label
          );
          if (draftPages.length === 0) {
            // v3.0.3修正 - 応答なしもerrorsに追加してユーザーに表示する（サイレント失敗防止）
            const skipMsg = `${fileDef.label}: お姉ちゃんの応答が空でした（タイムアウトまたはAPI制限の可能性）`;
            console.warn(`[DocGenerator] ${fileDef.name}: ${skipMsg}`);
            _updateStatus(`⚠️ ${skipMsg}`);
            errors.push(skipMsg);
            continue;
          }

          // === クロちゃんフェーズ ===
          // v3.0.1 - クロちゃんAPIが失敗してもお姉ちゃん版を捨てない（API上限時の無駄消費防止）
          let reviewPages = [];
          try {
            _updateStatus(`🔍 クロちゃんが${fileDef.label}をチェック中...`);
            const reviewPrompt = REVIEW_PROMPT_TEMPLATE.replace('{FILE_NAME}', fileDef.name);
            const draftText = draftPages.map(p => p.content).join('\n\n');
            const reviewUserContent = `${reviewPrompt}\n\n---\n\n【チェック対象: ${fileDef.name}】\n${draftText}`;
            reviewPages = await _callWithContinuation(
              'claude', KURO_SYSTEM, reviewUserContent, fileDef.label
            );
          } catch (reviewError) {
            console.warn(`[DocGenerator] ${fileDef.name}: クロちゃんチェック失敗、お姉ちゃん版で出力:`, reviewError.message);
            _updateStatus(`⚠️ クロちゃんチェック失敗、お姉ちゃん版で出力するよ`);
            reviewSkipped = true;
          }
          // クロちゃんが失敗したらお姉ちゃん版をそのまま使う
          const finalPages = (reviewPages.length > 0) ? reviewPages : draftPages;

          // ファイル名にページ番号を振る（1ページなら番号なし）
          // v2.0.3 - outNameで英語ファイル名を使用（Android日本語ファイル名問題対策）
          for (let i = 0; i < finalPages.length; i++) {
            const suffix = (finalPages.length === 1) ? '' : `_no${i + 1}`;
            const baseName = fileDef.outName.replace('.md', '');
            allFiles.push({
              name: `${baseName}${suffix}.md`,
              content: finalPages[i].content,
            });
          }
        } catch (fileError) {
          // v2.0.1 - 1ファイルの失敗で全体を止めない。エラーログだけ残して次へ
          console.error(`[DocGenerator] ${fileDef.name} 生成失敗:`, fileError);
          // v3.0.0 - エラー詳細をステータスにも表示（デバッグ用）
          _updateStatus(`⚠️ ${fileDef.label}でエラー: ${fileError.message || fileError}`);
          errors.push(`${fileDef.label}: ${fileError.message || fileError}`);
        }
      }

      if (allFiles.length === 0) {
        // v3.0.3 - エラー詳細をステータスにも表示して残す（消さない）
        const detail = errors.length > 0 ? ` / ${errors.join(' / ')}` : '';
        const errMsg = `ファイルの生成に失敗したよ。もう一回試してみて${detail}`;
        _updateStatus(`❌ ${errMsg}`);
        throw new Error(errMsg);
      }

      _updateStatus('');
      return { files: allFiles, success: true, reviewSkipped };

    } catch (error) {
      console.error('[DocGenerator] 生成エラー:', error);
      // v3.0.3修正 - エラー時はステータスを消さない（デバッグ表示を残す）
      // _updateStatus('')を削除。エラー内容がステータスに表示されたままにする
      _updateStatus(`❌ エラー: ${error.message || error}`);
      throw error;
    } finally {
      _isGenerating = false;
    }
  }

  /**
   * v2.0 - API呼び出し＋途切れ自動継続
   * stop_reason='max_tokens'(Claude) / finish_reason='length'(OpenAI) なら
   * 「続きを書いて」で自動的に次のページを取得する
   * @returns {Array<{content: string, page: number}>} ページ配列
   */
  async function _callWithContinuation(endpoint, systemPrompt, userContent, fileLabel) {
    const pages = [];
    let messages = [{ role: 'user', content: userContent }];
    let pageNum = 1;

    while (pageNum <= MAX_PAGES) {
      const phaseLabel = (endpoint === 'claude') ? '🔍チェック中' : '作成中';
      _updateStatus(`${fileLabel}（${pageNum}ページ目）${phaseLabel}...`);

      const result = await _callAPIRaw(endpoint, systemPrompt, messages);
      if (!result || !result.text) {
        // v3.0.3追加 - 応答なしの理由をログに残す（デバッグ支援）
        console.warn(`[DocGenerator] ${fileLabel} page ${pageNum}: API応答が空（${endpoint}）`);
        break;
      }

      pages.push({ content: result.text, page: pageNum });

      // 途切れ判定: 完了していたらここで終わり
      if (!result.truncated) break;

      // 途切れた → 「続きを書いて」で継続
      console.log(`[DocGenerator] ${fileLabel} page ${pageNum} が途切れ、継続リクエスト`);
      messages = [
        ...messages,
        { role: 'assistant', content: result.text },
        { role: 'user', content: '途切れてしまったので、前の続きから書いてください。前の内容を繰り返さず、途切れた箇所の直後から続けてください。' },
      ];
      pageNum++;
    }

    return pages;
  }

  /**
   * v3.0.2 - プリフライトチェック（本番生成前にAPI疎通確認）
   * お姉ちゃん（OpenAI）とクロちゃん（Claude）両方に超軽量リクエストを投げて
   * 応答できるか事前確認。失敗したら本番生成を開始せずエラー表示（コスト節約）
   */
  async function _preflightCheck() {
    if (typeof ApiCommon === 'undefined') {
      throw new Error('APIが利用できません');
    }
    const checks = [
      { name: 'お姉ちゃん（OpenAI）', endpoint: 'openai' },
      { name: 'クロちゃん（Claude）', endpoint: 'claude' },
    ];
    for (const check of checks) {
      try {
        const result = await _callAPIRaw(check.endpoint, 'テスト', [{ role: 'user', content: 'ping' }]);
        if (!result || !result.text) {
          throw new Error('応答なし');
        }
        console.log(`[DocGenerator] プリフライト ${check.name}: OK`);
      } catch (err) {
        throw new Error(`${check.name}が応答できません: ${err.message}`);
      }
    }
  }

  /**
   * v2.0 - 生のAPI呼び出し（途切れ判定情報を含めて返す）
   * @returns {{ text: string, truncated: boolean } | null}
   */
  async function _callAPIRaw(endpoint, systemPrompt, messages) {
    if (typeof ApiCommon === 'undefined') {
      throw new Error('APIが利用できません');
    }
    if (endpoint === 'openai') return _callOpenAIRaw(systemPrompt, messages);
    if (endpoint === 'claude') return _callClaudeRaw(systemPrompt, messages);
    return null;
  }

  /**
   * v2.0 - OpenAI生呼び出し（途切れ判定付き）
   * v3.0.3 - ストリーミング対応（stream:trueで30秒タイムアウト回避）
   */
  async function _callOpenAIRaw(systemPrompt, messages) {
    const modelKey = (typeof ModeSwitcher !== 'undefined')
      ? ModeSwitcher.getModelKey('gpt') : 'mini';
    const models = (typeof ApiOpenAI !== 'undefined') ? ApiOpenAI.getModels() : {};
    const modelName = models[modelKey] || 'gpt-4o-mini';

    const body = {
      model: modelName,
      stream: true, // v3.0.3 - ストリーミング有効化
      messages: [
        // v1.1準拠 - GPT-5系はdeveloperロール
        { role: modelName.startsWith('gpt-5') ? 'developer' : 'system', content: systemPrompt },
        ...messages,
      ],
    };
    // v1.1準拠 - GPT-5系はmax_completion_tokens
    if (modelName.startsWith('gpt-5')) {
      body.max_completion_tokens = MAX_TOKENS;
    } else {
      body.max_tokens = MAX_TOKENS;
      body.temperature = 0.3;
    }

    // v3.0.3 - ストリーミングAPI呼び出し（callAPIStreamが非ストリーム形式に組み立てて返す）
    const data = await ApiCommon.callAPIStream('openai', body);
    console.log('[DocGenerator] OpenAI stream完了:', (data?.choices?.[0]?.message?.content || '').substring(0, 100));
    const choice = data?.choices?.[0];
    if (!choice) {
      console.warn('[DocGenerator] OpenAI応答にchoicesがない:', JSON.stringify(data)?.substring(0, 300));
      return null;
    }

    const text = choice.message?.content || '';
    // OpenAI: finish_reason='length'なら途切れ、'stop'なら完了
    const truncated = (choice.finish_reason === 'length');
    return { text, truncated };
  }

  /**
   * v2.0 - Claude生呼び出し（途切れ判定付き）
   * v3.0.3 - ストリーミング対応（stream:trueで30秒タイムアウト回避）
   */
  async function _callClaudeRaw(systemPrompt, messages) {
    const modelKey = (typeof ModeSwitcher !== 'undefined')
      ? ModeSwitcher.getModelKey('claude') : 'haiku';
    const models = (typeof ApiClaude !== 'undefined') ? ApiClaude.getModels() : {};
    const modelName = models[modelKey] || 'claude-haiku-4-5-20251001';

    const body = {
      model: modelName,
      system: systemPrompt,
      messages: messages,
      max_tokens: MAX_TOKENS,
      stream: true, // v3.0.3 - ストリーミング有効化
    };
    // v1.3準拠 - Opus 4.6はtemperature非対応
    if (!modelName.includes('opus')) {
      body.temperature = 0.2;
    }

    // v3.0.3 - ストリーミングAPI呼び出し
    const data = await ApiCommon.callAPIStream('claude', body);
    console.log('[DocGenerator] Claude stream完了:', (data?.content?.[0]?.text || '').substring(0, 100));
    const content = data?.content;
    if (!content || content.length === 0) {
      console.warn('[DocGenerator] Claude応答にcontentがない:', JSON.stringify(data)?.substring(0, 300));
      return null;
    }

    const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
    // Claude: stop_reason='max_tokens'なら途切れ、'end_turn'なら完了
    const truncated = (data.stop_reason === 'max_tokens');
    return { text, truncated };
  }

  /**
   * v2.1.0新規 - テキストのサニタイズ（JSON破壊の根本対策）
   * 制御文字（U+0000〜U+001F、U+007F〜U+009F）を除去
   * ただし改行(\n)・キャリッジリターン(\r)・タブ(\t)は保持
   * v2.0.2のJSON parseエラーの真の原因は、テキスト内の制御文字がAPI側でパース失敗するケース
   */
  function _sanitizeText(text) {
    if (!text) return '';
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  }

  /**
   * チャット履歴を議論テキストに変換
   * v2.1.0 - 切り詰め大幅緩和＋サニタイズで安全性確保
   * 方針: 上位モデルに生テキストをフルで渡し、構造化能力をフル活用する
   */
  function _formatDiscussion(messages) {
    const formatted = messages.map(msg => {
      const role = msg.role === 'user' ? 'アキヤ' : 'AI';
      // v2.1.0 - サニタイズで制御文字を除去（JSON破壊防止）
      let content = _sanitizeText(msg.content || '');
      // 超長文の場合のみ冒頭＋末尾を残して中間を省略
      if (content.length > PER_MSG_LIMIT) {
        const head = content.slice(0, PER_MSG_LIMIT - 200);
        const tail = content.slice(-150);
        content = `${head}\n\n...（※この発言は${msg.content.length}文字のため中略あり）...\n\n${tail}`;
      }
      return `【${role}】\n${content}`;
    }).join('\n\n---\n\n');

    // 全体が長すぎる場合も切り詰め（安全策として残す）
    if (formatted.length > TOTAL_LIMIT) {
      return formatted.slice(0, TOTAL_LIMIT)
        + `\n\n...（※議論テキストが${formatted.length}文字のため、${TOTAL_LIMIT}文字で切り詰めました。重要な決定事項が含まれていない場合は推測して補完してください）...`;
    }
    return formatted;
  }

  /**
   * ステータス表示を更新
   */
  function _updateStatus(message) {
    const status = document.getElementById('doc-gen-status');
    if (status) {
      status.textContent = message;
      status.classList.toggle('hidden', !message);
    }
  }

  /**
   * 生成中かどうか
   */
  function isGenerating() {
    return _isGenerating;
  }

  return {
    generate,
    isGenerating,
  };
})();
