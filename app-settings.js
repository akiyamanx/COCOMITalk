// app-settings.js v1.7
// このファイルは設定モーダルの制御を担当する（app.jsから分離）
// 認証トークン/モデル選択/音声設定/TTS切替/話すスピード調整
// v1.0 2026-03-10 新規作成 - app.jsの設定関連10関数を分離＋スピード調整追加
// v1.1 2026-03-15 - TTSスピードデフォルト1.25x（フォールバック値変更）
// v1.2 2026-03-19 - STT切替を条件付きに＋デバッグパネルON/OFF安定化
// v1.3 2026-03-19 - DebugLogger連動（デバッグOFF時にログファイル自動ダウンロード）
// v1.4 2026-10-28 - モデル設定を3段階(軽量/標準/高頭脳)×4モード(普段/開発/会議/お散歩)に。葵・キミは「準備中」で選択不可
// v1.5 2026-10-28 - お姉ちゃん標準/高頭脳のツール切替（オフ/アプリ検索/OpenAI内蔵検索）を追加
// v1.6 2026-10-28 - 思考の強さ（EffortSettingsUI）・STT文字起こしモデル選択・TTSにGemini追加
// v1.7 2026-10-28 - 読み上げの既定をGeminiに。旧設定(未設定/openai)は一度だけgeminiへ移す（voicevoxは残す）。OpenAI/VOICEVOXは控えとして選べる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';

