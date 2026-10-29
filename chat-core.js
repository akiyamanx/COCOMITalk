// COCOMITalk - チャットコア（メッセージ送受信＋チャット管理）
// v0.3-v1.1: 履歴保存/トークン表示/三姉妹API/グループ/音声/停止ボタン
// v1.2 2026-03-10 - 表示系をChatUiに分離（499→355行に軽量化）
// v1.3 2026-03-10 - 1対1チャットにもKVメモリー注入（Step 4強化）
// v1.5 2026-03-11 - PromptBuilder共通化リファクタ（メモリー＋検索注入をprompt-builder.jsに委譲）
// v1.6 2026-03-12 - Step 6 Phase 1: チャット記憶自動保存フック＋姉妹切替時リセット
// v1.7 2026-03-12 - セッション開始位置記録＋getSessionHistory追加（今の部屋の会話だけDL）
// v1.8 2026-03-13 - AI自発的記憶保存マーカー検知（💾SAVE:対応）
// v1.9 2026-03-16 - グループモードにattachment引数を追加（方針C: テキスト全員・画像リードのみ）
// v2.0 2026-03-30 - Sprint 2: PromptBuilder.buildにsister引数追加（ownerベース記憶注入制御）
// v2.1 2026-04-06 - お散歩モード自動送信対応（vision-auto-sendイベント受信、表示/送信テキスト分離）
// v2.2 2026-07-17 - お散歩自動送信のisProcessingスキップ時に一時添付を破棄（ゾンビ写真の次送信混入防止・PoC A）
// 2026-10-28 - 返信の先頭の声のトーンタグ[tone:xxx]を受け取り直後に外す（ToneStyle.consume。画面・履歴・読み上げにタグを出さない）
// v2.3 2026-10-29 - step2有効化の準備: SISTER_API に aoi(ApiXai) / kimi(ApiKimi) を追加。登録簿が enabled の時だけ api を返す（今は両方 false=誰も呼ばない）
// v2.4 2026-10-30 - 1対1: 約束(調べるね/待っててね)だけで止まった返事に1回だけ自動フォローアップ（promise-followup.js）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
//
// ■ 葵ちゃん/きみちゃんを有効にする手順（スイッチの場所）。まだ全部OFF。実際の中継には一度もつないでいない
//   1. 中継Worker(cocomi-api-relay)に /xai /kimi をデプロイ + XAI_API_KEY / KIMI_API_KEY を設定（deliverables_v2/relay_xai_kimi_v2.patch）
//   2. characters.js の aoi / kimi を enabled:true（← これが本体のスイッチ。このファイルのSISTER_APIと meeting-relay.js の SISTERS は
//      それに連動して ApiXai/ApiKimi を返す）
//   3. 有効にする前に別途必要（このstepでは未対応）: 発言順 meeting-router.js（今は koko/gpt/claude 固定）／このファイルの SISTERS・chatHistories
//      ・履歴復元ループ（koko/gpt/claude 固定）／voice-input.js の姉妹ハイライト。tests/aoi-kimi-wiring.test.js が現状を固定している
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

  /** 登録簿で有効なキャラか（登録簿が無ければ false） */
  const _isOn = (key) => (typeof CharacterRegistry !== 'undefined') && CharacterRegistry.isEnabled(key);

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
    // v2.3追加 - 登録簿(characters.js)が enabled の時だけ api を返す。無効の間は null（呼び出し側は未接続として扱う）
    aoi: {
      module: () => (_isOn('aoi') && typeof ApiXai !== 'undefined') ? ApiXai : null,
      prompt: () => (typeof AoiSystemPrompt !== 'undefined') ? AoiSystemPrompt.getPrompt() : '',
    },
    kimi: {
      module: () => (_isOn('kimi') && typeof ApiKimi !== 'undefined') ? ApiKimi : null,
      prompt: () => (typeof KimiSystemPrompt !== 'undefined') ? KimiSystemPrompt.getPrompt() : '',
    },
  };

  const chatHistories = {
    koko: [],
    gpt: [],
    claude: []
  };

  const sessionStartIndex = { koko: 0, gpt: 0, claude: 0 };

  let currentSister = 'koko';

  async function init() {
    chatArea = document.getElementById('chat-area');
    msgInput = document.getElementById('msg-input');
    btnSend = document.getElementById('btn-send');
    welcomeMsg = document.getElementById('welcome-msg');
    charCount = document.getElementById('char-count');

    if (typeof ChatUi !== 'undefined') {
      ChatUi.init({
        chatArea,
        getCurrentSister: () => currentSister,
        getSisters: () => SISTERS,
      });
    }

    _setupInputEvents();
    _setupSendEvents();

    await _loadAllHistories();

    for (const key of ['koko', 'gpt', 'claude']) {
      sessionStartIndex[key] = chatHistories[key].length;
    }

    // v2.1追加 - お散歩モード自動送信イベントリスナー
    _setupVisionAutoSend();

    console.log('[ChatCore] 初期化完了 v2.2');
  }

  function _setupInputEvents() {
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

    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!btnSend.disabled) {
          _handleSend();
        }
      }
    });
  }

  function _setupSendEvents() {
    btnSend.addEventListener('click', () => {
      if (isProcessing) {
        _handleCancel();
      } else if (!btnSend.disabled) {
        _handleSend();
      }
    });
  }

  /**
   * v2.1追加 - お散歩モード自動送信
   * vision-ui-controller.jsからのカスタムイベントを受信し、
   * 画面にはdisplayTextを表示、APIにはapiText+添付画像を送信する
   */
  function _setupVisionAutoSend() {
    document.addEventListener('vision-auto-send', (e) => {
      if (isProcessing) {
        console.log('[ChatCore] 処理中のため自動送信スキップ');
        // v2.2追加 - 残留した自動キャプチャ画像を破棄（次の送信に混入するのを防ぐ）
        if (typeof FileHandler !== 'undefined') FileHandler.clearAttachment();
        return;
      }
      const { displayText, apiText } = e.detail;
      const attachment = (typeof FileHandler !== 'undefined') ? FileHandler.consumeAttachment() : null;
      if (!attachment) {
        console.log('[ChatCore] 添付画像がないため自動送信スキップ');
        return;
      }
      if (welcomeMsg && !welcomeMsg.classList.contains('hidden')) {
        welcomeMsg.classList.add('hidden');
      }
      // 画面表示はdisplayText
      addMessage('user', `📎 ${attachment.name}\n${displayText}`);
      // 履歴にはapiTextを保存
      chatHistories[currentSister].push({ role: 'user', content: apiText });
      _saveHistory();

      isProcessing = true;
      _showStopButton();
      showTyping();

      const sisterAPI = SISTER_API[currentSister];
      const apiModule = sisterAPI ? sisterAPI.module() : null;
      if (apiModule && apiModule.hasApiKey()) {
        _apiReply(apiText, apiModule, sisterAPI.prompt(), attachment);
      } else {
        _demoReply(apiText);
      }
    });
  }

  function _showStopButton() {
    btnSend.disabled = false;
    btnSend.querySelector('.send-arrow').textContent = '⏹';
    btnSend.classList.add('btn-stop');
    btnSend.title = '停止';
  }

  function _restoreSendButton() {
    btnSend.querySelector('.send-arrow').textContent = '↑';
    btnSend.classList.remove('btn-stop');
    btnSend.title = '送信';
    btnSend.disabled = msgInput.value.trim().length === 0;
  }

  function _handleCancel() {
    console.log('[ChatCore] 送信キャンセル実行');
    const aborted = (typeof ApiCommon !== 'undefined') ? ApiCommon.abortAll() : 0;
    if (typeof MeetingRelay !== 'undefined') MeetingRelay.abort();
    hideTyping();
    if (aborted > 0) addMessage('ai', '⏹ 送信をキャンセルしました');
    isProcessing = false;
    _restoreSendButton();
  }

  function _stripTone(r) { return (typeof ToneStyle !== 'undefined') ? ToneStyle.consume(r) : r; }
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

  function _handleSend() {
    const text = msgInput.value.trim();
    if (!text || isProcessing) return;

    if (welcomeMsg && !welcomeMsg.classList.contains('hidden')) {
      welcomeMsg.classList.add('hidden');
    }

    const attachment = (typeof FileHandler !== 'undefined') ? FileHandler.consumeAttachment() : null;

    const displayText = attachment ? `📎 ${attachment.name}\n${text}` : text;
    addMessage('user', displayText);

    msgInput.value = '';
    msgInput.style.height = 'auto';
    btnSend.disabled = true;
    charCount.textContent = '';

    chatHistories[currentSister].push({ role: 'user', content: text });
    _saveHistory();

    isProcessing = true;
    _showStopButton();
    showTyping();

    const isGroup = (typeof ModeSwitcher !== 'undefined') && ModeSwitcher.isGroupMode();

    if (isGroup) {
      _groupReply(text, attachment);
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

  async function _apiReply(userText, apiModule, systemPrompt, attachment) {
    try {
      const history = chatHistories[currentSister];

      // v2.0変更 - PromptBuilder.buildにsister引数追加（ownerベース記憶注入制御）
      let fullPrompt = systemPrompt;
      if (typeof PromptBuilder !== 'undefined') {
        const extra = await PromptBuilder.build({ mode: 'chat', sister: currentSister, userText });
        fullPrompt = systemPrompt + extra;
      }

      const modelKey = (typeof ModeSwitcher !== 'undefined')
        ? ModeSwitcher.getModelKey(currentSister)
        : undefined;

      const opts = { model: modelKey };
      if (attachment) opts.attachment = attachment;
      const mode = (typeof ModeSwitcher !== 'undefined') ? ModeSwitcher.getMode() : 'normal';
      if (mode !== 'normal') opts.maxTokens = 2048;

      // v2.x 声のトーンタグ[tone:xxx]を画面・履歴・読み上げ用の文から外す（無くても/壊れていても本文はそのまま）
      let reply = _stripTone(await apiModule.sendMessage(userText, fullPrompt, history, opts));

      if (typeof ChatMemory !== 'undefined' && reply.includes('💾SAVE:')) {
        reply = await ChatMemory.detectAndSave(reply, currentSister, chatHistories[currentSister]);
      }

      hideTyping();
      addMessage('ai', reply);
      chatHistories[currentSister].push({ role: 'assistant', content: reply });
      _saveHistory();

      if (typeof ChatMemory !== 'undefined') {
        ChatMemory.countTurn(currentSister);
        ChatMemory.autoSave(currentSister, chatHistories[currentSister]);
      }

      if (window.voiceController && window.voiceController.isEnabled()) {
        window.voiceController.speakResponse(reply, currentSister);
      }
      // v2.4 約束だけで止まった返事 → 1回だけ自動で続き（隠し指示は履歴に入れない）
      if (typeof PromiseFollowup !== 'undefined' && PromiseFollowup.shouldFollowUp(reply, opts)) {
        showTyping();
        const more = await PromiseFollowup.run({ apiModule, systemPrompt: fullPrompt, history: chatHistories[currentSister], firstReply: reply, model: modelKey, state: opts });
        hideTyping();
        if (more) { const r2 = _stripTone(more); addMessage('ai', r2); chatHistories[currentSister].push({ role: 'assistant', content: r2 }); _saveHistory(); }
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

  async function _groupReply(userText, attachment) {
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
        attachment,
      });
    } finally {
      isProcessing = false;
      _restoreSendButton();
    }
  }

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

  function switchSister(sisterKey) {
    if (!SISTERS[sisterKey]) return;
    currentSister = sisterKey;

    if (typeof ChatMemory !== 'undefined') {
      ChatMemory.resetTurnCount();
    }

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

  function getCurrentSister() {
    return currentSister;
  }

  function _saveHistory() {
    if (typeof ChatHistory !== 'undefined') {
      ChatHistory.save(currentSister, chatHistories[currentSister]).catch(e => {
        console.warn('[ChatCore] 履歴保存エラー:', e);
      });
    }
  }

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
    getSessionHistory: (sister) => {
      const key = sister || currentSister;
      const start = sessionStartIndex[key] || 0;
      return (chatHistories[key] || []).slice(start);
    },
    getGroupContext: () => ({ currentSister, chatHistories, addMessage, hideTyping, chatArea, SISTERS, SISTER_API }),
  };
})();