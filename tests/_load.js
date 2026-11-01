// COCOMITalk - テスト用ローダー
// このファイルはグローバルスクリプト形式の本番ファイルを、変更せずにNodeのvmで読み込む補助
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// 2026-10-30 - characters.js は既定で「葵/きみ=準備中」の固定版(soonCharacters)に差し替えて読む（準備中の動きを試すテスト用）。
//   実ファイル(aoi/kimi enabled:true)をそのまま読むときは extra.realRegistry=true
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
/** characters.js の本文を、葵/きみ=準備中(enabled:false)に戻した版（実ファイルは触らない） */
function soonCharacters(src) {
  let s = src;
  for (const [k, note] of [['aoi', 'xAI'], ['kimi', 'Kimi']]) {
    s = s.replace(new RegExp(`(key: '${k}'[\\s\\S]*?)enabled: true, status: 'active', statusNote: ''`),
      `$1enabled: false, status: 'coming-soon', statusNote: '準備中（中継が${note}未対応）'`);
  }
  return s;
}

function load(files, names, extra = {}) {
  const { realRegistry, ...rest } = extra;
  const sandbox = { console: { log() {}, warn() {}, error() {} }, ...rest };
  vm.createContext(sandbox);
  const src = files.map(f => {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return (f === 'characters.js' && !realRegistry) ? soonCharacters(t) : t;
  }).join('\n;\n');
  const out = vm.runInContext(`${src}\n;({${names.join(',')}})`, sandbox, { filename: files.join('+') });
  return { ...out, sandbox };
}

module.exports = { load, makeStorage, ROOT, soonCharacters };
