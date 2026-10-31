// COCOMITalk - v4.7 相談の全件一覧・取り消し（consultation-list.js / consultation-ui v1.5）のテスト
// このファイルは node --test tests/*.test.js で実行する（実APIは呼ばない。fetchは偽物）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./_load');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const env = () => load(['consultation-list.js'], ['ConsultationList']).ConsultationList;

test('誰から・日時（D1のUTC→日本時間）・バー文言', () => {
  const L = env();
  assert.equal(L.fromWhom('web-claude'), 'クロちゃん');
  assert.equal(L.fromWhom(null), 'クロちゃん');
  assert.equal(L.fromWhom('mcp-claude'), 'クロちゃん');
  assert.equal(L.fromWhom('cocomitalk'), 'アキヤ');
  assert.equal(L.formatDate('2026-03-28 15:05:00'), '3/29 00:05');
  assert.equal(L.formatDate(''), '');
  assert.equal(L.barText(5), 'クロちゃんからの相談が5件あるよ！');
  assert.equal(L.barText(10), 'クロちゃんからの相談が10件以上あるよ！');
});

test('取り消しは既存 POST /consultation/resolve に「取り消し（済み）」を送る', async () => {
  const L = env();
  const calls = [];
  const ok = await L.cancelOnServer(3, async (u, o) => { calls.push([u, o]); return { ok: true }; }, 'https://w.example', 'tok');
  assert.equal(ok, true);
  assert.equal(calls[0][0], 'https://w.example/consultation/resolve');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['X-COCOMI-AUTH'], 'tok');
  assert.deepEqual(JSON.parse(calls[0][1].body), { id: 3, resolution: '取り消し（済み）', akiya_comment: null });
  assert.equal(await L.cancelOnServer(3, async () => ({ ok: false, status: 500 }), 'https://w', 't'), false);
  assert.equal(await L.cancelOnServer(3, async () => { throw new Error('net'); }, 'https://w', 't'), false);
  assert.equal(await L.cancelOnServer(3, async () => ({ ok: true }), '', 't'), false, 'URL無しは送らない');
});

test('without は id の型違いでも外し、元配列は変えない', () => {
  const L = env();
  const a = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(JSON.parse(JSON.stringify(L.without(a, '2'))), [{ id: 1 }, { id: 3 }]);
  assert.equal(a.length, 3);
});

test('consultation-ui v1.5: 全件取得(limit=上限)・一覧描画・確認ダイアログ付き取り消し・件数更新', () => {
  const s = read('consultation-ui.js');
  assert.ok(s.includes('status=pending&limit=${_listLimit()}'));
  assert.ok(!s.includes('limit=5`'));
  assert.ok(s.includes('ConsultationList.render('));
  assert.ok(/confirm\(/.test(s) && s.includes('ConsultationList.cancelOnServer('));
  assert.ok(s.includes('_showBar(_consultations.length)'));
  assert.ok(s.includes('最終更新: 葵(Aoi), 2026-11-01'));
});

test('index.html は consultation-list.js を consultation-ui.js の前に読み、sw.js は v4.7 でキャッシュする', () => {
  const h = read('index.html');
  assert.ok(h.indexOf('consultation-list.js') > 0 && h.indexOf('consultation-list.js') < h.indexOf('consultation-ui.js'));
  const sw = read('sw.js');
  assert.ok(sw.includes("'./consultation-list.js'") && sw.includes("const CACHE_NAME = 'cocomitalk-v4.7';"));
});
