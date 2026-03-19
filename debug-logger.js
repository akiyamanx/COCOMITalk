// COCOMITalk - デバッグログ記録＋ファイル出力
// このファイルはデバッグパネルのログをバッファに蓄積し、
// パネルOFF時にテキストファイルとしてダウンロードする機能を提供する。
// OFFにするとバッファは自動クリアされる。
// v1.0 2026-03-19 新規作成

'use strict';

const DebugLogger = (() => {
  // ログバッファ（上限なし — デバッグOFF時に全部出力してクリア）
  let _buffer = [];
  let _active = false;

  /**
   * ログを1行追加（whisper-provider._debugLogから呼ばれる）
   * @param {string} line - タイムスタンプ付きのログ行
   */
  function addLog(line) {
    if (!_active) return;
    _buffer.push(line);
  }

  /**
   * デバッグモードを開始（パネルON時）
   */
  function start() {
    _active = true;
    _buffer = [];
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    _buffer.push(`[${ts}] === DebugLogger 記録開始 ===`);
    console.log('[DebugLogger] 記録開始');
  }

  /**
   * デバッグモードを終了してログファイルをダウンロード（パネルOFF時）
   * ログが空なら何もしない
   */
  function stopAndDownload() {
    if (!_active) return;
    _active = false;

    // v1.0 ログが記録開始の1行だけなら（実質空）ダウンロードしない
    if (_buffer.length <= 1) {
      _buffer = [];
      console.log('[DebugLogger] ログ空 → ダウンロードスキップ');
      return;
    }

    // 終了行を追加
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    _buffer.push(`[${ts}] === DebugLogger 記録終了（${_buffer.length}行） ===`);

    // ファイル名: COCOMITalk_debug_YYYY-MM-DD_HHmmss.txt
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const fileName = `COCOMITalk_debug_${dateStr}_${timeStr}.txt`;

    // テキストファイルとしてダウンロード
    const text = _buffer.join('\n');
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // クリーンアップ
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    console.log(`[DebugLogger] ${_buffer.length}行のログを ${fileName} としてダウンロード`);

    // バッファクリア
    _buffer = [];
  }

  /**
   * 現在のバッファ行数を取得
   */
  function getLineCount() {
    return _buffer.length;
  }

  /**
   * 記録中かどうか
   */
  function isActive() {
    return _active;
  }

  return {
    addLog,
    start,
    stopAndDownload,
    getLineCount,
    isActive,
  };
})();

// グローバルに公開
window.DebugLogger = DebugLogger;
