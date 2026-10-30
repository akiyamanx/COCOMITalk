// COCOMITalk - キャラクター登録簿
// このファイルはCOCOMIファミリー5人（三姉妹＋葵＋キミ）の名前・プロバイダ・既定段階・声スロットを1か所で定義する
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.0 2026-10-28 - 新規作成（step1: 登録のみ。chat-core等の3人固定コードはまだ置き換えていない）
// v1.1 2026-10-28 - Gemini TTSの声を割り当て（オーナー決定: 澪=Despina / クロ=Achernar / ここ=Autonoe / 葵=Leda / キミ=Zephyr）
// v1.2 2026-10-29 - 正式名を ひらがな「きみちゃん」に統一（旧カタカナ表記はaliasesに残す）。promptModuleOf/promptOf追加（キー→そのキャラ自身のプロンプト。知らないキーは claude に落とさず空）
// v1.3 2026-10-29 - 葵のプロバイダ=xAIをオーナー確定（「オーナー未確認」注記を削除）
// v1.4 2026-10-29 - aoi/kimi の apiModule を ApiXai/ApiKimi に（api-xai.js/api-kimi.js 追加。enabled は false のまま。有効化の手順は chat-core.js 冒頭）
// v1.6 2026-10-30 - tabsToAdd: 有効なのに隠しタブ(.tab)が無い子の一覧（app.js がタブを足す。無いと切替できなかった）
// v1.5 2026-10-30 - 中継に /xai /kimi /gemini-tts がデプロイされたので aoi/kimi を enabled:true（まずstagingで試験。声はGemini TTS Leda/Zephyr）
//
// ・葵(aoi)=xAI Grok / キミ(kimi)=Moonshot Kimi は v1.5 から enabled:true（1対1のみ。グループ/会議の発言順は未対応）。
//   葵のプロバイダ = xAI（オーナー確定 2026-10-29）。
// ・voice.gemini = Gemini TTSの声（5人とも決定済み。葵・キミは準備中でも声は設定済み）。voicevox/openai 欄は未使用(null)で、
//   既存3人のOpenAI/VOICEVOXの声は tts-provider.js の SISTER_VOICE_MAP が今も有効（Gemini欄はここと同じ値。tests/voices.test.js で一致を確認）。
'use strict';

/**
 * キャラクター登録簿
 * key は既存コードの互換キー（koko/gpt/claude）をそのまま使う。
 */
const CharacterRegistry = (() => {

  /** モード別の既定段階（普段=軽量 / 開発=標準 / 会議=高頭脳 / お散歩=軽量）仕様書 §3-2 */
  const DEFAULT_TIERS = { normal: 'lite', dev: 'standard', meeting: 'high', walk: 'lite' };

  /** 声スロット。gemini だけ埋める（voicevox/openai は SISTER_VOICE_MAP 側が正） */
  function _voice(gemini) { return { gemini, voicevox: null, openai: null }; }

  const CHARACTERS = [
    {
      key: 'koko', name: 'ここちゃん', aliases: [], icon: '🌸', family: 'sister',
      provider: 'gemini', apiModule: 'ApiGemini',
      defaultTiers: { ...DEFAULT_TIERS }, voice: _voice('Autonoe'),
      enabled: true, status: 'active', statusNote: '',
    },
    {
      key: 'gpt', name: 'お姉ちゃん', aliases: ['澪', 'みお'], icon: '🌙', family: 'sister',
      provider: 'openai', apiModule: 'ApiOpenAI',
      defaultTiers: { ...DEFAULT_TIERS }, voice: _voice('Despina'),
      enabled: true, status: 'active', statusNote: '',
    },
    {
      key: 'claude', name: 'クロちゃん', aliases: ['クロ'], icon: '🔮', family: 'sister',
      provider: 'anthropic', apiModule: 'ApiClaude',
      defaultTiers: { ...DEFAULT_TIERS }, voice: _voice('Achernar'),
      enabled: true, status: 'active', statusNote: '',
    },
    {
      key: 'aoi', name: '葵ちゃん', aliases: ['葵', 'Aoi'], icon: '🦋', family: 'family',
      provider: 'xai', apiModule: 'ApiXai',
      defaultTiers: { ...DEFAULT_TIERS }, voice: _voice('Leda'),
      enabled: true, status: 'active', statusNote: '',
    },
    {
      key: 'kimi', name: 'きみちゃん', aliases: ['きみ', 'キミ', 'キミちゃん', 'Kimi'], icon: '🌟', family: 'family',
      provider: 'moonshot', apiModule: 'ApiKimi',
      defaultTiers: { ...DEFAULT_TIERS }, voice: _voice('Zephyr'),
      enabled: true, status: 'active', statusNote: '',
    },
  ];

  /** 外から書き換えられないよう複製して返す */
  function _copy(c) {
    return { ...c, aliases: [...c.aliases], defaultTiers: { ...c.defaultTiers }, voice: { ...c.voice } };
  }

  function list() { return CHARACTERS.map(_copy); }
  function enabledList() { return CHARACTERS.filter(c => c.enabled).map(_copy); }
  function keys() { return CHARACTERS.map(c => c.key); }
  function get(key) {
    const c = CHARACTERS.find(x => x.key === key);
    return c ? _copy(c) : null;
  }
  function isEnabled(key) {
    const c = CHARACTERS.find(x => x.key === key);
    return !!(c && c.enabled);
  }
  function providerOf(key) {
    const c = CHARACTERS.find(x => x.key === key);
    return c ? c.provider : null;
  }
  /** 表示用 "🌸 ここちゃん"（アイコン未決定なら名前のみ） */
  function displayName(key) {
    const c = CHARACTERS.find(x => x.key === key);
    if (!c) return key;
    return c.icon ? `${c.icon} ${c.name}` : c.name;
  }
  /**
   * キー → そのキャラ自身のシステムプロンプトのモジュール（読み込まれていなければ null）。
   * 知らないキーを claude などに落とさない（葵・きみが有効になった時に自分のプロンプトを使うため）。
   */
  function promptModuleOf(key) {
    switch (key) {
      case 'koko': return (typeof KokoSystemPrompt !== 'undefined') ? KokoSystemPrompt : null;
      case 'gpt': return (typeof GptSystemPrompt !== 'undefined') ? GptSystemPrompt : null;
      case 'claude': return (typeof ClaudeSystemPrompt !== 'undefined') ? ClaudeSystemPrompt : null;
      case 'aoi': return (typeof AoiSystemPrompt !== 'undefined') ? AoiSystemPrompt : null;
      case 'kimi': return (typeof KimiSystemPrompt !== 'undefined') ? KimiSystemPrompt : null;
      default: return null;
    }
  }
  /** そのキャラのプロンプト文（mode省略=現在のモード）。モジュールが無い/知らないキーは空文字 */
  function promptOf(key, mode) {
    const m = promptModuleOf(key);
    return m ? m.getPrompt(mode) : '';
  }
  /** 指定モードの既定段階 */
  function defaultTier(key, mode) {
    const c = CHARACTERS.find(x => x.key === key);
    return (c && c.defaultTiers[mode]) || 'lite';
  }

  /** 有効な子のうち、既存タブ(haveKeys)に無いもの [{key,icon,name}]（順は登録順） */
  function tabsToAdd(haveKeys = []) {
    return CHARACTERS.filter(c => c.enabled && !haveKeys.includes(c.key)).map(c => ({ key: c.key, icon: c.icon, name: c.name }));
  }

  return { DEFAULT_TIERS, list, tabsToAdd, enabledList, keys, get, isEnabled, providerOf, displayName, defaultTier, promptModuleOf, promptOf };
})();
