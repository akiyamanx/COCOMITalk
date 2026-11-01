// COCOMITalk - モード切替統合モジュール
// このファイルはnormal/dev/meetingモードの切替とプロンプト＋モデルグレードの連動を管理する
// v0.8 Step 3 - 新規作成
// v0.9 Step 3.5 - solo/group（👤⇔👥）人数モード追加
// v1.1 2026-10-28 - モデルを3段階(lite/standard/high)化。お散歩モード用の設定枠(walk)を追加。旧キーはModelMigrationで変換
// v1.2 2026-10-29 - プロンプトのモード切替に葵・きみ（読み込まれていれば）も追加
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29

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

  // --- 設定できるモード（トーンモード＋お散歩）---
  // 'walk' はお散歩モード中だけ使う設定枠（トーンモードとは別軸。walkActive中はこちらが優先）
  const SETTING_MODES = [...MODES, 'walk'];

  // --- モード別モデル段階（lite/standard/high）---
  // 登録簿(CharacterRegistry)の既定段階から作る: 普段=lite / 開発=standard / 会議=high / お散歩=lite
  // 葵・キミ（準備中）の枠も含むが、UIでは選べずAPIにも渡らない。
  const DEFAULT_MODE_MODELS = {};
  SETTING_MODES.forEach(mode => {
    DEFAULT_MODE_MODELS[mode] = {};
    CharacterRegistry.keys().forEach(k => { DEFAULT_MODE_MODELS[mode][k] = CharacterRegistry.defaultTier(k, mode); });
  });

  // v1.0追加 - ユーザーがカスタマイズしたモデル設定（設定画面で変更可能）
  let customModeModels = null;

  let currentMode = 'normal';
  let peopleMode = 'solo'; // v0.9追加 - 'solo' or 'group'
  let walkActive = false;  // v1.1追加 - お散歩モード中か（trueの間は 'walk' 枠のモデル段階を使う）

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
    // 葵・きみ（準備中）。読み込まれていれば同じモードに揃えておく（有効化された時に食い違わないように）
    if (typeof AoiSystemPrompt !== 'undefined') AoiSystemPrompt.setMode(mode);
    if (typeof KimiSystemPrompt !== 'undefined') KimiSystemPrompt.setMode(mode);
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
    const provider = CharacterRegistry.providerOf(sisterKey);
    if (!provider) return;
    // 段階キーからモデル名を引く（お散歩中は 🚶 を付けて区別）
    const r = ModelTiers.resolve(provider, getModelKey(sisterKey));
    indicator.textContent = `${walkActive ? '🚶' : display.short} | ${r.label}`;
  }

  /**
   * 姉妹切替時にインジケーターを更新（app.jsから呼ばれる）
   */
  function onSisterSwitch(sisterKey) {
    _updateModelIndicator(currentMode, sisterKey);
  }

  /**
   * 設定モード（normal/dev/meeting/walk）と姉妹から、使うモデル段階キーを返す
   * 優先順: 保存済みカスタム設定 > 既定段階。旧キーが残っていても段階へ変換して返す（未知の値は既定）
   * @returns {string|undefined} 'lite'|'standard'|'high'（未登録の姉妹はundefined）
   */
  function getModelKeyFor(settingMode, sisterKey) {
    const provider = CharacterRegistry.providerOf(sisterKey);
    if (!provider) return undefined;
    const fallback = DEFAULT_MODE_MODELS[settingMode]?.[sisterKey] || DEFAULT_MODE_MODELS.normal[sisterKey];
    const saved = customModeModels?.[settingMode]?.[sisterKey];
    return ModelTiers.normalizeKey(provider, saved) || fallback;
  }

  /**
   * 現在のモードで指定姉妹のモデル段階キーを取得
   * v1.0変更 - カスタム設定があればそちらを優先 / v1.1変更 - お散歩中は 'walk' 枠
   */
  function getModelKey(sisterKey) {
    return getModelKeyFor(walkActive ? 'walk' : currentMode, sisterKey);
  }

  /**
   * v1.0追加 - モデル段階のカスタム設定を適用
   * v1.1変更 - 渡された姉妹だけ上書きして他の姉妹の保存値は消さない。値は段階へ変換、未知の値は捨てる
   * @param {string} mode - 対象モード（normal/dev/meeting/walk）
   * @param {Object} models - { koko: 'lite', gpt: 'standard', claude: 'high' }
   */
  function setCustomModels(mode, models) {
    if (!SETTING_MODES.includes(mode)) {
      console.warn(`[ModeSwitcher] 不明な設定モード: ${mode}`);
      return;
    }
    if (!customModeModels) customModeModels = {};
    const merged = { ...(customModeModels[mode] || {}) };
    Object.entries(models || {}).forEach(([sister, key]) => {
      const provider = CharacterRegistry.providerOf(sister);
      const tier = provider ? ModelTiers.normalizeKey(provider, key) : null;
      if (tier) merged[sister] = tier;
    });
    customModeModels[mode] = merged;
    // LocalStorageに保存
    try {
      localStorage.setItem('cocomitalk-custom-models', JSON.stringify(customModeModels));
    } catch (e) { console.warn('[ModeSwitcher] カスタムモデル保存エラー:', e); }
    _updateUI(currentMode);
  }

  /** v1.0追加 - 保存済みカスタムモデルを読み込み（v1.1: 先に旧キー→段階の移行を実行） */
  function _loadCustomModels() {
    try {
      ModelMigration.run(localStorage);
      const saved = localStorage.getItem('cocomitalk-custom-models');
      if (saved) customModeModels = JSON.parse(saved);
    } catch (e) { console.warn('[ModeSwitcher] カスタムモデル読み込みエラー:', e); }
  }

  /**
   * v1.0追加 - 選択可能なモデル一覧（v1.1: 各姉妹3段階。準備中のキャラは含めない＝選べない）
   * @returns {Object} { koko:[{key,name,tier,label,id,deprecatedAfter}], gpt:[...], claude:[...] }
   */
  function getAvailableModels() {
    const out = {};
    CharacterRegistry.enabledList().forEach(c => { out[c.key] = ModelTiers.listForProvider(c.provider); });
    return out;
  }

  /**
   * v1.1追加 - お散歩モードの開始/終了を伝える（trueの間は 'walk' 枠の段階を使う）
   */
  function setWalkMode(on) {
    walkActive = !!on;
    _updateUI(currentMode);
    console.log(`[ModeSwitcher] お散歩モデル枠: ${walkActive ? 'ON' : 'OFF'}`);
  }

  function isWalkMode() {
    return walkActive;
  }

  /** v1.1追加 - 設定画面に並べるモード一覧（normal/dev/meeting/walk） */
  function getSettingModes() {
    return [...SETTING_MODES];
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
    // v1.1追加 - 3段階化・お散歩枠
    getModelKeyFor, getSettingModes, setWalkMode, isWalkMode,
  };
})();
