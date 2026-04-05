// COCOMITalk - アプリ初期化・画面管理
// このファイルはアプリ全体の初期化、スプラッシュ画面、タブ切替、設定を管理する
// v1.0～v1.2 設定画面/MeetingHistory初期化/会議自動復元
// v1.3 2026-03-09 - 音声コントローラー初期化＋姉妹タブ連動（Step 5b）
// v1.6 2026-03-10 - 設定関連をapp-settings.jsに分離（余裕確保）
// v1.7 2026-04-05 - ワイワイモード: スタイル切替ボタン初期化追加
// v1.8 2026-04-05 - ビジョンエンジンUI統合: カメラON/OFF・キャプチャ・切替ボタン初期化
'use strict';
/** アプリケーションモジュール */
const App = (() => {
  // 三姉妹のCSS変数マッピング
  const _theme = (k) => ({ '--active-primary': `var(--${k}-primary)`, '--active-light': `var(--${k}-light)`, '--active-dark': `var(--${k}-dark)`, '--active-bg': `var(--${k}-bg)` });
  const SISTER_THEMES = { koko: _theme('koko'), gpt: _theme('gpt'), claude: _theme('claude') };
  // アプリ起動
  async function init() {
    _handleSplash();
    // TokenMonitor初期化
    if (typeof TokenMonitor !== 'undefined') {
      try { await TokenMonitor.init(); await TokenMonitor.loadAndDisplay(); }
      catch (e) { console.warn('[App] TokenMonitor初期化エラー:', e); }
    }
    // MeetingHistory初期化（TokenMonitorのDB接続を共有してblocked防止）
    if (typeof MeetingHistory !== 'undefined') {
      try {
        if (typeof TokenMonitor !== 'undefined' && TokenMonitor.getDb()) {
          MeetingHistory.setDb(TokenMonitor.getDb());
        } else { await MeetingHistory.init(); }
        await MeetingHistory.trimOldMeetings();
      } catch (e) { console.warn('[App] MeetingHistory初期化エラー:', e); }
    }
    ChatCore.init();
    _setupTabs();
    _setupModeButton();
    _setupPeopleButton();
    _setupContinueTalkButton();
    // v1.7追加 - ワイワイモード: スタイル切替ボタン初期化
    _initStyleButton();
    // v1.8追加 - ビジョンエンジン: カメラUIボタン初期化
    _initVisionButtons();
    if (typeof MeetingUI !== 'undefined') MeetingUI.init();
    // v1.0追加 - 会議アーカイブUI初期化
    if (typeof MeetingArchiveUI !== 'undefined') MeetingArchiveUI.init();
    // v1.7追加 - メモリー管理UI初期化（Step 4補完）
    if (typeof MemoryUI !== 'undefined') MemoryUI.init();
    // v2.5追加 - 記憶インポートUI初期化
    if (typeof MemoryImportUI !== 'undefined') MemoryImportUI.init();
    // v1.8追加 - 検索UI初期化（Phase 2a）
    if (typeof SearchUI !== 'undefined') SearchUI.init();
    // v1.3追加 - 音声コントローラー初期化（Step 5b）
    try {
      if (typeof VoiceController !== 'undefined') {
        window.voiceController = new VoiceController();
        window.voiceController.init();
      }
    } catch (e) {
      console.warn('[App] VoiceController初期化スキップ:', e.message);
      // ★デバッグ: 初期化エラーを表示（原因特定後に削除）
      alert('VC-ERR: ' + e.message);
    }
    // v1.2追加 - 進行中の会議があれば復元
    await _restoreActiveMeeting();
    _setupFileButtons();
    // v1.6変更 - 設定をAppSettingsモジュールに委譲
    if (typeof AppSettings !== 'undefined') { AppSettings.setup(); AppSettings.loadSettings(); }
    console.log('[App] COCOMITalk v1.7 起動完了');
  }
  // スプラッシュ画面の制御
  function _handleSplash() {
    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app');
    setTimeout(() => {
      splash.classList.add('fade-out');
      // フェードアウト完了後にアプリ表示
      setTimeout(() => {
        splash.classList.add('hidden');
        app.classList.remove('hidden');
      }, 400);
    }, 1500);
  }
  // 三姉妹タブの設定
  function _setupTabs() {
    const tabs = document.querySelectorAll('.tab');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const sisterKey = tab.dataset.sister;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _applyTheme(sisterKey);
        if (typeof ModeSwitcher !== 'undefined') {
          ModeSwitcher.onSisterSwitch(sisterKey);
        }
        // v1.3追加 - 音声コントローラーの姉妹IDも切替
        if (window.voiceController) {
          window.voiceController.setCurrentSister(sisterKey);
        }
        ChatCore.switchSister(sisterKey);
      });
    });
  }

  // v0.8追加 - モード切替ボタンの設定
  function _setupModeButton() {
    const modeBtn = document.getElementById('btn-mode');
    if (!modeBtn) return;

    modeBtn.addEventListener('click', () => {
      if (typeof ModeSwitcher === 'undefined') return;

      const newMode = ModeSwitcher.cycleMode();

      // meetingモード → 会議画面を表示
      if (newMode === 'meeting') {
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.show();
        }
      } else {
        // normal/devに戻った → 会議画面を閉じる
        if (typeof MeetingUI !== 'undefined' && MeetingUI.getIsVisible()) {
          MeetingUI.hide();
        }
      }

      console.log(`[App] モード切替: ${newMode}`);
    });
  }

  // v0.9追加 - 人数切替ボタンの設定（👤⇔👥）
  function _setupPeopleButton() {
    const peopleBtn = document.getElementById('btn-people');
    if (!peopleBtn) return;

    peopleBtn.addEventListener('click', () => {
      if (typeof ModeSwitcher === 'undefined') return;

      const newPeople = ModeSwitcher.togglePeopleMode();

      // グループモード時は三姉妹タブを非表示にする（全員で話すため）
      const tabNav = document.querySelector('.sister-tabs');
      if (tabNav) {
        tabNav.classList.toggle('tabs-hidden', newPeople === 'group');
      }

      // v0.9.3追加 - 🔄ボタンの表示切替
      const continueBtn = document.getElementById('btn-continue-talk');
      if (continueBtn) {
        continueBtn.classList.toggle('hidden', newPeople !== 'group');
      }

      // プレースホルダー更新
      const msgInput = document.getElementById('msg-input');
      if (msgInput) {
        msgInput.placeholder = (newPeople === 'group')
          ? 'みんなに話しかけてね...'
          : ChatCore.SISTERS[ChatCore.getCurrentSister()].placeholder;
      }

      // グループ解除時はリレー履歴リセット
      if (newPeople === 'solo' && typeof ChatGroup !== 'undefined') {
        ChatGroup.resetHistory();
      }

      console.log(`[App] 人数モード切替: ${newPeople}`);
    });
  }

  // v0.9.3追加 - 🔄姉妹だけで会話を続けるボタンの設定
  function _setupContinueTalkButton() {
    const btn = document.getElementById('btn-continue-talk');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      if (typeof ChatGroup === 'undefined') return;
      if (!ChatGroup.hasPrevTurn()) return;

      btn.disabled = true;
      try {
        await ChatGroup.continueTalk(ChatCore.getGroupContext());
      } finally {
        btn.disabled = false;
      }
    });
  }

  // v1.7追加 - ワイワイモード: スタイル切替ボタン初期化
  function _initStyleButton() {
    const btnStyle = document.getElementById('btn-style');
    if (!btnStyle || typeof ChatStyleModes === 'undefined') return;

    // 初期表示を復元
    _updateStyleButton(btnStyle, ChatStyleModes.getStyle());

    btnStyle.addEventListener('click', () => {
      // meeting-full時のガード
      if (typeof StyleResolver !== 'undefined' && typeof ModeSwitcher !== 'undefined') {
        const toneMode = ModeSwitcher.getMode();
        const meetingGrade = (typeof MeetingRouter !== 'undefined' && toneMode === 'meeting')
          ? (MeetingRouter.getCurrentGrade ? MeetingRouter.getCurrentGrade() : null)
          : null;
        const nextStyle = ChatStyleModes.getStyle() === 'normal' ? 'waiwai' : 'normal';
        const result = StyleResolver.resolve(toneMode, nextStyle, meetingGrade);

        if (!result.allowed) {
          alert(result.message);
          return;
        }

        if (result.level === 'warn' && result.message) {
          console.log(`[App] スタイル警告: ${result.message}`);
        }
      }

      const newStyle = ChatStyleModes.toggleStyle();
      _updateStyleButton(btnStyle, newStyle);
    });
  }

  // v1.7追加 - スタイルボタンの表示更新
  function _updateStyleButton(btn, style) {
    const info = ChatStyleModes.getStyleInfo(style);
    btn.textContent = info.label;
    btn.classList.toggle('style-waiwai', style === 'waiwai');
  }

  // v1.8追加 - ビジョンエンジン: カメラUI初期化
  function _initVisionButtons() {
    if (typeof VisionEngine === 'undefined') {
      console.log('[App] VisionEngine未読み込み、スキップ');
      return;
    }

    const btnToggle = document.getElementById('btn-vision-toggle');
    const btnCapture = document.getElementById('btn-vision-capture');
    const btnSwitch = document.getElementById('btn-vision-switch');
    const visionPanel = document.getElementById('vision-panel');
    const videoEl = document.getElementById('vision-preview');

    if (!btnToggle || !visionPanel || !videoEl) return;

    // カメラON/OFFトグル
    btnToggle.addEventListener('click', async () => {
      if (VisionEngine.isActive()) {
        // カメラ停止
        VisionEngine.stopCamera();
        visionPanel.classList.add('hidden');
        btnToggle.classList.remove('vision-active');
        btnToggle.title = '📷 カメラを起動';
        // v1.1追加 - ズームスライダーリセット
        const _zs = document.getElementById('vision-zoom-slider');
        const _zv = document.getElementById('vision-zoom-value');
        if (_zs) { _zs.value = '1.0'; }
        if (_zv) { _zv.textContent = '1.0x'; }
        console.log('[App] ビジョンエンジン: カメラOFF');
      } else {
        // カメラ起動
        try {
          await VisionEngine.startCamera(videoEl);
          visionPanel.classList.remove('hidden');
          btnToggle.classList.add('vision-active');
          btnToggle.title = '📷 カメラを停止';
          console.log('[App] ビジョンエンジン: カメラON');
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
          // キャプチャ成功のフィードバック
          btnCapture.style.transform = 'scale(1.2)';
          setTimeout(() => { btnCapture.style.transform = ''; }, 200);
          console.log(`[App] ビジョンキャプチャ完了: ${att.name} (${att.size}bytes)`);
        }
      });
    }

    // v1.1追加 - ズームスライダー
    const zoomSlider = document.getElementById('vision-zoom-slider');
    const zoomValue = document.getElementById('vision-zoom-value');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        const level = parseFloat(zoomSlider.value);
        VisionEngine.setZoom(level);
        if (zoomValue) zoomValue.textContent = `${level.toFixed(1)}x`;
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
          console.log('[App] ビジョンエンジン: カメラ切替完了');
        }
      });
    }
  }

  // テーマカラーを適用
  function _applyTheme(sisterKey) {
    const theme = SISTER_THEMES[sisterKey];
    if (!theme) return;

    const root = document.documentElement;
    Object.entries(theme).forEach(([prop, value]) => {
      root.style.setProperty(prop, value);
    });

    // テーマカラーのmetaタグも更新
    const themeColors = { koko: '#FF6B9D', gpt: '#6B5CE7', claude: '#E6783E' };
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', themeColors[sisterKey] || '#FF6B9D');
    }
  }

  // v1.2追加 - 進行中の会議をIndexedDBから復元
  async function _restoreActiveMeeting() {
    if (typeof MeetingHistory === 'undefined' || typeof MeetingRelay === 'undefined' || typeof MeetingUI === 'undefined') return;
    try {
      const meetings = await MeetingHistory.getAllMeetings();
      const active = meetings.find(m => m.status === 'in_progress');
      if (!active) {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recent = meetings.find(m => m.status === 'completed' && new Date(m.date).getTime() > oneHourAgo);
        if (!recent) return;
        _doRestore(recent);
        return;
      }
      _doRestore(active);
    } catch (e) {
      console.warn('[App] 会議復元エラー（無視して続行）:', e);
    }
  }

  // v1.2追加 - 会議復元の実行
  function _doRestore(meeting) {
    const routing = MeetingRelay.restoreFromDB(meeting);
    if (!routing) return;
    if (typeof ModeSwitcher !== 'undefined') ModeSwitcher.setMode('meeting');
    MeetingUI.show();
    MeetingUI.restoreDisplay(meeting, routing);
    console.log(`[App] 会議復元完了: ${meeting.id}`);
  }

  // v1.0新規 - ファイル関連ボタンの設定
  function _setupFileButtons() {
    if (typeof FileHandler === 'undefined') return;
    const btnAttach = document.getElementById('btn-attach');
    const fileInput = document.getElementById('file-input');
    if (btnAttach && fileInput) {
      btnAttach.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { const att = await FileHandler.readFile(file); FileHandler.setAttachment(att); }
        catch (err) { alert(err.message); }
        fileInput.value = '';
      });
    }
    const btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (typeof ChatCore === 'undefined') return;
        const sister = ChatCore.getCurrentSister();
        // v1.5.1修正 - 今のセッション（部屋）の会話だけダウンロード
        const history = ChatCore.getSessionHistory(sister);
        if (!history || history.length === 0) { alert('まだ会話がないよ！'); return; }
        FileHandler.downloadChat(history, `COCOMITalk_${ChatCore.SISTERS[sister]?.name || sister}`);
      });
    }
    const btnGenDoc = document.getElementById('btn-generate-doc');
    if (btnGenDoc) {
      btnGenDoc.addEventListener('click', async () => {
        if (typeof DocGenerator === 'undefined' || typeof ChatCore === 'undefined') return;
        if (DocGenerator.isGenerating()) return;
        const sister = ChatCore.getCurrentSister();
        const history = ChatCore.getHistory(sister);
        if (!history || history.length === 0) { alert('まだ会話がないよ！先に三姉妹と議論してから📋を押してね'); return; }
        btnGenDoc.disabled = true;
        try {
          const result = await DocGenerator.generate(history);
          if (result.success && result.files.length > 0) await FileHandler.downloadAsZip(result.files);
        } catch (err) { alert(`指示書生成エラー: ${err.message}`);
        } finally { btnGenDoc.disabled = false; }
      });
    }
  }

  // --- 公開API ---
  return { init };
})();

// v1.5追加 - 音声コマンド用グローバル関数（Step 5e）
window.switchToSister = (sisterKey) => {
  // v1.5.3追加 - グループモード中なら1対1に戻す
  if (typeof ModeSwitcher !== 'undefined' && ModeSwitcher.isGroupMode()) {
    ModeSwitcher.togglePeopleMode();
  }
  const tab = document.querySelector(`.tab[data-sister="${sisterKey}"]`);
  if (tab) tab.click();
};
window.switchToGroup = () => {
  // v1.5.2修正 - グループモード切替はtogglePeopleMode（btn-modeではなくbtn-people）
  if (typeof ModeSwitcher !== 'undefined') {
    if (!ModeSwitcher.isGroupMode()) {
      ModeSwitcher.togglePeopleMode();
    }
  }
};

// DOMContentLoaded で起動
document.addEventListener('DOMContentLoaded', () => App.init());
// Service Worker登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[App] SW登録完了:', reg.scope))
      .catch(err => console.warn('[App] SW登録失敗:', err));
  });
}
