// COCOMITalk - チャットコア
// このファイルはチャットUIのメッセージ送受信を管理する
// v0.3 Session C - IndexedDB会話履歴保存対応
// v0.4 Session D - メッセージにトークン数表示
// v0.5 Step 2 - 三姉妹API分岐対応（Worker経由）
// v0.8 Step 3 - モード連動モデルキー対応
// v0.9 Step 3.5 - グループモード（👥三姉妹リレー応答）対応

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

  // v0.5追加 - 三姉妹のAPIモジュール＋プロンプトマッピング
  const SISTER_API = {
    koko: {
      module: () => (typeof ApiGemini !== 'undefined') ? ApiGemini : null,
      prompt: () => (typeof KokoSystemPrompt !== 'undefined') ? KokoSystemPrompt.getPrompt() : '',
    },
    gpt: {
      module: () => (typeof ApiOpenAI !== 'undefined') ? ApiOpenAI : null,
      prompt: () => (typeof GptSystemPrompt !== 'undefined') ? GptSystemPrompt.getPrompt() : '',
    },
    claude: {
      module: () => (typeof ApiClaude !== 'undefined') ? ApiClaude : null,
      prompt: () => (typeof ClaudeSystemPrompt !== 'undefined') ? ClaudeSystemPrompt.getPrompt() : '',
    },
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
  async function init() {
    chatArea = document.getElementById('chat-area');
    msgInput = document.getElementById('msg-input');
    btnSend = document.getElementById('btn-send');
    welcomeMsg = document.getElementById('welcome-msg');
    charCount = document.getElementById('char-count');

    // イベントリスナー設定
    _setupInputEvents();
    _setupSendEvents();

    // v0.3追加 - IndexedDBから履歴読み込み
    await _loadAllHistories();

    console.log('[ChatCore] 初期化完了');
  }

  /** 入力欄のイベント設定 */
  function _setupInputEvents() {
    // テキストエリアの自動リサイズ
    msgInput.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';

      const hasText = msgInput.value.trim().length > 0;
      btnSend.disabled = !hasText || isProcessing;

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
   * v0.5変更 - 三姉妹それぞれのAPIに振り分け
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

    // 履歴に追加＋IndexedDB保存
    chatHistories[currentSister].push({ role: 'user', content: text });
    _saveHistory();

    // タイピングインジケーター表示
    isProcessing = true;
    showTyping();

    // v0.5変更 → v0.9変更 - グループモード対応
    const isGroup = (typeof ModeSwitcher !== 'undefined') && ModeSwitcher.isGroupMode();

    if (isGroup) {
      // 👥 グループモード: 三姉妹全員がリレー応答
      _groupReply(text);
    } else {
      // 👤 ソロモード: 1対1で返答
      const sisterAPI = SISTER_API[currentSister];
      const apiModule = sisterAPI ? sisterAPI.module() : null;

      if (apiModule && apiModule.hasApiKey()) {
        _apiReply(text, apiModule, sisterAPI.prompt());
      } else {
        _demoReply(text);
      }
    }
  }

  /**
   * API経由で返答を取得
   * v0.5変更 - APIモジュールを引数で受け取る（三姉妹共通）
   * v0.8変更 - ModeSwitcherからモデルキーを取得して渡す
   */
  async function _apiReply(userText, apiModule, systemPrompt) {
    try {
      const history = chatHistories[currentSister];

      // v0.8追加 - モード連動のモデルキー取得
      const modelKey = (typeof ModeSwitcher !== 'undefined')
        ? ModeSwitcher.getModelKey(currentSister)
        : undefined;

      const reply = await apiModule.sendMessage(userText, systemPrompt, history, { model: modelKey });

      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      _saveHistory();

    } catch (error) {
      console.error('[ChatCore] API返答エラー:', error);
      hideTyping();
      const errorMsg = error.message.includes('認証トークン')
        ? '認証トークンが設定されてないみたい…⚙️設定からトークンを入れてね！'
        : `ごめんね、通信エラーだった…💦（${error.message}）`;
      addMessage('ai', errorMsg);
    } finally {
      isProcessing = false;
      btnSend.disabled = msgInput.value.trim().length === 0;
    }
  }

  /**
   * v0.9追加 - グループモード: ChatGroupモジュールに委譲
   */
  async function _groupReply(userText) {
    if (typeof ChatGroup === 'undefined') {
      console.error('[ChatCore] ChatGroupモジュールが見つかりません');
      isProcessing = false;
      return;
    }
    try {
      await ChatGroup.handleGroupReply(userText, {
        currentSister,
        chatHistories,
        addMessage,
        hideTyping,
        chatArea,
        SISTERS,
        SISTER_API,
      });
    } finally {
      isProcessing = false;
      btnSend.disabled = msgInput.value.trim().length === 0;
    }
  }

  /**
   * デモ返答（API未接続時の仮実装）
   */
  function _demoReply(userText) {
    const replies = _getDemoReplies(currentSister, userText);
    const reply = replies[Math.floor(Math.random() * replies.length)];

    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      _saveHistory();
      isProcessing = false;
      btnSend.disabled = msgInput.value.trim().length === 0;
    }, delay);
  }

  /**
   * デモ返答パターン（API接続前の仮データ）
   */
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

  /**
   * メッセージをチャットエリアに追加
   * v0.9変更 - options.sisterKeyで姉妹アイコン＋名前表示（グループモード用）
   */
  function addMessage(role, text, options = {}) {
    const sisterKey = options.sisterKey || currentSister;
    const sister = SISTERS[sisterKey];
    const isGroupReply = options.sisterKey && role === 'ai';

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : sister.icon;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // v0.9追加 - グループモードの姉妹名表示
    if (isGroupReply) {
      const nameTag = document.createElement('div');
      nameTag.className = 'msg-sister-name';
      nameTag.textContent = sister.name + (options.isLead ? ' 👑' : '');
      nameTag.style.color = _getSisterColor(sisterKey);
      bubble.appendChild(nameTag);
    }

    const textNode = document.createElement('div');
    textNode.className = 'msg-text';
    textNode.textContent = text;
    bubble.appendChild(textNode);

    // v0.9.4 - エラー表示のみ（履歴に入れない）の場合は薄く表示
    if (options.noHistory) {
      msgDiv.classList.add('msg-no-history');
    }

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    chatArea.appendChild(msgDiv);

    _scrollToBottom();
  }

  /**
   * 姉妹のテーマカラーを取得（v0.9追加）
   */
  function _getSisterColor(sisterKey) {
    const colors = { koko: '#FF6B9D', gpt: '#6B5CE7', claude: '#E6783E' };
    return colors[sisterKey] || '#888';
  }

  /**
   * タイピングインジケーター表示
   */
  function showTyping() {
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

    _clearChat();

    const history = chatHistories[sisterKey];
    if (history.length === 0) {
      if (welcomeMsg) {
        welcomeMsg.classList.remove('hidden');
        welcomeMsg.querySelector('.welcome-icon').textContent = sister.welcomeIcon;
        welcomeMsg.querySelector('.welcome-text').textContent = sister.welcomeText;
      }
    } else {
      if (welcomeMsg) welcomeMsg.classList.add('hidden');
      history.forEach(msg => {
        addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content);
      });
    }

    msgInput.placeholder = sister.placeholder;

    console.log(`[ChatCore] 姉妹切替: ${sister.name}`);
  }

  /**
   * チャットエリアをクリア
   */
  function _clearChat() {
    const messages = chatArea.querySelectorAll('.message');
    messages.forEach(msg => msg.remove());
  }

  /**
   * 現在の姉妹キーを取得
   */
  function getCurrentSister() {
    return currentSister;
  }

  /**
   * IndexedDBに現在の姉妹の履歴を保存（v0.3追加）
   */
  function _saveHistory() {
    if (typeof ChatHistory !== 'undefined') {
      ChatHistory.save(currentSister, chatHistories[currentSister]).catch(e => {
        console.warn('[ChatCore] 履歴保存エラー:', e);
      });
    }
  }

  /**
   * IndexedDBから全姉妹の履歴を読み込み（v0.3追加）
   */
  async function _loadAllHistories() {
    if (typeof ChatHistory === 'undefined') return;

    try {
      await ChatHistory.init();

      for (const key of ['koko', 'gpt', 'claude']) {
        const saved = await ChatHistory.load(key);
        if (saved && saved.length > 0) {
          chatHistories[key] = saved;
        }
      }

      const history = chatHistories[currentSister];
      if (history.length > 0) {
        if (welcomeMsg) welcomeMsg.classList.add('hidden');
        history.forEach(msg => {
          addMessage(msg.role === 'user' ? 'user' : 'ai', msg.content);
        });
      }

      console.log('[ChatCore] 履歴読み込み完了');
    } catch (e) {
      console.warn('[ChatCore] 履歴読み込みエラー:', e);
    }
  }

  /**
   * 会話履歴をクリア（v0.3追加）
   */
  async function clearHistory(sisterKey) {
    if (sisterKey) {
      chatHistories[sisterKey] = [];
      if (typeof ChatHistory !== 'undefined') {
        await ChatHistory.clear(sisterKey);
      }
    } else {
      chatHistories.koko = [];
      chatHistories.gpt = [];
      chatHistories.claude = [];
      if (typeof ChatHistory !== 'undefined') {
        await ChatHistory.clearAll();
      }
    }
    _clearChat();
    if (welcomeMsg) {
      welcomeMsg.classList.remove('hidden');
      const sister = SISTERS[currentSister];
      welcomeMsg.querySelector('.welcome-icon').textContent = sister.welcomeIcon;
      welcomeMsg.querySelector('.welcome-text').textContent = sister.welcomeText;
    }
  }

  // --- 公開API ---
  return {
    init, addMessage, showTyping, hideTyping,
    switchSister, getCurrentSister, clearHistory, SISTERS,
    // v0.9.3 - グループモード用コンテキスト
    getGroupContext: () => ({ currentSister, chatHistories, addMessage, hideTyping, chatArea, SISTERS, SISTER_API }),
  };
})();
