// COCOMITalk - ビジョンUIコントローラー
// このファイルはカメラUI（ON/OFF・キャプチャ・ズーム・解像度・AF・お散歩モード）を管理する
// app.jsから分離（行数削減）+ お散歩モードUI追加
// v1.0 2026-04-06 - app.jsからビジョンUI分離 + お散歩モード（自動キャプチャ→自動送信）

'use strict';

const VisionUIController = (() => {

  // --- お散歩モード設定 ---
  const WALK_INTERVALS = [
    { label: '10秒', ms: 10000 },
    { label: '30秒', ms: 30000 },
    { label: '1分',  ms: 60000 },
  ];
  const WALK_DEFAULT_INDEX = 1; // 30秒
  const WALK_CHANGE_THRESHOLD = 0.15; // 変化率15%で自動キャプチャ
  const WALK_AUTO_MESSAGE = '今、何が見える？気になるものがあったら教えて！';

  let _walkIntervalIndex = WALK_DEFAULT_INDEX;
  let _isWalkMode = false;

  /**
   * ビジョンUI全体の初期化（app.jsのinit()から呼ばれる）
   */
  function init() {
    if (typeof VisionEngine === 'undefined') {
      console.log('[VisionUI] VisionEngine未読み込み、スキップ');
      return;
    }
    _initCameraButtons();
    _initZoomControls();
    _initResolutionButton();
    _initFocusCaptureButton();
    _initWalkModeUI();
    _listenAutoCapture();
  }

  // ==============================
  // カメラON/OFF・キャプチャ・切替
  // ==============================

  function _initCameraButtons() {
    const btnToggle = document.getElementById('btn-vision-toggle');
    const btnCapture = document.getElementById('btn-vision-capture');
    const btnSwitch = document.getElementById('btn-vision-switch');
    const visionPanel = document.getElementById('vision-panel');
    const videoEl = document.getElementById('vision-preview');

    if (!btnToggle || !visionPanel || !videoEl) return;

    // カメラON/OFFトグル
    btnToggle.addEventListener('click', async () => {
      if (VisionEngine.isActive()) {
        // お散歩モードも停止
        if (_isWalkMode) _stopWalkMode();
        VisionEngine.stopCamera();
        visionPanel.classList.add('hidden');
        btnToggle.classList.remove('vision-active');
        btnToggle.title = '📷 カメラを起動';
        // ズームスライダーリセット
        const zs = document.getElementById('vision-zoom-slider');
        const zv = document.getElementById('vision-zoom-value');
        if (zs) { zs.value = '1.0'; zs.max = '4.0'; }
        if (zv) { zv.textContent = '1.0x'; }
        // 解像度ボタンリセット
        const rb = document.getElementById('btn-vision-resolution');
        if (rb) { rb.textContent = '🌿エコ'; rb.classList.remove('res-standard', 'res-hd'); }
        // AFインジケーターリセット
        const fi = document.getElementById('vision-focus-indicator');
        if (fi) { fi.classList.remove('af-active', 'af-unsupported'); }
        console.log('[VisionUI] カメラOFF');
      } else {
        try {
          await VisionEngine.startCamera(videoEl);
          visionPanel.classList.remove('hidden');
          btnToggle.classList.add('vision-active');
          btnToggle.title = '📷 カメラを停止';
          _updateFocusIndicator();
          console.log('[VisionUI] カメラON');
        } catch (err) {
          alert(err.message);
        }
      }
    });

    // 📸キャプチャボタン
    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        if (!VisionEngine.isActive()) return;
        const att = VisionEngine.captureAndAttach();
        if (att) {
          btnCapture.style.transform = 'scale(1.2)';
          setTimeout(() => { btnCapture.style.transform = ''; }, 200);
          console.log(`[VisionUI] キャプチャ完了: ${att.name}`);
        }
      });
    }

    // 🔄カメラ前後切替
    if (btnSwitch) {
      btnSwitch.addEventListener('click', async () => {
        if (!VisionEngine.isActive()) return;
        btnSwitch.disabled = true;
        const ok = await VisionEngine.switchCamera();
        btnSwitch.disabled = false;
        if (ok) {
          _updateFocusIndicator();
          console.log('[VisionUI] カメラ切替完了');
        }
      });
    }
  }

  // ==============================
  // ズームスライダー
  // ==============================

  function _initZoomControls() {
    const zoomSlider = document.getElementById('vision-zoom-slider');
    const zoomValue = document.getElementById('vision-zoom-value');
    if (!zoomSlider) return;

    zoomSlider.addEventListener('input', () => {
      const level = parseFloat(zoomSlider.value);
      VisionEngine.setZoom(level);
      if (zoomValue) zoomValue.textContent = `${level.toFixed(1)}x`;
    });
  }

  // ==============================
  // 解像度切替ボタン
  // ==============================

  function _initResolutionButton() {
    const btnResolution = document.getElementById('btn-vision-resolution');
    const zoomSlider = document.getElementById('vision-zoom-slider');
    const zoomValue = document.getElementById('vision-zoom-value');
    if (!btnResolution) return;

    btnResolution.addEventListener('click', () => {
      if (!VisionEngine.isActive()) return;
      const result = VisionEngine.cycleResolution();
      if (!result) return;

      btnResolution.textContent = result.label;
      btnResolution.classList.remove('res-standard', 'res-hd');
      if (result.key === 'standard') btnResolution.classList.add('res-standard');
      if (result.key === 'hd') btnResolution.classList.add('res-hd');

      if (zoomSlider) {
        zoomSlider.max = String(result.currentZoomMax);
        if (parseFloat(zoomSlider.value) > result.currentZoomMax) {
          zoomSlider.value = String(result.currentZoomMax);
          if (zoomValue) zoomValue.textContent = `${result.currentZoomMax.toFixed(1)}x`;
        }
      }
      console.log(`[VisionUI] 解像度切替: ${result.label}`);
    });
  }

  // ==============================
  // 📌ピントキャプチャボタン
  // ==============================

  function _initFocusCaptureButton() {
    const btnFocusCapture = document.getElementById('btn-vision-focus-capture');
    if (!btnFocusCapture) return;

    btnFocusCapture.addEventListener('click', async () => {
      if (!VisionEngine.isActive()) return;
      btnFocusCapture.classList.add('focusing');
      btnFocusCapture.disabled = true;
      try {
        const att = await VisionEngine.focusAndCapture();
        if (att) {
          console.log(`[VisionUI] ピントキャプチャ完了: ${att.name}`);
        }
      } finally {
        btnFocusCapture.classList.remove('focusing');
        btnFocusCapture.disabled = false;
      }
    });
  }

  // ==============================
  // AFインジケーター
  // ==============================

  function _updateFocusIndicator() {
    const fi = document.getElementById('vision-focus-indicator');
    if (!fi || typeof VisionEngine === 'undefined') return;

    fi.classList.remove('af-active', 'af-unsupported');
    if (VisionEngine.isFocusSupported()) {
      fi.classList.add('af-active');
      fi.title = `AF: ${VisionEngine.getFocusMode() || 'active'}`;
    } else {
      fi.classList.add('af-unsupported');
      fi.title = 'AF非対応（固定フォーカス）';
    }
  }

  // ==============================
  // 🚶 お散歩モード（自動キャプチャ）
  // ==============================

  function _initWalkModeUI() {
    const btnWalk = document.getElementById('btn-vision-walk');
    if (!btnWalk) return;

    btnWalk.addEventListener('click', () => {
      if (!VisionEngine.isActive()) {
        alert('先にカメラを起動してね📷');
        return;
      }
      if (_isWalkMode) {
        _stopWalkMode();
      } else {
        _startWalkMode();
      }
    });

    // 長押しでインターバル変更
    let holdTimer = null;
    btnWalk.addEventListener('touchstart', (e) => {
      holdTimer = setTimeout(() => {
        e.preventDefault();
        _cycleWalkInterval();
      }, 600);
    }, { passive: false });
    btnWalk.addEventListener('touchend', () => { clearTimeout(holdTimer); });
    btnWalk.addEventListener('touchcancel', () => { clearTimeout(holdTimer); });
  }

  function _startWalkMode() {
    const interval = WALK_INTERVALS[_walkIntervalIndex];
    VisionEngine.startAutoCapture(interval.ms, WALK_CHANGE_THRESHOLD);
    _isWalkMode = true;

    const btnWalk = document.getElementById('btn-vision-walk');
    const walkStatus = document.getElementById('vision-walk-status');
    if (btnWalk) {
      btnWalk.classList.add('walk-active');
      btnWalk.title = '🚶 お散歩モード停止';
    }
    if (walkStatus) {
      walkStatus.textContent = `🚶 ${interval.label}`;
      walkStatus.classList.remove('hidden');
    }
    console.log(`[VisionUI] お散歩モード開始（${interval.label}間隔、変化率${WALK_CHANGE_THRESHOLD * 100}%）`);
  }

  function _stopWalkMode() {
    VisionEngine.stopAutoCapture();
    _isWalkMode = false;

    const btnWalk = document.getElementById('btn-vision-walk');
    const walkStatus = document.getElementById('vision-walk-status');
    if (btnWalk) {
      btnWalk.classList.remove('walk-active');
      btnWalk.title = '🚶 お散歩モード開始';
    }
    if (walkStatus) {
      walkStatus.classList.add('hidden');
    }
    console.log('[VisionUI] お散歩モード停止');
  }

  function _cycleWalkInterval() {
    _walkIntervalIndex = (_walkIntervalIndex + 1) % WALK_INTERVALS.length;
    const interval = WALK_INTERVALS[_walkIntervalIndex];

    // 動作中なら再起動
    if (_isWalkMode) {
      VisionEngine.stopAutoCapture();
      VisionEngine.startAutoCapture(interval.ms, WALK_CHANGE_THRESHOLD);
    }

    const walkStatus = document.getElementById('vision-walk-status');
    if (walkStatus && _isWalkMode) {
      walkStatus.textContent = `🚶 ${interval.label}`;
    }

    // フィードバック
    const btnWalk = document.getElementById('btn-vision-walk');
    if (btnWalk) {
      btnWalk.style.transform = 'scale(1.2)';
      setTimeout(() => { btnWalk.style.transform = ''; }, 200);
    }

    console.log(`[VisionUI] お散歩間隔変更: ${interval.label}`);
  }

  // ==============================
  // 自動キャプチャ→自動送信連携
  // ==============================

  function _listenAutoCapture() {
    document.addEventListener('vision-auto-capture', (e) => {
      console.log(`[VisionUI] 自動キャプチャイベント受信: 変化率${(e.detail.changeRate * 100).toFixed(1)}%`);
      _autoSendToSister();
    });
  }

  /** 自動キャプチャされた画像をここちゃんに自動送信 */
  function _autoSendToSister() {
    const msgInput = document.getElementById('msg-input');
    const btnSend = document.getElementById('btn-send');
    if (!msgInput || !btnSend) return;

    // 既に入力中なら上書きしない
    if (msgInput.value.trim().length > 0) {
      console.log('[VisionUI] 入力欄にテキストがあるため自動送信スキップ');
      return;
    }

    msgInput.value = WALK_AUTO_MESSAGE;
    msgInput.dispatchEvent(new Event('input'));
    // 少し待ってから送信（UIの更新を待つ）
    setTimeout(() => {
      if (!btnSend.disabled) {
        btnSend.click();
      }
    }, 100);
  }

  // --- 公開API ---
  return { init };
})();
