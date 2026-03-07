// COCOMITalk - モード切替統合モジュール
// このファイルはnormal/dev/meetingモードの切替とプロンプト＋モデルグレードの連動を管理する
// v0.8 Step 3 - 新規作成

'use strict';

/**
 * モード切替モジュール
 * - ボタン1つでnormal→dev→meeting循環
 * - プロンプト（*SystemPrompt.setMode）とモデルグレード（各APIモジュール）を連動
 * - UIのインジケーター更新も担当
 */
const ModeSwitcher = (() => {

  // --- モード定義 ---
  const MODES = ['normal', 'dev', 'meeting'];

  // --- モード別表示設定 ---
  const MODE_DISPLAY = {
    normal: { label: '💬 普段', short: 'N', color: 'var(--active-primary)' },
    dev: { label: '🔧 開発', short: 'D', color: '#FF9800' },
    meeting: { label: '🏛️ 会議', short: 'M', color: '#F44336' },
  };

  // --- モード別モデルグレード ---
  // v0.8追加 - 安全ガイド準拠: meetingもまず中級モデルでテスト
  const MODE_MODELS = {
    normal: {
      koko: 'flash-25',       // gemini-2.5-flash
      gpt: 'mini',            // gpt-4o-mini
      claude: 'haiku',        // claude-haiku-4.5
    },
    dev: {
      koko: 'flash-3',        // gemini-3-flash
      gpt: 'gpt4o',           // gpt-4o
      claude: 'sonnet',       // claude-sonnet-4
    },
    meeting: {
      // 安全ガイド: まずdevと同じ中級モデル。Pro/Opus/5.4は動作確認後に手動切替
      koko: 'flash-3',        // gemini-3-flash（将来: gemini-3.1-pro）
      gpt: 'gpt4o',           // gpt-4o（将来: gpt-5.4）
      claude: 'sonnet',       // claude-sonnet-4（将来: claude-opus-4.6）
    },
  };

  // --- 姉妹別モデル表示名 ---
  const MODEL_DISPLAY = {
    normal: { koko: 'Gemini 2.5 Flash', gpt: 'GPT-4o-mini', claude: 'Haiku 4.5' },
    dev: { koko: 'Gemini 3 Flash', gpt: 'GPT-4o', claude: 'Sonnet 4' },
    meeting: { koko: 'Gemini 3 Flash', gpt: 'GPT-4o', claude: 'Sonnet 4' },
  };

  let currentMode = 'normal';

  /**
   * 次のモードに切替（循環: normal→dev→meeting→normal）
   * @returns {string} 切替後のモード
   */
  function cycleMode() {
    const idx = MODES.indexOf(currentMode);
    const nextIdx = (idx + 1) % MODES.length;
    return setMode(MODES[nextIdx]);
  }

  /**
   * 指定モードに切替
   * @param {string} mode - 'normal' / 'dev' / 'meeting'
   * @returns {string} 切替後のモード
   */
  function setMode(mode) {
    if (!MODES.includes(mode)) {
      console.warn(`[ModeSwitcher] 不明なモード: ${mode}`);
      return currentMode;
    }

    currentMode = mode;

    // 1. 三姉妹のプロンプトモードを切替
    _applyPromptMode(mode);

    // 2. UIを更新
    _updateUI(mode);

    console.log(`[ModeSwitcher] モード切替: ${mode}`);
    return mode;
  }

  /**
   * 三姉妹プロンプトのモード切替
   */
  function _applyPromptMode(mode) {
    if (typeof KokoSystemPrompt !== 'undefined') KokoSystemPrompt.setMode(mode);
    if (typeof GptSystemPrompt !== 'undefined') GptSystemPrompt.setMode(mode);
    if (typeof ClaudeSystemPrompt !== 'undefined') ClaudeSystemPrompt.setMode(mode);
  }

  /**
   * UI更新（モードボタン＋モデルインジケーター）
   */
  function _updateUI(mode) {
    const display = MODE_DISPLAY[mode];

    // モードボタンの表示更新
    const modeBtn = document.getElementById('btn-mode');
    if (modeBtn) {
      modeBtn.textContent = display.label;
      modeBtn.dataset.mode = mode;
      modeBtn.style.borderColor = display.color;
    }

    // モデルインジケーター更新（現在の姉妹に合わせて）
    const currentSister = (typeof ChatCore !== 'undefined')
      ? ChatCore.getCurrentSister()
      : 'koko';
    _updateModelIndicator(mode, currentSister);
  }

  /**
   * モデルインジケーターを更新
   */
  function _updateModelIndicator(mode, sisterKey) {
    const indicator = document.getElementById('model-indicator');
    if (indicator) {
      const modelName = MODEL_DISPLAY[mode]?.[sisterKey] || 'Unknown';
      const display = MODE_DISPLAY[mode];
      indicator.textContent = `${display.short} | ${modelName}`;
    }
  }

  /**
   * 姉妹切替時にインジケーターを更新（app.jsから呼ばれる）
   */
  function onSisterSwitch(sisterKey) {
    _updateModelIndicator(currentMode, sisterKey);
  }

  /**
   * 現在のモードで指定姉妹のモデルキーを取得
   * @param {string} sisterKey - 'koko' / 'gpt' / 'claude'
   * @returns {string} モデルキー（例: 'flash-25', 'mini', 'haiku'）
   */
  function getModelKey(sisterKey) {
    return MODE_MODELS[currentMode]?.[sisterKey] || MODE_MODELS.normal[sisterKey];
  }

  /**
   * 現在のモードを取得
   */
  function getMode() {
    return currentMode;
  }

  /**
   * 会議モードかどうか
   */
  function isMeetingMode() {
    return currentMode === 'meeting';
  }

  /**
   * モード一覧を取得
   */
  function getModes() {
    return [...MODES];
  }

  /**
   * モード表示情報を取得
   */
  function getModeDisplay(mode) {
    return MODE_DISPLAY[mode || currentMode];
  }

  return {
    cycleMode,
    setMode,
    getMode,
    getModelKey,
    isMeetingMode,
    getModes,
    getModeDisplay,
    onSisterSwitch,
    MODE_MODELS,
  };
})();
