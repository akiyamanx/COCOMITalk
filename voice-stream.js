// COCOMITalk - AIの返事を「受け取りながら」読み上げる（ストリーミング読み上げ v1.0）
// このファイルは、音声会話中にAIの返事が少しずつ届く時、最初の1文（。！？!? か 30字の切れ目）が揃った時点で声にし始める仕組み
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.0 2026-10-30 - 新規作成（kuro_reply_tts_2026-10-30.md §2(a)）。かたまりの大きさは今と同じ（1つ目〜30字・2つ目〜60字・以降〜150字）、2つ同時に先読み
//   ハウリング防止は今のまま: 返事全体を1つの「話し中」にする（かたまりの間・返事の到着待ちでもマイクを開けない）。onPlayEnd は最後に1回だけ
//   voice-output.js（AudioPlaybackManager）より後に読み込む（mixinで speakStream を足す）
'use strict';

const VoiceStream = (() => {
  const END = '。．！？!?…♪～\n';
  const isEnd = (ch) => END.includes(ch);
  const LIMITS = [30, 60];
  const MAX = 150;
  const limitFor = (n) => (n < LIMITS.length ? LIMITS[n] : MAX);

  /** 画面に出す前の生の文 → 読み上げてよい部分（声のトーンタグの途中は隠す・💾SAVE以降は読まない） */
  function view(raw) {
    let v = String(raw || '');
    try { if (typeof ToneStyle !== 'undefined') v = ToneStyle.streamView(v); } catch (e) { /* そのまま */ }
    const k = v.indexOf('💾');
    return k >= 0 ? v.slice(0, k) : v;
  }

  /** 文の終わり（END）の位置の直後。続けて並んだ記号（。！ など）もまとめる。無ければ -1 */
  function endAfter(s, from = 0) {
    for (let i = from; i < s.length; i++) {
      if (isEnd(s[i])) { let j = i + 1; while (j < s.length && isEnd(s[j])) j++; return j; }
    }
    return -1;
  }

  /**
   * 次に声にするかたまりを決める（純粋関数）。
   * @param {string} text 今までに届いた読み上げ用の文 / @param {number} pos 既に渡した位置 / @param {number} count 既に作ったかたまり数
   * @param {{done?:boolean, need?:boolean}} o done=返事が全部届いた / need=先読みの枠が空いている（すぐ次が欲しい）
   * @returns {{piece:string, next:number}|null}
   */
  function nextPiece(text, pos, count, o = {}) {
    const rest = String(text || '').slice(pos);
    if (!rest.trim()) return (o.done && rest) ? { piece: '', next: pos + rest.length } : null;
    const limit = limitFor(count);
    if (count === 0) {
      let e = endAfter(rest);
      // 1文目が8字未満（「うん！」等）は次の文とつなげる（今の分け方と同じ）。返事が終わっていれば短いまま
      while (e > 0 && rest.slice(0, e).trim().length < 8) { const e2 = endAfter(rest, e); if (e2 < 0) { e = o.done ? rest.length : -1; break; } e = e2; }
      if (e < 0 && o.done) e = rest.length;
      const head = rest.slice(0, Math.min(e < 0 ? rest.length : e, limit + 1));
      if (e < 0 || e > limit) { // 1文目が長い/まだ終わらない: 8〜30字の「、」や空白で切る（今の30字ルール）
        const cut = Math.max(head.lastIndexOf('、'), head.lastIndexOf('，'), head.lastIndexOf(' '));
        if (cut >= 8 && (e >= 0 || rest.length > limit)) return { piece: rest.slice(0, cut + 1), next: pos + cut + 1 };
        if (e < 0) return null; // 切れ目がまだ無い: もう少し待つ
      }
      return { piece: rest.slice(0, e), next: pos + e };
    }
    // 2つ目以降: 終わった文だけを、上限まで詰める
    let used = 0, e;
    while ((e = endAfter(rest, used)) > 0) {
      if (used > 0 && e > limit) break;
      used = e;
      if (used >= limit) break;
    }
    if (o.done && used === 0) used = rest.length;
    else if (o.done && used < limit && rest.length <= limit) used = rest.length;
    if (used === 0) return null;
    if (!o.done && !o.need && used < limit && endAfter(rest, used) < 0) return null; // 急がない時は、上限近くまで貯める
    if (used > MAX) { // 長すぎる1文は「、」で分ける
      const c = rest.slice(0, MAX + 1).lastIndexOf('、');
      if (c >= 8) used = c + 1;
    }
    return { piece: rest.slice(0, used), next: pos + used };
  }

  function _tlog(t) { try { if (typeof VoiceFast !== 'undefined') VoiceFast.tlog(t); } catch (e) { /* ignore */ } }

  /** chat-core 用: 音声会話中で、この姉妹のAPIがストリーミングできる時だけ読み上げ係を作る（できなければ null＝今まで通り） */
  function begin(apiModule, sisterId, win = (typeof window !== 'undefined' ? window : {})) {
    try {
      const vc = win.voiceController;
      if (!apiModule || apiModule.supportsStream !== true) return null;
      if (!vc || !vc.isEnabled() || !vc._playback || typeof vc._playback.speakStream !== 'function') return null;
      return vc._playback.speakStream(sisterId, { speed: vc._speed });
    } catch (e) { return null; }
  }

  return { END, view, endAfter, nextPiece, begin, limitFor, _tlog };
})();

