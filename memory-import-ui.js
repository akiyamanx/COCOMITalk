// このファイルは何をするか:
// COCOMITalkの記憶インポートUI。独立した全画面オーバーレイで、
// D1＋Vectorizeに記憶を直接投入する。3つの入力モードに対応:
// ①テキスト1件入力 ②JSON一括ペースト ③MDファイルアップロード→自動パース
// v1.0 2026-03-16 - 新規作成（実行計画書v24.0「次のステップ#1」）
'use strict';

const MemoryImportUI = (() => {
  // ============================================================
  // 初期化
  // ============================================================
  function init() {
    const btnOpen = document.getElementById('btn-open-memory-import');
    if (btnOpen) btnOpen.addEventListener('click', show);
    _injectStyles();
  }

  // ============================================================
  // 画面表示/非表示
  // ============================================================
  function show() {
    let overlay = document.getElementById('memory-import-overlay');
    if (!overlay) {
      overlay = _createOverlay();
      document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
    _switchMode('single');
  }

  function hide() {
    const overlay = document.getElementById('memory-import-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  // ============================================================
  // オーバーレイDOM生成
  // ============================================================
  function _createOverlay() {
    const el = document.createElement('div');
    el.id = 'memory-import-overlay';
    el.className = 'memory-import-overlay hidden';
    el.innerHTML = `
      <div class="mi-header">
        <h2>📁 記憶インポート</h2>
        <button id="mi-btn-close" class="icon-btn" aria-label="閉じる">✕</button>
      </div>
      <div class="mi-tabs">
        <button class="mi-tab active" data-mode="single">✏️ 1件入力</button>
        <button class="mi-tab" data-mode="json">📋 JSON一括</button>
        <button class="mi-tab" data-mode="md">📄 MDファイル</button>
      </div>
      <div class="mi-body">
        <!-- 1件入力モード -->
        <div id="mi-mode-single" class="mi-mode">
          <label>トピック（必須）</label>
          <input type="text" id="mi-topic" placeholder="例: 方針F完了" maxlength="100">
          <label>内容・経緯（必須）</label>
          <textarea id="mi-summary" rows="6" placeholder="経緯や理由も含めて記載。長文OK！"></textarea>
          <label>姉妹</label>
          <select id="mi-sister">
            <option value="">指定なし</option>
            <option value="koko">ここちゃん</option>
            <option value="kuro">クロちゃん</option>
            <option value="onee">お姉ちゃん</option>
          </select>
          <label>カテゴリ</label>
          <input type="text" id="mi-category" placeholder="例: 開発/雑談/ドライブ" maxlength="20">
          <button id="mi-btn-submit-single" class="mi-btn-submit">📤 投入する</button>
        </div>
        <!-- JSON一括モード -->
        <div id="mi-mode-json" class="mi-mode hidden">
          <label>JSON配列を貼り付け</label>
          <textarea id="mi-json" rows="10" placeholder='[{"topic":"...", "summary":"..."}, ...]'></textarea>
          <p class="mi-hint">最大20件。各要素にtopicとsummaryが必須。</p>
          <button id="mi-btn-submit-json" class="mi-btn-submit">📤 一括投入</button>
        </div>
        <!-- MDファイルモード -->
        <div id="mi-mode-md" class="mi-mode hidden">
          <label>セッションカプセルMDファイルを選択</label>
          <input type="file" id="mi-file" accept=".md,.txt">
          <div id="mi-md-preview" class="mi-md-preview hidden">
            <p class="mi-preview-title">📋 抽出結果プレビュー:</p>
            <div id="mi-md-list"></div>
            <button id="mi-btn-submit-md" class="mi-btn-submit">📤 まとめて投入</button>
          </div>
        </div>
      </div>
      <div id="mi-status" class="mi-status hidden"></div>
    `;
    // イベント設定
    el.querySelector('#mi-btn-close').addEventListener('click', hide);
    el.querySelectorAll('.mi-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchMode(tab.dataset.mode));
    });
    el.querySelector('#mi-btn-submit-single').addEventListener('click', _submitSingle);
    el.querySelector('#mi-btn-submit-json').addEventListener('click', _submitJSON);
    el.querySelector('#mi-file').addEventListener('change', _onFileSelect);
    return el;
  }

  // ============================================================
  // タブ切り替え
  // ============================================================
  function _switchMode(mode) {
    document.querySelectorAll('.mi-mode').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('.mi-tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById(`mi-mode-${mode}`);
    const tab = document.querySelector(`.mi-tab[data-mode="${mode}"]`);
    if (panel) panel.classList.remove('hidden');
    if (tab) tab.classList.add('active');
  }

  // ============================================================
  // 1件投入
  // ============================================================
  async function _submitSingle() {
    const topic = document.getElementById('mi-topic').value.trim();
    const summary = document.getElementById('mi-summary').value.trim();
    const sister = document.getElementById('mi-sister').value || null;
    const category = document.getElementById('mi-category').value.trim() || null;
    if (!topic || !summary) return _showStatus('⚠️ トピックと内容は必須です', 'error');

    _showStatus('📤 投入中...', 'loading');
    const body = { topic, summary, type: 'import' };
    if (sister) body.sister = sister;
    if (category) body.category = category;

    const result = await _callImportAPI(body);
    if (result.success) {
      _showStatus(`✅ 投入成功！（${result.keys[0]}）`, 'success');
      document.getElementById('mi-topic').value = '';
      document.getElementById('mi-summary').value = '';
    } else {
      _showStatus(`❌ ${result.error || '投入失敗'}`, 'error');
    }
  }

  // ============================================================
  // JSON一括投入
  // ============================================================
  async function _submitJSON() {
    const raw = document.getElementById('mi-json').value.trim();
    if (!raw) return _showStatus('⚠️ JSONを貼り付けてください', 'error');

    let memories;
    try {
      const parsed = JSON.parse(raw);
      memories = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return _showStatus('⚠️ JSONの形式が正しくありません', 'error');
    }

    _showStatus(`📤 ${memories.length}件を投入中...`, 'loading');
    const result = await _callImportAPI({ memories });
    if (result.success) {
      let msg = `✅ ${result.imported}件投入成功！`;
      if (result.skipped > 0) msg += `（${result.skipped}件重複スキップ）`;
      if (result.errors > 0) msg += `（${result.errors}件エラー）`;
      _showStatus(msg, 'success');
    } else {
      _showStatus(`❌ ${result.error || '投入失敗'}`, 'error');
    }
  }

  // ============================================================
  // MDファイル読み込み＋パース
  // ============================================================
  function _onFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const sections = _parseMD(text);
      _showMDPreview(sections);
    };
    reader.readAsText(file);
  }

  /**
   * MD見出し単位でセクション分割
   * ## や ### を区切りに、見出し→topic、本文→summary
   * 経緯・失敗・学びを全部含めて1記憶にする
   */
  function _parseMD(text) {
    const lines = text.split('\n');
    const sections = [];
    let currentTopic = null;
    let currentLines = [];

    for (const line of lines) {
      // ## または ### 見出しを検出（# 1個はタイトルなのでスキップ）
      const headingMatch = line.match(/^(#{2,3})\s+(.+)/);
      if (headingMatch) {
        // 前のセクションを保存
        if (currentTopic && currentLines.length > 0) {
          sections.push(_buildSection(currentTopic, currentLines));
        }
        currentTopic = headingMatch[2].trim();
        currentLines = [];
      } else if (currentTopic) {
        currentLines.push(line);
      }
    }
    // 最後のセクション
    if (currentTopic && currentLines.length > 0) {
      sections.push(_buildSection(currentTopic, currentLines));
    }
    return sections;
  }

  function _buildSection(topic, lines) {
    // 空行のみのセクションは除外用に短いsummaryになる
    const summary = lines.join('\n').trim();
    // トピックからMarkdown装飾を除去
    const cleanTopic = topic
      .replace(/[*_`#]/g, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    return { topic: cleanTopic, summary, type: 'import' };
  }

  function _showMDPreview(sections) {
    const preview = document.getElementById('mi-md-preview');
    const listDiv = document.getElementById('mi-md-list');
    // 空セクション（summary 10文字未満）を除外
    const valid = sections.filter(s => s.summary.length >= 10);
    if (valid.length === 0) {
      listDiv.innerHTML = '<p>⚠️ 投入可能なセクションが見つかりません</p>';
      preview.classList.remove('hidden');
      return;
    }
    listDiv.innerHTML = valid.map((s, i) => `
      <div class="mi-preview-item">
        <label><input type="checkbox" class="mi-md-check" data-idx="${i}" checked>
          <strong>${_escapeHtml(s.topic)}</strong></label>
        <p class="mi-preview-summary">${_escapeHtml(s.summary.substring(0, 120))}${s.summary.length > 120 ? '...' : ''}</p>
      </div>
    `).join('');
    preview.classList.remove('hidden');
    // 投入ボタンのイベント再設定（セクションデータを保持）
    const btn = document.getElementById('mi-btn-submit-md');
    btn.onclick = () => _submitMD(valid);
  }

  // ============================================================
  // MD一括投入
  // ============================================================
  async function _submitMD(sections) {
    const checks = document.querySelectorAll('.mi-md-check:checked');
    const indices = Array.from(checks).map(c => parseInt(c.dataset.idx));
    const selected = indices.map(i => sections[i]).filter(Boolean);
    if (selected.length === 0) return _showStatus('⚠️ 投入するセクションを選んでください', 'error');

    _showStatus(`📤 ${selected.length}件を投入中...`, 'loading');
    const result = await _callImportAPI({ memories: selected });
    if (result.success) {
      let msg = `✅ ${result.imported}件投入成功！`;
      if (result.skipped > 0) msg += `（${result.skipped}件重複スキップ）`;
      if (result.errors > 0) msg += `（${result.errors}件エラー）`;
      _showStatus(msg, 'success');
    } else {
      _showStatus(`❌ ${result.error || '投入失敗'}`, 'error');
    }
  }

  // ============================================================
  // API呼び出し共通
  // ============================================================
  async function _callImportAPI(body) {
    try {
      // ApiCommon.callAPIを使って認証ヘッダーを自動付与
      return await ApiCommon.callAPI('memory-import', body);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ============================================================
  // ステータス表示
  // ============================================================
  function _showStatus(msg, type) {
    const el = document.getElementById('mi-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `mi-status mi-status-${type}`;
    el.classList.remove('hidden');
    if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // スタイル動的注入（行数節約のためCSS別ファイルにしない）
  // ============================================================
  function _injectStyles() {
    if (document.getElementById('mi-styles')) return;
    const style = document.createElement('style');
    style.id = 'mi-styles';
    style.textContent = `
.memory-import-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:#1a1a2e;color:#e0e0e0;z-index:3000;overflow-y:auto;display:flex;flex-direction:column}
.memory-import-overlay.hidden{display:none}
.mi-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #333}
.mi-header h2{margin:0;font-size:1.1rem}
.mi-tabs{display:flex;gap:0;border-bottom:1px solid #333}
.mi-tab{flex:1;padding:10px 8px;background:transparent;border:none;color:#999;font-size:0.85rem;cursor:pointer;border-bottom:2px solid transparent}
.mi-tab.active{color:#a78bfa;border-bottom-color:#a78bfa}
.mi-body{flex:1;padding:16px;overflow-y:auto}
.mi-mode.hidden{display:none}
.mi-mode label{display:block;font-size:0.82rem;color:#aaa;margin:10px 0 4px}
.mi-mode label:first-child{margin-top:0}
.mi-mode input[type="text"],.mi-mode textarea,.mi-mode select{width:100%;padding:10px;background:#252540;border:1px solid #444;border-radius:8px;color:#e0e0e0;font-size:0.9rem;box-sizing:border-box}
.mi-mode textarea{resize:vertical;font-family:inherit}
.mi-mode input[type="file"]{margin:8px 0}
.mi-btn-submit{width:100%;padding:12px;margin-top:16px;background:linear-gradient(135deg,#6c5ce7,#a78bfa);border:none;border-radius:10px;color:#fff;font-size:1rem;font-weight:bold;cursor:pointer}
.mi-btn-submit:active{opacity:0.8}
.mi-hint{font-size:0.78rem;color:#888;margin:6px 0 0}
.mi-status{padding:10px 16px;font-size:0.85rem;text-align:center}
.mi-status.hidden{display:none}
.mi-status-loading{color:#ffd166}
.mi-status-success{color:#06d6a0}
.mi-status-error{color:#ef476f}
.mi-md-preview{margin-top:12px}
.mi-preview-title{font-size:0.85rem;color:#a78bfa;margin:0 0 8px}
.mi-preview-item{padding:8px;margin:4px 0;background:#252540;border-radius:8px}
.mi-preview-item label{display:flex;align-items:center;gap:6px;font-size:0.9rem}
.mi-preview-summary{font-size:0.78rem;color:#999;margin:4px 0 0 24px;white-space:pre-wrap;word-break:break-all}
    `;
    document.head.appendChild(style);
  }

  return { init, show, hide };
})();
