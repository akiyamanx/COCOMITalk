// COCOMITalk - チャットUI（メッセージ表示・タイピング表示・デモ返答）
// v1.0 2026-03-10 - chat-core.jsから表示系ロジックを分離
// v1.1 2026-03-27 - #77 吹き出しタップ読み上げ（AI返答bubbleをタップ→TTS再生）
// v1.2 2026-03-27 - #77改善: 再タップで読み上げ停止トグル（再生中→停止/停止中→再生）
// v1.6 2026-10-30 - 太字補正: MdFix.render（md-fix.js）で「）**に」等の生**を<strong>に
// v1.5 2026-10-30 - ツールを実際に使った返事の吹き出しに小さな印（options.toolNames → 🔎検索したよ 等）
// v1.4 2026-10-29 - 音が鳴っている間の吹き出しタップで停止（準備中・鳴り始め700msのタップは無視）
// v1.3 2026-10-29 - 連打で声が重なる不具合の修正: 読み上げ中(準備中含む)のタップは無視。停止はマイクの🔊ボタン。読み上げ中の吹き出しに speaking 表示
// v3.77 2026-10-29 - AIの吹き出しに data-sister を付与（CSSがその子の色を付ける）／名前札の色を彩度控えめに
// v1.7 2026-10-30 - 名前札の色に葵/きみを追加
// 最終更新: 葵(Aoi), 2026-10-30
'use strict';

/** チャットUI表示モジュール */
const ChatUi = (() => {
  let chatArea = null;
  let _currentSisterFn = null; // ChatCoreから現在の姉妹を取得する関数
  let _sistersFn = null; // SISTERSオブジェクトを取得する関数

  // v1.0 初期化 — ChatCoreから必要な参照を受け取る
  function init(refs) {
    chatArea = refs.chatArea;
    _currentSisterFn = refs.getCurrentSister;
    _sistersFn = refs.getSisters;
    console.log('[ChatUi] 初期化完了');
  }

  // 姉妹テーマカラー
  function getSisterColor(sisterKey) {
    const colors = { koko: '#A5426C', gpt: '#4F449E', claude: '#A8531F', aoi: '#1F6E96', kimi: '#94650A' };
    return colors[sisterKey] || '#888';
  }

  /** メッセージをチャットエリアに追加 */
  function addMessage(role, text, options = {}) {
    const SISTERS = _sistersFn();
    const currentSister = _currentSisterFn();
    const sisterKey = options.sisterKey || currentSister;
    const sister = SISTERS[sisterKey];
    const isGroupReply = options.sisterKey && role === 'ai';

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    if (role === 'ai' && sisterKey) msgDiv.setAttribute('data-sister', sisterKey);   // v3.77: CSSがその子の色（アバター地・吹き出しの左筋）を付ける目印

    // アバター
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : sister.icon;

    // 吹き出し
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // グループ返答時の姉妹名タグ
    if (isGroupReply) {
      const nameTag = document.createElement('div');
      nameTag.className = 'msg-sister-name';
      nameTag.textContent = sister.name + (options.isLead ? ' 👑' : '');
      nameTag.style.color = getSisterColor(sisterKey);
      bubble.appendChild(nameTag);
    }

    // テキスト本文（Markdownパース対応）
    const textNode = document.createElement('div');
    textNode.className = 'msg-text';
    if (role === 'ai' && typeof MdFix !== 'undefined') {
      try {
        textNode.innerHTML = MdFix.render(text); // v1.6 日本語隣接の**も太字に
      } catch (e) {
        textNode.textContent = text;
      }
    } else {
      textNode.textContent = text;
    }
    bubble.appendChild(textNode);
    // v1.5 2026-10-30 ツールを実際に使った返事に小さな印（検証用）
    if (role === 'ai' && options.toolNames && options.toolNames.length && typeof PromiseFollowup !== 'undefined') {
      const tag = document.createElement('div');
      tag.className = 'msg-tool-tag';
      tag.textContent = PromiseFollowup.toolLabel(options.toolNames);
      tag.style.cssText = 'font-size:11px;opacity:.65;margin-top:4px;';
      bubble.appendChild(tag);
    }

    // v1.3改良 - #77 吹き出しタップ読み上げ（AI返答のみ）。準備中(合成待ち)のタップは無視、音が鳴っている間のタップは停止（speakBubble 側で判定）
    if (role === 'ai') {
      bubble.style.cursor = 'pointer';
      const setBusy = (busy) => {
        bubble.classList.toggle('speaking', busy);
        if (busy) bubble.setAttribute('aria-busy', 'true'); else bubble.removeAttribute('aria-busy');
      };
      bubble.addEventListener('click', () => {
        const vc = window.voiceController;
        if (vc && vc.speakBubble) vc.speakBubble(text, sisterKey, { onBusyChange: setBusy });
      });
    }

    if (options.noHistory) {
      msgDiv.classList.add('msg-no-history');
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    chatArea.appendChild(msgDiv);

    scrollToBottom();
  }

  // タイピングインジケーター表示
  function showTyping() {
    hideTyping();
    const SISTERS = _sistersFn();
    const sister = SISTERS[_currentSisterFn()];
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai';
    msgDiv.id = 'typing-msg';
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = sister.icon;
    const indicator = document.createElement('div');
    indicator.className = 'msg-bubble typing-indicator';
    indicator.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(indicator);
    chatArea.appendChild(msgDiv);
    scrollToBottom();
  }

  // タイピングインジケーター非表示
  function hideTyping() {
    const typing = document.getElementById('typing-msg');
    if (typing) typing.remove();
  }

  // チャットエリアを最下部にスクロール
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  // チャットエリアのメッセージをクリア
  function clearMessages() {
    const messages = chatArea.querySelectorAll('.message');
    messages.forEach(msg => msg.remove());
  }

  // デモ返答（API未接続時の仮実装）
  function getDemoReply(sister, userText) {
    const replies = _getDemoReplies(sister, userText);
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // デモ返答パターン
  function _getDemoReplies(sister, userText) {
    const isGreeting = /おはよう|おは/.test(userText);
    const greetings = {
      koko: 'アキちゃん、おはよう！✨ 今日も一緒に頑張ろうね！😊',
      gpt: 'おはよう、アキヤ。今日も良い一日にしよう。',
      claude: 'おはよ、アキヤ！今日は何やる？',
    };
    const defaults = {
      koko: ['うんうん！もっと聞かせて、アキちゃん！😊', 'なるほどね〜！アキちゃん、面白い！✨'],
      gpt: ['なるほど、それは興味深いね。もう少し詳しく聞かせてくれる？'],
      claude: ['うんうん、それいいね！もうちょっと具体的に聞かせて？'],
    };
    if (isGreeting && greetings[sister]) return [greetings[sister]];
    return defaults[sister] || ['（※デモモードです）'];
  }

  return {
    init,
    addMessage,
    showTyping,
    hideTyping,
    scrollToBottom,
    clearMessages,
    getSisterColor,
    getDemoReply,
  };
})();