if (typeof window !== 'undefined') window.VoiceStream = VoiceStream;

/**
 * AudioPlaybackManager に「受け取りながら読み上げる」を足す。
 * 戻り値: { push(delta), finish(finalText) → 1つでも声にしたら true（false なら呼び出し側が今まで通り speak する）, started() }
 */
if (typeof AudioPlaybackManager !== 'undefined') {
  AudioPlaybackManager.prototype.speakStream = function(sisterId, options = {}) {
    const self = this;
    const st = { raw: '', final: null, emitted: '', pos: 0, chunks: [], pres: [], nextSyn: 0, inflight: 0, p: 0, done: false,
      gen: null, style: options.style, firstDelta: false, waiters: [] };
    const alive = () => st.gen !== null && st.gen === self._gen;
    const wake = () => { const w = st.waiters; st.waiters = []; w.forEach(f => f()); };
    const textNow = () => {
      if (st.final === null) return VoiceStream.view(st.raw);
      const f = VoiceStream.view(st.final);
      return f.startsWith(st.emitted) ? f : st.emitted + '\n' + f; // ツール等で文が変わった時は、言った分の後ろに新しい返事を続ける
    };
    let vc = null;

    const startSynth = () => {
      while (alive() && st.inflight < 2 && st.nextSyn < st.chunks.length) {
        const i = st.nextSyn++;
        st.inflight++;
        self._tlog(`🔊 TTS${i + 1}送信(ストリーム) ${st.chunks[i].length}字「${st.chunks[i].slice(0, 12)}…」 声=${vc.voice}`);
        st.pres[i] = self._synth(st.chunks[i], vc.voice, sisterId, options.speed || 1.0, st.style);
        st.pres[i].then(a => self._tlog(`📦 TTS${i + 1}受信 ${self._ttsInfo(a)}`), e => self._tlog(`⚠️ TTS${i + 1}失敗 ${e.message}`))
          .finally(() => { st.inflight--; pump(); });
      }
    };

    const firstStart = () => { // 最初のかたまりができた時に1回だけ: 今まで通り「話し中」にする（マイクは止まったまま）
      if (self._playing || self._preparing || self._queuePlaying) self.stop();
      st.gen = ++self._gen;
      vc = getSisterVoice(sisterId);
      if (st.style === undefined) {
        try { st.style = (typeof ToneStyle !== 'undefined') ? ToneStyle.styleFor(ToneStyle.parse(st.raw).tone || ToneStyle.detect(textNow())) : undefined; } catch (e) { st.style = undefined; }
      }
      self._chunkedPlaying = true; self._queueCancelled = false; self._playing = true;
      if (self.onPlayStart) self.onPlayStart(sisterId);
      playLoop();
    };

    function pump() {
      if (st.gen !== null && !alive()) return;
      const text = textNow();
      for (;;) {
        const need = st.nextSyn >= st.chunks.length && st.inflight < 2;
        const r = VoiceStream.nextPiece(text, st.pos, st.chunks.length, { done: st.done, need });
        if (!r) break;
        st.emitted = text.slice(0, r.next); st.pos = r.next;
        let c = self._cleanTextForTTS(r.piece);
        if (typeof VoiceFast !== 'undefined') c = VoiceFast.ttsClean(c);
        if (c && (typeof VoiceFast === 'undefined' || VoiceFast.norm(c))) {
          st.chunks.push(c);
          if (st.gen === null) firstStart();
        }
        if (!r.piece) break;
      }
      if (st.gen !== null) { startSynth(); wake(); }
    }

    async function playLoop() {
      const gen = st.gen;
      for (st.p = 0; ; st.p++) {
        while (gen === self._gen && ((st.p >= st.chunks.length && !st.done) || (st.p < st.chunks.length && !st.pres[st.p]))) {
          startSynth(); // 合成がまだ始まっていない番なら始める（同じ文を2回作らない）
          if (st.p < st.chunks.length && st.pres[st.p]) break;
          await new Promise(r => { st.waiters.push(r); setTimeout(r, 250); });
        }
        if (gen !== self._gen || self._queueCancelled) return;
        if (st.p >= st.chunks.length) break;
        try {
          await self._speakOneChunk(st.chunks[st.p], vc.voice, sisterId, { ...options, style: st.style, _gen: gen, _idx: st.p + 1 }, st.pres[st.p]);
        } catch (e) { self._log(`stream chunk ${st.p + 1} エラー: ${e.message}`); }
        pump();
      }
      if (gen !== self._gen) return;
      self._playing = false; self._currentAudio = null; self._chunkedPlaying = false;
      if (self.onPlayEnd) self.onPlayEnd(sisterId);
    }

    return {
      push(delta) {
        if (st.done || typeof delta !== 'string' || !delta) return;
        if (!st.firstDelta) { st.firstDelta = true; VoiceStream._tlog('💬 AIの返事の最初の文字が届いた（ストリーム）'); }
        st.raw += delta; pump();
      },
      finish(finalText) {
        if (st.done) return st.gen !== null;
        st.final = typeof finalText === 'string' ? finalText : null;
        if (st.final === null) st.final = VoiceStream.view(st.raw);
        st.done = true;
        if (st.gen === null) return false; // まだ1つも声にしていない: 呼び出し側が今まで通り読み上げる
        pump(); wake();
        return true;
      },
      started() { return st.gen !== null; },
    };
  };
}
