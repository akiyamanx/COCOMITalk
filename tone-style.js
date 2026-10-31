// tone-style.js v1.0
// このファイルは何をするか:
// 返信の先頭に付く「声のトーンタグ」[tone:xxx] を読み取って画面・履歴・読み上げ用の文から消し、
// Gemini TTSの話し方(style)に変換する。タグが無い/壊れていても本文と読み上げは必ず動く。
// 6種類だけ: cheerful(基本) / calm / gentle-sad / serious / excited / explaining
// 使う場所: 各キャラのプロンプト末尾(promptRule) / 返信受け取り直後(consume) / 読み上げ(styleForText)

// v1.0 2026-10-28 - 新規作成（場面ごとの口調切り替え）
// v1.1 2026-10-29 - 漏れ対策2件: ①角括弧なしの先頭行「Tone: calm」も外す ②ストリーミング途中の日本語の値（[トーン:落…）も隠す
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29

const ToneStyle = (() => {
  const TONES = ['cheerful', 'calm', 'gentle-sad', 'serious', 'excited', 'explaining'];
  const DEFAULT_TONE = 'cheerful';

  // Gemini TTSの speech_metadata.style に入る文（英語の自由文・200字以内。基本はみんな明るく）
  const STYLES = {
    'cheerful': 'Bright, friendly and warm, natural cheerful conversation',
    'calm': 'Calm, relaxed and soft-spoken, steady unhurried pace',
    'gentle-sad': 'Gentle, soft and comforting, slightly slower and quieter, empathetic and sincere, never overly bright',
    'serious': 'Calm and serious, composed and clear, steady pace, a little slower, no playful tone',
    'excited': 'Excited and delighted, upbeat, lively and celebratory',
    'explaining': 'Clear and steady, friendly and easy to follow, like a kind teacher explaining, moderate pace',
  };

  const ALIASES = {
    'cheerful': 'cheerful', 'calm': 'calm', 'gentle-sad': 'gentle-sad', 'gentle': 'gentle-sad', 'sad': 'gentle-sad',
    'serious': 'serious', 'excited': 'excited', 'explaining': 'explaining', 'explain': 'explaining',
    '明るい': 'cheerful', '落ち着いた': 'calm', '落ち着き': 'calm', 'やさしい': 'gentle-sad', '優しい': 'gentle-sad',
    '悲しい': 'gentle-sad', '真剣': 'serious', 'わくわく': 'excited', '盛り上がり': 'excited', '説明': 'explaining',
  };

  const OPEN = '[\\[［【(（<＜]';
  const CLOSE = '[\\]］】)）>＞]';
  const LABEL = '(?:tone|ｔｏｎｅ|トーン|口調)\\s*[:：=＝]';
  // 先頭の完全なタグ / 先頭の閉じ忘れタグ(既知の語だけ) / 文中の完全なタグ
  const RE_LEAD = new RegExp(`^[\\s\\u200b\\ufeff]*${OPEN}\\s*${LABEL}\\s*([^\\]］】)）>＞\\n]{0,30}?)\\s*${CLOSE}`, 'i');
  const RE_LEAD_OPEN = /^[\s\u200b\ufeff]*[[［【]\s*tone\s*[:：=＝]\s*(cheerful|calm|gentle[-_ ]?sad|gentle|sad|serious|excited|explaining|explain)\b\]?/i;
  // v1.1追加 - 角括弧なしの先頭行「Tone: calm」「トーン：落ち着いた」（既知の語＋行末だけ。本文の「Tone: calm and…」のような文は外さない）
  const RE_LEAD_BARE = /^[\s\u200b\ufeff]*(?:tone|ｔｏｎｅ|トーン|口調)\s*[:：=＝]\s*(cheerful|calm|gentle[-_ ]?sad|gentle|sad|serious|excited|explaining|explain|明るい|落ち着いた|落ち着き|やさしい|優しい|悲しい|真剣|わくわく|盛り上がり|説明)[ \t\u3000]*(?:\r?\n|$)/i;
  const RE_ANY = new RegExp(`[\\[［【]\\s*${LABEL}\\s*[^\\]］】\\n]{0,30}?\\s*[\\]］】]`, 'gi');
  // ストリーミング途中の「まだタグかどうか分からない先頭」: [ [t [to [tone [tone:ca ...
  const RE_PARTIAL = /^[\s\u200b\ufeff]*[[［【]\s*(?:t|to|ton|tone|ト|トー|トーン|口|口調)?\s*(?:[:：=＝]\s*[^\]］】)）>＞\n]{0,30})?$/i;
  // v1.1追加 - 角括弧なしの「Tone:」途中（コロンまで来てから隠す。"To"や"Tokyo"の書き出しは隠さない）
  const RE_PARTIAL_BARE = /^[\s\u200b\ufeff]*(?:tone|ｔｏｎｅ|トーン|口調)\s*[:：=＝]\s*[^\n]{0,20}\r?\n?$/i;

  function normalizeTone(word) {
    if (typeof word !== 'string') return null;
    const k = word.normalize('NFKC').trim().toLowerCase().replace(/[_\s]+/g, '-');
    return ALIASES[k] || null;
  }

  /** 返信文からタグを取り除き { text, tone(不明ならnull), hadTag } を返す。何が来ても例外を出さない */
  function parse(raw) {
    if (typeof raw !== 'string') return { text: raw == null ? '' : String(raw), tone: null, hadTag: false };
    let text = raw;
    let tone = null;
    let hadTag = false;
    let m = RE_LEAD.exec(text);
    if (m) {
      hadTag = true;
      tone = normalizeTone(m[1]);
      text = text.slice(m[0].length);
    } else if ((m = RE_LEAD_OPEN.exec(text))) {
      hadTag = true;
      tone = normalizeTone(m[1]);
      text = text.slice(m[0].length);
    } else if ((m = RE_LEAD_BARE.exec(text))) {
      hadTag = true;
      tone = normalizeTone(m[1]);
      text = text.slice(m[0].length);
    }
    // 文中・文末に紛れたタグも画面に出さない（先頭タグが無ければ最初のものを採用）
    text = text.replace(RE_ANY, (t) => {
      hadTag = true;
      if (!tone) {
        const mm = /[:：=＝]\s*([^\]］】\n]*)/.exec(t);
        tone = normalizeTone(mm ? mm[1] : '');
      }
      return '';
    });
    if (hadTag) text = text.replace(/^[ \t\u3000\r\n]+/, '');
    return { text, tone, hadTag };
  }

  // ---- 返信ごとのトーンを少し覚えておく（読み上げ時に本文の先頭で引き当てる）----
  const _memory = new Map();
  const MEMORY_MAX = 40;
  function _key(text) {
    return String(text || '').replace(/\s+/g, '').slice(0, 16); // 先頭だけで引き当てる（末尾の💾SAVE行などが外れても一致）
  }
  function remember(text, tone) {
    const k = _key(text);
    if (!k || !TONES.includes(tone)) return;
    _memory.delete(k);
    _memory.set(k, tone);
    if (_memory.size > MEMORY_MAX) _memory.delete(_memory.keys().next().value);
  }
  function recall(text) {
    return _memory.get(_key(text)) || null;
  }

  /** 返信を受け取った直後に呼ぶ。タグを消した本文を返し、トーンを覚える */
  function consume(raw) {
    try {
      const r = parse(raw);
      if (r.tone) remember(r.text, r.tone);
      else _memory.delete(_key(r.text)); // タグ無しの返信に古い同じ書き出しのトーンを使い回さない
      return r.text;
    } catch (e) {
      return raw;
    }
  }

  /** ストリーミング途中の文を画面に出す用。タグの途中（"[to" など）は空にして隠す */
  function streamView(partial) {
    try {
      if (typeof partial !== 'string') return '';
      if (RE_PARTIAL.test(partial) || RE_PARTIAL_BARE.test(partial)) return '';
      return parse(partial).text;
    } catch (e) {
      return typeof partial === 'string' ? partial : '';
    }
  }

  // ---- タグが無い/忘れた時の軽い推定（キーワード・絵文字）----
  const RE_GENTLE = /(亡くな|他界|入院|病気|病院|手術|闘病|喪失|別れ|悲し|かなし|つら[いかっ]|辛[いかっ]|寂し|さみし|淋し|泣[いきけ]|涙|落ち込|不安|心配|しんどい|苦し|お悔やみ|残念|ごめんね|ごめんなさい|申し訳|すみません|😢|😭|🥺|😞|😔|💔)/;
  const RE_SERIOUS = /(⚠|重要|ご注意|注意して|注意が必要|危険|警告|緊急|障害|トラブル|エラー|失敗|問題が|セキュリティ|漏えい|漏洩|違反|法的|契約|訴訟|取り返し|必ず確認|ご確認ください)/;
  const RE_EXCITED = /(おめでとう|やったー|やったね|やった！|やったぁ|最高|すごーい|すっごい|わーい|わぁい|いえーい|イエーイ|サイコー|大成功|🎉|🥳|🎊|！！)/;
  const RE_EXPLAIN = /(手順|ステップ|まず|次に|最後に|つまり|要するに|理由は|仕組み|というのは|例えば|たとえば|解説|説明すると|ポイントは)/g;

  function detect(text) {
    try {
      const t = String(text || '');
      if (RE_GENTLE.test(t)) return 'gentle-sad';
      if (RE_SERIOUS.test(t)) return 'serious';
      if (RE_EXCITED.test(t)) return 'excited';
      const hits = (t.match(RE_EXPLAIN) || []).length;
      const listLines = (t.match(/^\s*(?:\d+[.．]|[-・*]\s)/gm) || []).length;
      if (hits >= 2 || listLines >= 3 || t.includes('```')) return 'explaining';
    } catch (e) { /* 推定に失敗しても基本トーンへ */ }
    return DEFAULT_TONE;
  }

  /** 読み上げるトーン: 覚えたタグ → 推定 → cheerful */
  function toneFor(text) {
    const r = parse(text); // タグが残っていればそれを優先（本文側で引き当てる）
    return r.tone || recall(r.text) || detect(r.text) || DEFAULT_TONE;
  }
  function styleFor(tone) {
    return STYLES[tone] || STYLES[DEFAULT_TONE];
  }
  function styleForText(text) {
    return styleFor(toneFor(text));
  }

  /** 各キャラのシステムプロンプトの末尾に足す指示（全キャラ共通・短く） */
  function promptRule() {
    return '\n\n【声のトーンタグ（読み上げ用）】\n' +
      '返信の一番最初に、次のどれか1つだけをタグとして半角で付けてください。例: [tone:cheerful] 今日もいい天気だね！\n' +
      'cheerful=楽しい話・雑談（基本。迷ったらこれ） / calm=落ち着いた話 / gentle-sad=悲しい・心配・謝る・病気や喪失などの繊細な話 / ' +
      'serious=重要・注意・トラブル・悪い知らせ / excited=お祝い・盛り上がり / explaining=説明・手順・解説\n' +
      'タグは画面には表示されません。タグの後ろは普段どおりの文章にし、タグの説明や2つ以上のタグは書かないでください。\n';
  }

  function _reset() { _memory.clear(); }

  return { TONES, DEFAULT_TONE, STYLES, parse, consume, streamView, detect, toneFor, styleFor, styleForText, promptRule, remember, recall, _reset };
})();

if (typeof window !== 'undefined') window.ToneStyle = ToneStyle;
