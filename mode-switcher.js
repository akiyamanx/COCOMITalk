// COCOMITalk - モード切替統合モジュール
// このファイルはnormal/dev/meetingモードの切替とプロンプト＋モデルグレードの連動を管理する
// v0.8 Step 3 - 新規作成
// v0.9 Step 3.5 - solo/group（👤⇔👥）人数モード追加

'use strict';

/**
 * モード切替モジュール
 * - 2軸構造: トーンモード（normal/dev/meeting）× 人数モード（solo/group）
 * - プロンプト（*SystemPrompt.setMode）とモデルグレード（各APIモジュール）を連動
 * - UIのインジケーター更新も担当
 */
const ModeSwitcher = (() => {

  // --- トーンモード定義 ---
  const MODES = ['normal', 'dev', 'meeting'];

  // --- 人数モード定義（v0.9追加） ---
  const PEOPLE_MODES = ['solo', 'group'];

  // --- モード別表示設定 ---
  const MODE_DISPLAY = {
    normal: { label: '💬 普段', short: 'N', color: 'var(--active-primary)' },
    dev: { label: '🔧 開発', short: 'D', color: '#FF9800' },
    meeting: { label: '🏛️ 会議', short: 'M', color: '#F44336' },
  };

  // --- 人数モード表示設定（v0.9追加） ---
  const PEOPLE_DISPLAY = {
    solo: { label: '👤', tooltip: '1対1モード' },
    group: { label: '👥', tooltip: 'みんなモード（三姉妹全員）' },
  };

  // --- モード別モデルグレード ---
  // v0.8 安全ガイド準拠 → v1.0 meeting最上位デフォルト化
  const DEFAULT_MODE_MODELS = {
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
      // v1.0 - 会議は最上位モデルをデフォルトに
      koko: 'pro-31',         // gemini-3.1-pro
      gpt: 'gpt54',           // gpt-5.4
      claude: 'opus',         // claude-opus-4.6
    },
  };

  // v1.0追加 - ユーザーがカスタマイズしたモデル設定（設定画面で変更可能）
  let customModeModels = null;

  // --- 姉妹別モデル表示名 ---
  const MODEL_DISPLAY = {
    normal: { koko: 'Gemini 2.5 Flash', gpt: 'GPT-4o-mini', claude: 'Haiku 4.5' },
    dev: { koko: 'Gemini 3 Flash', gpt: 'GPT-4o', claude: 'Sonnet 4' },
    meeting: { koko: 'Gemini 3.1 Pro', gpt: 'GPT-5.4', claude: 'Opus 4.6' },
  };

  let currentMode = 'normal';
  let peopleMode = 'solo'; // v0.9追加 - 'solo' or 'group'

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
   * モデルインジケーターを更新（v1.0変更 - カスタム設定反映）
   */
  function _updateModelIndicator(mode, sisterKey) {
    const indicator = document.getElementById('model-indicator');
    if (!indicator) return;
    const display = MODE_DISPLAY[mode];
    // カスタム設定されてる場合はモデルキーから名前を逆引き
    const currentKey = getModelKey(sisterKey);
    const models = getAvailableModels();
    const found = models[sisterKey]?.find(m => m.key === currentKey);
    const modelName = found ? found.name : (MODEL_DISPLAY[mode]?.[sisterKey] || 'Unknown');
    indicator.textContent = `${display.short} | ${modelName}`;
  }

  /**
   * 姉妹切替時にインジケーターを更新（app.jsから呼ばれる）
   */
  function onSisterSwitch(sisterKey) {
    _updateModelIndicator(currentMode, sisterKey);
  }

  /**
   * 現在のモードで指定姉妹のモデルキーを取得
   * v1.0変更 - カスタム設定があればそちらを優先
   */
  function getModelKey(sisterKey) {
    // カスタム設定 > デフォルト の優先順
    if (customModeModels?.[currentMode]?.[sisterKey]) {
      return customModeModels[currentMode][sisterKey];
    }
    return DEFAULT_MODE_MODELS[currentMode]?.[sisterKey] || DEFAULT_MODE_MODELS.normal[sisterKey];
  }

  /**
   * v1.0追加 - モデルグレードのカスタム設定を適用
   * @param {string} mode - 対象モード
   * @param {Object} models - { koko: 'xxx', gpt: 'xxx', claude: 'xxx' }
   */
  function setCustomModels(mode, models) {
    if (!customModeModels) customModeModels = {};
    customModeModels[mode] = { ...models };
    // LocalStorageに保存
    try {
      localStorage.setItem('cocomitalk-custom-models', JSON.stringify(customModeModels));
    } catch (e) { console.warn('[ModeSwitcher] カスタムモデル保存エラー:', e); }
    _updateUI(currentMode);
  }

  /** v1.0追加 - 保存済みカスタムモデルを読み込み */
  function _loadCustomModels() {
    try {
      const saved = localStorage.getItem('cocomitalk-custom-models');
      if (saved) customModeModels = JSON.parse(saved);
    } catch (e) { console.warn('[ModeSwitcher] カスタムモデル読み込みエラー:', e); }
  }

  /** v1.0追加 - 選択可能なモデル一覧 */
  function getAvailableModels() {
    return {
      koko: [
        { key: 'flash-25', name: 'Gemini 2.5 Flash', tier: '💰' },
        { key: 'flash-3', name: 'Gemini 3 Flash', tier: '💰💰' },
        { key: 'pro-31', name: 'Gemini 3.1 Pro', tier: '💰💰💰' },
      ],
      gpt: [
        { key: 'mini', name: 'GPT-4o-mini', tier: '💰' },
        { key: 'gpt4o', name: 'GPT-4o', tier: '💰💰' },
        { key: 'gpt54', name: 'GPT-5.4', tier: '💰💰💰' },
      ],
      claude: [
        { key: 'haiku', name: 'Haiku 4.5', tier: '💰' },
        { key: 'sonnet', name: 'Sonnet 4', tier: '💰💰' },
        { key: 'opus', name: 'Opus 4.6', tier: '💰💰💰' },
      ],
    };
  }

  // 起動時にカスタム設定を読み込み
  _loadCustomModels();

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

  // --- v0.9追加 - 人数モード制御 ---

  /**
   * 人数モードを切替（solo⇔group）
   * @returns {string} 切替後の人数モード
   */
  function togglePeopleMode() {
    peopleMode = (peopleMode === 'solo') ? 'group' : 'solo';
    _updatePeopleUI(peopleMode);
    console.log(`[ModeSwitcher] 人数モード切替: ${peopleMode}`);
    return peopleMode;
  }

  /**
   * 人数モードを取得
   */
  function getPeopleMode() {
    return peopleMode;
  }

  /**
   * グループモードかどうか
   */
  function isGroupMode() {
    return peopleMode === 'group';
  }

  /**
   * 人数モードボタンのUI更新（v0.9追加）
   */
  function _updatePeopleUI(mode) {
    const btn = document.getElementById('btn-people');
    if (btn) {
      const display = PEOPLE_DISPLAY[mode];
      btn.textContent = display.label;
      btn.title = display.tooltip;
      btn.dataset.people = mode;
      // グループモード時はアクティブ色
      btn.classList.toggle('people-active', mode === 'group');
    }
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
    cycleMode, setMode, getMode, getModelKey,
    isMeetingMode, getModes, getModeDisplay, onSisterSwitch,
    togglePeopleMode, getPeopleMode, isGroupMode,
    // v1.0追加 - モデルカスタマイズ
    setCustomModels, getAvailableModels,
    DEFAULT_MODE_MODELS,
  };
})();
