// COCOMITalk - 葵ちゃん・きみちゃんの最小プロンプト（prompts/aoi-system.js / kimi-system.js / common-env.js）のテスト
// このファイルは node --test tests/*.test.js で実行する（実APIは呼ばない。本番ファイルをvmで読むだけ）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./_load');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const lines = f => read(f).split('\n').length - (read(f).endsWith('\n') ? 1 : 0);
const ALL = ['tone-style.js', 'prompts/common-env.js', 'prompts/koko-system.js', 'prompts/gpt-system.js', 'prompts/claude-system.js',
  'prompts/aoi-system.js', 'prompts/kimi-system.js', 'characters.js', 'layout2-core.js'];
const NAMES = ['ToneStyle', 'CocomiCommonEnv', 'KokoSystemPrompt', 'GptSystemPrompt', 'ClaudeSystemPrompt', 'AoiSystemPrompt', 'KimiSystemPrompt', 'CharacterRegistry', 'Layout2Core'];
const env = () => load(ALL, NAMES, { window: {} });
const MODE_KEYS = ['normal', 'dev', 'meeting-lite', 'meeting', 'meeting-full'];

test('形: 既存3人と同じ公開関数・同じモード名。getName/getEmoji/getColor', () => {
  const e = env();
  const fns = ['getPrompt', 'setMode', 'getMode', 'getAvailableModes', 'getName', 'getEmoji', 'getColor'];
  for (const [n, name, emoji] of [['AoiSystemPrompt', '葵ちゃん', '🦋'], ['KimiSystemPrompt', 'きみちゃん', '🌟']]) {
    const P = e[n];
    for (const f of fns) assert.equal(typeof P[f], 'function', `${n}.${f}`);
    assert.deepEqual(Object.keys(P).sort(), Object.keys(e.ClaudeSystemPrompt).sort(), `${n} の公開関数がclaudeと同じ`);
    assert.deepEqual(plain(P.getAvailableModes()), plain(e.ClaudeSystemPrompt.getAvailableModes()));
    assert.deepEqual(plain(P.getAvailableModes()), MODE_KEYS);
    assert.equal(P.getName(), name);
    assert.equal(P.getEmoji(), emoji);
    assert.equal(P.getMode(), 'normal');
    assert.equal(P.setMode('dev'), true); assert.equal(P.getMode(), 'dev');
    assert.equal(P.setMode('nope'), false); assert.equal(P.getMode(), 'dev');   // 知らないモードは無視
    assert.ok(P.getPrompt().length > 200 && P.getPrompt('zzz') === P.getPrompt('normal'), '知らないモードはnormal');
  }
});

