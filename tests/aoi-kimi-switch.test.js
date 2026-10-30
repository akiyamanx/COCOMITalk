// COCOMITalk - 葵/きみに1対1で切り替えられることの回帰テスト（v3.92）
// このファイルは「葵/きみの札を押しても話す子が変わらない」不具合(隠しタブ.tabが三姉妹分しか無かった)の再発防止
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, makeStorage, ROOT } = require('./_load');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

function el() {
  return { placeholder: '', value: '', style: {}, disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelector: () => el(), appendChild() {}, scrollTop: 0 };
}

test('tabsToAdd: 本物の登録簿で、三姉妹のタブしか無ければ 葵🦋・きみ🌟 を足す。全部あれば何も足さない', () => {
  const R = load(['characters.js'], ['CharacterRegistry'], { realRegistry: true }).CharacterRegistry;
  assert.deepEqual(plain(R.tabsToAdd(['koko', 'gpt', 'claude'])),
    [{ key: 'aoi', icon: '🦋', name: '葵ちゃん' }, { key: 'kimi', icon: '🌟', name: 'きみちゃん' }]);
  assert.deepEqual(plain(R.tabsToAdd(['koko', 'gpt', 'claude', 'aoi', 'kimi'])), []);
  // 準備中(無効)の子のタブは足さない
  const off = load(['characters.js'], ['CharacterRegistry']).CharacterRegistry;
  assert.deepEqual(plain(off.tabsToAdd(['koko', 'gpt', 'claude'])), []);
});

test('1対1の切替: switchSister(aoi/kimi) で今の子・入力欄の案内が変わり、送信先は ApiXai / ApiKimi', async () => {
  const els = {};
  const document = { getElementById: id => (els[id] = els[id] || el()), addEventListener() {} };
  const e = load(['characters.js', 'api-compat-core.js', 'api-xai.js', 'api-kimi.js', 'chat-core.js'], ['ChatCore', 'ApiXai', 'ApiKimi'],
    { realRegistry: true, document, window: { addEventListener() {} }, localStorage: makeStorage(),
      ApiCommon: { hasAuthToken: () => true }, ModelTiers: { idMap: () => ({}) } });
  await e.ChatCore.init();
  for (const [k, name, mod] of [['aoi', '葵ちゃん', e.ApiXai], ['kimi', 'きみちゃん', e.ApiKimi]]) {
    e.ChatCore.switchSister(k);
    assert.equal(e.ChatCore.getCurrentSister(), k);
    assert.equal(els['msg-input'].placeholder, `${name}に話しかけてね...`);
    assert.equal(e.ChatCore.getGroupContext().SISTER_API[k].module(), mod);
  }
  e.ChatCore.switchSister('koko');
  assert.equal(e.ChatCore.getCurrentSister(), 'koko');
});

test('配線: app.js がタブを足し(tabsToAdd)、色(テーマ・CSS)と声(Leda/Zephyr)が葵/きみにもある。sw v3.92', () => {
  const app = read('app.js');
  assert.match(app, /CharacterRegistry\.tabsToAdd\(/);
  assert.match(app, /aoi: _theme\('aoi'\), kimi: _theme\('kimi'\)/);
  assert.match(read('design-tokens.css'), /--aoi-primary:[\s\S]*--kimi-primary:/);
  assert.match(read('styles.css'), /data-sister="aoi"/);
  assert.match(read('tts-provider.js'), /aoi: +\{ gemini: \{ voice: 'Leda'/);
  assert.match(read('tts-provider.js'), /kimi: \{ gemini: \{ voice: 'Zephyr'/);
  assert.doesNotMatch(read('chat-core.js'), /for \(const key of \['koko', 'gpt', 'claude'\]\)/);
  assert.ok(read('sw.js').includes("'cocomitalk-v3.93'"));
});
