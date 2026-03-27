// COCOMITalk - チャットUI（メッセージ表示・タイピング表示・デモ返答）
// v1.0 2026-03-10 - chat-core.jsから表示系ロジックを分離
// v1.1 2026-03-27 - #77 吹き出しタップ読み上げ（AI返答bubbleをタップ→TTS再生）
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
    const colors = { koko: '#FF6B9D', gpt: '#6B5CE7', claude: '#E6783E' };
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
    if (role === 'ai' && typeof marked !== 'undefined' && marked.parse) {
      try {
        textNode.innerHTML = marked.parse(text, { breaks: true, gfm: true });
      } catch (e) {
        textNode.textContent = text;
      }
    } else {
      textNode.textContent = text;
    }
    bubble.appendChild(textNode);

    // v1.1追加 - #77 吹き出しタップ読み上げ（AI返答のみ）
    if (role === 'ai') {
      bubble.style.cursor = 'pointer';
      bubble.addEventListener('click', () => {
        if (window.voiceController && window.voiceController.speakBubble) {
          window.voiceController.speakBubble(text, sisterKey);
        }
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
