// COCOMITalk - 音声会話を速くするための小道具（v1.0）
// このファイルは ①各段階の時間をデバッグログに出す ②AI自身の声を拾った「こだま」を捨てる ③音声の時だけ短く速く返す、をまとめる
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.0 2026-10-30 - 新規作成（voice_latency_audit_2026-10-30.md の「アプリだけで直せること」）
// v1.1 2026-10-30 - 読み上げ用: 絵文字を外す(ttsClean)・最初のかたまりを短く(20〜30字の自然な切れ目)分ける(splitForTTS)・細かい⏱(tlog)
'use strict';

const VoiceFast = (() => {
  const ECHO_WINDOW_MS = 10000;   // 話し終わってからこの時間内の「さっき自分が話した言葉」は、こだまとして捨てる
  const KEEP_MS = 180000;         // 覚えておく上限（長い返事でも途中の文を忘れない）
  const LABEL = {
    segment: '🎙️ 話し終わり→録音を文字起こしへ送信',
    stt: '📝 言葉を表示',
    send: '📤 AIへ送信',
    llm: '💬 AIの返事が届いた',
    tts: '🔊 返事の声が鳴り始めた',
  };
  let spoken = [];                // { n: 正規化した文, at: 時刻 }
  let t0 = 0;                     // 話し終わり（推定）の時刻
  let ttsMarked = false;

  const _win = () => (typeof window !== 'undefined' ? window : {});

  function _log(line) {
    try { if (_win().DebugLogger) _win().DebugLogger.addLog(line); } catch (e) { /* ignore */ }
    console.log(`[VoiceFast] ${line}`);
  }

  /** 段階の時刻をログに出す。segment で起点（話し終わり＝無音検出 − 無音待ち時間）を置き直す */
  function mark(stage, info = {}, now = Date.now()) {
    if (stage === 'segment') { t0 = now - (Number(info.silenceMs) || 0); ttsMarked = false; }
    if (stage === 'send') ttsMarked = false;
    if (stage === 'tts') { if (ttsMarked) return null; ttsMarked = true; }
    const since = t0 ? ` +${((now - t0) / 1000).toFixed(1)}秒（話し終わりから）` : '';
    const line = `⏱ ${LABEL[stage] || stage}${since}`;
    _log(line);
    return line;
  }

  /** 比べるための正規化（記号・空白・絵文字・大小・全角半角の違いを消す） */
  function norm(s) {
    return String(s || '').normalize('NFKC').toLowerCase()
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\s\p{P}\p{S}ー〜]/gu, '');
  }

  function rememberSpoken(text, now = Date.now()) {
    const n = norm(text);
    if (n) spoken.push({ n, at: now });
    spoken = spoken.filter(x => now - x.at <= KEEP_MS);
  }

  /** 読み上げが終わった時に呼ぶ: 覚えている文の時刻を「今」にする（こだま判定の10秒はここから） */
  function endSpeaking(now = Date.now()) {
    spoken.forEach(x => { x.at = now; });
  }

  function _bigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }

  /** 文字起こしが、直近に自分が話した言葉とほぼ同じなら true（こだま） */
  function isEcho(text, now = Date.now()) {
    const n = norm(text);
    if (n.length < 4) return false; // 「うん」「はい」など短い返事は捨てない
    for (const x of spoken) {
      if (now - x.at > ECHO_WINDOW_MS) continue;
      if (x.n.includes(n) || (x.n.length >= 4 && n.includes(x.n))) return true;
      if (n.length >= 6) {
        const set = new Set(_bigrams(x.n)), bg = _bigrams(n);
        const hit = bg.filter(b => set.has(b)).length;
        if (hit / bg.length >= 0.7) return true;
      }
    }
    return false;
  }

  function isVoiceOn() {
    try { return !!(_win().voiceController && _win().voiceController.isEnabled()); } catch (e) { return false; }
  }

  /** 音声の時は軽い段階（lite: 思考なし/最弱）。音声でなければ普段の段階のまま */
  function modelKey(normalKey, voiceOn = isVoiceOn()) {
    return voiceOn ? 'lite' : normalKey;
  }

  /** 音声の時だけ「短く話し言葉で」を足す。じっくり・詳しく等を頼まれた時は足さない */
  function promptExtra(userText, voiceOn = isVoiceOn()) {
    if (!voiceOn) return '';
    if (/じっくり|詳しく|くわしく|丁寧に|ていねいに|長めに/.test(String(userText || ''))) return '';
    return '\n\n【音声会話中】今は声で話しているよ。返事は話し言葉で2〜3文くらいに短く。最初の一言は短く（例:「うん、いいね！」）。箇条書き・見出し・表・URL・絵文字は使わないでね。';
  }

  /** 細かい⏱（TTSの送信/受信/再生など）。起点は話し終わり */
  function tlog(text, now = Date.now()) { return mark(text, {}, now); }

  const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]+/gu;
  /** 読み上げ前に絵文字を外す。文の切れ目の絵文字（いいね✨今日は）は「。」にして区切りとして残す */
  function ttsClean(text) {
    return String(text || '').replace(EMOJI, (m, i, all) => {
      const prev = all.slice(0, i).trim().slice(-1), rest = all.slice(i + m.length).trim();
      return (!prev || /[。．！？!?…♪、，,]/.test(prev) || !rest) ? '' : '。';
    }).replace(/\s*。\s*/g, '。').replace(/。{2,}/g, '。').replace(/、。/g, '。').replace(/^。+/, '').trim();
  }

  const END = '。．！？!?…♪～\n';
  /** 読み上げのかたまり分け: 1つ目は短く(〜30字、自然な切れ目)、2つ目は〜60字、以降は〜max字 */
  function splitForTTS(text, max = 150) {
    const sents = String(text || '').match(new RegExp(`[^${END}]+[${END}]*|[${END}]+`, 'g')) || [];
    const out = [];
    let cur = '';
    const limit = () => (out.length === 0 ? 30 : out.length === 1 ? 60 : max);
    const push = (c) => { c = c.trim(); if (c) out.push(c); };
    for (let s of sents) {
      if (out.length === 0 && !cur && s.trim().length > 30) { // 1文目が長い: 8〜30字の「、」や空白で切る
        const head = s.slice(0, 31), cut = Math.max(head.lastIndexOf('、'), head.lastIndexOf('，'), head.lastIndexOf(' '));
        if (cut >= 8) { push(s.slice(0, cut + 1)); s = s.slice(cut + 1); }
      }
      if (s.length > max) { // 長すぎる文は「、」で分ける
        push(cur); cur = '';
        for (const p of s.split(/(?<=[、，])/)) { if ((cur + p).length > limit() && cur) { push(cur); cur = p; } else cur += p; }
        continue;
      }
      if (cur && (cur.trim().length >= 8 || out.length > 0) && (cur + s).length > limit()) { push(cur); cur = s; }
      else if (out.length === 0 && cur.trim().length >= 8) { push(cur); cur = s; }
      else cur += s;
    }
    push(cur);
    return out;
  }

  function _reset() { spoken = []; t0 = 0; ttsMarked = false; }

  return { ECHO_WINDOW_MS, LABEL, mark, norm, rememberSpoken, endSpeaking, isEcho, isVoiceOn, modelKey, promptExtra, tlog, ttsClean, splitForTTS, _reset };
})();

if (typeof window !== 'undefined') window.VoiceFast = VoiceFast;
