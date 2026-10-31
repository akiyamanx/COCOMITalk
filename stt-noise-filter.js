// COCOMITalk - 文字起こしの「雑音ハルシネーション」除け（v4.3）
// このファイルは whisper-provider.js / whisper-preread.js から使う。無音や雑音から Whisper が作りがちな
// YouTube風の定型句（ご視聴ありがとうございました・チャンネル登録お願いします・字幕の作者行・Thank you for watching 等）を
// 1) 本物の話の後ろに付いていたら外す 2) 定型句だけ（＋おやすみなさい等）なら丸ごと捨てる（表示もAIへも渡さない）。
// 控えめ方針: 単独の「おやすみなさい」「以上です」は、録音がほぼ無音（声の大きいコマが少ない）と分かる時だけ捨てる。
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.0 2026-10-31 - 新規作成（実機ログ: 雑音から「おやすみなさい。 ご視聴ありがとうございました。」）
'use strict';

const SttNoiseFilter = (() => {
  const P = '[。．.、,!！?？\\s]*';
  /** はっきりYouTube/字幕の定型句（話の中にあっても外す） */
  const YT = [
    'ご視聴(いただき|頂き)?(まして)?(本当に)?ありがとうございました', 'ご清聴ありがとうございました', '最後までご覧いただきありがとうございました',
    '(高評価(と|、)?)?(チャンネル登録)(と|、)?(高評価)?(を)?(よろしく)?(お願いします|お願いいたします|してね)', '高評価(を)?(よろしく)?お願いします',
    '次の動画でお会いしましょう', 'また次回の動画で(お会いしましょう)?', 'これからもお楽しみに',
    '(字幕|翻訳|字幕作成|字幕提供)(は|：|:)\\s*[^。\\n]{0,30}', '提供(：|:)\\s*[^。\\n]{0,30}',
    'thank(s| you) (so much )?for watching', 'please subscribe( to (my|our|the) channel)?', 'subtitles? (by|created by)[^\\n]{0,60}$', 'amara\\.org[^.\\n]{0,40}',
  ].map(x => new RegExp(`(${x})${P}`, 'gi'));
  /** 単独なら怪しい（定型句と一緒、または録音がほぼ無音の時だけ捨てる） */
  const WEAK = /^(おやすみなさい|おやすみ|以上です|以上で|ありがとうございました)[。．.!！]*$/;
  const NEAR_SILENT_FRAMES = 5; // 声の大きいコマ(100ms)がこれ未満＝ほぼ無音（約0.5秒）
  const strip = t => t.replace(/^[。．.、,!！?？\s]+/, '').replace(/[、,\s]+$/, '').trim();

  /**
   * @param {string} text
   * @param {number|null} loudFrames - この区切りで声の閾値を超えたコマ数（分からなければ null＝定型句だけ除く）
   * @returns {{text:string, drop:boolean, removed:string[], reason:string}}
   */
  function clean(text, loudFrames = null) {
    const src = String(text || '').trim();
    const removed = [];
    let t = src;
    for (const re of YT) t = t.replace(re, (m) => { removed.push(m.trim()); return ''; });
    t = strip(t);
    if (!t || /^[。．.、,!！?？…♪\s]+$/.test(t) || /^[(（]?(BGM|Music|音楽|拍手)[)）]?[。.]?$/i.test(t)) return { text: '', drop: true, removed, reason: removed.length ? '定型句だけ' : '記号だけ' };
    if (WEAK.test(t)) {
      if (removed.length) return { text: '', drop: true, removed: removed.concat(t), reason: '定型句＋' + t };
      if (loudFrames != null && loudFrames < NEAR_SILENT_FRAMES) return { text: '', drop: true, removed: [t], reason: `ほぼ無音(声${loudFrames}コマ)の「${t}」` };
    }
    return { text: t, drop: false, removed, reason: removed.length ? '定型句を外した' : '' };
  }
  return { clean, NEAR_SILENT_FRAMES };
})();

if (typeof window !== 'undefined') window.SttNoiseFilter = SttNoiseFilter;
