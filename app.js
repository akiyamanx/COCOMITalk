// COCOMITalk - アプリ初期化・画面管理
// このファイルはアプリ全体の初期化、スプラッシュ画面、タブ切替、設定を管理する
// v0.1 Session A - 基盤構築

'use strict';

/**
 * アプリケーションモジュール
 */
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

  // --- モデル表示名 ---
  const MODEL_NAMES = {
    auto: 'スマートルーティング',
    flash: 'Gemini Flash',
    balanced: 'Gemini 2.5 Flash',
    quality: '高品質モード',
  };

  /**
   * アプリ起動
   */
  function init() {
    // スプラッシュ画面の処理
    _handleSplash();

    // チャットコア初期化
    ChatCore.init();

    // タブ切り替え設定
    _setupTabs();

    // 設定モーダル設定
    _setupSettings();

    // 保存済み設定を読み込み
    _loadSettings();

    console.log('[App] COCOMITalk v0.1 起動完了');
  }

  /**
   * スプラッシュ画面の制御
   */
  function _handleSplash() {
    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app');

    // 1.5秒後にスプラッシュをフェードアウト
    setTimeout(() => {
      splash.classList.add('fade-out');

      // フェードアウト完了後にアプリ表示
      setTimeout(() => {
        splash.classList.add('hidden');
        app.classList.remove('hidden');
      }, 400);
    }, 1500);
  }

  /**
   * 三姉妹タブの設定
   */
  function _setupTabs() {
    const tabs = document.querySelectorAll('.tab');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const sisterKey = tab.dataset.sister;

        // タブのアクティブ状態を更新
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // テーマカラー変更
        _applyTheme(sisterKey);

        // チャット切り替え
        ChatCore.switchSister(sisterKey);
      });
    });
  }

  /**
   * テーマカラーを適用
   */
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

  /**
   * 設定モーダルの制御
   */
  function _setupSettings() {
    const modal = document.getElementById('settings-modal');
    const btnOpen = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const overlay = modal.querySelector('.modal-overlay');
    const btnSave = document.getElementById('btn-save-settings');

    // 開く
    btnOpen.addEventListener('click', () => {
      modal.classList.remove('hidden');
      _loadSettingsToForm();
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
  }

  /**
   * 設定をLocalStorageから読み込み
   */
  function _loadSettings() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;

      const settings = JSON.parse(saved);

      // ルーティングモードのインジケーター更新
      const routingMode = settings.routingMode || 'balanced';
      _updateModelIndicator(routingMode);

      console.log('[App] 設定読み込み完了');
    } catch (e) {
      console.warn('[App] 設定読み込みエラー:', e);
    }
  }

  /**
   * 設定をフォームに反映
   */
  function _loadSettingsToForm() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;

      const settings = JSON.parse(saved);

      // APIキーをフォームに反映
      if (settings.geminiKey) {
        document.getElementById('key-gemini').value = settings.geminiKey;
      }
      if (settings.openaiKey) {
        document.getElementById('key-openai').value = settings.openaiKey;
      }
      if (settings.claudeKey) {
        document.getElementById('key-claude').value = settings.claudeKey;
      }

      // ルーティングモード
      if (settings.routingMode) {
        document.getElementById('routing-mode').value = settings.routingMode;
      }
    } catch (e) {
      console.warn('[App] フォーム反映エラー:', e);
    }
  }

  /**
   * 設定を保存
   */
  function _saveSettings() {
    try {
      const settings = {
        geminiKey: document.getElementById('key-gemini').value.trim(),
        openaiKey: document.getElementById('key-openai').value.trim(),
        claudeKey: document.getElementById('key-claude').value.trim(),
        routingMode: document.getElementById('routing-mode').value,
      };

      localStorage.setItem('cocomitalk-settings', JSON.stringify(settings));

      // モデルインジケーター更新
      _updateModelIndicator(settings.routingMode);

      console.log('[App] 設定保存完了');
    } catch (e) {
      console.error('[App] 設定保存エラー:', e);
    }
  }

  /**
   * モデルインジケーター更新
   */
  function _updateModelIndicator(routingMode) {
    const indicator = document.getElementById('model-indicator');
    if (indicator) {
      indicator.textContent = MODEL_NAMES[routingMode] || 'Gemini 2.5 Flash';
    }
  }

  // --- 公開API ---
  return { init };
})();

// --- DOMContentLoaded で起動 ---
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
