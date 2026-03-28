// COCOMITalk - 会議専用画面UI（メッセージ表示・ラウンド管理・アクションボタン）
// v0.8〜v1.3 初期作成〜議事録DL分離 / v1.4-1.5 ファイル添付対応
// v1.6 2026-03-21 - 会議グレード選択対応（meeting-lite/meeting/meeting-full）
// v1.7 2026-03-24 - 📋ボタンをドロップダウン化（CLAUDE.md/設計書/指示書を個別生成）
// v1.8 2026-03-28 - 相談トピック連携: ConsultationUI.init()呼び出し＋会議終了時の回答ダイアログ
// v1.8.1 2026-03-28 - バグ修正: 回答ダイアログ表示時にhide()が先に走って見えない問題を修正
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
    _setupEvents();
    if (typeof MeetingVoice !== 'undefined') MeetingVoice.init();
    console.log('[MeetingUI] 初期化完了 v1.8.1');
  }

  /** イベントリスナー設定 */
  function _setupEvents() {
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) btnStart.addEventListener('click', _handleStartOrContinue);
    if (topicInput) {
      topicInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _handleStartOrContinue(); }
      });
    }
    const btnContinue = meetingScreen.querySelector('#btn-meeting-continue');
    if (btnContinue) btnContinue.addEventListener('click', _handleContinue);
    const btnClose = meetingScreen.querySelector('#btn-meeting-close');
    if (btnClose) btnClose.addEventListener('click', _handleEndMeeting);
    const btnEnd = meetingScreen.querySelector('#btn-meeting-end');
    if (btnEnd) btnEnd.addEventListener('click', _handleEndMeeting);
    const btnMinutes = meetingScreen.querySelector('#btn-meeting-minutes');
    if (btnMinutes) {
      btnMinutes.addEventListener('click', () => {
        if (typeof MeetingDocActions !== 'undefined') MeetingDocActions.downloadMinutes(currentRouting);
      });
    }
    const btnDoc = meetingScreen.querySelector('#btn-meeting-doc');
    if (btnDoc) btnDoc.addEventListener('click', (e) => { e.stopPropagation(); _toggleDocDropdown(btnDoc); });
    const btnArchive = meetingScreen.querySelector('#btn-meeting-archive');
    if (btnArchive) btnArchive.addEventListener('click', _handleShowArchive);
    _setupFileAttach();
  }

  async function _handleStartOrContinue() {
    if (!topicInput) return;
    const topic = topicInput.value.trim();
    if (!topic) return;
    const hasRound = currentRouting && (typeof MeetingRelay !== 'undefined') && MeetingRelay.getCurrentRound() > 0;
    if (hasRound) {
      if (typeof MeetingVoice !== 'undefined') { MeetingVoice.showConfirm(topic); } else { _handleContinue(); }
      return;
    }
    await _startNewMeeting(topic);
  }

  async function _startNewMeeting(topic) {
    if (!topic && topicInput) topic = topicInput.value.trim();
    if (!topic) return;
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
      const gradeSelect = meetingScreen.querySelector('#meeting-grade-select');
      const meetingGrade = gradeSelect ? gradeSelect.value : 'meeting';
      await MeetingRelay.startMeeting(topic, routing, attachments, meetingGrade);
      _showActionButtons();
    } catch (error) {
      addSystemMessage(`エラー: ${error.message}`);
    } finally {
      topicInput.disabled = false;
      if (btnStart) btnStart.disabled = false;
    }
  }

  async function _handleContinue() {
    if (!currentRouting) return;
    const followUp = topicInput ? topicInput.value.trim() : '';
    if (!followUp) {
      if (topicInput) { topicInput.placeholder = '💬 追加の質問や指示を入力してから「🔄 続ける」を押してね'; topicInput.focus(); }
      return;
    }
    const attachments = _meetingAttachments.length > 0 ? [..._meetingAttachments] : null;
    _meetingAttachments = [];
    _updateMeetingFilePreview();
    if (topicInput) topicInput.value = '';
    const fileNames = attachments ? attachments.map(a => a.name).join(', ') : '';
    const displayText = attachments ? `📎 ${fileNames}\n${followUp}` : followUp;
    addUserMessage(displayText);
    _hideActionButtons();
    await MeetingRelay.continueRound(followUp, currentRouting, attachments);
    _showActionButtons();
  }

  // v1.8.1修正 - 相談トピック会議の場合、回答ダイアログ選択後まで画面を閉じない
  function _handleEndMeeting() {
    // v1.8追加 - 相談トピック会議だった場合、回答ダイアログを表示
    if (typeof ConsultationUI !== 'undefined' && ConsultationUI.hasActiveConsultation()) {
      const dialogShown = ConsultationUI.showResolveDialogIfNeeded();
      if (dialogShown) {
        // v1.8.1修正 - ダイアログが表示された場合はここで止める
        // 画面クローズは_resolveConsultation完了後にcloseMeetingScreen()を呼ぶ
        return;
      }
    }

    // 通常の会議終了（相談トピックなし or ダイアログ不要時）
    _closeMeetingScreen();
  }

  // v1.8.1追加 - 会議画面を閉じる共通処理（ダイアログ完了後にも呼ばれる）
  function _closeMeetingScreen() {
    hide();
    if (typeof ModeSwitcher !== 'undefined') ModeSwitcher.setMode('normal');
    _clearChat();
    currentRouting = null;
    if (topicInput) { topicInput.disabled = false; topicInput.value = ''; }
    const btnStart = meetingScreen.querySelector('#btn-meeting-start');
    if (btnStart) btnStart.disabled = false;
  }

  // v1.8修正 - 会議画面表示時にConsultationUI初期化
  function show() {
    if (meetingScreen) { meetingScreen.classList.remove('hidden'); isVisible = true; }
    const normalChat = document.getElementById('app');
    if (normalChat) normalChat.classList.add('meeting-active');
    // v1.8追加 - 相談トピック通知バーの初期化（pending相談があれば表示）
    if (typeof ConsultationUI !== 'undefined') {
      ConsultationUI.init();
    }
  }

  function hide() {
    if (meetingScreen) { meetingScreen.classList.add('hidden'); isVisible = false; }
    const normalChat = document.getElementById('app');
    if (normalChat) normalChat.classList.remove('meeting-active');
  }
  function getIsVisible() { return isVisible; }
  function showRoutingResult(routing) {
    const leadSister = SISTER_DISPLAY[routing.lead];
    const orderNames = routing.order.map(k => `${SISTER_DISPLAY[k].emoji}${SISTER_DISPLAY[k].name}`).join(' → ');
    addSystemMessage(
      `📋 議題カテゴリ: ${routing.label}\n` +
      `👑 主担当: ${leadSister.emoji}${leadSister.name}\n` +
      `🔄 発言順: ${orderNames}\n` +
      `💡 理由: ${routing.reason}`
    );
  }

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

  function addUserMessage(text) {
    if (!chatArea) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg user-msg';
    const header = document.createElement('div');
    header.className = 'meeting-msg-header';
    header.innerHTML = '<span class="meeting-avatar" style="background:#4CAF50">👤</span><span class="meeting-name" style="color:#4CAF50">アキヤ</span>';
    const body = document.createElement('div');
    body.className = 'meeting-msg-body';
    body.textContent = text;
    msgDiv.appendChild(header);
    msgDiv.appendChild(body);
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  function addSystemMessage(text) {
    if (!chatArea) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg system-msg';
    msgDiv.innerHTML = text.replace(/\n/g, '<br>');
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }

  function showTyping(sisterKey) {
    hideTyping();
    if (!chatArea) return;
    const sister = SISTER_DISPLAY[sisterKey];
    const msgDiv = document.createElement('div');
    msgDiv.className = 'meeting-msg sister-msg';
    msgDiv.id = 'meeting-typing';
    msgDiv.innerHTML = `<div class="meeting-msg-header"><span class="meeting-avatar" style="background:${sister.color}">${sister.emoji}</span><span class="meeting-name" style="color:${sister.color}">${sister.name}</span><span class="meeting-thinking">考え中...</span></div><div class="meeting-msg-body typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
    chatArea.appendChild(msgDiv);
    _scrollToBottom();
  }
  function hideTyping() {
    const typing = document.getElementById('meeting-typing');
    if (typing) typing.remove();
  }
  function _showActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.remove('hidden');
    const btnM = meetingScreen?.querySelector('#btn-meeting-minutes');
    const btnD = meetingScreen?.querySelector('#btn-meeting-doc');
    if (btnM) btnM.disabled = false;
    if (btnD) btnD.disabled = false;
    if (topicInput) topicInput.placeholder = '💬 追加の質問や指示を入力...';
    const guide = meetingScreen?.querySelector('#meeting-action-guide');
    const round = (typeof MeetingRelay !== 'undefined') ? MeetingRelay.getCurrentRound() : 0;
    if (guide) guide.textContent = `✅ ラウンド${round}完了！次はどうする？`;
  }
  function _hideActionButtons() {
    const actions = meetingScreen?.querySelector('.meeting-actions');
    if (actions) actions.classList.add('hidden');
  }
  function _clearChat() { if (chatArea) chatArea.innerHTML = ''; }

  function _renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      try { return marked.parse(text, { breaks: true, gfm: true }); } catch (e) { console.warn('[MeetingUI] Markdownパースエラー:', e); }
    }
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }

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
        try { const att = await FileHandler.readFile(file); _meetingAttachments.push(att); }
        catch (err) { alert(`${file.name}: ${err.message}`); }
      }
      _updateMeetingFilePreview();
      fileInput.value = '';
    });
  }

  function _updateMeetingFilePreview() {
    const preview = document.getElementById('meeting-file-preview');
    if (!preview) return;
    if (_meetingAttachments.length === 0) { preview.classList.add('hidden'); preview.innerHTML = ''; return; }
    let html = '';
    _meetingAttachments.forEach((att, idx) => {
      const sizeStr = att.size < 1024 ? `${att.size}B` : att.size < 1048576 ? `${(att.size / 1024).toFixed(1)}KB` : `${(att.size / 1048576).toFixed(1)}MB`;
      html += att.type === 'image'
        ? `<div class="file-preview-item"><img src="${att.dataUrl}" alt="${att.name}" class="file-preview-thumb"><span class="file-preview-name">${att.name}</span><button class="file-preview-remove" data-idx="${idx}">✕</button></div>`
        : `<div class="file-preview-item"><span class="file-preview-icon">📄</span><span class="file-preview-name">${att.name}（${sizeStr}）</span><button class="file-preview-remove" data-idx="${idx}">✕</button></div>`;
    });
    preview.innerHTML = html;
    preview.classList.remove('hidden');
    preview.querySelectorAll('.file-preview-remove').forEach(btn => {
      btn.addEventListener('click', (e) => { const idx = parseInt(e.target.dataset.idx, 10); _meetingAttachments.splice(idx, 1); _updateMeetingFilePreview(); });
    });
  }

  function _toggleDocDropdown(anchorBtn) {
    const existing = document.getElementById('doc-gen-dropdown');
    if (existing) { existing.remove(); return; }
    const menu = document.createElement('div');
    menu.id = 'doc-gen-dropdown';
    menu.className = 'doc-gen-dropdown';
    [
      { label: '📋 CLAUDE.md', fileType: 'claude' },
      { label: '📐 設計書', fileType: 'design' },
      { label: '📝 ステップ指示書', fileType: 'step' },
      { label: '📦 全部生成', fileType: 'all' },
    ].forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'doc-gen-dropdown-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => { menu.remove(); if (typeof MeetingDocActions !== 'undefined') MeetingDocActions.generateDoc(item.fileType); });
      menu.appendChild(btn);
    });
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px`;
    document.body.appendChild(menu);
    const close = (e) => { if (!menu.contains(e.target) && e.target !== anchorBtn) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  async function _handleShowArchive() {
    if (typeof MeetingArchiveUI !== 'undefined') MeetingArchiveUI.show();
  }

  function _scrollToBottom() {
    if (chatArea) requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
  }

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
    init, show, hide, getIsVisible, showRoutingResult,
    addSisterMessage, addUserMessage, addSystemMessage,
    showTyping, hideTyping, restoreDisplay,
    startNewMeeting: _startNewMeeting, handleContinue: _handleContinue,
    // v1.8.1追加 - ConsultationUIの_resolveConsultation完了後に呼ぶ
    closeMeetingScreen: _closeMeetingScreen,
  };
})();
