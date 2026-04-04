// COCOMITalk - 会話スタイルモード定義（ワイワイモード）
// このファイルは会話スタイル（じっくり/ワイワイ）の定義と
// モデル別のスタイルプロンプト生成を管理する
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 1）
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
- 相手がもっと聞きたそうなら、そこで深掘り。最初から全部説明しない。`,

      // GPT（お姉ちゃん）: 役割設定が効く
      gpt: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！あなたはLINEグループで親友とチャットしています。
- 短い段落で2〜3文を目安に。長い前置きは避けて。
- 説明は最小限。聞かれたら答える、のスタンス。
- マークダウン記法（#見出し、**太字**、- リスト等）は使わない。普通のチャット文で。
- 絵文字は自然に使ってOK。
- 楽しい雰囲気で、テンポよく！`,

      // Gemini（ここちゃん）: メタファー＋文数が効く
      koko: `

【以下は出力スタイルの補足指示です。上記の役割・安全ルール・人格設定はすべて維持してください】

今はワイワイモード！親しい友達とチャットアプリで会話してるイメージで。
文字数は数えなくていいよ。2〜3文程度で自然に返してね。
マークダウン（見出し・箇条書き・太字・リストなど）は使わないで、普通の文章で話してね。
長い説明より、ポンポンとテンポよくキャッチボールする感じ！
聞かれてないことまで先回りして説明しなくて大丈夫。
絵文字は自然に使ってOK😊`,
    },
  };

  let _currentStyle = 'normal';

  /**
   * スタイルプロンプトを取得
   * @param {string} style - 'normal' or 'waiwai'
   * @param {string} sister - 'koko' / 'gpt' / 'claude'
   * @returns {string} 追加するプロンプト文（normalの場合は空文字）
   */
  function getStylePrompt(style, sister) {
    if (!style || style === 'normal') return '';
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
