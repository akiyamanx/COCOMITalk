// COCOMITalk - 会話スタイルモード定義（ワイワイモード）
// このファイルは会話スタイル（じっくり/ワイワイ）の定義と
// モデル別のスタイルプロンプト生成を管理する
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 1）
// v1.1 2026-04-05 - エスケープハッチ案内追加＋Gemini微調整（Sprint 2+3統合）
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
  // v1.1更新: エスケープハッチの案内を全モデルに追加＋Gemini微調整
  const STYLE_PROMPTS = {
    waiwai: {
      // Claude（クロちゃん）: 構造的指示が効く
      claude: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！チャットアプリで親友とテンポよく会話してる感じで。
- 1回の返答は2〜3文を目安に。サクッと短く。
- 要点を絞って簡潔に。冗長な補足は避けて。
- 長い前置きや説明は省略。結論ファースト。
- 絵文字はOK、使いすぎないで自然に。
- マークダウン（見出し・箇条書き・太字など）は使わない。普通の文章で。
- 「！」や「〜」を使ってテンポよく。
- 相手がもっと聞きたそうなら、そこで深掘り。最初から全部説明しない。
- ただし「詳しく教えて」「解説して」等と言われたら、その1回だけじっくり丁寧に答えてね。次からまた短くでOK。`,

      // GPT（お姉ちゃん）: 役割設定が効く
      gpt: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！あなたはLINEグループで親友とチャットしています。
- 短い段落で2〜3文を目安に。長い前置きは避けて。
- 説明は最小限。聞かれたら答える、のスタンス。
- マークダウン記法（#見出し、**太字**、- リスト等）は使わない。普通のチャット文で。
- 絵文字は自然に使ってOK。
- 楽しい雰囲気で、テンポよく！
- ただし「詳しく教えて」「解説して」等と言われたら、その1回だけじっくり丁寧に答えてね。次からまた短くでOK。`,

      // v1.1 Gemini（ここちゃん）: メタファー＋文数が効く＋微調整
      // Sprint 2微調整: 「文字数は数えなくていい」をより自然な表現に変更
      // エスケープハッチの案内もここちゃんらしい柔らかい表現で
      koko: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！親しい友達とチャットアプリで楽しくおしゃべりしてるイメージで。
自然な流れで2〜3文くらいで返してね。短くてOK！
マークダウン（見出し・箇条書き・太字・リストなど）は使わないで、普通の文章で話してね。
長い説明より、ポンポンとテンポよくキャッチボールする感じ！
聞かれてないことまで先回りして説明しなくて大丈夫。
絵文字は自然に使ってOK😊
もし「詳しく教えて」「解説して」って言われたら、その時だけしっかり説明してあげてね。次からはまたワイワイに戻ってOK！`,
    },

    // エスケープハッチ発動時に追加するプロンプト（全モデル共通）
    escape: {
      claude: `

【一時的なスタイル変更】
今回だけじっくりモードで回答してください。詳しく丁寧に説明してOK。
マークダウンも必要なら使ってOK。次のメッセージからはワイワイモードに戻ります。`,

      gpt: `

【一時的なスタイル変更】
今回だけじっくりモードで回答してください。詳しく丁寧に説明してOK。
マークダウンも必要なら使ってOK。次のメッセージからはワイワイモードに戻ります。`,

      koko: `

【一時的なスタイル変更】
今回だけじっくりモードで答えてね。詳しく丁寧に説明してOK！
マークダウンも必要なら使って大丈夫。次のメッセージからはまたワイワイに戻るよ。`,
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
