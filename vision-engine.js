// COCOMITalk - ビジョンエンジン（三姉妹の目）
// このファイルはカメラ映像の取得・キャプチャ・解像度最適化を管理する
// ここちゃん（Gemini）が三姉妹の「目」として映像を見るための共通基盤
// v1.0 2026-04-05 - Step1: カメラ起動/手動キャプチャ/解像度リサイズ/FileHandler連携
// v1.1 2026-04-05 - ズーム機能追加（スライダー1x〜4x、CSS scale+Canvas中央クロップ）
// v1.2 2026-04-05 - 解像度3段階切替（エコ/標準/高精細）+ ズーム上限連動

'use strict';

/**
 * ビジョンエンジンモジュール
 * - カメラ起動/停止（getUserMedia）
 * - 手動キャプチャ（ボタンタップで即撮影）
 * - 変化検出モード（将来Step2で追加）
 * - 解像度最適化（320x240でコスト削減）
 * - FileHandlerとの連携（既存の添付フローに乗せる）
 */
const VisionEngine = (() => {

  // --- 設定 ---
  // v1.2変更 - 解像度プリセット定義
  const RESOLUTION_PRESETS = {
    eco:      { width: 320,  height: 240, quality: 0.7, zoomMax: 4.0, label: '🌿エコ',   desc: '320x240' },
    standard: { width: 640,  height: 480, quality: 0.8, zoomMax: 6.0, label: '📋標準',   desc: '640x480' },
    hd:       { width: 1280, height: 720, quality: 0.85, zoomMax: 8.0, label: '🔍高精細', desc: '1280x720' },
  };
  const PRESET_ORDER = ['eco', 'standard', 'hd']; // 切替順序
  const CAPTURE_MIME = 'image/jpeg';

  // v1.2変更 - ズーム設定（上限はプリセットで動的に変わる）
  const ZOOM_MIN = 1.0;
  let _zoomMax = 4.0; // v1.2: プリセットに応じて動的に変わる
  const ZOOM_STEP = 0.1;
  const ZOOM_DEFAULT = 1.0;

  // --- 内部状態 ---
  let _stream = null;        // MediaStream（カメラ映像）
  let _videoEl = null;        // <video>要素（プレビュー表示用）
  let _canvas = null;         // <canvas>要素（キャプチャ用、非表示）
  let _isActive = false;      // カメラON/OFF
  let _captureCount = 0;      // キャプチャ回数カウンター

  // v1.1追加 - ズーム状態
  let _zoomLevel = ZOOM_DEFAULT; // 現在のズーム倍率

  // v1.2追加 - 現在の解像度プリセット
  let _currentPreset = 'eco';

  // --- 変化検出用（Step2で使用） ---
  let _prevFrameData = null;  // 前回フレームのImageData
  let _autoTimer = null;      // 自動キャプチャ用タイマーID

  /**
   * カメラを起動してプレビュー表示を開始
   * @param {HTMLVideoElement} videoElement - プレビュー表示先の<video>要素
   * @returns {Promise<boolean>} 成功したらtrue
   */
  async function startCamera(videoElement) {
    if (_isActive) {
      console.log('[VisionEngine] カメラは既に起動中');
      return true;
    }

    if (!videoElement) {
      console.error('[VisionEngine] video要素が指定されていません');
      return false;
    }

    try {
      // カメラアクセス要求（背面カメラ優先 = お散歩・現場向け）
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }, // 背面カメラ優先
          width: { ideal: 640 },   // プレビューは少し高めでOK
          height: { ideal: 480 },
        },
        audio: false, // 音声は不要（STTは別系統で処理）
      });

      _videoEl = videoElement;
      _videoEl.srcObject = _stream;
      _videoEl.setAttribute('playsinline', ''); // iOS対応
      _videoEl.setAttribute('autoplay', '');
      _videoEl.muted = true;
      await _videoEl.play();

      // v1.2変更 - キャプチャ用Canvas（プリセットの解像度で生成）
      const preset = RESOLUTION_PRESETS[_currentPreset];
      _canvas = document.createElement('canvas');
      _canvas.width = preset.width;
      _canvas.height = preset.height;

      _isActive = true;
      _captureCount = 0;
      console.log('[VisionEngine] カメラ起動完了');
      return true;

    } catch (err) {
      console.error('[VisionEngine] カメラ起動失敗:', err.message);
      // ユーザー向けメッセージ
      if (err.name === 'NotAllowedError') {
        throw new Error('カメラのアクセスが許可されていないよ。ブラウザの設定でカメラを許可してね');
      } else if (err.name === 'NotFoundError') {
        throw new Error('カメラが見つからないよ。カメラが付いてるか確認してね');
      }
      throw new Error(`カメラの起動に失敗したよ: ${err.message}`);
    }
  }

  /**
   * カメラを停止
   */
  function stopCamera() {
    // 自動キャプチャ停止
    stopAutoCapture();

    if (_stream) {
      _stream.getTracks().forEach(track => track.stop());
      _stream = null;
    }
    if (_videoEl) {
      _videoEl.srcObject = null;
      _videoEl = null;
    }
    _canvas = null;
    _isActive = false;
    _prevFrameData = null;
    _captureCount = 0;
    _zoomLevel = ZOOM_DEFAULT; // v1.1追加 - ズームリセット
    _currentPreset = 'eco'; // v1.2追加 - 解像度リセット
    _zoomMax = RESOLUTION_PRESETS.eco.zoomMax; // v1.2追加
    console.log('[VisionEngine] カメラ停止完了');
  }

  /**
   * 現在のカメラ映像をキャプチャして添付ファイルとして登録
   * ボタンタップ or ボイスコマンド「見て！」で呼ばれる
   * @returns {Object|null} { type, name, size, content, mimeType, dataUrl }
   */
  function captureAndAttach() {
    if (!_isActive || !_videoEl || !_canvas) {
      console.warn('[VisionEngine] カメラが起動していません');
      return null;
    }

    const ctx = _canvas.getContext('2d');

    // v1.2変更 - 解像度プリセット対応: 中央クロップ方式で描画
    const preset = RESOLUTION_PRESETS[_currentPreset];
    const vw = _videoEl.videoWidth || 640;
    const vh = _videoEl.videoHeight || 480;
    const sw = vw / _zoomLevel;
    const sh = vh / _zoomLevel;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    ctx.drawImage(_videoEl, sx, sy, sw, sh, 0, 0, preset.width, preset.height);

    // JPEG形式のDataURLに変換（品質もプリセットに応じて調整）
    const dataUrl = _canvas.toDataURL(CAPTURE_MIME, preset.quality);
    // Base64部分だけ取得（data:image/jpeg;base64, を除去）
    const base64 = dataUrl.split(',')[1];

    // バイトサイズ概算（Base64は元データの約1.33倍）
    const sizeBytes = Math.round(base64.length * 0.75);

    _captureCount++;
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    const fileName = `vision_${_captureCount}.jpg`;

    // FileHandlerの添付形式に合わせたオブジェクトを生成
    const attachment = {
      type: 'image',
      name: fileName,
      size: sizeBytes,
      content: base64,       // Base64文字列（Gemini inlineData用）
      mimeType: CAPTURE_MIME,
      dataUrl: dataUrl,       // プレビュー表示用
    };

    // FileHandlerに登録 → 既存の送信フローで自動的にGeminiに送られる
    if (typeof FileHandler !== 'undefined') {
      FileHandler.setAttachment(attachment);
    }

    console.log(`[VisionEngine] キャプチャ#${_captureCount}: ${fileName} (${_formatSize(sizeBytes)}) [${timestamp}]`);
    return attachment;
  }

  /**
   * キャプチャのみ実行（添付登録なし、変化検出やプレビュー用）
   * @returns {ImageData|null} Canvas上のピクセルデータ
   */
  function _captureFrame() {
    if (!_isActive || !_videoEl || !_canvas) return null;
    const ctx = _canvas.getContext('2d');
    // v1.2変更 - 解像度プリセット対応
    const preset = RESOLUTION_PRESETS[_currentPreset];
    const vw = _videoEl.videoWidth || 640;
    const vh = _videoEl.videoHeight || 480;
    const sw = vw / _zoomLevel;
    const sh = vh / _zoomLevel;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;
    ctx.drawImage(_videoEl, sx, sy, sw, sh, 0, 0, preset.width, preset.height);
    return ctx.getImageData(0, 0, preset.width, preset.height);
  }

  // ============================================
  // Step2用: 変化検出（今は骨格だけ、将来有効化）
  // ============================================

  /**
   * 2つのフレーム間の変化率を計算（ピクセル差分比較）
   * @param {ImageData} frame1 - 前のフレーム
   * @param {ImageData} frame2 - 今のフレーム
   * @returns {number} 変化率（0.0〜1.0）
   */
  function _calcChangeRate(frame1, frame2) {
    if (!frame1 || !frame2) return 1.0; // 初回は必ず「変化あり」
    const d1 = frame1.data;
    const d2 = frame2.data;
    const len = d1.length;
    let diffCount = 0;
    // RGBの差の合計が閾値を超えるピクセルをカウント（Aチャンネルはスキップ）
    const threshold = 30; // 1ピクセルあたりの差分閾値
    for (let i = 0; i < len; i += 4) {
      const dr = Math.abs(d1[i] - d2[i]);
      const dg = Math.abs(d1[i + 1] - d2[i + 1]);
      const db = Math.abs(d1[i + 2] - d2[i + 2]);
      if (dr + dg + db > threshold) {
        diffCount++;
      }
    }
    const totalPixels = len / 4;
    return diffCount / totalPixels;
  }

  /**
   * 自動キャプチャ開始（変化検出モード）
   * @param {number} intervalMs - チェック間隔（ミリ秒、デフォルト30秒）
   * @param {number} changeThreshold - 変化率の閾値（デフォルト0.3 = 30%変化で送信）
   */
  function startAutoCapture(intervalMs = 30000, changeThreshold = 0.3) {
    if (_autoTimer) {
      console.log('[VisionEngine] 自動キャプチャは既に動作中');
      return;
    }

    console.log(`[VisionEngine] 自動キャプチャ開始（間隔:${intervalMs / 1000}秒, 閾値:${changeThreshold * 100}%）`);

    _autoTimer = setInterval(() => {
      const currentFrame = _captureFrame();
      if (!currentFrame) return;

      const changeRate = _calcChangeRate(_prevFrameData, currentFrame);
      _prevFrameData = currentFrame;

      if (changeRate >= changeThreshold) {
        console.log(`[VisionEngine] 変化検出: ${(changeRate * 100).toFixed(1)}% → 自動キャプチャ実行`);
        captureAndAttach();
        // 自動送信トリガー（chat-core.jsのイベントとして発火）
        const event = new CustomEvent('vision-auto-capture', {
          detail: { changeRate, captureCount: _captureCount }
        });
        document.dispatchEvent(event);
      } else {
        console.log(`[VisionEngine] 変化少ない: ${(changeRate * 100).toFixed(1)}% → スキップ`);
      }
    }, intervalMs);
  }

  /**
   * 自動キャプチャ停止
   */
  function stopAutoCapture() {
    if (_autoTimer) {
      clearInterval(_autoTimer);
      _autoTimer = null;
      _prevFrameData = null;
      console.log('[VisionEngine] 自動キャプチャ停止');
    }
  }

  // ============================================
  // v1.1追加: ズーム制御
  // ============================================

  /**
   * ズーム倍率を設定（1.0〜4.0）
   * CSSのtransform scaleでプレビュー拡大 + キャプチャ時にCanvas中央クロップ
   * @param {number} level - ズーム倍率
   */
  function setZoom(level) {
    _zoomLevel = Math.max(ZOOM_MIN, Math.min(_zoomMax, level));

    // CSSでプレビュー映像を拡大（見た目の反映）
    if (_videoEl) {
      _videoEl.style.transform = `scale(${_zoomLevel})`;
      _videoEl.style.transformOrigin = 'center center';
    }

    console.log(`[VisionEngine] ズーム: ${_zoomLevel.toFixed(1)}x`);
    return _zoomLevel;
  }

  /**
   * 現在のズーム倍率を取得
   * @returns {number}
   */
  function getZoom() {
    return _zoomLevel;
  }

  // ============================================
  // v1.2追加: 解像度プリセット切替
  // ============================================

  /**
   * 解像度プリセットを設定
   * @param {string} presetKey - 'eco' | 'standard' | 'hd'
   * @returns {Object} 設定後のプリセット情報
   */
  function setResolution(presetKey) {
    const preset = RESOLUTION_PRESETS[presetKey];
    if (!preset) {
      console.warn(`[VisionEngine] 不明なプリセット: ${presetKey}`);
      return null;
    }

    _currentPreset = presetKey;
    _zoomMax = preset.zoomMax;

    // Canvas解像度を更新
    if (_canvas) {
      _canvas.width = preset.width;
      _canvas.height = preset.height;
    }

    // 現在のズームが新しい上限を超えてたらクランプ
    if (_zoomLevel > _zoomMax) {
      setZoom(_zoomMax);
    }

    console.log(`[VisionEngine] 解像度変更: ${preset.label} (${preset.desc}) / ズーム上限: ${preset.zoomMax}x`);
    return { key: presetKey, ...preset, currentZoomMax: _zoomMax };
  }

  /**
   * 次の解像度プリセットに切替（eco → standard → hd → eco ...）
   * @returns {Object} 切替後のプリセット情報
   */
  function cycleResolution() {
    const currentIdx = PRESET_ORDER.indexOf(_currentPreset);
    const nextIdx = (currentIdx + 1) % PRESET_ORDER.length;
    return setResolution(PRESET_ORDER[nextIdx]);
  }

  /**
   * 現在の解像度プリセット情報を取得
   * @returns {Object}
   */
  function getResolution() {
    const preset = RESOLUTION_PRESETS[_currentPreset];
    return { key: _currentPreset, ...preset, currentZoomMax: _zoomMax };
  }

  // ============================================
  // ユーティリティ
  // ============================================

  /**
   * カメラが起動中か
   */
  function isActive() {
    return _isActive;
  }

  /**
   * キャプチャ回数を取得
   */
  function getCaptureCount() {
    return _captureCount;
  }

  /**
   * 自動キャプチャが動作中か
   */
  function isAutoCapturing() {
    return _autoTimer !== null;
  }

  /**
   * ファイルサイズを人間が読める形式に変換
   */
  function _formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * カメラ/背面カメラの前面切替
   */
  async function switchCamera() {
    if (!_isActive) return false;
    const currentTrack = _stream?.getVideoTracks()[0];
    if (!currentTrack) return false;

    const settings = currentTrack.getSettings();
    const currentFacing = settings.facingMode || 'environment';
    const newFacing = currentFacing === 'environment' ? 'user' : 'environment';

    stopCamera();
    // 一瞬待つ（カメラリソース解放のため）
    await new Promise(r => setTimeout(r, 300));

    const videoEl = document.getElementById('vision-preview');
    if (!videoEl) return false;

    // 新しい向きで再起動
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: newFacing }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      _videoEl = videoEl;
      _videoEl.srcObject = _stream;
      _videoEl.setAttribute('playsinline', '');
      _videoEl.setAttribute('autoplay', '');
      _videoEl.muted = true;
      await _videoEl.play();

      const preset = RESOLUTION_PRESETS[_currentPreset]; // v1.2変更
      _canvas = document.createElement('canvas');
      _canvas.width = preset.width;
      _canvas.height = preset.height;
      _isActive = true;

      // v1.1追加 - ズーム倍率を維持（カメラ切替後も同じズームレベル）
      if (_zoomLevel !== ZOOM_DEFAULT && _videoEl) {
        _videoEl.style.transform = `scale(${_zoomLevel})`;
        _videoEl.style.transformOrigin = 'center center';
      }

      console.log(`[VisionEngine] カメラ切替: ${currentFacing} → ${newFacing}`);
      return true;
    } catch (err) {
      console.error('[VisionEngine] カメラ切替失敗:', err.message);
      return false;
    }
  }

  // --- 公開API ---
  return {
    startCamera,
    stopCamera,
    captureAndAttach,
    startAutoCapture,
    stopAutoCapture,
    setZoom,      // v1.1追加
    getZoom,      // v1.1追加
    setResolution,    // v1.2追加
    cycleResolution,  // v1.2追加
    getResolution,    // v1.2追加
    switchCamera,
    isActive,
    isAutoCapturing,
    getCaptureCount,
  };
})();
