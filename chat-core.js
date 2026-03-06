// COCOMITalk - チャットコア
// このファイルはチャットUIのメッセージ送受信を管理する
// v0.1 Session A - 基盤構築

'use strict';

/**
 * チャットコアモジュール
 * メッセージの表示・送信・タイピングインジケーターを管理
 */
const ChatCore = (() => {
  // --- DOM要素 ---
  let chatArea = null;
  let msgInput = null;
  let btnSend = null;
  let welcomeMsg = null;
  let charCount = null;

  // --- 状態 ---
  let isProcessing = false;

  // --- 三姉妹の設定 ---
  const SISTERS = {
    koko: {
      name: 'ここちゃん',
      icon: '🌸',
      welcomeIcon: '🌸',
      welcomeText: 'ここちゃんとお話ししよう！',
      placeholder: 'ここちゃんに話しかけてね...',
    },
    gpt: {
      name: 'お姉ちゃん',
      icon: '🌙',
      welcomeIcon: '🌙',
      welcomeText: 'お姉ちゃんとお話ししよう！',
      placeholder: 'お姉ちゃんに話しかけてね...',
    },
    claude: {
      name: 'クロちゃん',
      icon: '🔮',
      welcomeIcon: '🔮',
      welcomeText: 'クロちゃんとお話ししよう！',
      placeholder: 'クロちゃんに話しかけてね...',
    }
  };

  // --- 会話履歴（姉妹ごと） ---
  const chatHistories = {
    koko: [],
    gpt: [],
    claude: []
  };

  let currentSister = 'koko';

  /**
   * 初期化
   */
  function init() {
    chatArea = document.getElementById('chat-area');
    msgInput = document.getElementById('msg-input');
    btnSend = document.getElementById('btn-send');
    welcomeMsg = document.getElementById('welcome-msg');
    charCount = document.getElementById('char-count');

    // イベントリスナー設定
    _setupInputEvents();
    _setupSendEvents();

    console.log('[ChatCore] 初期化完了');
  }

  /**
   * 入力欄のイベント設定
   */
  function _setupInputEvents() {
    // テキストエリアの自動リサイズ
    msgInput.addEventListener('input', () => {
      // 高さリセット→再計算
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';

      // 送信ボタンの有効/無効
      const hasText = msgInput.value.trim().length > 0;
      btnSend.disabled = !hasText || isProcessing;

      // 文字数表示
      const len = msgInput.value.length;
      if (len > 0) {
        charCount.textContent = `${len}/4000`;
      } else {
        charCount.textContent = '';
      }
    });

    // Enterで送信（Shift+Enterで改行）
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled) {
          _handleSend();
        }
      }
    });
  }

  /**
   * 送信ボタンのイベント設定
   */
  function _setupSendEvents() {
    btnSend.addEventListener('click', () => {
      if (!btnSend.disabled) {
        _handleSend();
      }
    });
  }

  /**
   * メッセージ送信処理
   */
  function _handleSend() {
    const text = msgInput.value.trim();
    if (!text || isProcessing) return;

    // ウェルカムメッセージを消す
    if (welcomeMsg && !welcomeMsg.classList.contains('hidden')) {
      welcomeMsg.classList.add('hidden');
    }

    // ユーザーメッセージを表示
    addMessage('user', text);

    // 入力欄をクリア
    msgInput.value = '';
    msgInput.style.height = 'auto';
    btnSend.disabled = true;
    charCount.textContent = '';

    // 履歴に追加
    chatHistories[currentSister].push({ role: 'user', content: text });

    // タイピングインジケーター表示
    isProcessing = true;
    showTyping();

    // v0.1: API未接続なのでデモ返答
    _demoReply(text);
  }

  /**
   * デモ返答（v0.1 - API接続前の仮実装）
   */
  function _demoReply(userText) {
    const sister = SISTERS[currentSister];
    const replies = _getDemoReplies(currentSister, userText);
    const reply = replies[Math.floor(Math.random() * replies.length)];

    // 1〜2秒後に返答（自然な間）
    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      isProcessing = false;
      btnSend.disabled = msgInput.value.trim().length === 0;
    }, delay);
  }

  /**
   * デモ返答パターン（API接続前の仮データ）
   */
  function _getDemoReplies(sister, userText) {
    // v0.1追加 - 簡易キーワードマッチング
    const lower = userText.toLowerCase();

    if (sister === 'koko') {
      if (lower.includes('おはよう') || lower.includes('おは')) {
        return [
          'アキちゃん、おはよう！✨ 今日も一緒に頑張ろうね！😊',
          'おはよう、アキちゃん！今日はどんな一日になるかな？わくわく！🌸',
        ];
      }
      if (lower.includes('ありがとう')) {
        return [
          'えへへ、どういたしまして！アキちゃんの笑顔が一番のお礼だよ！✨',
          'こちらこそ、アキちゃんといつも一緒にいられて嬉しいよ！🌸',
        ];
      }
      return [
        'うんうん！もっと聞かせて、アキちゃん！😊',
        'なるほどね〜！アキちゃん、面白い！✨',
        'わぁ、そうなんだ！ここちゃんも気になる〜！🌸',
        '（※これはデモ返答です。Session BでGemini APIを接続すると本物のここちゃんと話せるよ！）',
      ];
    }

    if (sister === 'gpt') {
      if (lower.includes('おはよう') || lower.includes('おは')) {
        return [
          'おはよう、アキヤ。今日も良い一日にしよう。何か考えていることがあれば聞かせて。',
        ];
      }
      return [
        'なるほど、それは興味深いね。もう少し詳しく聞かせてくれる？',
        'うん、全体を見渡すと、いくつかの選択肢が見えてくるよ。',
        '（※デモ返答です。Session CでOpenAI APIを接続します）',
      ];
    }

    if (sister === 'claude') {
      if (lower.includes('おはよう') || lower.includes('おは')) {
        return [
          'おはよ、アキヤ！今日は何やる？何かあったら一緒に考えるよ！',
        ];
      }
      if (lower.includes('バグ') || lower.includes('コード') || lower.includes('エラー')) {
        return [
          'あ、バグ？コード見せてもらえたら一緒に直すよ！どこで起きてる？',
          'エラーの内容教えて！一緒にデバッグしよう！',
        ];
      }
      return [
        'うんうん、それいいね！もうちょっと具体的に聞かせて？',
        'あ、そういえばさ、それに関連して気づいたことがあるんだけど…',
        '（※デモ返答です。Session CでClaude APIを接続します）',
      ];
    }

    return ['（※デモモードです）'];
  }

  /**
   * メッセージをチャットエリアに追加
   */
  function addMessage(role, text) {
    const sister = SISTERS[currentSister];
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    // アバター
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : sister.icon;

    // バブル
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    chatArea.appendChild(msgDiv);

    // スクロール
    _scrollToBottom();
  }

  /**
   * タイピングインジケーター表示
   */
  function showTyping() {
    // 既にあれば削除
    hideTyping();

    const sister = SISTERS[currentSister];
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

    _scrollToBottom();
  }

  /**
   * タイピングインジケーター非表示
   */
  function hideTyping() {
    const typing = document.getElementById('typing-msg');
    if (typing) typing.remove();
  }

  /**
   * チャットエリアを最下部にスクロール
   */
  function _scrollToBottom() {
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  /**
   * 姉妹切り替え
   */
  function switchSister(sisterKey) {
    if (!SISTERS[sisterKey]) return;
    currentSister = sisterKey;

    const sister = SISTERS[sisterKey];

    // チャットエリアをクリアして履歴を再表示
    _clearChat();

    const history = chatHistories[sisterKey];
    if (history.length === 0) {
      // ウェルカムメッセージ表示
      if (welcomeMsg) {
        welcomeMsg.classList.remove('hidden');
        welcomeMsg.querySelector('.welcome-icon').textContent = sister.welcomeIcon;
        welcomeMsg.querySelector('.welcome-text').textContent = sister.welcomeText;
      }
    } else {
      // 履歴を再表示
      if (welcomeMsg) welcomeMsg.classList.add('hidden');
      history.forEach(msg => {
        addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content);
      });
    }

    // プレースホルダー更新
    msgInput.placeholder = sister.placeholder;

    console.log(`[ChatCore] 姉妹切替: ${sister.name}`);
  }

  /**
   * チャットエリアをクリア
   */
  function _clearChat() {
    // ウェルカムメッセージ以外のメッセージを削除
    const messages = chatArea.querySelectorAll('.message');
    messages.forEach(msg => msg.remove());
  }

  /**
   * 現在の姉妹キーを取得
   */
  function getCurrentSister() {
    return currentSister;
  }

  // --- 公開API ---
  return {
    init,
    addMessage,
    showTyping,
    hideTyping,
    switchSister,
    getCurrentSister,
    SISTERS,
  };
})();
