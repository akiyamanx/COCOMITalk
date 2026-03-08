// COCOMITalk - 会話履歴管理（IndexedDB）
// このファイルはIndexedDBを使って会話履歴を永続保存する
// v0.3 Session C - リロードしても会話が消えない
// v0.4 Session D - DB_VERSION=2はTokenMonitor側で管理（ストア追加）
// v0.5 Step 3.5 - DB_VERSION=3 meetingsストア追加（MeetingHistoryと統一）
'use strict';

/**
 * 会話履歴管理モジュール
 * IndexedDBに姉妹ごとの会話履歴を保存・読み込み
 */
const ChatHistory = (() => {

  const DB_NAME = 'cocomitalk-db';
  const DB_VERSION = 3; // v0.5 - MeetingHistory追加に伴いバージョンアップ
  const STORE_NAME = 'conversations';

  let db = null;

  /**
   * IndexedDB初期化
   * @returns {Promise<IDBDatabase>}
   */
  function init() {
    // v0.4追加 - 既にDBを開いている場合はそちらを使う
    if (db) {
      return Promise.resolve(db);
    }

    return new Promise((resolve, reject) => {
      // v0.5 安全策: 5秒タイムアウト
      const timeout = setTimeout(() => {
        console.warn('[ChatHistory] DB接続タイムアウト（5秒）');
        reject(new Error('DB接続タイムアウト'));
      }, 5000);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        console.warn('[ChatHistory] DB blocked');
        clearTimeout(timeout);
        reject(new Error('DB blocked'));
      };

      // DB作成・アップグレード時
      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'sisterKey' });
        }
        // v0.4追加 - TokenMonitor用ストア
        if (!database.objectStoreNames.contains('token_usage')) {
          database.createObjectStore('token_usage', { keyPath: 'monthKey' });
        }
        // v0.5追加 - 会議履歴ストア（MeetingHistoryと同じスキーマ）
        if (!database.objectStoreNames.contains('meetings')) {
          const mStore = database.createObjectStore('meetings', { keyPath: 'id' });
          mStore.createIndex('by_date', 'date', { unique: false });
        }
        console.log('[ChatHistory] DBスキーマ作成完了（v3）');
      };

      request.onsuccess = (event) => {
        clearTimeout(timeout);
        db = event.target.result;
        console.log('[ChatHistory] DB接続完了');
        resolve(db);
      };

      request.onerror = (event) => {
        clearTimeout(timeout);
        console.error('[ChatHistory] DB接続エラー:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 会話履歴を保存
   * @param {string} sisterKey - 姉妹キー（koko/gpt/claude）
   * @param {Array} messages - メッセージ配列 [{role, content, timestamp}]
   * @returns {Promise<void>}
   */
  function save(sisterKey, messages) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 最大500件に制限（古いのから削除）
      const trimmed = messages.slice(-500);

      const data = {
        sisterKey,
        messages: trimmed,
        updatedAt: new Date().toISOString(),
      };

      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = (e) => {
        console.error('[ChatHistory] 保存エラー:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /**
   * 会話履歴を読み込み
   * @param {string} sisterKey - 姉妹キー
   * @returns {Promise<Array>} メッセージ配列
   */
  function load(sisterKey) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(sisterKey);

      request.onsuccess = (event) => {
        const data = event.target.result;
        resolve(data ? data.messages : []);
      };

      request.onerror = (e) => {
        console.error('[ChatHistory] 読み込みエラー:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /**
   * 特定の姉妹の会話履歴をクリア
   * @param {string} sisterKey - 姉妹キー
   * @returns {Promise<void>}
   */
  function clear(sisterKey) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(sisterKey);

      request.onsuccess = () => {
        console.log(`[ChatHistory] ${sisterKey}の履歴クリア`);
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 全会話履歴をクリア
   * @returns {Promise<void>}
   */
  function clearAll() {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[ChatHistory] 全履歴クリア');
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  return { init, save, load, clear, clearAll };
})();