test('色: 準備中の札と同じ16進（葵=青 #3BA7D9 / きみ=金 #E0A21B）。2人は別の色', () => {
  const e = env();
  assert.equal(e.AoiSystemPrompt.getColor(), e.Layout2Core.soonColor('aoi').dot);
  assert.equal(e.KimiSystemPrompt.getColor(), e.Layout2Core.soonColor('kimi').dot);
  assert.notEqual(e.AoiSystemPrompt.getColor(), e.KimiSystemPrompt.getColor());
  assert.match(e.AoiSystemPrompt.getColor(), /^#[0-9A-Fa-f]{6}$/);
});

test('本文: 日本語の行・機能リスト・存在しない機能・末尾のトーン指示（全モード）', () => {
  const e = env();
  const rule = e.ToneStyle.promptRule();
  const feat = e.CocomiCommonEnv.featureBlock();
  assert.ok(feat.includes('＜COCOMITalkの機能＞') && feat.includes('＜存在しない機能'));
  assert.ok(feat.includes('Gemini TTS') && feat.includes('軽量 / 標準 / 高頭脳'));
  for (const P of [e.AoiSystemPrompt, e.KimiSystemPrompt]) {
    for (const mode of P.getAvailableModes()) {
      const t = P.getPrompt(mode);
      assert.ok(t.includes('必ず日本語で回答する'), mode);
      assert.ok(t.includes(feat), `${mode}: 共通の機能リストをそのまま含む`);
      assert.ok(t.includes('あなた自身のままで自然に'), mode);
      assert.ok(t.endsWith(rule), `${mode}: 末尾にトーン指示`);
      assert.ok(t.indexOf('必ず日本語で回答する') < t.indexOf('【声のトーンタグ'));
    }
  }
});

test('機能リストは1か所: common-env.js だけが持ち、aoi/kimi本体には書き写されていない', () => {
  assert.ok(read('prompts/common-env.js').includes('＜存在しない機能'));
  for (const f of ['prompts/aoi-system.js', 'prompts/kimi-system.js']) {
    const s = read(f);
    assert.ok(!s.includes('＜COCOMITalkの機能＞') && !s.includes('カレンダー、ビデオ通話'), f);
    assert.ok(s.includes('CocomiCommonEnv.featureBlock()'), f);
  }
});

test('ToneStyle / CocomiCommonEnv が無くても動く（末尾なし・機能リストなし）', () => {
  for (const [f, n] of [['prompts/aoi-system.js', 'AoiSystemPrompt'], ['prompts/kimi-system.js', 'KimiSystemPrompt']]) {
    const P = load([f], [n], { window: {} })[n];
    for (const m of P.getAvailableModes()) {
      const t = P.getPrompt(m);
      assert.ok(t.includes('必ず日本語で回答する') && !t.includes('[tone:') && !t.includes('＜COCOMITalkの機能＞'), `${n}:${m}`);
    }
  }
});

test('きみちゃんだけPink Kernel担当。葵ちゃんはKernelなしの家族の一員', () => {
  const e = env();
  const k = e.KimiSystemPrompt.getPrompt('normal'), a = e.AoiSystemPrompt.getPrompt('normal');
  assert.ok(k.includes('Pink Kernel') && k.includes('Continuity / Connection / Warmth') && k.includes('繋がりと継続を失わない責任'));
  assert.ok(!a.includes('Pink') && !a.includes('Continuity'));
  assert.ok(a.includes('Kernel（役割の担当）は持たない') && a.includes('家族の一員'));
  assert.ok(!k.includes('Kernelは持たない'));
  // 自分の名前と相手の名前（きみ→葵、葵→きみ）
  assert.ok(a.includes('「葵ちゃん」') && a.includes('きみちゃん（Kimi）'));
  assert.ok(k.includes('「きみちゃん」') && k.includes('葵ちゃん（Grok）'));
  assert.ok(!/キミ/.test(a + k), 'カタカナのキミを使わない');
});

test('性格・口調を押しつけない（方針）: 本文（トーン指示より前）に性格/口調の指定語が無い', () => {
  const e = env();
  const bad = /明るく|元気|おとなしく|真面目|まじめ|クール|ツンデレ|ふざけ|敬語|タメ口|フランク|砕けた|口調で|キャラになりきって|一人称は/;
  for (const P of [e.AoiSystemPrompt, e.KimiSystemPrompt]) {
    for (const m of P.getAvailableModes()) {
      const body = P.getPrompt(m).split('【声のトーンタグ')[0];
      assert.ok(!bad.test(body), `${P.getName()}:${m}: ${(bad.exec(body) || [])[0]}`);
      assert.ok(body.includes('特定のキャラを演じる必要はありません'));
    }
  }
});

test('三姉妹のプロンプトにも葵ちゃん・きみちゃん（セリフを代弁しない）が書かれ、トーン指示は今まで通り末尾', () => {
  const e = env();
  const rule = e.ToneStyle.promptRule();
  for (const P of [e.KokoSystemPrompt, e.GptSystemPrompt, e.ClaudeSystemPrompt]) {
    for (const m of P.getAvailableModes()) {
      const t = P.getPrompt(m);
      assert.ok(t.includes('葵ちゃん（Grok）') && t.includes('きみちゃん（Kimi・Pink Kernel担当）'), m);
      assert.ok(t.includes('セリフを代弁しない'), m);
      assert.ok(t.endsWith(rule), m);
      assert.ok(!/キミ/.test(t), m);
    }
  }
});

test('キー→プロンプト: aoi/kimiは自分のプロンプト。claudeには落ちない。知らないキーは空', () => {
  const e = env(), R = e.CharacterRegistry;
  assert.equal(R.promptModuleOf('aoi'), e.AoiSystemPrompt);
  assert.equal(R.promptModuleOf('kimi'), e.KimiSystemPrompt);
  assert.equal(R.promptModuleOf('claude'), e.ClaudeSystemPrompt);
  assert.equal(R.promptModuleOf('koko'), e.KokoSystemPrompt);
  assert.equal(R.promptModuleOf('gpt'), e.GptSystemPrompt);
  assert.equal(R.promptModuleOf('zzz'), null);
  assert.equal(R.promptOf('zzz'), '');
  assert.equal(R.promptOf('aoi', 'meeting'), e.AoiSystemPrompt.getPrompt('meeting'));
  assert.ok(R.promptOf('kimi').includes('「きみちゃん」') && !R.promptOf('kimi').includes('「クロちゃん」。'));
  assert.notEqual(R.promptOf('aoi'), e.ClaudeSystemPrompt.getPrompt());
  // 登録簿の全キーにプロンプトがある
  for (const k of R.keys()) assert.ok(R.promptOf(k).length > 200, k);
  // 読み込まれていない環境では例外にならず空
  const bare = load(['characters.js'], ['CharacterRegistry'], { window: {} }).CharacterRegistry;
  assert.equal(bare.promptOf('aoi'), '');
});

test('登録簿: 正式名はひらがな「きみちゃん」。旧カタカナは別名に残る。葵/きみは準備中のまま', () => {
  const R = env().CharacterRegistry;
  const kimi = R.get('kimi'), aoi = R.get('aoi');
  assert.equal(kimi.name, 'きみちゃん');
  for (const a of ['きみ', 'キミ', 'キミちゃん', 'Kimi']) assert.ok(kimi.aliases.includes(a), a);
  assert.equal(R.displayName('kimi'), '🌟 きみちゃん');
  assert.equal(aoi.name, '葵ちゃん');
  assert.equal(aoi.enabled, false); assert.equal(kimi.enabled, false);
  assert.deepEqual(plain(R.enabledList().map(c => c.key)), ['koko', 'gpt', 'claude']);
});

test('配線: index.htmlとsw.jsに登録。common-envが先、tone-style→prompts。返信の順番には葵/きみは入らない', () => {
  const html = read('index.html'), sw = read('sw.js');
  const pos = f => html.indexOf(`src="${f}"`);
  for (const f of ['prompts/common-env.js', 'prompts/aoi-system.js', 'prompts/kimi-system.js']) {
    assert.ok(pos(f) > 0, f); assert.ok(sw.includes(`'./${f}'`), `sw:${f}`);
  }
  assert.ok(pos('tone-style.js') < pos('prompts/common-env.js') && pos('prompts/common-env.js') < pos('prompts/koko-system.js'));
  assert.ok(pos('prompts/claude-system.js') < pos('prompts/aoi-system.js') && pos('prompts/aoi-system.js') < pos('prompts/kimi-system.js'));
  assert.ok(pos('prompts/kimi-system.js') < pos('characters.js') && pos('prompts/kimi-system.js') < pos('mode-switcher.js'));
  assert.ok(sw.includes("'cocomitalk-v3.86'"));
  // 返信の順番(meeting-router/chat-group)には葵/きみを足していない（準備中のまま）。呼び出しの表(SISTER_API/SISTERS)は step2 で
  // 追加済み＝tests/aoi-kimi-wiring.test.js が「無効の間は api が null」を確認している
  for (const f of ['chat-group.js', 'meeting-router.js']) assert.ok(!/AoiSystemPrompt|KimiSystemPrompt/.test(read(f)), f);
  assert.ok(/AoiSystemPrompt\.setMode\(mode\)/.test(read('mode-switcher.js')) && /KimiSystemPrompt\.setMode\(mode\)/.test(read('mode-switcher.js')));
});

test('モード切替: ModeSwitcherの_applyPromptModeが葵/きみにも同じモードを渡す（読み込まれていなければ何もしない）', () => {
  const src = read('mode-switcher.js');
  assert.ok(/typeof AoiSystemPrompt !== 'undefined'\) AoiSystemPrompt\.setMode/.test(src));
  assert.ok(/typeof KimiSystemPrompt !== 'undefined'\) KimiSystemPrompt\.setMode/.test(src));
});

