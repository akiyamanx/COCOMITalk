// COCOMITalk - テスト用ローダー
// このファイルはグローバルスクリプト形式の本番ファイルを、変更せずにNodeのvmで読み込む補助
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/** 簡易localStorage */
function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/**
 * files を順に同じコンテキストで実行し、exposeしたconst名を返す
 * (const はコンテキストのグローバルに乗らないので末尾で取り出す)
 */
function load(files, names, extra = {}) {
  const sandbox = { console: { log() {}, warn() {}, error() {} }, ...extra };
  vm.createContext(sandbox);
  const src = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const out = vm.runInContext(`${src}\n;({${names.join(',')}})`, sandbox, { filename: files.join('+') });
  return { ...out, sandbox };
}

module.exports = { load, makeStorage, ROOT };
