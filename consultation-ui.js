// COCOMITalk - 相談トピック連携UI
// このファイルは何をするか:
// claude.aiクロちゃんが書き込んだ相談トピックを会議画面に通知バーとして表示し、
// アキヤが補足コメントを追加して三姉妹会議に投入する。
// 会議完了後は「ファイルDLだけ」or「DL＋DB保存」を選べる。
// v1.0 2026-03-28 - 新規作成
// v1.1 2026-03-28 - バグ修正: 議題テキスト短縮＋会議自動開始＋回答ダイアログ条件修正
// v1.2 2026-03-28 - バグ修正: 会議開始後に通知バーが再表示される問題＋resolve後のバー非表示
'use strict';

/** 相談トピック連携UIモジュール */
const ConsultationUI = (() => {

  let _currentConsultation = null;
  let _barEl = null;
  let _panelEl = null;
  let _dialogEl = null;
  let _meetingExecuted = false;
  // v1.2追加 - 会議開始済みフラグ（init再呼び出し時にpending再取得を防ぐ）
  let _consultationStarted = false;

  async function init() {
    _createElements();
    // v1.2修正 - 既に会議開始済みならpending再チェックしない
    if (!_consultationStarted) {
      await _checkPendingConsultations();
    }
  }

  function _createElements() {
    if (!document.getElementById('consultation-bar')) {
      const bar = document.createElement('div');
      bar.id = 'consultation-bar';
      bar.className = 'consultation-bar hidden';
      bar.innerHTML = `<span class="consultation-bar-icon">📨</span><span class="consultation-bar-text"></span><span class="consultation-bar-arrow">▼</span>`;
      bar.addEventListener('click', _togglePanel);
      _barEl = bar;

      const panel = document.createElement('div');
      panel.id = 'consultation-panel';
      panel.className = 'consultation-panel hidden';
      panel.innerHTML = `
        <div class="consultation-panel-header">
          <span>📨 クロちゃんからの相談</span>
          <button class="consultation-close-btn" aria-label="閉じる">✕</button>
        </div>
        <div class="consultation-panel-body">
          <div class="consultation-topic"></div>
          <div class="consultation-question"></div>
          <div class="consultation-context"></div>
          <div class="consultation-comment-area">
            <label class="consultation-comment-label">💬 補足コメント:</label>
            <textarea class="consultation-comment-input" placeholder="アキヤの補足やヒントを追加..." rows="2" maxlength="500"></textarea>
          </div>
          <button class="consultation-start-btn">▶ この議題で会議開始</button>
        </div>
      `;
      panel.querySelector('.consultation-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        _hidePanel();
      });
      panel.querySelector('.consultation-start-btn').addEventListener('click', _startMeetingWithConsultation);
      _panelEl = panel;

      const dialog = document.createElement('div');
      dialog.id = 'consultation-resolve-dialog';
      dialog.className = 'consultation-resolve-dialog hidden';
      dialog.innerHTML = `
        <div class="consultation-resolve-overlay"></div>
        <div class="consultation-resolve-box">
          <p class="consultation-resolve-msg">📨 相談トピックの回答をどうする？</p>
          <div class="consultation-resolve-btns">
            <button class="consultation-resolve-dl">📥 ファイルDLだけ</button>
            <button class="consultation-resolve-both">📥💾 DL＋DBに保存</button>
          </div>
        </div>
      `;
      dialog.querySelector('.consultation-resolve-dl').addEventListener('click', () => _resolveConsultation(false));
      dialog.querySelector('.consultation-resolve-both').addEventListener('click', () => _resolveConsultation(true));
      dialog.querySelector('.consultation-resolve-overlay').addEventListener('click', () => _resolveConsultation(false));
      _dialogEl = dialog;

      const meetingFooter = document.querySelector('.meeting-input-area');
      if (meetingFooter) {
        meetingFooter.insertBefore(panel, meetingFooter.firstChild);
        meetingFooter.insertBefore(bar, meetingFooter.firstChild);
      }
      const meetingScreen = document.getElementById('meeting-screen');
      if (meetingScreen) {
        meetingScreen.appendChild(dialog);
      }
    } else {
      _barEl = document.getElementById('consultation-bar');
      _panelEl = document.getElementById('consultation-panel');
      _dialogEl = document.getElementById('consultation-resolve-dialog');
    }
  }

  async function _checkPendingConsultations() {
    if (typeof ApiCommon === 'undefined') return;
    try {
      const workerUrl = ApiCommon.getWorkerURL();
      const authToken = ApiCommon.getAuthToken();
      if (!workerUrl || !authToken) return;

      const res = await fetch(`${workerUrl}/consultation?status=pending&limit=5`, {
        method: 'GET',
        headers: { 'X-COCOMI-AUTH': authToken },
      });
      if (!res.ok) {
        console.warn('[ConsultationUI] 相談取得失敗:', res.status);
        return;
      }
      const data = await res.json();
      const consultations = data.consultations || [];

      if (consultations.length > 0) {
        _currentConsultation = consultations[0];
        _meetingExecuted = false;
        _consultationStarted = false;
        _showBar(consultations.length);
      } else {
        _hideBar();
      }
    } catch (e) {
      console.warn('[ConsultationUI] 相談チェックスキップ:', e.message);
    }
  }

  function _showBar(count) {
    if (!_barEl) return;
    const text = _barEl.querySelector('.consultation-bar-text');
    text.textContent = `クロちゃんからの相談が${count}件あるよ！`;
    _barEl.classList.remove('hidden');
  }

  function _hideBar() {
    if (_barEl) _barEl.classList.add('hidden');
    _hidePanel();
  }

  function _togglePanel() {
    if (!_panelEl) return;
    if (_panelEl.classList.contains('hidden')) {
      _showPanel();
    } else {
      _hidePanel();
    }
  }

  function _showPanel() {
    if (!_panelEl || !_currentConsultation) return;
    const c = _currentConsultation;
    _panelEl.querySelector('.consultation-topic').textContent = `📌 ${c.topic}`;
    _panelEl.querySelector('.consultation-question').textContent = c.question;
    const ctxEl = _panelEl.querySelector('.consultation-context');
    if (c.context) {
      ctxEl.textContent = `背景: ${c.context}`;
      ctxEl.classList.remove('hidden');
    } else {
      ctxEl.classList.add('hidden');
    }
    _panelEl.querySelector('.consultation-comment-input').value = '';
    _panelEl.classList.remove('hidden');
    const arrow = _barEl.querySelector('.consultation-bar-arrow');
    if (arrow) arrow.textContent = '▲';
  }

  function _hidePanel() {
    if (_panelEl) _panelEl.classList.add('hidden');
    if (_barEl) {
      const arrow = _barEl.querySelector('.consultation-bar-arrow');
      if (arrow) arrow.textContent = '▼';
    }
  }

  function _startMeetingWithConsultation() {
    if (!_currentConsultation) return;
    const c = _currentConsultation;
    const comment = _panelEl.querySelector('.consultation-comment-input').value.trim();

    let topic = `【📨 相談】${c.topic}\n${c.question}`;
    if (c.context) {
      const shortCtx = c.context.length > 100 ? c.context.slice(0, 100) + '...' : c.context;
      topic += `\n背景: ${shortCtx}`;
    }
    if (comment) {
      topic += `\n補足: ${comment}`;
      _currentConsultation._akiyaComment = comment;
    }

    _hidePanel();
    _hideBar();

    // v1.2追加 - 会議開始済みフラグをON（init再呼び出し時のpending再取得を防ぐ）
    _meetingExecuted = true;
    _consultationStarted = true;

    if (typeof MeetingUI !== 'undefined' && MeetingUI.startNewMeeting) {
      MeetingUI.startNewMeeting(topic);
    } else {
      const topicInput = document.querySelector('.meeting-topic-input');
      if (topicInput) {
        topicInput.value = topic;
        topicInput.style.height = 'auto';
        topicInput.style.height = Math.min(topicInput.scrollHeight, 200) + 'px';
      }
    }

    console.log('[ConsultationUI] 相談トピックで会議開始:', c.topic);
  }

  function showResolveDialogIfNeeded() {
    if (!_currentConsultation || !_meetingExecuted) return false;
    if (_dialogEl) {
      _dialogEl.classList.remove('hidden');
    }
    return true;
  }

  async function _resolveConsultation(saveToDb) {
    if (_dialogEl) _dialogEl.classList.add('hidden');
    if (!_currentConsultation) return;

    let resolution = '';
    if (typeof MeetingRelay !== 'undefined') {
      const history = MeetingRelay.getHistory();
      if (history && history.length > 0) {
        resolution = history.map(msg => {
          const name = { koko: 'ここちゃん', gpt: 'お姉ちゃん', claude: 'クロちゃん' }[msg.sister] || msg.sister;
          return `【${name}】\n${msg.content}`;
        }).join('\n\n---\n\n');
      }
    }

    _downloadResolution(resolution);

    if (saveToDb) {
      await _saveResolutionToDb(resolution);
    }

    if (typeof MeetingUI !== 'undefined') {
      const msg = saveToDb
        ? '📨 回答をDL＋DBに保存しました！次回claude.aiでクロちゃんが読めるよ'
        : '📨 回答をDLしました！ファイルをclaude.aiに渡してね';
      MeetingUI.addSystemMessage(msg);
    }

    // v1.2修正 - 全状態をクリアして通知バーも確実に非表示にする
    _currentConsultation = null;
    _meetingExecuted = false;
    _consultationStarted = false;
    _hideBar();
  }

  function _downloadResolution(resolution) {
    if (!_currentConsultation) return;
    const c = _currentConsultation;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    let md = `# 📨 相談トピック回答\n\n`;
    md += `- 相談ID: ${c.id}\n`;
    md += `- タイトル: ${c.topic}\n`;
    md += `- 日時: ${dateStr}\n\n`;
    md += `## 質問\n\n${c.question}\n\n`;
    if (c.context) {
      md += `## 背景\n\n${c.context}\n\n`;
    }
    if (c._akiyaComment) {
      md += `## アキヤの補足\n\n${c._akiyaComment}\n\n`;
    }
    md += `## 三姉妹の回答\n\n${resolution || '（会議が実行されませんでした）'}\n`;

    const blob = new Blob([md], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `COCOMI_相談回答_${c.id}_${dateStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function _saveResolutionToDb(resolution) {
    if (!_currentConsultation || typeof ApiCommon === 'undefined') return;
    try {
      const workerUrl = ApiCommon.getWorkerURL();
      const authToken = ApiCommon.getAuthToken();
      if (!workerUrl || !authToken) return;

      const res = await fetch(`${workerUrl}/consultation/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-COCOMI-AUTH': authToken,
        },
        body: JSON.stringify({
          id: _currentConsultation.id,
          resolution: resolution,
          akiya_comment: _currentConsultation._akiyaComment || null,
        }),
      });

      if (!res.ok) {
        console.error('[ConsultationUI] DB保存失敗:', res.status);
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.addSystemMessage('⚠️ DB保存に失敗しました。ファイルは保存済みです');
        }
      } else {
        console.log('[ConsultationUI] DB保存成功');
      }
    } catch (e) {
      console.error('[ConsultationUI] DB保存エラー:', e.message);
    }
  }

  function hasActiveConsultation() {
    return _currentConsultation !== null;
  }

  async function refresh() {
    _consultationStarted = false;
    await _checkPendingConsultations();
  }

  return {
    init,
    refresh,
    showResolveDialogIfNeeded,
    hasActiveConsultation,
  };
})();