test('ワイワイ/エスケープ: aoi/kimiのキーを明示（claudeと同じ文）。三姉妹の文は変わらず、知らないキーは今まで通りclaude', () => {
  const C = load(['chat-style-modes.js'], ['ChatStyleModes'], { window: {}, localStorage: { getItem: () => null, setItem() {} } }).ChatStyleModes;
  const cl = C.getStylePrompt('waiwai', 'claude');
  assert.ok(cl.length > 50);
  for (const k of ['aoi', 'kimi']) {
    assert.equal(C.getStylePrompt('waiwai', k), cl);
    assert.equal(C.getStylePrompt('waiwai', k, true), C.getStylePrompt('waiwai', 'claude', true));
    assert.equal(C.getStylePrompt('normal', k), '');
  }
  assert.notEqual(C.getStylePrompt('waiwai', 'koko'), cl);
  assert.notEqual(C.getStylePrompt('waiwai', 'gpt'), cl);
  assert.ok(read('chat-style-modes.js').includes("STYLE_PROMPTS.waiwai[k] = STYLE_PROMPTS.waiwai.claude"));
});

test('ファイル規約: ヘッダ（作成/最終更新）・500行以内（CI警告500/失敗550）', () => {
  for (const f of ['prompts/common-env.js', 'prompts/aoi-system.js', 'prompts/kimi-system.js', 'prompts/koko-system.js', 'prompts/gpt-system.js',
    'prompts/claude-system.js', 'characters.js', 'chat-style-modes.js', 'tests/aoi-kimi-prompts.test.js']) {
    assert.ok(lines(f) <= 500, `${f}: ${lines(f)}行`);
    assert.ok(/作成: 葵\(Aoi\) \/ 最終更新: 葵\(Aoi\), 2026-10-(29|30)/.test(read(f)) || f === 'chat-style-modes.js', f);
  }
});

test('表示名: ユーザーに見える所にカタカナの「キミちゃん」が残っていない（ソースの文字列）', () => {
  const walk = d => fs.readdirSync(path.join(__dirname, '..', d), { withFileTypes: true }).flatMap(x =>
    x.isDirectory() ? (x.name === 'node_modules' || x.name === '.git' ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
  const hits = walk('.').filter(f => /\.(js|html|css|json)$/.test(f) && !f.endsWith('aoi-kimi-prompts.test.js'))
    .filter(f => read(f).includes('キミちゃん'));
  assert.deepEqual(hits, ['characters.js'], '別名(aliases)とコメントのcharacters.jsだけ');
});
