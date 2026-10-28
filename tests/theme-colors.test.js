// tests/theme-colors.test.js v1.0
// このファイルはCOCOMITalkの配色（落ち着いた青の基調＋姉妹は識別用だけ）が崩れていないかを確かめるテスト
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const tok = (css, name) => (css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1];

test('基調は青: --app-* が定義され、--active-* はそれを指す（姉妹の色を指さない）', () => {
  const css = read('styles.css');
  assert.strictEqual(tok(css, '--app-primary'), '#4A76A8');
  assert.ok(/--active-primary:\s*var\(--app-primary\)/.test(css));
  assert.ok(/--active-dark:\s*var\(--app-dark\)/.test(css));
  assert.ok(!/--active-primary:\s*var\(--koko/.test(css));
});

test('app.js: 切り替えるのは --sister-* だけで、--active-* は触らない／theme-colorは青固定', () => {
  const js = read('app.js');
  assert.ok(js.includes("'--sister-primary'"));
  assert.ok(!js.includes("'--active-primary'"));
  assert.ok(!js.includes('#FF6B9D'));
  assert.ok(read('index.html').includes('content="#4A76A8"'));
  assert.ok(read('manifest.json').includes('"theme_color": "#4A76A8"'));
});

test('AA(4.5:1): 白文字×基調、本文×背景、補助文字、淡い文字、名札の濃×淡', () => {
  const css = read('styles.css');
  const need = [
    ['#FFFFFF', tok(css, '--app-primary')], ['#FFFFFF', tok(css, '--app-dark')],
    [tok(css, '--app-dark'), tok(css, '--app-bg')], [tok(css, '--text-primary'), tok(css, '--bg-main')],
    [tok(css, '--text-primary'), tok(css, '--bg-chat')], [tok(css, '--text-secondary'), tok(css, '--bg-main')],
    [tok(css, '--text-light'), tok(css, '--bg-main')], [tok(css, '--text-light'), tok(css, '--bg-chat')],
  ];
  for (const k of ['koko', 'gpt', 'claude']) need.push([tok(css, `--${k}-dark`), tok(css, `--${k}-light`)]);
  for (const [f, b] of need) assert.ok(f && b && ratio(f, b) >= 4.5, `${f} on ${b} = ${f && b && ratio(f, b).toFixed(2)}`);
});

test('旧い派手な色（ピンク #FF6B9D / 濃い紫 #6c5ce7 / #6B5CE7）が画面の基調として残っていない', () => {
  const files = ['styles.css', 'design-tokens.css', 'layout-main.css', 'layout-panels.css', 'layout2-main.css', 'meeting-styles.css',
    'memory-ui-styles.css', 'consultation-styles.css', 'vision-styles.css', 'voice-ui.js', 'voice-sender.js', 'app.js'];
  for (const f of files) assert.ok(!/#FF6B9D|#6c5ce7|#6B5CE7/i.test(read(f)), f);
});

test('チャット: AIの吹き出しに data-sister を付ける（その子の色の目印）', () => {
  assert.ok(read('chat-ui.js').includes("setAttribute('data-sister', sisterKey)"));
  assert.ok(/data-sister="koko"\] \.msg-avatar/.test(read('styles.css')));
});
