// app-settings.js v1.2
// このファイルは設定モーダルの制御を担当する（app.jsから分離）
// 認証トークン/モデル選択/音声設定/TTS切替/話すスピード調整
// v1.0 2026-03-10 新規作成 - app.jsの設定関連10関数を分離＋スピード調整追加
// v1.1 2026-03-15 - TTSスピードデフォルト1.25x（フォールバック値変更）
// v1.2 2026-03-19 - STT切替を条件付きに＋デバッグパネルON/OFF安定化
// v1.3 2026-03-19 - DebugLogger連動（デバッグOFF時にログファイル自動ダウンロード）
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
      const saved = localStorage.getItem('cocomitalk-settings');
      if (!saved) return;
      const settings = JSON.parse(saved);
      if (window.voiceController) {
        window.voiceController.setAutoListen(!!settings.handsfree);
        window.voiceController.setDebugVisible(!!settings.sttDebug);
        // v1.0追加 - スピード設定反映 / v1.1変更 - デフォルト1.25x
        if (settings.ttsSpeed) window.voiceController.setSpeed(parseFloat(settings.ttsSpeed));
      }
      _applyTTSProvider(settings.ttsProvider || 'openai', settings.vvApiKey || '');
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
        if (selTTS) { selTTS.value = s.ttsProvider || 'openai'; _toggleVVKeyUI(selTTS.value); }
        const selSTT = document.getElementById('sel-stt-provider');
        if (selSTT) selSTT.value = s.sttProvider || 'webspeech';
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
        ttsProvider: selTTS ? selTTS.value : 'openai',
        sttProvider: selSTT ? selSTT.value : 'webspeech',
        vvApiKey: vvKey ? vvKey.value.trim() : '',
        ttsSpeed: spdSlider ? spdSlider.value : '1.25',
      };
      localStorage.setItem('cocomitalk-settings', JSON.stringify(settings));
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

  /** モデル設定UIを動的に生成 */
  function _buildModelSettingsUI() {
    const area = document.getElementById('model-settings-area');
    if (!area || typeof ModeSwitcher === 'undefined') return;
    const models = ModeSwitcher.getAvailableModels();
    const modes = ModeSwitcher.getModes();
    const modeLabels = { normal: '💬 普段', dev: '🔧 開発', meeting: '🏛️ 会議' };
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
      if (mode === 'meeting') html += `<p class="setting-hint">💰 会議1ターン: 約¥30〜80</p>`;
      html += `</div>`;
    });
    area.innerHTML = html;
  }

  /** 指定モード×姉妹のモデルキーを取得 */
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

  /** モデル設定をドロップダウンから読み取り反映 */
  function _saveModelSettings() {
    if (typeof ModeSwitcher === 'undefined') return;
    ModeSwitcher.getModes().forEach(mode => {
      const models = {};
      ['koko', 'gpt', 'claude'].forEach(sister => {
        const sel = document.getElementById(`model-${mode}-${sister}`);
        if (sel) models[sister] = sel.value;
      });
      if (models.koko && models.gpt && models.claude) {
        ModeSwitcher.setCustomModels(mode, models);
      }
    });
  }

  /** デフォルトリセット処理のセットアップ */
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
    });
  }

  return { setup, loadSettings, saveSettings, loadSettingsToForm };
})();
