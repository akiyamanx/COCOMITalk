// COCOMITalk - モデル設定の移行モジュール
// このファイルは localStorage の旧モデルキー（flash-25/mini/haiku等）を新しい3段階（lite/standard/high）へ安全に変換する
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
// v1.0 2026-10-28 - 新規作成（旧値は別キーにバックアップ・何度実行しても同じ結果・壊れたJSONでも落ちない）
'use strict';

/**
 * 移行ルール（仕様書 §3-3）
 * - 対象キー 'cocomitalk-custom-models' = { モード: { 姉妹キー: モデルキー } }
 * - 旧キーは ModelTiers.LEGACY_ALIASES で段階へ変換。すでに段階名ならそのまま。
 * - 解釈できない値は有効データから外す（=既定段階が使われる）。元の値はバックアップに残る。
 * - 初めて変更が起きた時だけ 'cocomitalk-custom-models-v1-backup' に元のJSON文字列を保存（既にあれば上書きしない）。
 * - 壊れたJSONはバックアップに退避してから有効キーを削除（既定段階になる）。例外は投げない。
 */
const ModelMigration = (() => {

  const KEY = 'cocomitalk-custom-models';
  const BACKUP_KEY = 'cocomitalk-custom-models-v1-backup';
  const SCHEMA_KEY = 'cocomitalk-models-schema-version';
  const SCHEMA_VERSION = '2';

  /** 純粋関数: 保存データ(オブジェクト)を変換。{ data, changed, dropped:[{mode,sister,value}] } */
  function migrateData(obj, providerOf) {
    const out = {};
    const dropped = [];
    let changed = false;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { data: out, changed: true, dropped };
    }
    Object.entries(obj).forEach(([mode, perSister]) => {
      if (!perSister || typeof perSister !== 'object' || Array.isArray(perSister)) {
        changed = true; dropped.push({ mode, sister: '*', value: perSister }); return;
      }
      out[mode] = {};
      Object.entries(perSister).forEach(([sister, value]) => {
        const provider = providerOf(sister);
        const tier = provider ? ModelTiers.normalizeKey(provider, value) : null;
        if (!tier) { changed = true; dropped.push({ mode, sister, value }); return; }
        if (tier !== value) changed = true;
        out[mode][sister] = tier;
      });
    });
    return { data: out, changed, dropped };
  }

  /**
   * localStorage 互換オブジェクトに対して移行を実行
   * @returns {{status:'none'|'unchanged'|'migrated'|'corrupt', dropped:Array}}
   */
  function run(storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return { status: 'none', dropped: [] };
    try {
      const raw = store.getItem(KEY);
      if (raw === null || raw === undefined) {
        store.setItem(SCHEMA_KEY, SCHEMA_VERSION);
        return { status: 'none', dropped: [] };
      }
      let obj;
      try { obj = JSON.parse(raw); } catch (e) {
        if (store.getItem(BACKUP_KEY) === null) store.setItem(BACKUP_KEY, raw);
        store.removeItem(KEY);
        store.setItem(SCHEMA_KEY, SCHEMA_VERSION);
        console.warn('[ModelMigration] 壊れたモデル設定を退避して既定に戻しました');
        return { status: 'corrupt', dropped: [] };
      }
      const providerOf = (s) => (typeof CharacterRegistry !== 'undefined') ? CharacterRegistry.providerOf(s) : null;
      const res = migrateData(obj, providerOf);
      if (res.changed) {
        if (store.getItem(BACKUP_KEY) === null) store.setItem(BACKUP_KEY, raw);
        store.setItem(KEY, JSON.stringify(res.data));
      }
      store.setItem(SCHEMA_KEY, SCHEMA_VERSION);
      if (res.dropped.length) console.warn('[ModelMigration] 解釈できない値を既定に戻しました:', JSON.stringify(res.dropped));
      return { status: res.changed ? 'migrated' : 'unchanged', dropped: res.dropped };
    } catch (e) {
      console.warn('[ModelMigration] 移行エラー（既存設定は触らず続行）:', e);
      return { status: 'none', dropped: [] };
    }
  }

  return { KEY, BACKUP_KEY, SCHEMA_KEY, SCHEMA_VERSION, migrateData, run };
})();
