// COCOMITalk - トークン使用量モニター
// このファイルはAPIのトークン使用量をIndexedDBに記録し、料金を計算する
// v0.4 Session D - 使用量の見える化
// v0.7 Step 2完了 - 三姉妹全API対応（モデルID統一＋姉妹カラー表示）
'use strict';

/**
 * トークンモニターモジュール
 * - 毎回のAPI呼び出しでトークン数を記録
 * - 月別に集計してIndexedDBに保存
 * - モデル別の料金単価から概算コストを計算
 * - UIにリアルタイム表示（三姉妹カラー対応）
 */
const TokenMonitor = (() => {

  // --- IndexedDB設定 ---
  const DB_NAME = 'cocomitalk-db';
  const DB_VERSION = 3; // v1.0 Step 3.5 meetingsストア追加
  const STORE_NAME = 'token_usage';

  // --- モデル別料金（USD / 1Mトークン）2026年3月時点 ---
  // v0.7更新 - APIモジュールが実際に送信するモデルIDに合わせる
  const MODEL_PRICING = {
    // Gemini系（api-gemini.jsのMODELS値と一致）
    'gemini-2.0-flash-lite': { input: 0.075, output: 0.30, sister: 'koko' },
    'gemini-2.0-flash': { input: 0.10, output: 0.40, sister: 'koko' },
    'gemini-2.5-flash': { input: 0.15, output: 1.25, sister: 'koko' },
    'gemini-2.5-pro-preview-03-25': { input: 1.25, output: 10.00, sister: 'koko' },
    // v0.7追加 - 将来のモデルグレード切替用
    'gemini-3-flash': { input: 0.20, output: 1.00, sister: 'koko' },
    'gemini-3.1-pro': { input: 2.00, output: 12.00, sister: 'koko' },
    // Claude系（api-claude.jsのMODELS値と一致）
    'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, sister: 'claude' },
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, sister: 'claude' },
    'claude-opus-4-6-20260205': { input: 5.00, output: 25.00, sister: 'claude' },
    // OpenAI系（api-openai.jsのMODELS値と一致）
    'gpt-4o-mini': { input: 0.15, output: 0.60, sister: 'gpt' },
    'gpt-4o': { input: 2.50, output: 10.00, sister: 'gpt' },
  };

  // v0.7追加 - モデルIDから短い表示名へのマッピング
  const MODEL_DISPLAY_NAMES = {
    'gemini-2.0-flash-lite': 'Flash Lite',
    'gemini-2.0-flash': 'Flash 2.0',
    'gemini-2.5-flash': 'Flash 2.5',
    'gemini-2.5-pro-preview-03-25': 'Pro 2.5',
    'gemini-3-flash': 'Flash 3',
    'gemini-3.1-pro': 'Pro 3.1',
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
    'claude-sonnet-4-20250514': 'Sonnet 4',
    'claude-opus-4-6-20260205': 'Opus 4.6',
    'gpt-4o-mini': '4o-mini',
    'gpt-4o': '4o',
  };

  // v0.7追加 - 姉妹カラー（詳細レポート用）
  const SISTER_COLORS = {
    koko: '#FF6B9D',
    gpt: '#6B5CE7',
    claude: '#E6783E',
  };

  // USD→JPYレート（大まかな概算用）
  const USD_TO_JPY = 150;

  let db = null;

  // --- 今月のキャッシュ（高速表示用） ---
  let currentMonthCache = null;

  /**
   * IndexedDB初期化（DB_VERSIONアップ時にストア追加）
   */
  function init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        // v0.3の会話履歴ストア（既存）
        if (!database.objectStoreNames.contains('conversations')) {
          database.createObjectStore('conversations', { keyPath: 'sisterKey' });
        }
        // v0.4追加 - トークン使用量ストア
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'monthKey' });
        }
        // v1.0追加 - 会議履歴ストア（MeetingHistoryと統一）
        if (!database.objectStoreNames.contains('meetings')) {
          const mStore = database.createObjectStore('meetings', { keyPath: 'id' });
          mStore.createIndex('by_date', 'date', { unique: false });
        }
        console.log('[TokenMonitor] DBスキーマ更新完了（v3）');
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        console.log('[TokenMonitor] DB接続完了');
        resolve(db);
      };

      request.onerror = (event) => {
        console.error('[TokenMonitor] DB接続エラー:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 現在の月キーを生成（例: "2026-03"）
   */
  function _getMonthKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * 今日の日付キーを生成（例: "2026-03-07"）
   */
  function _getDateKey() {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }

  /**
   * トークン使用量を記録
   * @param {string} modelName - 使用したモデル名（例: "gemini-2.5-flash"）
   * @param {number} inputTokens - 入力トークン数
   * @param {number} outputTokens - 出力トークン数
   */
  async function record(modelName, inputTokens, outputTokens) {
    if (!db) {
      console.warn('[TokenMonitor] DB未初期化、記録スキップ');
      return;
    }

    const monthKey = _getMonthKey();
    const dateKey = _getDateKey();

    try {
      // 既存の月データを取得
      const existing = await _getMonthData(monthKey);

      // 月の合計を更新
      existing.totalInput += inputTokens;
      existing.totalOutput += outputTokens;
      existing.totalCalls += 1;

      // 日別データを更新
      if (!existing.daily[dateKey]) {
        existing.daily[dateKey] = { input: 0, output: 0, calls: 0 };
      }
      existing.daily[dateKey].input += inputTokens;
      existing.daily[dateKey].output += outputTokens;
      existing.daily[dateKey].calls += 1;

      // モデル別データを更新
      if (!existing.byModel[modelName]) {
        existing.byModel[modelName] = { input: 0, output: 0, calls: 0 };
      }
      existing.byModel[modelName].input += inputTokens;
      existing.byModel[modelName].output += outputTokens;
      existing.byModel[modelName].calls += 1;

      // 最終更新時刻
      existing.updatedAt = new Date().toISOString();

      // 保存
      await _saveMonthData(existing);

      // キャッシュ更新
      currentMonthCache = existing;

      // UI更新
      _updateUI(existing);

      console.log(`[TokenMonitor] 記録: ${modelName} in=${inputTokens} out=${outputTokens}`);
    } catch (e) {
      console.error('[TokenMonitor] 記録エラー:', e);
    }
  }

  /**
   * 月データを取得（なければ新規作成）
   */
  function _getMonthData(monthKey) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(monthKey);

      request.onsuccess = (event) => {
        const data = event.target.result;
        if (data) {
          resolve(data);
        } else {
          // 新規月データ
          resolve({
            monthKey,
            totalInput: 0,
            totalOutput: 0,
            totalCalls: 0,
            daily: {},
            byModel: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 月データを保存
   */
  function _saveMonthData(data) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 概算料金を計算（USD）
   * @param {Object} monthData - 月データ
   * @returns {number} 概算料金（USD）
   */
  function calcCostUSD(monthData) {
    let totalUSD = 0;
    for (const [model, usage] of Object.entries(monthData.byModel)) {
      const pricing = MODEL_PRICING[model];
      if (pricing) {
        // 料金は100万トークンあたりなので /1000000
        totalUSD += (usage.input / 1000000) * pricing.input;
        totalUSD += (usage.output / 1000000) * pricing.output;
      } else {
        // v0.7変更 - 不明なモデルは安全側で概算（gpt-4o-miniの料金）
        console.warn(`[TokenMonitor] 未知のモデル: ${model}、gpt-4o-miniの料金で概算`);
        totalUSD += (usage.input / 1000000) * 0.15;
        totalUSD += (usage.output / 1000000) * 0.60;
      }
    }
    return totalUSD;
  }

  /**
   * 概算料金を計算（JPY）
   */
  function calcCostJPY(monthData) {
    return calcCostUSD(monthData) * USD_TO_JPY;
  }

  /**
   * UIのフッターにトークン情報を表示
   */
  function _updateUI(monthData) {
    // フッターの料金表示を更新
    const costEl = document.getElementById('token-cost');
    if (costEl) {
      const jpy = calcCostJPY(monthData);
      const totalTokens = monthData.totalInput + monthData.totalOutput;
      // 1万トークン単位で表示（わかりやすく）
      const tokenK = (totalTokens / 10000).toFixed(1);
      if (jpy < 1) {
        costEl.textContent = `${tokenK}万tk | ¥1未満`;
      } else {
        costEl.textContent = `${tokenK}万tk | ¥${Math.ceil(jpy)}`;
      }
      costEl.title = `今月: 入力${monthData.totalInput.toLocaleString()}tk / 出力${monthData.totalOutput.toLocaleString()}tk / ${monthData.totalCalls}回`;
    }
  }

  /**
   * 現在の月データを取得して表示を初期化
   */
  async function loadAndDisplay() {
    if (!db) return;
    try {
      const monthKey = _getMonthKey();
      const data = await _getMonthData(monthKey);
      currentMonthCache = data;
      _updateUI(data);
    } catch (e) {
      console.warn('[TokenMonitor] 表示初期化エラー:', e);
    }
  }

  /**
   * 今月のサマリーを取得（設定画面用）
   */
  async function getMonthlySummary() {
    if (!db) return null;
    const monthKey = _getMonthKey();
    return await _getMonthData(monthKey);
  }

  /**
   * 詳細レポートをHTML文字列で生成（設定モーダル用）
   */
  async function getDetailReportHTML() {
    const data = await getMonthlySummary();
    if (!data) return '<p>データなし</p>';

    const costUSD = calcCostUSD(data);
    const costJPY = calcCostJPY(data);

    let html = '';

    // 月サマリー
    html += `<div class="token-summary">`;
    html += `<div class="token-stat">`;
    html += `<span class="stat-label">今月の合計</span>`;
    html += `<span class="stat-value">${data.totalCalls}回の会話</span>`;
    html += `</div>`;
    html += `<div class="token-stat">`;
    html += `<span class="stat-label">入力トークン</span>`;
    html += `<span class="stat-value">${data.totalInput.toLocaleString()}</span>`;
    html += `</div>`;
    html += `<div class="token-stat">`;
    html += `<span class="stat-label">出力トークン</span>`;
    html += `<span class="stat-value">${data.totalOutput.toLocaleString()}</span>`;
    html += `</div>`;
    html += `<div class="token-stat highlight">`;
    html += `<span class="stat-label">概算料金</span>`;
    html += `<span class="stat-value">¥${Math.ceil(costJPY)} ($${costUSD.toFixed(4)})</span>`;
    html += `</div>`;
    html += `</div>`;

    // v0.7変更 - 姉妹別集計（三姉妹カラー表示）
    const sisterTotals = { koko: { input: 0, output: 0, calls: 0, cost: 0 }, gpt: { input: 0, output: 0, calls: 0, cost: 0 }, claude: { input: 0, output: 0, calls: 0, cost: 0 } };
    const models = Object.entries(data.byModel);
    for (const [model, usage] of models) {
      const pricing = MODEL_PRICING[model];
      const sister = pricing?.sister || 'koko';
      sisterTotals[sister].input += usage.input;
      sisterTotals[sister].output += usage.output;
      sisterTotals[sister].calls += usage.calls;
      if (pricing) {
        sisterTotals[sister].cost += (usage.input / 1000000) * pricing.input + (usage.output / 1000000) * pricing.output;
      }
    }

    // 姉妹別サマリー
    const sisterNames = { koko: '🌸 ここちゃん', gpt: '🌙 お姉ちゃん', claude: '🔮 クロちゃん' };
    const activeSisters = Object.entries(sisterTotals).filter(([, s]) => s.calls > 0);
    if (activeSisters.length > 0) {
      html += `<div class="token-models">`;
      html += `<p class="token-section-title">姉妹別</p>`;
      for (const [key, usage] of activeSisters) {
        const color = SISTER_COLORS[key] || '#999';
        const costJPYSister = usage.cost * USD_TO_JPY;
        html += `<div class="token-model-row" style="border-left:3px solid ${color};padding-left:8px;">`;
        html += `<span class="model-name">${sisterNames[key]}</span>`;
        html += `<span class="model-usage">${usage.calls}回 / ${((usage.input + usage.output) / 10000).toFixed(1)}万tk / ¥${Math.ceil(costJPYSister)}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    // モデル別（詳細）
    if (models.length > 0) {
      html += `<div class="token-models">`;
      html += `<p class="token-section-title">モデル別（詳細）</p>`;
      for (const [model, usage] of models) {
        const displayName = MODEL_DISPLAY_NAMES[model] || model;
        const pricing = MODEL_PRICING[model];
        const color = pricing ? (SISTER_COLORS[pricing.sister] || '#999') : '#999';
        html += `<div class="token-model-row">`;
        html += `<span class="model-name" style="color:${color}">${displayName}</span>`;
        html += `<span class="model-usage">${usage.calls}回 / ${(usage.input + usage.output).toLocaleString()}tk</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    // 直近の日別（最新5日分）
    const days = Object.entries(data.daily).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
    if (days.length > 0) {
      html += `<div class="token-daily">`;
      html += `<p class="token-section-title">日別（直近5日）</p>`;
      for (const [date, usage] of days) {
        const shortDate = date.slice(5); // "03-07"
        html += `<div class="token-daily-row">`;
        html += `<span class="daily-date">${shortDate}</span>`;
        html += `<span class="daily-usage">${usage.calls}回 / ${(usage.input + usage.output).toLocaleString()}tk</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    return html;
  }

  /**
   * 使用量データをリセット（設定画面から呼べる）
   */
  async function clearAll() {
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => {
        currentMonthCache = null;
        _updateUI({ totalInput: 0, totalOutput: 0, totalCalls: 0, byModel: {} });
        console.log('[TokenMonitor] 使用量データクリア');
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // --- 公開API ---
  return {
    init,
    record,
    loadAndDisplay,
    getMonthlySummary,
    getDetailReportHTML,
    calcCostJPY,
    calcCostUSD,
    clearAll,
    MODEL_PRICING,
  };
})();
