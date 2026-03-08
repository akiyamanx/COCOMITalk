// COCOMITalk - アプリ初期化・画面管理
// このファイルはアプリ全体の初期化、スプラッシュ画面、タブ切替、設定を管理する
// v1.0 - 設定画面リニューアル＋ファイル入出力ボタン / v1.1 - MeetingHistory初期化追加
'use strict';

/** アプリケーションモジュール */
const App = (() => {
  // --- 三姉妹のCSS変数マッピング ---
  const SISTER_THEMES = {
    koko: {
      '--active-primary': 'var(--koko-primary)',
      '--active-light': 'var(--koko-light)',
      '--active-dark': 'var(--koko-dark)',
      '--active-bg': 'var(--koko-bg)',
    },
    gpt: {
      '--active-primary': 'var(--gpt-primary)',
      '--active-light': 'var(--gpt-light)',
      '--active-dark': 'var(--gpt-dark)',
      '--active-bg': 'var(--gpt-bg)',
    },
    claude: {
      '--active-primary': 'var(--claude-primary)',
      '--active-light': 'var(--claude-light)',
      '--active-dark': 'var(--claude-dark)',
      '--active-bg': 'var(--claude-bg)',
    }
  };

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

    // 開く
    btnOpen.addEventListener('click', async () => {
      modal.classList.remove('hidden');
      _loadSettingsToForm();
      if (typeof TokenMonitor !== 'undefined') {
        const detailArea = document.getElementById('token-detail-area');
        if (detailArea) {
          try {
            detailArea.innerHTML = await TokenMonitor.getDetailReportHTML();
          } catch (e) {
            detailArea.innerHTML = '<p>データ読み込みエラー</p>';
          }
        }
      }
    });

    // 閉じる
    const closeModal = () => modal.classList.add('hidden');
    btnClose.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    // 保存
    btnSave.addEventListener('click', () => {
      _saveSettings();
      closeModal();
    });

    // v0.3追加 - 履歴クリア
    const btnClear = document.getElementById('btn-clear-history');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (confirm('全ての会話履歴を削除しますか？\nこの操作は取り消せません。')) {
          await ChatCore.clearHistory();
          closeModal();
        }
      });
    }

    // v0.4追加 - トークン使用量リセット
    const btnClearTokens = document.getElementById('btn-clear-tokens');
    if (btnClearTokens) {
      btnClearTokens.addEventListener('click', async () => {
        if (confirm('トークン使用量データをリセットしますか？\nこの操作は取り消せません。')) {
          if (typeof TokenMonitor !== 'undefined') {
            await TokenMonitor.clearAll();
          }
        }
      });
    }

    // v0.9.5追加 - モデル設定デフォルトリセットボタン
    _setupResetModels();
  }

  /**
   * 設定をLocalStorageから読み込み
   * v0.9.5変更 - 旧routingMode削除、ModeSwitcher連携のみ
   */
  function _loadSettings() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;
      // 認証トークンはapi-common.jsが直接読む
      console.log('[App] 設定読み込み完了');
    } catch (e) {
      console.warn('[App] 設定読み込みエラー:', e);
    }
  }

  /**
   * 設定をフォームに反映
   * v0.9.5変更 - 認証トークンのみ＋モデル設定UI動的生成
   */
  function _loadSettingsToForm() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (saved) {
        const settings = JSON.parse(saved);
        // 認証トークン
        if (settings.geminiKey) {
          document.getElementById('key-gemini').value = settings.geminiKey;
        }
      }
      // v0.9.5追加 - モデル設定UIを動的に生成
      _buildModelSettingsUI();
    } catch (e) {
      console.warn('[App] フォーム反映エラー:', e);
    }
  }

  /**
   * 設定を保存
   * v0.9.5変更 - 認証トークンのみ＋モデル設定はModeSwitcher経由で別保存
   */
  function _saveSettings() {
    try {
      const settings = {
        geminiKey: document.getElementById('key-gemini').value.trim(),
      };
      localStorage.setItem('cocomitalk-settings', JSON.stringify(settings));

      // v0.9.5追加 - モデル設定を各ドロップダウンから読み取りModeSwitcherに反映
      _saveModelSettings();

      console.log('[App] 設定保存完了');
    } catch (e) {
      console.error('[App] 設定保存エラー:', e);
    }
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

  /**
   * v0.9.5新規 - 指定モード×姉妹のモデルキーを取得（設定画面用）
   * ModeSwitcher.getModelKey()は現在のモードしか見れないので、
   * LocalStorageのカスタム設定 or デフォルトから直接取得
   */
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
      // 3つとも取得できた場合のみ保存
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

      // カスタム設定をクリア
      try {
        localStorage.removeItem('cocomitalk-custom-models');
      } catch (e) { /* ignore */ }

      // UIを再生成（デフォルト値で表示される）
      _buildModelSettingsUI();

      // ModeSwitcherの全モードをデフォルトに戻す
      if (typeof ModeSwitcher !== 'undefined') {
        const defaults = ModeSwitcher.DEFAULT_MODE_MODELS;
        ModeSwitcher.getModes().forEach(mode => {
          ModeSwitcher.setCustomModels(mode, defaults[mode]);
        });
      }

      console.log('[App] モデル設定をデフォルトにリセット');
    });
  }

  // v1.0新規 - 📎ファイル添付＋💾ダウンロードボタンの設定
  function _setupFileButtons() {
    if (typeof FileHandler === 'undefined') return;

    // 📎ボタン → hidden file inputをクリック
    const btnAttach = document.getElementById('btn-attach');
    const fileInput = document.getElementById('file-input');
    if (btnAttach && fileInput) {
      btnAttach.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const att = await FileHandler.readFile(file);
          FileHandler.setAttachment(att);
        } catch (err) {
          alert(err.message);
        }
        fileInput.value = ''; // 同じファイルを再選択できるようにリセット
      });
    }

    // 💾ボタン → 会話ログをダウンロード
    const btnDownload = document.getElementById('btn-download');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (typeof ChatCore === 'undefined') return;
        const sister = ChatCore.getCurrentSister();
        const history = ChatCore.getHistory(sister);
        if (!history || history.length === 0) {
          alert('まだ会話がないよ！');
          return;
        }
        const sisterName = ChatCore.SISTERS[sister]?.name || sister;
        FileHandler.downloadChat(history, `COCOMITalk_${sisterName}`);
      });
    }

    // 📋ボタン → 指示書自動生成
    const btnGenDoc = document.getElementById('btn-generate-doc');
    if (btnGenDoc) {
      btnGenDoc.addEventListener('click', async () => {
        if (typeof DocGenerator === 'undefined' || typeof ChatCore === 'undefined') return;
        if (DocGenerator.isGenerating()) return;
        // 現在の姉妹の会話履歴を取得（グループならkoko基準）
        const sister = ChatCore.getCurrentSister();
        const history = ChatCore.getHistory(sister);
        if (!history || history.length === 0) {
          alert('まだ会話がないよ！先に三姉妹と議論してから📋を押してね');
          return;
        }
        btnGenDoc.disabled = true;
        try {
          const result = await DocGenerator.generate(history);
          if (result.success && result.files.length > 0) {
            await FileHandler.downloadAsZip(result.files);
          }
        } catch (err) {
          alert(`指示書生成エラー: ${err.message}`);
        } finally {
          btnGenDoc.disabled = false;
        }
      });
    }
  }

  // --- 公開API ---
  return { init };
})();

// --- DOMContentLoaded で起動 ---
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

// v0.3追加 - Service Worker登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[App] SW登録完了:', reg.scope))
      .catch((err) => console.warn('[App] SW登録失敗:', err));
  });
}
