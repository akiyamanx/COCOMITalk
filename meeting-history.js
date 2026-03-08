// COCOMITalk - 会議履歴管理（IndexedDB）
// このファイルは会議履歴をIndexedDBに保存・読み込みする
// chat-history.js（既存の通常チャット履歴）と同じ仕組みを会議用に作る
// v1.0 Step 3.5 - 新規作成（2026-03-08）
'use strict';

/**
 * 会議履歴管理モジュール
 * - 会議開始時にレコード作成
 * - 各姉妹の発言ごとにリアルタイム追記保存
 * - 過去の会議一覧取得・個別取得・削除
 * - 既存のcocomitalk-db（DB_VERSION=2）にmeetingsストアを追加
 */
const MeetingHistory = (() => {

  // v1.0 - 既存DBと統合（ChatHistory/TokenMonitorと同じDB）
  const DB_NAME = 'cocomitalk-db';
  const DB_VERSION = 3; // v1.0 meetingsストア追加のためバージョンアップ
  const STORE_NAME = 'meetings';

  // 最大保存件数（古い会議から自動削除）
  const MAX_MEETINGS = 50;

  let db = null;

  /**
   * IndexedDB初期化
   * 既存ストア（conversations, token_usage）を壊さずmeetingsを追加
   * @returns {Promise<IDBDatabase>}
   */
  /**
   * 外部からDB接続を受け取る（TokenMonitorと共有）
   * @param {IDBDatabase} sharedDb
   */
  function setDb(sharedDb) {
    if (sharedDb) {
      db = sharedDb;
      console.log('[MeetingHistory] 共有DB接続受け取り完了');
    }
  }

  /**
   * IndexedDB初期化
   * 既にsetDb()でDB受け取り済みなら即resolve。
   * そうでなければ自前で開く（フォールバック）。
   */
  function init() {
    if (db) return Promise.resolve(db);

    return new Promise((resolve, reject) => {
      // v1.0 安全策: 5秒タイムアウト（blockedでハングしないように）
      const timeout = setTimeout(() => {
        console.warn('[MeetingHistory] DB接続タイムアウト（5秒）');
        reject(new Error('DB接続タイムアウト'));
      }, 5000);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        console.warn('[MeetingHistory] DB blocked - 他のタブを閉じてください');
        clearTimeout(timeout);
        reject(new Error('DB blocked'));
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains('conversations')) {
          database.createObjectStore('conversations', { keyPath: 'sisterKey' });
        }
        if (!database.objectStoreNames.contains('token_usage')) {
          database.createObjectStore('token_usage', { keyPath: 'monthKey' });
        }
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_date', 'date', { unique: false });
          console.log('[MeetingHistory] meetingsストア作成完了');
        }
      };

      request.onsuccess = (event) => {
        clearTimeout(timeout);
        db = event.target.result;
        console.log('[MeetingHistory] DB接続完了（v3）');
        resolve(db);
      };

      request.onerror = (event) => {
        clearTimeout(timeout);
        console.error('[MeetingHistory] DB接続エラー:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 会議IDを生成（MTG-YYYY-MM-DD-NNN形式）
   * @returns {string}
   */
  function _generateId() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    return `MTG-${dateStr}-${timeStr}`;
  }

  /**
   * 新しい会議を作成（会議開始時に呼ぶ）
   * @param {string} topic - 議題テキスト
   * @param {Object} routing - MeetingRouter.analyzeTopic()の結果
   * @returns {Promise<string>} 作成された会議ID
   */
  function createMeeting(topic, routing) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const id = _generateId();
      const meeting = {
        id,
        date: new Date().toISOString(),
        topic,
        category: routing?.label || '未分類',
        lead: routing?.lead || 'koko',
        routing: routing || null,
        history: [],
        status: 'in_progress',
      };

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(meeting);

      request.onsuccess = () => {
        console.log(`[MeetingHistory] 会議作成: ${id}`);
        resolve(id);
      };
      request.onerror = (e) => {
        console.error('[MeetingHistory] 会議作成エラー:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  /**
   * 会議に発言を追記（リアルタイム保存）
   * @param {string} id - 会議ID
   * @param {Object} entry - 発言データ { round, sister, name, isLead, content, timestamp }
   * @returns {Promise<void>}
   */
  function addEntry(id, entry) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const meeting = getReq.result;
        if (!meeting) {
          reject(new Error(`会議が見つかりません: ${id}`));
          return;
        }
        // 発言を追記
        meeting.history.push(entry);
        const putReq = store.put(meeting);
        putReq.onsuccess = () => resolve();
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * アキヤの発言（議題・追加指示）を追記
   * @param {string} id - 会議ID
   * @param {string} text - アキヤの発言テキスト
   * @param {number} round - ラウンド番号
   * @returns {Promise<void>}
   */
  function addUserEntry(id, text, round) {
    return addEntry(id, {
      round,
      sister: 'user',
      name: 'アキヤ',
      isLead: false,
      content: text,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 会議のステータスを更新（完了にする等）
   * @param {string} id - 会議ID
   * @param {string} status - 'completed' | 'in_progress'
   * @returns {Promise<void>}
   */
  function updateStatus(id, status) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const meeting = getReq.result;
        if (!meeting) { reject(new Error(`会議が見つかりません: ${id}`)); return; }
        meeting.status = status;
        const putReq = store.put(meeting);
        putReq.onsuccess = () => resolve();
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 会議を1件取得
   * @param {string} id - 会議ID
   * @returns {Promise<Object|null>}
   */
  function getMeeting(id) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 全会議を取得（新しい順）
   * @returns {Promise<Array>}
   */
  function getAllMeetings() {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_date');
      const meetings = [];

      // カーソルで新しい順に取得
      const request = index.openCursor(null, 'prev');
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          meetings.push(cursor.value);
          cursor.continue();
        } else {
          resolve(meetings);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 会議を削除
   * @param {string} id - 会議ID
   * @returns {Promise<void>}
   */
  function deleteMeeting(id) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB未初期化')); return; }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`[MeetingHistory] 会議削除: ${id}`);
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 古い会議を自動削除（MAX_MEETINGS件を超えたら古い方から）
   * @returns {Promise<number>} 削除した件数
   */
  async function trimOldMeetings() {
    try {
      const all = await getAllMeetings();
      if (all.length <= MAX_MEETINGS) return 0;

      // 古い方（配列の後ろ）から削除
      const toDelete = all.slice(MAX_MEETINGS);
      for (const m of toDelete) {
        await deleteMeeting(m.id);
      }
      console.log(`[MeetingHistory] ${toDelete.length}件の古い会議を自動削除`);
      return toDelete.length;
    } catch (e) {
      console.error('[MeetingHistory] 自動削除エラー:', e);
      return 0;
    }
  }

  return {
    init,
    setDb,
    createMeeting,
    addEntry,
    addUserEntry,
    updateStatus,
    getMeeting,
    getAllMeetings,
    deleteMeeting,
    trimOldMeetings,
    MAX_MEETINGS,
  };
})();
