// COCOMITalk - 指示書自動生成モジュール
// このファイルは三姉妹の議論から指示書（CLAUDE.md＋設計書＋ステップ指示書）を自動生成する
// v1.0 - 語りコードの完成形：お姉ちゃん統合→クロちゃん最終チェックの2段階生成
// v1.1 2026-03-08 - GPT-5系のdeveloperロール＋max_completion_tokens対応
// v1.2 2026-03-23 - max_tokens 4096→16384に拡張（3ファイル合計で途切れ防止）

'use strict';

/**
 * 指示書自動生成モジュール
 * 📋ボタン押下時のフロー:
 * 1. 現在のチャット履歴（議論内容）を収集
 * 2. お姉ちゃん（Blue/統合）に「3ファイルに整形して」と依頼
 * 3. クロちゃん（Red/品質）に「Claude Code向けに最終チェック」と依頼
 * 4. 3ファイルをZIPにまとめてダウンロード
 */
const DocGenerator = (() => {

  // --- 生成状態 ---
  let _isGenerating = false;

  // --- お姉ちゃんへの統合依頼プロンプト ---
  const INTEGRATION_PROMPT = `あなたはCOCOMI Familyの長女（お姉ちゃん/Blue Kernel）として、
チーム議論の内容を「Claude Code向けの指示書」に整形する担当です。

以下の議論内容を読んで、3つのファイルに分けて出力してください。

【出力フォーマット（厳守）】
必ず以下の3つのセクション区切りを使って出力してください:

===FILE:CLAUDE.md===
（ここにCLAUDE.mdの内容）

===FILE:設計書.md===
（ここに設計書の内容）

===FILE:step-instructions.md===
（ここにステップ指示書の内容）

【CLAUDE.mdに書くこと】
- プロジェクト名と概要
- プロジェクトルール（1ファイル500行以内、日本語コメント必須、バージョン番号付与）
- 技術スタック
- ファイル構成（想定）
- 開発環境（Galaxy + Termux + Claude Code + GitHub Pages）

【設計書.mdに書くこと】
- 機能一覧
- 画面構成・UI設計
- データ構造
- API・外部サービス連携
- 技術選定とその理由

【step-instructions.mdに書くこと】
- ### Step 1/N 形式で分割（1ステップ＝1つの明確なゴール）
- 各ステップに「やること」「完了条件」「注意点」を記載
- ステップ間の依存関係が明確
- 1ステップでClaude Codeが1セッションで完了できる粒度

議論にない情報は推測せず「[要確認]」と書いてください。`;

  // --- クロちゃんへの最終チェックプロンプト ---
  const REVIEW_PROMPT = `あなたはCOCOMI Familyの次女（クロちゃん/Red Kernel）として、
お姉ちゃんが作成した指示書をClaude Code向けに最終チェックする担当です。

以下の指示書を確認して、修正版を出力してください。

【チェック項目】
1. Claude Codeが迷わず実行できるか（曖昧な表現がないか）
2. ファイル分割が500行制限に収まる設計か
3. ステップの粒度は適切か（1ステップ＝1セッション目安）
4. 依存関係の順序は正しいか（前のステップが完了しないと次に進めない等）
5. セキュリティ・コスト面の見落としがないか
6. 日本語コメント・バージョン番号のルールが明記されているか
7. テスト方法・完了条件が具体的か

【出力フォーマット（厳守）】
修正した3ファイルを同じフォーマットで出力:

===FILE:CLAUDE.md===
（修正後のCLAUDE.md）

===FILE:設計書.md===
（修正後の設計書.md）

===FILE:step-instructions.md===
（修正後のstep-instructions.md）

修正箇所には「// クロちゃんチェック: ○○を追加」のようにコメントを入れてください。
問題なければそのまま出力してOKです。`;

  /**
   * 指示書を生成する（メインフロー）
   * @param {Array} chatMessages - チャット履歴（{role, content}の配列）
   * @returns {Promise<Object>} { files: [{name, content}], success: boolean }
   */
  async function generate(chatMessages) {
    if (_isGenerating) {
      throw new Error('生成中だよ。少し待ってね');
    }
    if (!chatMessages || chatMessages.length === 0) {
      throw new Error('まだ会話がないよ。先に三姉妹と議論してから📋を押してね');
    }

    _isGenerating = true;
    _updateStatus('お姉ちゃんが指示書を作成中... 📝');

    try {
      // 議論内容をテキスト化
      const discussion = _formatDiscussion(chatMessages);

      // Step 1: お姉ちゃん（GPT）に統合依頼
      const gptResult = await _callAPI('openai', INTEGRATION_PROMPT, discussion);
      if (!gptResult) throw new Error('お姉ちゃんの応答が取得できなかった');

      _updateStatus('クロちゃんが最終チェック中... 🔍');

      // Step 2: クロちゃん（Claude）に最終チェック依頼
      const claudeResult = await _callAPI('claude', REVIEW_PROMPT, gptResult);
      const finalResult = claudeResult || gptResult; // Claudeが失敗したらGPT版を使う

      // Step 3: 結果を3ファイルにパース
      const files = _parseFiles(finalResult);
      if (files.length === 0) {
        throw new Error('ファイルの解析に失敗したよ。もう一回試してみて');
      }

      _updateStatus('');
      return { files, success: true };

    } catch (error) {
      console.error('[DocGenerator] 生成エラー:', error);
      _updateStatus('');
      throw error;
    } finally {
      _isGenerating = false;
    }
  }

  /**
   * チャット履歴を議論テキストに変換
   */
  function _formatDiscussion(messages) {
    return messages.map(msg => {
      const role = msg.role === 'user' ? 'アキヤ' : 'AI';
      return `【${role}】\n${msg.content}`;
    }).join('\n\n---\n\n');
  }

  /**
   * API呼び出し（Worker経由）
   */
  async function _callAPI(endpoint, systemPrompt, userContent) {
    if (typeof ApiCommon === 'undefined') {
      throw new Error('APIが利用できません');
    }

    // モードに応じたモデルを使用（dev/meetingなら上位モデル）
    const mode = (typeof ModeSwitcher !== 'undefined') ? ModeSwitcher.getMode() : 'normal';

    if (endpoint === 'openai') {
      // お姉ちゃん用リクエスト
      const modelKey = (typeof ModeSwitcher !== 'undefined')
        ? ModeSwitcher.getModelKey('gpt') : 'mini';
      const models = (typeof ApiOpenAI !== 'undefined') ? ApiOpenAI.getModels() : {};
      const modelName = models[modelKey] || 'gpt-4o-mini';
      const body = {
        model: modelName,
        messages: [
          // v1.1修正 - GPT-5系はdeveloperロール
          { role: modelName.startsWith('gpt-5') ? 'developer' : 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      };
      // v1.1修正 - GPT-5系はmax_completion_tokens（リーズニングトークン対策）
      // v1.2修正 - 16384に拡張（3ファイル合計で途切れ防止）
      if (modelName.startsWith('gpt-5')) {
        body.max_completion_tokens = 16384;
      } else {
        body.max_tokens = 16384;
        body.temperature = 0.3;
      }
      const data = await ApiCommon.callAPI('openai', body);
      return data?.choices?.[0]?.message?.content || null;
    }

    if (endpoint === 'claude') {
      // クロちゃん用リクエスト
      const modelKey = (typeof ModeSwitcher !== 'undefined')
        ? ModeSwitcher.getModelKey('claude') : 'haiku';
      const models = (typeof ApiClaude !== 'undefined') ? ApiClaude.getModels() : {};
      const modelName = models[modelKey] || 'claude-haiku-4-5-20251001';
      const body = {
        model: modelName,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: 16384,  // v1.2修正 - 3ファイル合計で途切れ防止
        temperature: 0.2,
      };
      const data = await ApiCommon.callAPI('claude', body);
      const content = data?.content;
      if (content && content.length > 0) {
        return content.filter(b => b.type === 'text').map(b => b.text).join('');
      }
      return null;
    }

    return null;
  }

  /**
   * API応答を3ファイルにパース
   */
  function _parseFiles(text) {
    const files = [];
    const fileNames = ['CLAUDE.md', '設計書.md', 'step-instructions.md'];

    for (let i = 0; i < fileNames.length; i++) {
      const name = fileNames[i];
      const marker = `===FILE:${name}===`;
      const startIdx = text.indexOf(marker);
      if (startIdx === -1) continue;

      const contentStart = startIdx + marker.length;
      // 次のマーカーまで or 末尾まで
      const nextMarkerIdx = (i < fileNames.length - 1)
        ? text.indexOf(`===FILE:${fileNames[i + 1]}===`, contentStart)
        : -1;
      const contentEnd = (nextMarkerIdx !== -1) ? nextMarkerIdx : text.length;
      const content = text.substring(contentStart, contentEnd).trim();

      if (content) {
        files.push({ name, content });
      }
    }

    return files;
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
