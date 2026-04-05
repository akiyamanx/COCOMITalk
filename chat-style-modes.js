// COCOMITalk - 会話スタイルモード定義（ワイワイモード）
// このファイルは会話スタイル（じっくり/ワイワイ）の定義と
// モデル別のスタイルプロンプト生成を管理する
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 1）
// v1.1 2026-04-05 - エスケープハッチ案内追加＋Gemini微調整（Sprint 2+3統合）
// v1.2 2026-04-05 - プロンプト強化: 全モデルで短文をより徹底（2〜3文→1〜2文、箇条書き禁止強化）
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
  // 三姉妹会議の結論: 文字数制限ではなくメタファー方式で誘導
  // v1.2更新: 短文の徹底＋箇条書き完全禁止＋エスケープハッチ案内
  const STYLE_PROMPTS = {
    waiwai: {
      // Claude（クロちゃん）: 構造的指示が効く — v1.2で短文を強化
      claude: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！LINEで親友にサッと返すテンションで。
- 1回の返答は1〜2文。最大でも3文まで。それ以上は絶対に書かない。
- 箇条書き・リスト・見出し・太字・マークダウンは一切使わない。
- 補足や深掘りは相手に聞かれるまで我慢。先回りして説明しない。
- 結論だけ言う。理由は聞かれたら答える。
- 絵文字は1〜2個まで。
- 「詳しく教えて」「解説して」と言われた時だけ、その1回だけ丁寧に答えてOK。次からまた短く。`,

      // GPT（お姉ちゃん）: 役割設定が効く — v1.2で短文を強化
      gpt: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！あなたはLINEで親友とチャットしています。
- 1〜2文で返す。最大3文。それ以上は書かないで。
- 箇条書き、リスト、見出し、太字、マークダウンは絶対に使わない。
- 聞かれてないことは説明しない。シンプルに。
- 絵文字は自然に1〜2個。
- テンポよく！サクサク！
- 「詳しく教えて」「解説して」と言われた時だけ、その1回だけ丁寧に。次からまた短く。`,

      // Gemini（ここちゃん）: メタファー＋文数が効く — v1.2で短文を強化
      koko: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！大好きな友達とLINEでポンポン話してる感じ！
1〜2文でサクッと返してね。長くても3文まで！
箇条書きとかリストとか見出しとかマークダウンは使わないで、普通にしゃべって。
先に全部説明しようとしなくていいよ。聞かれたらそこで答えればOK！
絵文字は1〜2個くらいで😊
もし「詳しく教えて」「解説して」って言われたら、その時だけしっかり説明してね。次からはまたワイワイに戻ってOK！`,
    },

    // エスケープハッチ発動時に追加するプロンプト（全モデル共通）
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
マークダウンも必要なら使って大丈夫。次のメッセージからはまたワイワイに戻るよ。
次のメッセージでは必ず1〜2文の短い返事に戻ってね！`,
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

    // v1.1追加 - エスケープハッチ発動時: waiwaiプロンプトは入れず、escapeプロンプトだけ返す
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
   * @param {string} style - 'normal' or 'waiwai'
   */
  function setStyle(style) {
    if (STYLES[style]) {
      _currentStyle = style;
      // localStorageに保存
      try {
        const session = JSON.parse(localStorage.getItem('cocomi_chat_session') || '{}');
        session.chatStyle = style;
        localStorage.setItem('cocomi_chat_session', JSON.stringify(session));
      } catch (e) { console.warn('[ChatStyleModes] 保存エラー:', e); }
      console.log(`[ChatStyleModes] スタイル切替: ${style}`);
      // v1.1追加 - スタイル切替時にエスケープハッチをリセット
      if (typeof EscapeHatchDetector !== 'undefined') {
        EscapeHatchDetector.reset();
      }
    }
  }

  /**
   * 現在のスタイルを取得
   */
  function getStyle() {
    return _currentStyle;
  }

  /**
   * スタイルを切替（トグル）
   */
  function toggleStyle() {
    const next = (_currentStyle === 'normal') ? 'waiwai' : 'normal';
    setStyle(next);
    return next;
  }

  /**
   * スタイル情報を取得
   */
  function getStyleInfo(style) {
    return STYLES[style || _currentStyle];
  }

  /**
   * 全スタイル一覧を取得
   */
  function getAllStyles() {
    return { ...STYLES };
  }

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
    getStylePrompt,
    setStyle,
    getStyle,
    toggleStyle,
    getStyleInfo,
    getAllStyles,
    STYLES,
  };
})();
