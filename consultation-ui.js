// COCOMITalk - 相談トピック連携UI
// このファイルは何をするか:
// claude.aiクロちゃんが書き込んだ相談トピックを会議画面に通知バーとして表示し、
// アキヤが補足コメントを追加して三姉妹会議に投入する。
// 会議完了後は「ファイルDLだけ」or「DL＋DB保存」を選べる。
// v1.0 2026-03-28 - 新規作成
'use strict';

/** 相談トピック連携UIモジュール */
const ConsultationUI = (() => {

  // 現在表示中の相談トピック
  let _currentConsultation = null;
  // 通知バー要素
  let _barEl = null;
  // 展開パネル要素
  let _panelEl = null;
  // 回答ダイアログ要素
  let _dialogEl = null;

  /**
   * 初期化 — 会議画面表示時に呼ばれる
   * pending相談があれば通知バーを表示する
   */
  async function init() {
    _createElements();
    await _checkPendingConsultations();
  }

  /** DOM要素を生成（まだDOMに追加されていなければ作る） */
  function _createElements() {
    // v1.0 - 通知バー
    if (!document.getElementById('consultation-bar')) {
      const bar = document.createElement('div');
      bar.id = 'consultation-bar';
      bar.className = 'consultation-bar hidden';
      bar.innerHTML = `<span class="consultation-bar-icon">📨</span><span class="consultation-bar-text"></span><span class="consultation-bar-arrow">▼</span>`;
      bar.addEventListener('click', _togglePanel);
      _barEl = bar;

      // v1.0 - 展開パネル
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

      // v1.0 - 回答ダイアログ
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

      // v1.0 - DOMに挿入（会議フッターの先頭に通知バー＋パネル）
      const meetingFooter = document.querySelector('.meeting-input-area');
      if (meetingFooter) {
        meetingFooter.insertBefore(panel, meetingFooter.firstChild);
        meetingFooter.insertBefore(bar, meetingFooter.firstChild);
      }

      // 回答ダイアログは会議画面に追加
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

  /** pending相談があるかチェック */
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
        // 最新の1件を表示（複数ある場合は最新優先）
        _currentConsultation = consultations[0];
        _showBar(consultations.length);
      } else {
        _hideBar();
      }
    } catch (e) {
      console.warn('[ConsultationUI] 相談チェックスキップ:', e.message);
    }
  }

  /** 通知バーを表示 */
  function _showBar(count) {
    if (!_barEl) return;
    const text = _barEl.querySelector('.consultation-bar-text');
    text.textContent = `クロちゃんからの相談が${count}件あるよ！`;
    _barEl.classList.remove('hidden');
  }

  /** 通知バーを非表示 */
  function _hideBar() {
    if (_barEl) _barEl.classList.add('hidden');
    _hidePanel();
  }

  /** パネルの展開/折りたたみトグル */
  function _togglePanel() {
    if (!_panelEl) return;
    if (_panelEl.classList.contains('hidden')) {
      _showPanel();
    } else {
      _hidePanel();
    }
  }

  /** パネルを展開して相談内容を表示 */
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
    // 補足コメント欄をクリア
    _panelEl.querySelector('.consultation-comment-input').value = '';
    _panelEl.classList.remove('hidden');
    // 矢印を上向きに
    const arrow = _barEl.querySelector('.consultation-bar-arrow');
    if (arrow) arrow.textContent = '▲';
  }

  /** パネルを折りたたむ */
  function _hidePanel() {
    if (_panelEl) _panelEl.classList.add('hidden');
    if (_barEl) {
      const arrow = _barEl.querySelector('.consultation-bar-arrow');
      if (arrow) arrow.textContent = '▼';
    }
  }

  /** 相談トピックで会議を開始する */
  function _startMeetingWithConsultation() {
    if (!_currentConsultation) return;
    const c = _currentConsultation;
    const comment = _panelEl.querySelector('.consultation-comment-input').value.trim();

    // 議題テキストを組み立て
    let topic = `【📨 相談トピック】${c.topic}\n\n${c.question}`;
    if (c.context) {
      topic += `\n\n【背景】\n${c.context}`;
    }
    if (comment) {
      topic += `\n\n【アキヤの補足】\n${comment}`;
      // アキヤのコメントを保持（resolve時に使う）
      _currentConsultation._akiyaComment = comment;
    }

    // 議題入力欄にセット
    const topicInput = document.querySelector('.meeting-topic-input');
    if (topicInput) {
      topicInput.value = topic;
      // テキストエリアの高さを自動調整
      topicInput.style.height = 'auto';
      topicInput.style.height = topicInput.scrollHeight + 'px';
    }

    // パネルを閉じる
    _hidePanel();
    _hideBar();

    console.log('[ConsultationUI] 相談トピックを議題に挿入:', c.topic);
  }

  /**
   * 会議完了後に回答ダイアログを表示する
   * meeting-ui.jsの会議終了フローから呼ばれる
   * @returns {boolean} 相談トピック会議だったらtrue
   */
  function showResolveDialogIfNeeded() {
    if (!_currentConsultation) return false;
    if (_dialogEl) {
      _dialogEl.classList.remove('hidden');
    }
    return true;
  }

  /**
   * 回答を処理する（DLのみ or DL＋DB保存）
   * @param {boolean} saveToDb - DBにも保存するかどうか
   */
  async function _resolveConsultation(saveToDb) {
    // ダイアログを閉じる
    if (_dialogEl) _dialogEl.classList.add('hidden');

    if (!_currentConsultation) return;

    // 会議の結論テキストを取得（MeetingRelayから）
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

    // v1.0 - ファイルDL（必ず実行）
    _downloadResolution(resolution);

    // v1.0 - DB保存（アキヤが選んだ時だけ）
    if (saveToDb) {
      await _saveResolutionToDb(resolution);
    }

    // 完了メッセージ
    if (typeof MeetingUI !== 'undefined') {
      const msg = saveToDb
        ? '📨 回答をDL＋DBに保存しました！次回claude.aiでクロちゃんが読めるよ'
        : '📨 回答をDLしました！ファイルをclaude.aiに渡してね';
      MeetingUI.addSystemMessage(msg);
    }

    // 相談トピックをクリア
    _currentConsultation = null;
  }

  /** 回答をMarkdownファイルとしてDL */
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
    md += `## 三姉妹の回答\n\n${resolution}\n`;

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

  /** 回答をD1に保存（relay /consultation/resolve 経由） */
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

  /** 現在の相談トピックがあるか確認（外部参照用） */
  function hasActiveConsultation() {
    return _currentConsultation !== null;
  }

  /** リフレッシュ（会議画面再表示時に呼ぶ） */
  async function refresh() {
    await _checkPendingConsultations();
  }

  return {
    init,
    refresh,
    showResolveDialogIfNeeded,
    hasActiveConsultation,
  };
})();
