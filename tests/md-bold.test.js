// COCOMITalk - 吹き出し太字補正のテスト
// このファイルは md-fix.js（**太字**が全角記号・日本語に隣接しても<strong>になる）を確認する
// v1.0 2026-10-30 - 新規作成
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./_load');

const { MdFix } = load(['md-fix.js'], ['MdFix']);
// marked 9.1.6 が実際に返した出力（閉じ**が「）**に」で認識されない）
const MARKED_OUT = '<p>まず**GPU（グラフィックボード）**について！</p>\n<ul>\n<li><strong>NVIDIAのRTXシリーズ</strong>: 速い</li>\n</ul>\n';
const fakeMarked = { parse: () => MARKED_OUT };

test('全角カッコ＋日本語に隣接した**も<strong>になる', () => {
  const h = MdFix.render('x', fakeMarked);
  assert.match(h, /まず<strong>GPU（グラフィックボード）<\/strong>について！/);
  assert.match(h, /<strong>NVIDIAのRTXシリーズ<\/strong>/);
  assert.ok(!h.includes('**'));
});

test('対にならない**は消える／code内は触らない', () => {
  assert.strictEqual(MdFix.fixHtml('<p>残り**ひとつ</p>'), '<p>残りひとつ</p>');
  assert.strictEqual(MdFix.fixHtml('<p><code>a**b**</code></p>'), '<p><code>a**b**</code></p>');
});

test('markedが無い時もエスケープして太字化（XSSなし）', () => {
  const h = MdFix.render('**<img src=x onerror=alert(1)>**と\n「**太字**」', null);
  assert.ok(!h.includes('<img'));
  assert.match(h, /<strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>と<br>「<strong>太字<\/strong>」/);
});

test('chat-ui / meeting-ui が MdFix.render を使い、index.html と sw.js に載っている', () => {
  const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.match(rd('chat-ui.js'), /MdFix\.render\(/);
  assert.match(rd('meeting-ui.js'), /MdFix\.render\(/);
  assert.ok(rd('index.html').indexOf('md-fix.js') < rd('index.html').indexOf('chat-ui.js'));
  assert.match(rd('sw.js'), /'\.\/md-fix\.js'/);
});
