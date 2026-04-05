// COCOMITalk - ファイル入出力ハンドラー
// このファイルはファイル添付（📎）とダウンロード（💾）を管理する
// v1.0 Phase 1 - テキスト＋画像の読み込み＋テキストダウンロード
// v1.1 2026-04-06 - 添付画像タップで拡大プレビュー表示（モーダルオーバーレイ）

'use strict';

/**
 * ファイル入出力モジュール
 * - 📎添付: テキスト/画像ファイルを読み込んでAPIに渡せる形に変換
 * - 💾保存: チャット内容やAI応答をテキストファイルとしてダウンロード
 */
const FileHandler = (() => {

  // --- 対応ファイル種別 ---
  const TEXT_EXTENSIONS = ['.md', '.txt', '.js', '.json', '.css', '.html', '.csv', '.yml', '.yaml', '.xml', '.py', '.sh', '.toml'];
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  // v1.0 Phase 1: テキスト＋画像のみ。Phase 2でPDF/Word/Excel追加予定
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB上限（API制限に合わせる）
  const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 画像は4MB上限

  // --- 現在の添付ファイル ---
  let _currentAttachment = null;

  /**
   * ファイルを読み込んで添付データに変換
   * @param {File} file - 選択されたファイル
   * @returns {Promise<Object>} { type, name, size, content, mimeType }
   */
  async function readFile(file) {
    if (!file) throw new Error('ファイルが選択されていません');

    // サイズチェック
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`ファイルサイズが大きすぎるよ（${_formatSize(file.size)}）。5MB以下にしてね`);
    }

    const mimeType = file.type || '';
    const fileName = file.name || 'unknown';

    // 画像ファイル判定
    if (IMAGE_TYPES.includes(mimeType)) {
      if (file.size > MAX_IMAGE_SIZE) {
        throw new Error(`画像は4MB以下にしてね（${_formatSize(file.size)}）`);
      }
      return await _readAsImage(file, fileName, mimeType);
    }

    // テキストファイル判定（拡張子 or MIMEタイプ）
    const ext = '.' + fileName.split('.').pop().toLowerCase();
    if (TEXT_EXTENSIONS.includes(ext) || mimeType.startsWith('text/')) {
      return await _readAsText(file, fileName, mimeType);
    }

    // 未対応形式
    throw new Error(`このファイル形式（${ext}）はまだ対応してないよ。テキストか画像を選んでね`);
  }

  /**
   * テキストファイルを読み込み
   */
  function _readAsText(file, fileName, mimeType) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          type: 'text',
          name: fileName,
          size: file.size,
          content: reader.result,
          mimeType: mimeType || 'text/plain',
        });
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗したよ'));
      reader.readAsText(file, 'UTF-8');
    });
  }

  /**
   * 画像ファイルをbase64で読み込み
   */
  function _readAsImage(file, fileName, mimeType) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // data:image/jpeg;base64,xxxx の形式からbase64部分を取得
        const base64 = reader.result.split(',')[1];
        resolve({
          type: 'image',
          name: fileName,
          size: file.size,
          content: base64,
          mimeType: mimeType,
          dataUrl: reader.result, // プレビュー表示用
        });
      };
      reader.onerror = () => reject(new Error('画像の読み込みに失敗したよ'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * 添付ファイルをセット
   */
  function setAttachment(attachment) {
    _currentAttachment = attachment;
    _updatePreviewUI();
  }

  /**
   * 添付ファイルを取得＆クリア（送信時に呼ぶ）
   */
  function consumeAttachment() {
    const att = _currentAttachment;
    _currentAttachment = null;
    _updatePreviewUI();
    return att;
  }

  /**
   * 添付ファイルがあるか
   */
  function hasAttachment() {
    return _currentAttachment !== null;
  }

  /**
   * 添付をキャンセル
   */
  function clearAttachment() {
    _currentAttachment = null;
    _updatePreviewUI();
  }

  /**
   * プレビューUIを更新
   */
  function _updatePreviewUI() {
    const preview = document.getElementById('file-preview');
    if (!preview) return;

    if (!_currentAttachment) {
      preview.classList.add('hidden');
      preview.innerHTML = '';
      return;
    }

    const att = _currentAttachment;
    let html = '';

    if (att.type === 'image') {
      // v1.1変更 - 画像プレビュー（タップで拡大表示対応）
      html = `<div class="file-preview-item">
        <img src="${att.dataUrl}" alt="${att.name}" class="file-preview-thumb file-preview-zoomable" data-full-src="${att.dataUrl}">
        <span class="file-preview-name">${att.name}</span>
        <button class="file-preview-remove" aria-label="添付解除">✕</button>
      </div>`;
    } else {
      // テキストファイルプレビュー
      const shortContent = att.content.substring(0, 80).replace(/\n/g, ' ');
      html = `<div class="file-preview-item">
        <span class="file-preview-icon">📄</span>
        <span class="file-preview-name">${att.name}（${_formatSize(att.size)}）</span>
        <button class="file-preview-remove" aria-label="添付解除">✕</button>
      </div>`;
    }

    preview.innerHTML = html;
    preview.classList.remove('hidden');

    // ✕ボタンのイベント
    const removeBtn = preview.querySelector('.file-preview-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', clearAttachment);
    }

    // v1.1追加 - 画像サムネイルタップで拡大表示
    const zoomThumb = preview.querySelector('.file-preview-zoomable');
    if (zoomThumb) {
      zoomThumb.addEventListener('click', () => {
        _showImageModal(zoomThumb.dataset.fullSrc, att.name);
      });
    }
  }

  /**
   * v1.1追加 - 添付画像をフルスクリーンモーダルで拡大表示
   */
  function _showImageModal(src, name) {
    _closeImageModal();
    const overlay = document.createElement('div');
    overlay.id = 'image-preview-modal';
    overlay.className = 'image-preview-modal';
    overlay.innerHTML = `
      <div class="image-preview-modal-bg"></div>
      <div class="image-preview-modal-content">
        <img src="${src}" alt="${name}" class="image-preview-modal-img">
        <div class="image-preview-modal-footer">
          <span class="image-preview-modal-name">${name}</span>
          <button class="image-preview-modal-close" aria-label="閉じる">✕ 閉じる</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.image-preview-modal-bg').addEventListener('click', _closeImageModal);
    overlay.querySelector('.image-preview-modal-close').addEventListener('click', _closeImageModal);
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }

  /** v1.1追加 - 画像プレビューモーダルを閉じる */
  function _closeImageModal() {
    const modal = document.getElementById('image-preview-modal');
    if (modal) {
      modal.classList.remove('visible');
      setTimeout(() => modal.remove(), 200);
    }
  }

  // ============================================
  // 💾 ダウンロード機能
  // ============================================

  /**
   * テキストをファイルとしてダウンロード
   * @param {string} content - ファイル内容
   * @param {string} filename - ファイル名
   * @param {string} mimeType - MIMEタイプ（デフォルト: text/plain）
   */
  function downloadText(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * チャット全体をMarkdownとしてダウンロード
   * @param {Array} messages - メッセージ配列
   * @param {string} title - ファイルタイトル
   */
  function downloadChat(messages, title = 'COCOMITalk会話ログ') {
    const date = new Date().toISOString().split('T')[0];
    let md = `# ${title}\n**日付:** ${date}\n\n---\n\n`;

    messages.forEach(msg => {
      const role = msg.role === 'user' ? '🧑 アキヤ' : '🤖 AI';
      md += `### ${role}\n${msg.content}\n\n`;
    });

    downloadText(md, `${title}_${date}.md`, 'text/markdown');
  }

  // ============================================
  // ユーティリティ
  // ============================================

  /**
   * ファイルサイズを人間が読める形式に変換
   */
  function _formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  // v1.0追加 - 複数ファイルをZIPにまとめてダウンロード（JSZipをCDNで使用）
  async function downloadAsZip(files, zipName = 'COCOMITalk_指示書') {
    const date = new Date().toISOString().split('T')[0];
    const fullZipName = `${zipName}_${date}.zip`;

    // JSZipが読み込まれているか確認（CDNから動的に読み込み）
    if (typeof JSZip === 'undefined') {
      try {
        await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      } catch (e) {
        // JSZip読み込み失敗時は個別ダウンロードにフォールバック
        console.warn('[FileHandler] JSZip読み込み失敗、個別DLにフォールバック');
        files.forEach(f => downloadText(f.content, f.name, 'text/markdown'));
        return;
      }
    }

    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fullZipName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 外部スクリプトを動的に読み込むヘルパー
  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`スクリプト読み込み失敗: ${src}`));
      document.head.appendChild(s);
    });
  }

  /**
   * 対応ファイル形式の説明テキスト
   */
  function getSupportedFormatsText() {
    return 'テキスト（.md .txt .js .json .css等）、画像（.jpg .png .webp）';
  }

  return {
    readFile,
    setAttachment,
    consumeAttachment,
    hasAttachment,
    clearAttachment,
    downloadText,
    downloadChat,
    downloadAsZip,
    getSupportedFormatsText,
  };
})();
