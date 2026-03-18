// COCOMITalk - 会議専用画面UI（メッセージ表示・ラウンド管理・アクションボタン）
// v0.8 新規作成 / v0.9 Markdown対応 / v1.0 ヘッダー常時表示＋アーカイブ
// v1.1 restoreDisplay＋topicInput方式 / v1.2 確認ダイアログ＋UX改善
// v1.3 2026-03-10 - 議事録DL＋指示書生成をMeetingDocActionsに分離（496→413行に軽量化）
// v1.4 2026-03-19 - 会議モードにファイル添付対応（#73）
// v1.5 2026-03-19 - 複数ファイル添付対応（上限10件、multiple選択）
'use strict';

/** 会議UIモジュール */
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
  // v1.4追加 - 会議用添付ファイル（meeting-ui.js内で管理）
  // v1.5改修 - 複数ファイル対応（配列、上限10件）
  let _meetingAttachments = [];
  const _MAX_ATTACHMENTS = 10;

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
    // v1.2追加 - MeetingVoice初期化（確認ダイアログ）
    if (typeof MeetingVoice !== 'undefined') MeetingVoice.init();
    console.log('[MeetingUI] 初期化完了 v1.3');
  }

  /** イベントリスナー設定 */
  function _setupEvents() {
    // 議題送信ボタン
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) {
      btnStart.addEventListener('click', _handleStartOrContinue);
    }

    // 議題入力欄のEnterキー
    if (topicInput) {
      topicInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _handleStartOrContinue();
        }
      });
    }

    // 追加ラウンドボタン v1.2変更 - continueは追加指示付き続行
    const btnContinue = meetingScreen.querySelector('#btn-meeting-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', _handleContinue);
    }

    // v1.2変更 - ヘッダーの✕はclose（確認ダイアログ付き画面閉じ）
    const btnClose = meetingScreen.querySelector('#btn-meeting-close');
    if (btnClose) {
      btnClose.addEventListener('click', _handleEndMeeting);
    }

    // v1.2追加 - footerの✕会議終了ボタン
    const btnEnd = meetingScreen.querySelector('#btn-meeting-end');
    if (btnEnd) {
      btnEnd.addEventListener('click', _handleEndMeeting);
    }

    // v1.3改修 - 議事録DL＋指示書生成はMeetingDocActionsに委譲
    const btnMinutes = meetingScreen.querySelector('#btn-meeting-minutes');
    if (btnMinutes) {
      btnMinutes.addEventListener('click', () => {
        if (typeof MeetingDocActions !== 'undefined') {
          MeetingDocActions.downloadMinutes(currentRouting);
        }
      });
    }

    const btnDoc = meetingScreen.querySelector('#btn-meeting-doc');
    if (btnDoc) {
      btnDoc.addEventListener('click', () => {
        if (typeof MeetingDocActions !== 'undefined') {
          MeetingDocActions.generateDoc();
        }
      });
    }

    // v1.0追加 - 📂過去の会議一覧ボタン
    const btnArchive = meetingScreen.querySelector('#btn-meeting-archive');
    if (btnArchive) {
      btnArchive.addEventListener('click', _handleShowArchive);
    }

    // v1.4追加 - 会議用📎ファイル添付
    _setupFileAttach();
  }

  /** v1.2改修 - 送信ボタン/Enter押下時の処理（会議進行中なら確認ダイアログ） */
  async function _handleStartOrContinue() {
    if (!topicInput) return;
    const topic = topicInput.value.trim();
    if (!topic) return;
    // 会議進行中か判定
    const hasRound = currentRouting && (typeof MeetingRelay !== 'undefined') && MeetingRelay.getCurrentRound() > 0;
    if (hasRound) {
      // 進行中 → 確認ダイアログで分岐
      if (typeof MeetingVoice !== 'undefined') {
        MeetingVoice.showConfirm(topic);
      } else {
        // フォールバック: そのまま追加ラウンドとして処理
        _handleContinue();
      }
      return;
    }
    // 未開始 → 新規会議開始
    await _startNewMeeting(topic);
  }

  /** 新規会議開始（内部用・外部からも呼ばれる） */
  async function _startNewMeeting(topic) {
    if (!topic && topicInput) topic = topicInput.value.trim();
    if (!topic) return;

    // v1.5改修 - 添付ファイルを取り出してクリア（複数対応）
    const attachments = _meetingAttachments.length > 0 ? [..._meetingAttachments] : null;
    _meetingAttachments = [];
    _updateMeetingFilePreview();

    if (topicInput) topicInput.value = '';
    if (topicInput) topicInput.disabled = true;
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) btnStart.disabled = true;
    _clearChat();
    const fileNames = attachments ? attachments.map(a => a.name).join(', ') : '';
    const displayTopic = attachments ? `📎 ${fileNames}\n${topic}` : topic;
    addUserMessage(displayTopic);
    addSystemMessage('議題を分析中... 🔍');

    try {
      const routing = await MeetingRouter.analyzeTopic(topic);
      currentRouting = routing;

      // リレー開始（v1.4: attachment付き）
      await MeetingRelay.startMeeting(topic, routing, attachments);

      // 完了 → アクションボタン表示
      _showActionButtons();

    } catch (error) {
      addSystemMessage(`エラー: ${error.message}`);
    } finally {
      topicInput.disabled = false;
      if (btnStart) btnStart.disabled = false;
    }
  }

  /** 追加ラウンド処理 v1.2改善 - ガイドメッセージ強化 */
  async function _handleContinue() {
    if (!currentRouting) return;

    // topicInput欄から追加指示を取得
    const followUp = topicInput ? topicInput.value.trim() : '';
    if (!followUp) {
      if (topicInput) {
        topicInput.placeholder = '💬 追加の質問や指示を入力してから「🔄 続ける」を押してね';
        topicInput.focus();
      }
      return;
    }

    // v1.5改修 - 追加ラウンドにも複数添付対応
    const attachments = _meetingAttachments.length > 0 ? [..._meetingAttachments] : null;
    _meetingAttachments = [];
    _updateMeetingFilePreview();

    // 入力をクリア
    if (topicInput) topicInput.value = '';

    const fileNames = attachments ? attachments.map(a => a.name).join(', ') : '';
    const displayText = attachments ? `📎 ${fileNames}\n${followUp}` : followUp;
    addUserMessage(displayText);
    _hideActionButtons();

    await MeetingRelay.continueRound(followUp, currentRouting, attachments);
    _showActionButtons();
  }

  /** 会議終了処理 — 画面を閉じてnormalモードに戻す */
  function _handleEndMeeting() {
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

  /** アクションボタン表示（ラウンド完了後） */
  function _showActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.remove('hidden');
    // ヘッダーの📝📋を有効化
    const btnM = meetingScreen?.querySelector('#btn-meeting-minutes');
    const btnD = meetingScreen?.querySelector('#btn-meeting-doc');
    if (btnM) btnM.disabled = false;
    if (btnD) btnD.disabled = false;
    // v1.2追加 - 入力欄のplaceholderをわかりやすく変更
    if (topicInput) {
      topicInput.placeholder = '💬 追加の質問や指示を入力...';
    }
    // v1.2追加 - ラウンド番号をガイドに反映
    const guide = meetingScreen?.querySelector('#meeting-action-guide');
    const round = (typeof MeetingRelay !== 'undefined') ? MeetingRelay.getCurrentRound() : 0;
    if (guide) guide.textContent = `✅ ラウンド${round}完了！次はどうする？`;
  }

  /** アクションボタン非表示 */
  function _hideActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.add('hidden');
  }

  /** チャットエリアをクリア */
  function _clearChat() { if (chatArea) chatArea.innerHTML = ''; }

  /** MarkdownテキストをHTMLに変換 */
  function _renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      try {
        return marked.parse(text, { breaks: true, gfm: true });
      } catch (e) {
        console.warn('[MeetingUI] Markdownパースエラー:', e);
      }
    }
    // フォールバック: 改行をbrに変換するだけ
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

  // ═══════════════════════════════════════════
  // v1.4追加 - 会議用ファイル添付（#73）
  // ═══════════════════════════════════════════

  /** v1.5改修 - 会議用ファイル添付（複数対応） */
  function _setupFileAttach() {
    if (typeof FileHandler === 'undefined') return;
    const btnAttach = document.getElementById('btn-meeting-attach');
    const fileInput = document.getElementById('meeting-file-input');
    if (!btnAttach || !fileInput) return;
    btnAttach.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      const remaining = _MAX_ATTACHMENTS - _meetingAttachments.length;
      if (remaining <= 0) { alert(`添付は最大${_MAX_ATTACHMENTS}件までだよ`); fileInput.value = ''; return; }
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) alert(`上限${_MAX_ATTACHMENTS}件のため、${remaining}件だけ追加するよ`);
      for (const file of toAdd) {
        try {
          const att = await FileHandler.readFile(file);
          _meetingAttachments.push(att);
        } catch (err) { alert(`${file.name}: ${err.message}`); }
      }
      _updateMeetingFilePreview();
      fileInput.value = '';
    });
  }

  /** v1.5改修 - 会議用ファイルプレビュー更新（複数対応） */
  function _updateMeetingFilePreview() {
    const preview = document.getElementById('meeting-file-preview');
    if (!preview) return;
    if (_meetingAttachments.length === 0) {
      preview.classList.add('hidden');
      preview.innerHTML = '';
      return;
    }
    let html = '';
    _meetingAttachments.forEach((att, idx) => {
      const sizeStr = att.size < 1024 ? `${att.size}B`
        : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)}KB`
        : `${(att.size / 1048576).toFixed(1)}MB`;
      html += att.type === 'image'
        ? `<div class="file-preview-item"><img src="${att.dataUrl}" alt="${att.name}" class="file-preview-thumb"><span class="file-preview-name">${att.name}</span><button class="file-preview-remove" data-idx="${idx}">✕</button></div>`
        : `<div class="file-preview-item"><span class="file-preview-icon">📄</span><span class="file-preview-name">${att.name}（${sizeStr}）</span><button class="file-preview-remove" data-idx="${idx}">✕</button></div>`;
    });
    preview.innerHTML = html;
    preview.classList.remove('hidden');
    preview.querySelectorAll('.file-preview-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        _meetingAttachments.splice(idx, 1);
        _updateMeetingFilePreview();
      });
    });
  }

  /** v1.0追加 - 📂過去の会議一覧を表示（MeetingArchiveUIに委譲） */
  async function _handleShowArchive() {
    if (typeof MeetingArchiveUI !== 'undefined') {
      MeetingArchiveUI.show();
    }
  }

  /** スクロールを最下部に */
  function _scrollToBottom() {
    if (chatArea) {
      requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
    }
  }

  /** IndexedDBから復元した会議内容を画面に再描画 */
  function restoreDisplay(meeting, routing) {
    if (!meeting) return;

    _clearChat();
    currentRouting = routing;
    addSystemMessage('📂 前回の会議を復元しました');
    if (routing) showRoutingResult(routing);

    let lastRound = 0;
    for (const msg of meeting.history) {
      if (msg.round !== lastRound) { addSystemMessage(`--- ラウンド ${msg.round} ---`); lastRound = msg.round; }
      if (msg.sister === 'user') { addUserMessage(msg.content); }
      else { addSisterMessage(msg.sister, msg.content, msg.isLead); }
    }

    _showActionButtons();
    if (topicInput) { topicInput.disabled = false; topicInput.placeholder = '追加の質問や指示を入力...'; }
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
    restoreDisplay,
    startNewMeeting: _startNewMeeting,
    handleContinue: _handleContinue,
  };
})();
