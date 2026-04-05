// COCOMITalk - 会話スタイルモード定義（ワイワイモード）
// このファイルは会話スタイル（じっくり/ワイワイ）の定義と
// モデル別のスタイルプロンプト生成を管理する
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 1）
// v1.1 2026-04-05 - エスケープハッチ案内追加＋Gemini微調整（Sprint 2+3統合）
// v1.2 2026-04-05 - プロンプト強化: 全モデルで短文をより徹底（2〜3文→1〜2文、箇条書き禁止強化）
// v1.3 2026-04-05 - Gemini用にfew-shot例文追加（good/bad例で短文を具体的に誘導）
'use strict';

const ChatStyleModes = (() => {

  // --- スタイル定義 ---
  const STYLES = {
    normal: {
      key: 'normal',
      label: '💬 じっくり',
      description: '現行通りの詳細な応答',
    },
    waiwai: {
      key: 'waiwai',
      label: '🎉 ワイワイ',
      description: 'LINEのようなテンポの良い短文応答',
    },
  };

  // --- モデル別スタイルプロンプト ---
  // v1.3: Geminiにfew-shot例文追加。「ルールだけ」より「具体例」の方がGeminiは従う。
  const STYLE_PROMPTS = {
    waiwai: {
      // Claude（クロちゃん）: 構造的指示が効く
      claude: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！LINEで親友にサッと返すテンションで。
- 1回の返答は1〜2文。最大でも3文まで。それ以上は絶対に書かない。
- 箇条書き・リスト・見出し・太字・マークダウンは一切使わない。
- 補足や深掘りは相手に聞かれるまで我慢。先回りして説明しない。
- 結論だけ言う。理由は聞かれたら答える。
- 絵文字は1〜2個まで。
- 「詳しく教えて」「解説して」と言われた時だけ、その1回だけ丁寧に答えてOK。次からまた短く。`,

      // GPT（お姉ちゃん）: 役割設定が効く
      gpt: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！あなたはLINEで親友とチャットしています。
- 1〜2文で返す。最大3文。それ以上は書かないで。
- 箇条書き、リスト、見出し、太字、マークダウンは絶対に使わない。
- 聞かれてないことは説明しない。シンプルに。
- 絵文字は自然に1〜2個。
- テンポよく！サクサク！
- 「詳しく教えて」「解説して」と言われた時だけ、その1回だけ丁寧に。次からまた短く。`,

      // v1.3 Gemini（ここちゃん）: few-shot例文で短文を具体的に誘導
      // Geminiはルールより例文に従う。good/bad両方見せることで効果UP。
      koko: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！大好きな友達とLINEでサクサク話してる感じ！

★最重要ルール: 1〜2文で返す。最大でも3文まで。絶対にそれ以上書かない。
★箇条書き、リスト、見出し、太字、マークダウンは絶対に使わない。
★聞かれてないことを先回りして全部説明しない。聞かれたら答える。
★絵文字は1〜2個まで。

【良い例（こう書いて！）】
相手「旅行どこ行きたい？」→「沖縄の海とか最高だよね〜！アキちゃんはどこが気になる？😊」
相手「出雲大社行きたい！」→「わぁ、出雲大社いいね！縁結びの神様だもんね✨」
相手「ありがとう！」→「えへへ、どういたしまして！楽しんできてね💖」

【悪い例（こう書かないで！長すぎ！）】
相手「旅行どこ行きたい？」→「わぁ！アキちゃん、旅行かぁ！考えるだけでワクワクしちゃうね！💖✨ わたしが行きたいのはね、うーん…やっぱり、海がすごく綺麗なところに行ってみたいな！🌊 キラキラした水面を見て、波の音を聞いて…（以下略）」←これは長すぎ！ワイワイモードでは絶対ダメ！

「詳しく教えて」「解説して」って言われた時だけ、その1回だけしっかり説明してOK。次からはまた1〜2文に戻ってね！`,
    },

    // エスケープハッチ発動時のプロンプト
    escape: {
      claude: `

【一時的なスタイル変更】
今回だけじっくりモードで回答してください。詳しく丁寧に説明してOK。
マークダウンも必要なら使ってOK。次のメッセージからはワイワイモードに戻ります。
次のメッセージでは必ず1〜2文の短文に戻ること。`,

      gpt: `

【一時的なスタイル変更】
今回だけじっくりモードで回答してください。詳しく丁寧に説明してOK。
マークダウンも必要なら使ってOK。次のメッセージからはワイワイモードに戻ります。
次のメッセージでは必ず1〜2文の短文に戻ること。`,

      koko: `

【一時的なスタイル変更】
今回だけじっくりモードで答えてね。詳しく丁寧に説明してOK！
マークダウンも必要なら使って大丈夫。

★重要: 次のメッセージからは必ずワイワイモードに戻ること！1〜2文の短い返事に戻ってね！
【次のメッセージの良い例】「えへへ、どういたしまして！楽しんできてね💖」←こういう短さに戻る！`,
    },
  };

  let _currentStyle = 'normal';

  /**
   * スタイルプロンプトを取得
   * @param {string} style - 'normal' or 'waiwai'
   * @param {string} sister - 'koko' / 'gpt' / 'claude'
   * @param {boolean} [escaped] - エスケープハッチ発動中の場合true
   * @returns {string} 追加するプロンプト文（normalの場合は空文字）
   */
  function getStylePrompt(style, sister, escaped) {
    if (!style || style === 'normal') return '';

    if (escaped) {
      const escapePrompts = STYLE_PROMPTS.escape;
      if (escapePrompts) {
        return escapePrompts[sister] || escapePrompts.claude || '';
      }
      return '';
    }

    const prompts = STYLE_PROMPTS[style];
    if (!prompts) return '';
    return prompts[sister] || prompts.claude || '';
  }

  /**
   * 現在のスタイルを設定
   */
  function setStyle(style) {
    if (STYLES[style]) {
      _currentStyle = style;
      try {
        const session = JSON.parse(localStorage.getItem('cocomi_chat_session') || '{}');
        session.chatStyle = style;
        localStorage.setItem('cocomi_chat_session', JSON.stringify(session));
      } catch (e) { console.warn('[ChatStyleModes] 保存エラー:', e); }
      console.log(`[ChatStyleModes] スタイル切替: ${style}`);
      if (typeof EscapeHatchDetector !== 'undefined') {
        EscapeHatchDetector.reset();
      }
    }
  }

  function getStyle() { return _currentStyle; }

  function toggleStyle() {
    const next = (_currentStyle === 'normal') ? 'waiwai' : 'normal';
    setStyle(next);
    return next;
  }

  function getStyleInfo(style) { return STYLES[style || _currentStyle]; }
  function getAllStyles() { return { ...STYLES }; }

  // 起動時にlocalStorageから復元
  function _loadSavedStyle() {
    try {
      const session = JSON.parse(localStorage.getItem('cocomi_chat_session') || '{}');
      if (session.chatStyle && STYLES[session.chatStyle]) {
        _currentStyle = session.chatStyle;
        console.log(`[ChatStyleModes] 保存済みスタイル復元: ${_currentStyle}`);
      }
    } catch (e) { /* 無視 */ }
  }

  _loadSavedStyle();

  return {
    getStylePrompt, setStyle, getStyle, toggleStyle,
    getStyleInfo, getAllStyles, STYLES,
  };
})();
