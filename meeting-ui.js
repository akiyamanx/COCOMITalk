// COCOMITalk - 会議専用画面UI
// このファイルは会議モード時の専用画面のHTML生成とメッセージ表示を管理する
// v0.8 Step 3 - 新規作成
// v0.9 2026-03-08 - Markdownレンダリング対応（marked.js使用）
// v1.0 Step 3.5 - ヘッダー📝📋常時表示＋📂アーカイブ委譲
'use strict';

/**
 * 会議UIモジュール
 * - 会議専用画面の生成と表示/非表示
 * - 三姉妹のリレーメッセージを色分けで表示
 * - 議題入力＋ルーティング結果表示
 * - ラウンド管理UIとアクションボタン
 */
const MeetingUI = (() => {

  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  let meetingScreen = null;
  let chatArea = null;
  let topicInput = null;
  let currentRouting = null;
  let isVisible = false;

  /** 会議画面を初期化 */
  function init() {
    meetingScreen = document.getElementById('meeting-screen');
    if (!meetingScreen) {
      console.warn('[MeetingUI] meeting-screen要素が見つかりません');
      return;
    }
    chatArea = meetingScreen.querySelector('.meeting-chat');
    topicInput = meetingScreen.querySelector('.meeting-topic-input');

    // イベント設定
    _setupEvents();
    console.log('[MeetingUI] 初期化完了');
  }

  /** イベントリスナー設定 */
  function _setupEvents() {
    // 議題送信ボタン
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) {
      btnStart.addEventListener('click', _handleStartMeeting);
    }

    // 議題入力欄のEnterキー
    if (topicInput) {
      topicInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _handleStartMeeting();
        }
      });
    }

    // 追加ラウンドボタン
    const btnContinue = meetingScreen.querySelector('#btn-meeting-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', _handleContinue);
    }

    // 会議終了ボタン
    const btnEnd = meetingScreen.querySelector('#btn-meeting-end');
    if (btnEnd) {
      btnEnd.addEventListener('click', _handleEndMeeting);
    }

    // v1.0変更 - 議事録DLボタン（ヘッダー常時表示版）
    const btnMinutes = meetingScreen.querySelector('#btn-meeting-minutes');
    if (btnMinutes) {
      btnMinutes.addEventListener('click', _handleDownloadMinutes);
    }

    // v1.0変更 - 指示書生成ボタン（ヘッダー常時表示版）
    const btnDoc = meetingScreen.querySelector('#btn-meeting-doc');
    if (btnDoc) {
      btnDoc.addEventListener('click', _handleGenerateDoc);
    }

    // v1.0追加 - 📂過去の会議一覧ボタン
    const btnArchive = meetingScreen.querySelector('#btn-meeting-archive');
    if (btnArchive) {
      btnArchive.addEventListener('click', _handleShowArchive);
    }

    // v1.0追加 - 一覧画面の閉じるボタン
    const btnArchiveClose = meetingScreen.querySelector('#btn-archive-close');
    if (btnArchiveClose) {
      btnArchiveClose.addEventListener('click', _handleHideArchive);
    }
  }

  /** 会議開始処理 */
  async function _handleStartMeeting() {
    if (!topicInput) return;
    const topic = topicInput.value.trim();
    if (!topic) return;

    // 入力欄をクリア＆無効化
    topicInput.value = '';
    topicInput.disabled = true;
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) btnStart.disabled = true;

    // チャットエリアをクリア
    _clearChat();

    // アキヤの議題を表示
    addUserMessage(topic);

    // 議題分析（動的ルーティング）
    addSystemMessage('議題を分析中... 🔍');

    try {
      const routing = await MeetingRouter.analyzeTopic(topic);
      currentRouting = routing;

      // リレー開始
      await MeetingRelay.startMeeting(topic, routing);

      // 完了 → アクションボタン表示
      _showActionButtons();

    } catch (error) {
      addSystemMessage(`エラー: ${error.message}`);
    } finally {
      topicInput.disabled = false;
      if (btnStart) btnStart.disabled = false;
    }
  }

  /** 追加ラウンド処理 */
  async function _handleContinue() {
    if (!currentRouting) return;

    // 簡易入力（将来: 追加指示入力欄）
    const followUp = prompt('追加の指示や質問を入力してください:');
    if (!followUp) return;

    addUserMessage(followUp);
    _hideActionButtons();

    await MeetingRelay.continueRound(followUp, currentRouting);
    _showActionButtons();
  }

  /** 会議終了処理 */
  function _handleEndMeeting() {
    // v0.8修正 - 画面を閉じてnormalモードに戻す
    hide();

    // モードをnormalに戻す
    if (typeof ModeSwitcher !== 'undefined') {
      ModeSwitcher.setMode('normal');
    }

    // チャットエリアをクリア（次の会議用）
    _clearChat();
    currentRouting = null;

    // 入力欄を再有効化
    if (topicInput) {
      topicInput.disabled = false;
      topicInput.value = '';
    }
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) btnStart.disabled = false;
  }

  /** v0.9追加 - 議事録をMarkdownでダウンロード */
  function _handleDownloadMinutes() {
    if (typeof MeetingRelay === 'undefined') return;
    const history = MeetingRelay.getHistory();
    if (!history || history.length === 0) {
      addSystemMessage('まだ発言がないよ。会議を始めてからダウンロードしてね');
      return;
    }

    // 議事録Markdown生成
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    let md = `# COCOMI Family 会議議事録\n`;
    md += `- 日時: ${dateStr} ${timeStr}\n`;
    if (currentRouting) {
      md += `- カテゴリ: ${currentRouting.label}\n`;
      md += `- 主担当: ${SISTER_DISPLAY[currentRouting.lead]?.name || currentRouting.lead}\n`;
    }
    md += `\n---\n\n`;

    let lastRound = 0;
    for (const msg of history) {
      if (msg.round !== lastRound) {
        md += `## ラウンド ${msg.round}\n\n`;
        lastRound = msg.round;
      }
      const sister = SISTER_DISPLAY[msg.sister] || { emoji: '?', name: msg.sister };
      const leadMark = msg.isLead ? ' 👑主担当' : '';
      md += `### ${sister.emoji} ${sister.name}${leadMark}\n\n`;
      md += `${msg.content}\n\n---\n\n`;
    }

    // ダウンロード実行
    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `COCOMI会議_${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addSystemMessage('📝 議事録をダウンロードしたよ！');
  }

  /** v0.9追加 - 会議履歴から指示書を生成 */
  async function _handleGenerateDoc() {
    if (typeof MeetingRelay === 'undefined' || typeof DocGenerator === 'undefined') {
      addSystemMessage('指示書生成モジュールが読み込まれていません');
      return;
    }
    const history = MeetingRelay.getHistory();
    if (!history || history.length === 0) {
      addSystemMessage('まだ発言がないよ。会議を始めてから📋を押してね');
      return;
    }

    // 会議履歴をDocGeneratorが受け取れる形式に変換
    const chatMessages = history.map(msg => {
      const sister = SISTER_DISPLAY[msg.sister] || { name: msg.sister };
      return {
        role: 'ai',
        content: `【${sister.name}】\n${msg.content}`,
      };
    });

    addSystemMessage('📋 指示書を生成中... お姉ちゃんが統合→クロちゃんがチェック');

    try {
      const result = await DocGenerator.generate(chatMessages);
      if (result.success && result.files.length > 0) {
        // 各ファイルをダウンロード
        for (const file of result.files) {
          const blob = new Blob([file.content], { type: 'text/markdown; charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
        addSystemMessage(`📋 指示書${result.files.length}ファイルをダウンロードしたよ！`);
      }
    } catch (error) {
      addSystemMessage(`指示書生成エラー: ${error.message}`);
    }
  }

  /** 会議画面を表示 */
  function show() {
    if (meetingScreen) {
      meetingScreen.classList.remove('hidden');
      isVisible = true;
    }
    // 通常チャット画面を非表示
    const normalChat = document.getElementById('app');
    if (normalChat) normalChat.classList.add('meeting-active');
  }

  /** 会議画面を非表示 */
  function hide() {
    if (meetingScreen) {
      meetingScreen.classList.add('hidden');
      isVisible = false;
    }
    const normalChat = document.getElementById('app');
    if (normalChat) normalChat.classList.remove('meeting-active');
  }

  /** 表示中かどうか */
  function getIsVisible() { return isVisible; }

  /** ルーティング結果を表示 */
  function showRoutingResult(routing) {
    const leadSister = SISTER_DISPLAY[routing.lead];
    const orderNames = routing.order
      .map(k => `${SISTER_DISPLAY[k].emoji}${SISTER_DISPLAY[k].name}`)
      .join(' → ');

    addSystemMessage(
      `📋 議題カテゴリ: ${routing.label}\n` +
      `👑 主担当: ${leadSister.emoji}${leadSister.name}\n` +
      `🔄 発言順: ${orderNames}\n` +
      `💡 理由: ${routing.reason}`
    );
  }

  /** 姉妹のメッセージを追加 */
  function addSisterMessage(sisterKey, text, isLead) {
    if (!chatArea) return;

    const sister = SISTER_DISPLAY[sisterKey];
    const msgDiv = document.createElement('div');
    msgDiv.className = `meeting-msg sister-msg ${sisterKey}`;

    const header = document.createElement('div');
    header.className = 'meeting-msg-header';
    header.innerHTML = `<span class="meeting-avatar" style="background:${sister.color}">${sister.emoji}</span>` +
      `<span class="meeting-name" style="color:${sister.color}">${sister.name}</span>` +
      (isLead ? '<span class="meeting-lead-badge">👑主担当</span>' : '');

    const body = document.createElement('div');
    body.className = 'meeting-msg-body';
    // v0.9修正 - Markdownレンダリング（**太字**や### 見出しをHTMLに変換）
    body.innerHTML = _renderMarkdown(text);

    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  /** アキヤのメッセージを追加 */
  function addUserMessage(text) {
    if (!chatArea) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg user-msg';

    const header = document.createElement('div');
    header.className = 'meeting-msg-header';
    header.innerHTML = '<span class="meeting-avatar" style="background:#4CAF50">👤</span>' +
      '<span class="meeting-name" style="color:#4CAF50">アキヤ</span>';

    const body = document.createElement('div');
    body.className = 'meeting-msg-body';
    // v0.9 - ユーザーメッセージはテキストそのまま（Markdown不要）
    body.textContent = text;

    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  /** システムメッセージを追加 */
  function addSystemMessage(text) {
    if (!chatArea) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg system-msg';
    // 改行をbrに変換
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  /** タイピングインジケーター表示 */
  function showTyping(sisterKey) {
    hideTyping();
    if (!chatArea) return;

    const sister = SISTER_DISPLAY[sisterKey];
    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg sister-msg';
    msgDiv.id = 'meeting-typing';

    msgDiv.innerHTML = `<div class="meeting-msg-header">
      <span class="meeting-avatar" style="background:${sister.color}">${sister.emoji}</span>
      <span class="meeting-name" style="color:${sister.color}">${sister.name}</span>
      <span class="meeting-thinking">考え中...</span>
    </div>
    <div class="meeting-msg-body typing-indicator">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>`;

    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  /** タイピングインジケーター非表示 */
  function hideTyping() {
    const typing = document.getElementById('meeting-typing');
    if (typing) typing.remove();
  }

  /**
   * アクションボタン表示（ラウンド完了後）
   * v1.0変更 - 📝📋ヘッダーボタンも有効化
   */
  function _showActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.remove('hidden');
    // ヘッダーの📝📋を有効化
    const btnM = meetingScreen?.querySelector('#btn-meeting-minutes');
    const btnD = meetingScreen?.querySelector('#btn-meeting-doc');
    if (btnM) btnM.disabled = false;
    if (btnD) btnD.disabled = false;
  }

  /**
   * アクションボタン非表示
   */
  function _hideActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.add('hidden');
  }

  /** チャットエリアをクリア */
  function _clearChat() { if (chatArea) chatArea.innerHTML = ''; }

  /** v0.9追加 - MarkdownテキストをHTMLに変換 */
  function _renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      try {
        // marked.jsの設定（安全寄り）
        const html = marked.parse(text, {
          breaks: true,   // 改行をbrに変換
          gfm: true,      // GitHub Flavored Markdown
        });
        return html;
      } catch (e) {
        console.warn('[MeetingUI] Markdownパースエラー:', e);
      }
    }
    // フォールバック: 改行をbrに変換するだけ
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  /**
   * v1.0追加 - 📂過去の会議一覧を表示（MeetingArchiveUIに委譲）
   */
  async function _handleShowArchive() {
    if (typeof MeetingArchiveUI !== 'undefined') {
      MeetingArchiveUI.show();
    }
  }

  /**
   * v1.0追加 - HTMLエスケープ（XSS防止）
   */
  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * スクロールを最下部に
   */
  function _scrollToBottom() {
    if (chatArea) {
      requestAnimationFrame(() => {
        chatArea.scrollTop = chatArea.scrollHeight;
      });
    }
  }

  return {
    init,
    show,
    hide,
    getIsVisible,
    showRoutingResult,
    addSisterMessage,
    addUserMessage,
    addSystemMessage,
    showTyping,
    hideTyping,
  };
})();
