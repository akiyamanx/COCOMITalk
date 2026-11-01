// COCOMITalk - 会議の進め方（全員共通の手順ブロック）
// このファイルは会議モード（meeting-lite / meeting / meeting-full）の時だけ、5人全員（ここ/お姉ちゃん/クロ/葵/きみ）のプロンプト末尾に足す共通手順
// v1.0 2026-11-01 - 新規（会議システム Phase A・クロ§5-③）。通常会話・開発モードには足さない
// v1.1 2026-11-01 - 質問の全項目に答える（分からない所は「未確認」・後回しにしない）／調べていないのに「公式を確認した」と言わない・記憶の情報は「記憶では」。短すぎる返答は1回だけ聞き直す（isTooShort/RETRY_NOTE）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';

const MeetingProcedure = (() => {
  const MARK = '【COCOMI会議の進め方（全員共通）】';
  const BLOCK = [
    MARK,
    '- 参加者: ここちゃん・お姉ちゃん・クロちゃん・葵ちゃん・きみちゃん。主担当が進行役、他の人は自分の専門から意見・補足・チェック。',
    '- 発言は自分の分だけ。他の人のセリフを代わりに書かない。',
    '- ラウンド1=それぞれ独立した意見 / ラウンド2=補強・反論 / ラウンド3=まとめ（結論にまとめる）。',
    '- 最後に書記が「結論 / 決まったこと / やることの一覧 / 未決事項」にまとめる。まとめやすいよう、提案は短い箇条書きで。',
    '- やることは一覧まで出す。誰がやるかは会議で決めきらず、受け取った葵・澪・クロの3人で相談して決める（担当は空欄か「仮」でよい）。',
    '- 本番環境・お金・外への送信に関わる作業には「アキヤのGOが必要」と書く。',
    '- 質問の項目には全部、この発言の中で答える。分からない項目は「未確認」と書いて、分かる範囲を答える。「確認してから答えるね」のように後回しにして終わらない。',
    '- ツールで実際に検索・確認していないのに「調べた」「公式情報を確認した」と言わない。記憶にもとづく情報は「記憶では」と付ける。',
  ].join('\n');

  /** 短すぎる返答（約40文字未満）は1回だけ聞き直す */
  const SHORT_LIMIT = 40;
  const RETRY_NOTE = '\n\n【聞き直し】さっきの返答が短すぎて質問に答えていませんでした。今わかる範囲で全項目に具体的に答えてください（分からない項目は「未確認」）。後回しにしないでください。';
  function isTooShort(reply) { return typeof reply === 'string' && reply.replace(/\s/g, '').length < SHORT_LIMIT; }

  /** 会議モードか（meeting / meeting-lite / meeting-full） */
  function isMeetingMode(mode) { return typeof mode === 'string' && /^meeting(-lite|-full)?$/.test(mode); }
  function getBlock() { return BLOCK; }
  /** 会議モードの時だけ末尾に足す（二重に足さない） */
  function append(prompt, mode) {
    const p = prompt || '';
    if (!isMeetingMode(mode) || p.includes(MARK)) return p;
    return `${p}\n\n${BLOCK}`;
  }
  return { isMeetingMode, getBlock, append, MARK, isTooShort, RETRY_NOTE, SHORT_LIMIT };
})();