/** 設定モジュール（app.jsのinit()から呼ばれる） */
const AppSettings = (() => {

  /** 設定モーダルのイベント設定 */
  function setup() {
    const modal = document.getElementById('settings-modal');
    const btnOpen = document.getElementById('btn-settings');
    const btnClose = document.getElementById('btn-close-settings');
    const overlay = modal.querySelector('.modal-overlay');
    const btnSave = document.getElementById('btn-save-settings');
    // モーダルを開く共通処理
    const openModal = async () => {
      modal.classList.remove('hidden');
      loadSettingsToForm();
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
    btnSave.addEventListener('click', () => { saveSettings(); closeModal(); });
    // TTSプロバイダー切替時にAPIキー入力欄の表示を切替
    const selTTS = document.getElementById('sel-tts-provider');
    if (selTTS) {
      selTTS.addEventListener('change', () => _toggleVVKeyUI(selTTS.value));
    }
    // v1.0追加 - スピードスライダー
    const spdSlider = document.getElementById('range-tts-speed');
    const spdLabel = document.getElementById('tts-speed-label');
    if (spdSlider && spdLabel) {
      spdSlider.addEventListener('input', () => {
        spdLabel.textContent = `${spdSlider.value}x`;
      });
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

  /** 設定をLocalStorageから読み込み（起動時） */
  function loadSettings() {
    try {
      if (typeof migrateTTSProviderDefault === 'function') migrateTTSProviderDefault(); // 新規でも印だけ付ける
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;
      const settings = JSON.parse(saved);
      if (window.voiceController) {
        window.voiceController.setAutoListen(!!settings.handsfree);
        window.voiceController.setDebugVisible(!!settings.sttDebug);
        // v1.0追加 - スピード設定反映 / v1.1変更 - デフォルト1.25x
        if (settings.ttsSpeed) window.voiceController.setSpeed(parseFloat(settings.ttsSpeed));
      }
      _applyTTSProvider(settings.ttsProvider || 'gemini', settings.vvApiKey || '');
      console.log('[Settings] 設定読み込み完了');
    } catch (e) { console.warn('[Settings] 設定読み込みエラー:', e); }
  }

  /** 設定をフォームに反映 */
  function loadSettingsToForm() {
    try {
      const saved = localStorage.getItem('cocomitalk-settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.geminiKey) document.getElementById('key-gemini').value = s.geminiKey;
        const chkH = document.getElementById('chk-handsfree');
        if (chkH) chkH.checked = !!s.handsfree;
        const chkD = document.getElementById('chk-stt-debug');
        if (chkD) chkD.checked = !!s.sttDebug;
        const selTTS = document.getElementById('sel-tts-provider');
        if (selTTS) { selTTS.value = s.ttsProvider || 'gemini'; _toggleVVKeyUI(selTTS.value); }
        const selSTT = document.getElementById('sel-stt-provider');
        if (selSTT) selSTT.value = s.sttProvider || 'webspeech';
        _loadVoiceExtras();
        const vvKey = document.getElementById('vv-api-key-main');
        if (vvKey && s.vvApiKey) vvKey.value = s.vvApiKey;
        // v1.0追加 - スピードスライダー反映 / v1.1変更 - デフォルト1.25x
        const spdSlider = document.getElementById('range-tts-speed');
        const spdLabel = document.getElementById('tts-speed-label');
        if (spdSlider) { spdSlider.value = s.ttsSpeed || '1.25'; }
        if (spdLabel) { spdLabel.textContent = `${s.ttsSpeed || '1.25'}x`; }
      }
      _buildModelSettingsUI();
    } catch (e) { console.warn('[Settings] フォーム反映エラー:', e); }
  }

  /** 設定を保存 */
  function saveSettings() {
    try {
      const chkH = document.getElementById('chk-handsfree');
      const chkD = document.getElementById('chk-stt-debug');
      const selTTS = document.getElementById('sel-tts-provider');
      const selSTT = document.getElementById('sel-stt-provider');
      const vvKey = document.getElementById('vv-api-key-main');
      const spdSlider = document.getElementById('range-tts-speed');
      const settings = {
        geminiKey: document.getElementById('key-gemini').value.trim(),
        handsfree: chkH ? chkH.checked : false,
        sttDebug: chkD ? chkD.checked : false,
        ttsProvider: selTTS ? selTTS.value : 'gemini',
        sttProvider: selSTT ? selSTT.value : 'webspeech',
        vvApiKey: vvKey ? vvKey.value.trim() : '',
        ttsSpeed: spdSlider ? spdSlider.value : '1.25',
      };
      localStorage.setItem('cocomitalk-settings', JSON.stringify(settings));
      _saveVoiceExtras();
      if (window.voiceController) {
        window.voiceController.setAutoListen(settings.handsfree);
        window.voiceController.setSpeed(parseFloat(settings.ttsSpeed));
        // v1.2修正 - STTプロバイダーが実際に変更された時だけ切替（不要な再生成を防止）
        const currentSTT = window.voiceController._stt;
        const wantWhisper = settings.sttProvider === 'whisper';
        const isWhisper = typeof WhisperProvider !== 'undefined' && currentSTT instanceof WhisperProvider;
        if (wantWhisper !== isWhisper) {
          window.voiceController.switchSTTProvider(wantWhisper ? 'whisper' : 'webspeech');
        }
        // v1.2修正 - デバッグ設定はswitchの後に常に適用（切替有無に関わらず確実に反映）
        window.voiceController.setDebugVisible(settings.sttDebug);
        // v1.3追加 - DebugLogger連動（ON→記録開始、OFF→ログファイルダウンロード＋クリア）
        if (window.DebugLogger) {
          if (settings.sttDebug) {
            window.DebugLogger.start();
          } else {
            window.DebugLogger.stopAndDownload();
          }
        }
      }
      _applyTTSProvider(settings.ttsProvider, settings.vvApiKey);
      _saveModelSettings();
      console.log('[Settings] 設定保存完了');
    } catch (e) { console.error('[Settings] 設定保存エラー:', e); }
  }

  /** v1.6: 文字起こしモデル/区切り秒数/Gemini TTS品質（それぞれ専用キーに保存。無ければ既定） */
  function _loadVoiceExtras() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    if (typeof SttModel !== 'undefined') { set('sel-stt-model', SttModel.get()); set('sel-stt-silence', String(SttModel.getSilenceMs())); }
    if (typeof GeminiTTSProvider !== 'undefined') set('sel-gemini-tts-quality', GeminiTTSProvider.getQuality());
  }
  function _saveVoiceExtras() {
    const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
    if (typeof SttModel !== 'undefined') {
      if (val('sel-stt-model')) SttModel.set(val('sel-stt-model'));
      if (val('sel-stt-silence')) {
        const ms = SttModel.setSilenceMs(val('sel-stt-silence'));
        const stt = window.voiceController && window.voiceController._stt;
        if (stt && '_SILENCE_DURATION' in stt) stt._SILENCE_DURATION = ms; // 起動中のWhisperにも即反映
      }
    }
    if (typeof GeminiTTSProvider !== 'undefined' && val('sel-gemini-tts-quality')) GeminiTTSProvider.setQuality(val('sel-gemini-tts-quality'));
  }

  /** TTSプロバイダーを実際に切り替える */
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

  /** VOICEVOX APIキー入力欄の表示切替 */
  function _toggleVVKeyUI(providerName) {
    const el = document.getElementById('vv-key-setting');
    if (el) el.style.display = (providerName === 'voicevox') ? 'block' : 'none';
  }

  /** モデル設定UIを動的に生成（v1.1: 3段階×4モード（普段/開発/会議/お散歩）、準備中キャラは別枠で選択不可） */
  function _buildModelSettingsUI() {
    const area = document.getElementById('model-settings-area');
    if (!area || typeof ModeSwitcher === 'undefined') return;
    const models = ModeSwitcher.getAvailableModels();
    const modes = ModeSwitcher.getSettingModes();
    const modeLabels = { normal: '💬 普段', dev: '🔧 開発', meeting: '🏛️ 会議', walk: '🚶 お散歩' };
    const enabled = CharacterRegistry.enabledList();
    const optionsHTML = (list, currentKey) => list.map(m => {
      const warn = m.deprecatedAfter ? ` ⚠️${m.deprecatedAfter}まで` : '';
      return `<option value="${m.key}"${m.key === currentKey ? ' selected' : ''}>${m.tier}${m.label} ${m.name}${warn}</option>`;
    }).join('');
    let html = '';
    modes.forEach(mode => {
      html += `<div class="model-mode-block" data-mode="${mode}">`;
      html += `<h4 class="model-mode-title">${modeLabels[mode]}</h4>`;
      enabled.forEach(c => {
        const sid = `model-${mode}-${c.key}`;
        html += `<div class="setting-item model-select-row">`;
        html += `<label for="${sid}">${CharacterRegistry.displayName(c.key)}</label>`;
        html += `<select id="${sid}" class="model-select">${optionsHTML(models[c.key], ModeSwitcher.getModelKeyFor(mode, c.key))}</select></div>`;
      });
      if (mode === 'meeting') html += `<p class="setting-hint">💰 会議1ターン: 約¥30〜80（旧モデルでの目安。新モデルは未計測）</p>`;
      if (mode === 'walk') html += `<p class="setting-hint">🚶 お散歩中は自動で撮影し続けます。🪶軽量のままがおすすめ（標準以上は費用が増えます）</p>`;
      html += `</div>`;
    });
    // 準備中のキャラ（登録済みだが中継が未対応のため選べない）
    const soon = CharacterRegistry.list().filter(c => !c.enabled);
    if (soon.length) {
      html += `<div class="model-mode-block" data-mode="soon">`;
      html += `<h4 class="model-mode-title">🔒 準備中</h4>`;
      soon.forEach(c => {
        const list = ModelTiers.listForProvider(c.provider);
        html += `<div class="setting-item model-select-row model-row-disabled">`;
        html += `<label>${CharacterRegistry.displayName(c.key)}</label>`;
        html += `<select class="model-select" disabled>${optionsHTML(list, CharacterRegistry.defaultTier(c.key, 'normal'))}</select></div>`;
        html += `<p class="setting-hint">${c.statusNote}</p>`;
      });
      html += `</div>`;
    }
    html += _responsesModeHTML();
    if (typeof EffortSettingsUI !== 'undefined') html += EffortSettingsUI.html();
    area.innerHTML = html;
  }

  /** v1.追加 - お姉ちゃん標準/高頭脳(Terra/Sol)のツール切替（既定オフ。中継の /openai-responses 対応が必要） */
  function _responsesModeHTML() {
    if (typeof ApiOpenAIResponses === 'undefined') {
      return `<p class="setting-hint">🔎 お姉ちゃんのWeb検索は🪶軽量のときだけ使えます</p>`;
    }
    const cur = ApiOpenAIResponses.getMode();
    const opts = [
      ['off', 'オフ（標準・高頭脳はWeb検索なし）'],
      ['function', 'アプリの検索を使う（Responses API）'],
      ['hosted', 'OpenAI内蔵のWeb検索（出典つき・検索1回$0.01＋トークン）'],
    ].map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('');
    return `<div class="setting-item model-select-row"><label for="openai-responses-mode">🔎 お姉ちゃん 標準/高頭脳のツール</label>`
      + `<select id="openai-responses-mode" class="model-select">${opts}</select></div>`
      + `<p class="setting-hint">オン時は中継Workerの対応（/openai-responses）が必要。未対応・失敗時は自動でツール無しに戻ります（🪶軽量は常にWeb検索可）。</p>`;
  }

  /** モデル設定をドロップダウンから読み取り反映（v1.1: 有効なキャラ×4モード。準備中のキャラは保存しない） */
  function _saveModelSettings() {
    if (typeof ModeSwitcher === 'undefined') return;
    if (typeof EffortSettingsUI !== 'undefined') EffortSettingsUI.save();
    const rsel = document.getElementById('openai-responses-mode');
    if (rsel && typeof ApiOpenAIResponses !== 'undefined') {
      ApiOpenAIResponses.setMode(rsel.value);
      ApiOpenAIResponses.resetFailure();
    }
    ModeSwitcher.getSettingModes().forEach(mode => {
      const models = {};
      CharacterRegistry.enabledList().forEach(c => {
        const sel = document.getElementById(`model-${mode}-${c.key}`);
        if (sel) models[c.key] = sel.value;
      });
      if (Object.keys(models).length) ModeSwitcher.setCustomModels(mode, models);
    });
  }

  /** デフォルトリセット処理のセットアップ */
  function _setupResetModels() {
    const btn = document.getElementById('btn-reset-models');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!confirm('モデル設定をデフォルトに戻しますか？')) return;
      try { localStorage.removeItem('cocomitalk-custom-models'); } catch (e) { /* ignore */ }
      if (typeof EffortSettingsUI !== 'undefined') EffortSettingsUI.reset();
      if (typeof ModeSwitcher !== 'undefined') {
        const defaults = ModeSwitcher.DEFAULT_MODE_MODELS;
        const keys = CharacterRegistry.enabledList().map(c => c.key);
        ModeSwitcher.getSettingModes().forEach(mode => {
          const m = {};
          keys.forEach(k => { m[k] = defaults[mode][k]; });
          ModeSwitcher.setCustomModels(mode, m);
        });
      }
      _buildModelSettingsUI();
    });
  }

  return { setup, loadSettings, saveSettings, loadSettingsToForm };
})();
