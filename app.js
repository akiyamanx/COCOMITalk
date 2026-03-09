// COCOMITalk - アプリ初期化・画面管理
// このファイルはアプリ全体の初期化、スプラッシュ画面、タブ切替、設定を管理する
// v1.0～v1.2 設定画面/MeetingHistory初期化/会議自動復元
// v1.3 2026-03-09 - 音声コントローラー初期化＋姉妹タブ連動（Step 5b）
// v1.5 2026-03-09 - TTS プロバイダー切替（OpenAI/VOICEVOX）対応
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
    if (typeof MeetingUI !== 'undefined') MeetingUI.init();
    // v1.0追加 - 会議アーカイブUI初期化
    if (typeof MeetingArchiveUI !== 'undefined') MeetingArchiveUI.init();
    // v1.3追加 - 音声コントローラー初期化（Step 5b）
    try {
      if (typeof VoiceController !== 'undefined') {
        window.voiceController = new VoiceController();
        window.voiceController.init();
      }
    } catch (e) { console.warn('[App] VoiceController初期化スキップ:', e.message); }
    // v1.2追加 - 進行中の会議があれば復元
    await _restoreActiveMeeting();
    _setupFileButtons();
    _setupSettings();
    _loadSettings();
    console.log('[App] COCOMITalk v1.0 起動完了');
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

  // 設定モーダルの制御
  function _setupSettings() {
    const modal = document.getElementById('settings-modal');
    const btnOpen = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const overlay = modal.querySelector('.modal-overlay');
    const btnSave = document.getElementById('btn-save-settings');
    // モーダルを開く共通処理（通常画面・会議画面どちらからも使う）
    const openModal = async () => {
      modal.classList.remove('hidden');
      _loadSettingsToForm();
      if (typeof TokenMonitor !== 'undefined') {
        const detailArea = document.getElementById('token-detail-area');
        if (detailArea) {
          try { detailArea.innerHTML = await TokenMonitor.getDetailReportHTML(); }
          catch (e) { detailArea.innerHTML = '<p>データ読み込みエラー</p>'; }
        }
      }
    };
    btnOpen.addEventListener('click', openModal);
    // 会議ヘッダーの⚙️ボタンからも開く
    const btnMS = document.getElementById('btn-meeting-settings');
    if (btnMS) btnMS.addEventListener('click', openModal);
    const closeModal = () => modal.classList.add('hidden');
    btnClose.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
    btnSave.addEventListener('click', () => { _saveSettings(); closeModal(); });
    // v1.5追加 - TTSプロバイダー切替時にAPIキー入力欄の表示を切替
    const selTTS = document.getElementById('sel-tts-provider');
    if (selTTS) {
      selTTS.addEventListener('change', () => _toggleVVKeyUI(selTTS.value));
    }
    // 履歴クリア
    const btnClear = document.getElementById('btn-clear-history');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (confirm('全ての会話履歴を削除しますか？\nこの操作は取り消せません。')) {
          await ChatCore.clearHistory(); closeModal();
        }
      });
    }
    // トークン使用量リセット
    const btnClearTokens = document.getElementById('btn-clear-tokens');
    if (btnClearTokens) {
      btnClearTokens.addEventListener('click', async () => {
        if (confirm('トークン使用量データをリセットしますか？\nこの操作は取り消せません。')) {
          if (typeof TokenMonitor !== 'undefined') await TokenMonitor.clearAll();
        }
      });
    }
    _setupResetModels();
  }

  // 設定をLocalStorageから読み込み
  function _loadSettings() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;
      const settings = JSON.parse(saved);
      // v1.3追加 - 音声設定を起動時に反映
      if (window.voiceController) {
        window.voiceController.setAutoListen(!!settings.handsfree);
        window.voiceController.setDebugVisible(!!settings.sttDebug);
      }
      // v1.5追加 - TTSプロバイダー設定を起動時に反映
      _applyTTSProvider(settings.ttsProvider || 'openai', settings.vvApiKey || '');
      console.log('[App] 設定読み込み完了');
    } catch (e) {
      console.warn('[App] 設定読み込みエラー:', e);
    }
  }

  // 設定をフォームに反映
  function _loadSettingsToForm() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (saved) {
        const settings = JSON.parse(saved);
        // 認証トークン
        if (settings.geminiKey) {
          document.getElementById('key-gemini').value = settings.geminiKey;
        }
        // v1.3追加 - 音声設定
        const chkHandsfree = document.getElementById('chk-handsfree');
        if (chkHandsfree) chkHandsfree.checked = !!settings.handsfree;
        const chkDebug = document.getElementById('chk-stt-debug');
        if (chkDebug) chkDebug.checked = !!settings.sttDebug;
        // v1.5追加 - TTSプロバイダー設定
        const selTTS = document.getElementById('sel-tts-provider');
        if (selTTS) {
          selTTS.value = settings.ttsProvider || 'openai';
          _toggleVVKeyUI(selTTS.value);
        }
        const vvKey = document.getElementById('vv-api-key-main');
        if (vvKey && settings.vvApiKey) vvKey.value = settings.vvApiKey;
      }
      // v0.9.5追加 - モデル設定UIを動的に生成
      _buildModelSettingsUI();
    } catch (e) {
      console.warn('[App] フォーム反映エラー:', e);
    }
  }

  // 設定を保存（認証トークン＋モデル設定＋音声設定＋TTS切替）
  function _saveSettings() {
    try {
      const chkH = document.getElementById('chk-handsfree');
      const chkD = document.getElementById('chk-stt-debug');
      const selTTS = document.getElementById('sel-tts-provider');
      const vvKey = document.getElementById('vv-api-key-main');
      const settings = {
        geminiKey: document.getElementById('key-gemini').value.trim(),
        handsfree: chkH ? chkH.checked : false,
        sttDebug: chkD ? chkD.checked : false,
        // v1.5追加 - TTSプロバイダー設定
        ttsProvider: selTTS ? selTTS.value : 'openai',
        vvApiKey: vvKey ? vvKey.value.trim() : '',
      };
      localStorage.setItem('cocomitalk-settings', JSON.stringify(settings));
      // 音声設定を即時反映
      if (window.voiceController) {
        window.voiceController.setAutoListen(settings.handsfree);
        window.voiceController.setDebugVisible(settings.sttDebug);
      }
      // v1.5追加 - TTSプロバイダー切替を即時反映
      _applyTTSProvider(settings.ttsProvider, settings.vvApiKey);
      _saveModelSettings();
      console.log('[App] 設定保存完了');
    } catch (e) { console.error('[App] 設定保存エラー:', e); }
  }

  // v1.5追加 - TTSプロバイダーを実際に切り替える
  function _applyTTSProvider(providerName, vvApiKey) {
    if (typeof setTTSProviderName === 'function') setTTSProviderName(providerName);
    const pm = window.voiceController && window.voiceController._playback;
    if (pm) {
      pm.switchProvider(providerName);
      if (providerName === 'voicevox' && vvApiKey && pm._voicevoxProvider) {
        pm._voicevoxProvider.setApiKey(vvApiKey);
      }
    }
  }

  // v1.5追加 - VOICEVOX APIキー入力欄の表示切替
  function _toggleVVKeyUI(providerName) {
    const el = document.getElementById('vv-key-setting');
    if (el) el.style.display = (providerName === 'voicevox') ? 'block' : 'none';
  }

  // v0.9.5新規 - モデル設定UIを動的に生成
  function _buildModelSettingsUI() {
    const area = document.getElementById('model-settings-area');
    if (!area || typeof ModeSwitcher === 'undefined') return;

    const models = ModeSwitcher.getAvailableModels();
    const defaults = ModeSwitcher.DEFAULT_MODE_MODELS;
    const modes = ModeSwitcher.getModes();
    const modeLabels = { normal: '💬 普段モード', dev: '🔧 開発モード', meeting: '🏛️ 会議モード' };
    const sisterLabels = { koko: '🌸 ここちゃん', gpt: '🌙 お姉ちゃん', claude: '🔮 クロちゃん' };

    let html = '';
    modes.forEach(mode => {
      html += `<div class="model-mode-block" data-mode="${mode}">`;
      html += `<h4 class="model-mode-title">${modeLabels[mode]}</h4>`;
      ['koko', 'gpt', 'claude'].forEach(sister => {
        const currentKey = _getModelKeyForMode(mode, sister);
        const sid = `model-${mode}-${sister}`;
        html += `<div class="setting-item model-select-row">`;
        html += `<label for="${sid}">${sisterLabels[sister]}</label>`;
        html += `<select id="${sid}" class="model-select">`;
        models[sister].forEach(m => {
          const sel = (m.key === currentKey) ? ' selected' : '';
          html += `<option value="${m.key}"${sel}>${m.name} ${m.tier}</option>`;
        });
        html += `</select></div>`;
      });
      if (mode === 'meeting') {
        html += `<p class="setting-hint">💰 会議1ターン: 約¥30〜80（最上位モデル時）</p>`;
      }
      html += `</div>`;
    });
    area.innerHTML = html;
  }

  // v0.9.5新規 - 指定モード×姉妹のモデルキーを取得（LS or デフォルト）
  function _getModelKeyForMode(mode, sister) {
    try {
      const saved = localStorage.getItem('cocomitalk-custom-models');
      if (saved) {
        const custom = JSON.parse(saved);
        if (custom[mode]?.[sister]) return custom[mode][sister];
      }
    } catch (e) { /* デフォルトにフォールバック */ }
    return ModeSwitcher.DEFAULT_MODE_MODELS[mode]?.[sister];
  }

  // v0.9.5新規 - モデル設定をドロップダウンから読み取りModeSwitcherに反映
  function _saveModelSettings() {
    if (typeof ModeSwitcher === 'undefined') return;
    const modes = ModeSwitcher.getModes();
    modes.forEach(mode => {
      const models = {};
      ['koko', 'gpt', 'claude'].forEach(sister => {
        const select = document.getElementById(`model-${mode}-${sister}`);
        if (select) models[sister] = select.value;
      });
      if (models.koko && models.gpt && models.claude) {
        ModeSwitcher.setCustomModels(mode, models);
      }
    });
  }

  // v0.9.5新規 - デフォルトリセット処理のセットアップ
  function _setupResetModels() {
    const btn = document.getElementById('btn-reset-models');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!confirm('モデル設定をデフォルトに戻しますか？')) return;
      try { localStorage.removeItem('cocomitalk-custom-models'); } catch (e) { /* ignore */ }
      _buildModelSettingsUI();
      if (typeof ModeSwitcher !== 'undefined') {
        const defaults = ModeSwitcher.DEFAULT_MODE_MODELS;
        ModeSwitcher.getModes().forEach(mode => { ModeSwitcher.setCustomModels(mode, defaults[mode]); });
      }
      console.log('[App] モデル設定をデフォルトにリセット');
    });
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
        const history = ChatCore.getHistory(sister);
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