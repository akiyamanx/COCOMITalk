// COCOMITalk - チャットコア（メッセージ送受信＋チャット管理）
// v0.3-v1.1: 履歴保存/トークン表示/三姉妹API/グループ/音声/停止ボタン
// v1.2 2026-03-10 - 表示系をChatUiに分離（499→355行に軽量化）
// v1.3 2026-03-10 - 1対1チャットにもKVメモリー注入（Step 4強化）
// v1.5 2026-03-11 - PromptBuilder共通化リファクタ（メモリー＋検索注入をprompt-builder.jsに委譲）
'use strict';

/** チャットコアモジュール */
const ChatCore = (() => {
  let chatArea = null;
  let msgInput = null;
  let btnSend = null;
  let welcomeMsg = null;
  let charCount = null;

  let isProcessing = false;

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

  // 三姉妹のAPIモジュール＋プロンプトマッピング
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

  const chatHistories = {
    koko: [],
    gpt: [],
    claude: []
  };

  let currentSister = 'koko';

  // 初期化
  async function init() {
    chatArea = document.getElementById('chat-area');
    msgInput = document.getElementById('msg-input');
    btnSend = document.getElementById('btn-send');
    welcomeMsg = document.getElementById('welcome-msg');
    charCount = document.getElementById('char-count');

    // v1.2追加 - ChatUiの初期化（表示系を委譲）
    if (typeof ChatUi !== 'undefined') {
      ChatUi.init({
        chatArea,
        getCurrentSister: () => currentSister,
        getSisters: () => SISTERS,
      });
    }

    // イベントリスナー設定
    _setupInputEvents();
    _setupSendEvents();

    await _loadAllHistories();

    console.log('[ChatCore] 初期化完了 v1.5');
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

  // 送信ボタンのイベント設定 v1.1改修 - 停止ボタン機能追加
  function _setupSendEvents() {
    btnSend.addEventListener('click', () => {
      if (isProcessing) {
        _handleCancel();
      } else if (!btnSend.disabled) {
        _handleSend();
      }
    });
  }

  /** v1.1追加 - 送信ボタンを⏹停止表示に切替 */
  function _showStopButton() {
    btnSend.disabled = false;
    btnSend.querySelector('.send-arrow').textContent = '⏹';
    btnSend.classList.add('btn-stop');
    btnSend.title = '停止';
  }

  /** v1.1追加 - 送信ボタンを通常表示に戻す */
  function _restoreSendButton() {
    btnSend.querySelector('.send-arrow').textContent = '↑';
    btnSend.classList.remove('btn-stop');
    btnSend.title = '送信';
    btnSend.disabled = msgInput.value.trim().length === 0;
  }

  /** v1.1追加 - 送信キャンセル処理 */
  function _handleCancel() {
    console.log('[ChatCore] 送信キャンセル実行');
    const aborted = (typeof ApiCommon !== 'undefined') ? ApiCommon.abortAll() : 0;
    if (typeof MeetingRelay !== 'undefined') MeetingRelay.abort();
    hideTyping();
    if (aborted > 0) addMessage('ai', '⏹ 送信をキャンセルしました');
    isProcessing = false;
    _restoreSendButton();
  }

  // v1.2改修 - 表示系はChatUiに委譲するラッパー関数
  function addMessage(role, text, options) {
    if (typeof ChatUi !== 'undefined') {
      ChatUi.addMessage(role, text, options);
    }
  }
  function showTyping() {
    if (typeof ChatUi !== 'undefined') ChatUi.showTyping();
  }
  function hideTyping() {
    if (typeof ChatUi !== 'undefined') ChatUi.hideTyping();
  }

  /** メッセージ送信処理 */
  function _handleSend() {
    const text = msgInput.value.trim();
    if (!text || isProcessing) return;

    // ウェルカムメッセージを消す
    if (welcomeMsg && !welcomeMsg.classList.contains('hidden')) {
      welcomeMsg.classList.add('hidden');
    }

    const attachment = (typeof FileHandler !== 'undefined') ? FileHandler.consumeAttachment() : null;

    // ユーザーメッセージを表示（添付ファイル名付き）
    const displayText = attachment ? `📎 ${attachment.name}\n${text}` : text;
    addMessage('user', displayText);

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
    _showStopButton();
    showTyping();

    const isGroup = (typeof ModeSwitcher !== 'undefined') && ModeSwitcher.isGroupMode();

    if (isGroup) {
      _groupReply(text);
    } else {
      const sisterAPI = SISTER_API[currentSister];
      const apiModule = sisterAPI ? sisterAPI.module() : null;

      if (apiModule && apiModule.hasApiKey()) {
        _apiReply(text, apiModule, sisterAPI.prompt(), attachment);
      } else {
        _demoReply(text);
      }
    }
  }

  /** API経由で返答を取得 */
  async function _apiReply(userText, apiModule, systemPrompt, attachment) {
    try {
      const history = chatHistories[currentSister];

      // v1.5改修 - PromptBuilderでメモリー＋検索結果を一括注入
      let fullPrompt = systemPrompt;
      if (typeof PromptBuilder !== 'undefined') {
        const extra = await PromptBuilder.build({ mode: 'chat' });
        fullPrompt = systemPrompt + extra;
      }

      const modelKey = (typeof ModeSwitcher !== 'undefined')
        ? ModeSwitcher.getModelKey(currentSister)
        : undefined;

      const opts = { model: modelKey };
      if (attachment) opts.attachment = attachment;
      const mode = (typeof ModeSwitcher !== 'undefined') ? ModeSwitcher.getMode() : 'normal';
      if (mode !== 'normal') opts.maxTokens = 2048;

      const reply = await apiModule.sendMessage(userText, fullPrompt, history, opts);

      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      _saveHistory();

      // 音声モードなら応答を声で再生
      if (window.voiceController && window.voiceController.isEnabled()) {
        window.voiceController.speakResponse(reply, currentSister);
      }

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[ChatCore] API呼び出しがキャンセルされました');
        hideTyping();
      } else {
        console.error('[ChatCore] API返答エラー:', error);
        hideTyping();
        const errorMsg = error.message.includes('認証トークン')
          ? '認証トークンが設定されてないみたい…⚙️設定からトークンを入れてね！'
          : `ごめんね、通信エラーだった…💦（${error.message}）`;
        addMessage('ai', errorMsg);
      }
    } finally {
      isProcessing = false;
      _restoreSendButton();
    }
  }

  // グループモード
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
      _restoreSendButton();
    }
  }

  // v1.2改修 - デモ返答（ChatUiに委譲）
  function _demoReply(userText) {
    const reply = (typeof ChatUi !== 'undefined')
      ? ChatUi.getDemoReply(currentSister, userText)
      : '（※デモモードです）';

    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      _saveHistory();
      isProcessing = false;
      _restoreSendButton();
    }, delay);
  }

  // 姉妹切り替え
  function switchSister(sisterKey) {
    if (!SISTERS[sisterKey]) return;
    currentSister = sisterKey;

    const sister = SISTERS[sisterKey];

    if (typeof ChatUi !== 'undefined') ChatUi.clearMessages();

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

  // 現在の姉妹キーを取得
  function getCurrentSister() {
    return currentSister;
  }

  // 履歴をIndexedDBに保存
  function _saveHistory() {
    if (typeof ChatHistory !== 'undefined') {
      ChatHistory.save(currentSister, chatHistories[currentSister]).catch(e => {
        console.warn('[ChatCore] 履歴保存エラー:', e);
      });
    }
  }

  // IndexedDBから履歴読み込み
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

  // 会話履歴をクリア
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
    if (typeof ChatUi !== 'undefined') ChatUi.clearMessages();
    if (welcomeMsg) {
      welcomeMsg.classList.remove('hidden');
      const sister = SISTERS[currentSister];
      welcomeMsg.querySelector('.welcome-icon').textContent = sister.welcomeIcon;
      welcomeMsg.querySelector('.welcome-text').textContent = sister.welcomeText;
    }
  }

  return {
    init, addMessage, showTyping, hideTyping,
    switchSister, getCurrentSister, clearHistory, SISTERS,
    getHistory: (sister) => chatHistories[sister || currentSister] || [],
    getGroupContext: () => ({ currentSister, chatHistories, addMessage, hideTyping, chatArea, SISTERS, SISTER_API }),
  };
})();
