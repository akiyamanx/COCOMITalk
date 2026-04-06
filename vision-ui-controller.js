// COCOMITalk - ビジョンUIコントローラー
// このファイルはカメラUI（ON/OFF・キャプチャ・ズーム・解像度・AF・お散歩モード）を管理する
// app.jsから分離（行数削減）+ お散歩モードUI追加
// v1.0 2026-04-06 - app.jsからビジョンUI分離 + お散歩モード（自動キャプチャ→自動送信）
// v1.1 2026-04-06 - お散歩ボタン長押し修正（ブラウザ長押しメニュー抑止）
// v1.2 2026-04-06 - 間隔変更をステータスバッジタップに変更（長押し廃止、スマホブラウザ対応）
// v1.3 2026-04-06 - お散歩モード自動送信メッセージに短縮指示追加（TTS被り対策）
// v1.4 2026-04-06 - 会話ラリー中の自動キャプチャ一時停止 + 表示/送信分離（カスタムイベント方式）

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

  // v1.4変更 - 表示用とAPI送信用を分離
  const WALK_DISPLAY_MESSAGE = '📸 写真見たよ！';
  const WALK_API_MESSAGE = '今何が見える？お散歩モード中だから、2〜3文くらいで短く教えてね！';

  let _walkIntervalIndex = WALK_DEFAULT_INDEX;
  let _isWalkMode = false;

  // v1.4追加 - 会話ラリー一時停止用
  let _pauseResumeTimer = null;
  let _isPaused = false;

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
    _listenUserInput();
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

    // 🚶ボタン = ON/OFF切替のみ
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

    // ステータスバッジ「🚶 30秒」タップで間隔変更
    const walkStatus = document.getElementById('vision-walk-status');
    if (walkStatus) {
      walkStatus.addEventListener('click', () => {
        if (_isWalkMode) {
          _cycleWalkInterval();
        }
      });
    }
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
    _isPaused = false;
    if (_pauseResumeTimer) {
      clearTimeout(_pauseResumeTimer);
      _pauseResumeTimer = null;
    }

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

    // ステータス表示更新
    const walkStatus = document.getElementById('vision-walk-status');
    if (walkStatus) {
      walkStatus.textContent = `🚶 ${interval.label}`;
      walkStatus.style.transform = 'scale(1.15)';
      setTimeout(() => { walkStatus.style.transform = ''; }, 200);
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

  /**
   * v1.4変更 - 自動キャプチャ画像をカスタムイベントで送信
   * 表示用テキストとAPI送信用テキストを分離する
   */
  function _autoSendToSister() {
    if (_isPaused) {
      console.log('[VisionUI] 会話ラリー中のため自動送信スキップ');
      return;
    }
    const msgInput = document.getElementById('msg-input');
    if (msgInput && msgInput.value.trim().length > 0) {
      console.log('[VisionUI] 入力欄にテキストがあるため自動送信スキップ');
      return;
    }
    const event = new CustomEvent('vision-auto-send', {
      detail: { displayText: WALK_DISPLAY_MESSAGE, apiText: WALK_API_MESSAGE }
    });
    document.dispatchEvent(event);
    console.log('[VisionUI] 自動送信イベント発火');
  }

  /**
   * v1.4追加 - ユーザーが手入力で送信したら自動キャプチャを一時停止
   */
  function _listenUserInput() {
    const btnSend = document.getElementById('btn-send');
    if (!btnSend) return;
    btnSend.addEventListener('click', () => {
      if (!_isWalkMode || _isPaused) return;
      const msgInput = document.getElementById('msg-input');
      if (msgInput && (msgInput.value === WALK_DISPLAY_MESSAGE || msgInput.value === WALK_API_MESSAGE)) return;
      _pauseWalkMode();
    }, true);
  }

  /** v1.4追加 - お散歩モードを一時停止 */
  function _pauseWalkMode() {
    if (!_isWalkMode) return;
    _isPaused = true;
    VisionEngine.stopAutoCapture();
    if (_pauseResumeTimer) clearTimeout(_pauseResumeTimer);
    const interval = WALK_INTERVALS[_walkIntervalIndex];
    _pauseResumeTimer = setTimeout(() => { _resumeWalkMode(); }, interval.ms);
    const walkStatus = document.getElementById('vision-walk-status');
    if (walkStatus) { walkStatus.textContent = '💬 会話中...'; }
    console.log(`[VisionUI] 会話ラリー検知 → 自動キャプチャ一時停止（${interval.label}後に再開）`);
  }

  /** v1.4追加 - お散歩モードを再開 */
  function _resumeWalkMode() {
    if (!_isWalkMode) return;
    _isPaused = false;
    if (_pauseResumeTimer) { clearTimeout(_pauseResumeTimer); _pauseResumeTimer = null; }
    const interval = WALK_INTERVALS[_walkIntervalIndex];
    VisionEngine.startAutoCapture(interval.ms, WALK_CHANGE_THRESHOLD);
    const walkStatus = document.getElementById('vision-walk-status');
    if (walkStatus) { walkStatus.textContent = `🚶 ${interval.label}`; }
    console.log('[VisionUI] 自動キャプチャ再開');
  }

  // --- 公開API ---
  return { init };
})();
