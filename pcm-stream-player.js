// COCOMITalk - 受け取りながら鳴らす生PCMプレーヤー（pcm-stream-player.js v1.0）
// このファイルは中継 /gemini-tts の stream:true 応答（audio/L16, 24kHz, mono, 16bit little-endian）を
// Web Audio の AudioBufferSourceNode に currentTime 基準の start(at) で隙間なく並べて鳴らす。
// voice-output.js からは <audio> と同じに見える（play()/pause()/currentTime/playbackRate/'ended'/'error'）ので、
// 「最後のかたまりが鳴り終わってから ended → 今まで通り1.5秒待ってマイク復帰」の流れはそのまま（ハウリング防止）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.0 2026-10-31 - 新規作成（クロ設計§3 案A・§4: setTimeout で鳴らさない／奇数バイト持ち越し／途中で切れたら truncated）
'use strict';

const PcmStreamPlayer = (() => {
  const RATE = 24000;
  const LEAD_S = 0.06;              // 最初のかたまりを置く余裕（currentTime から）
  let _ctx = null;

  /** 共有の AudioContext（無い環境では null） */
  function ctx(AC) {
    if (_ctx) return _ctx;
    const C = AC || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    if (!C) return null;
    try { _ctx = new C(); } catch (e) { _ctx = null; }
    return _ctx;
  }
  /** ユーザー操作（マイクボタン・吹き出しタップ）の中で呼ぶ: スマホは操作の中でしか音を出せない */
  function unlock() { const c = ctx(); if (c && c.state !== 'running') { try { c.resume(); } catch (e) { /* ignore */ } } return c; }
  function isRunning() { return !!(_ctx && _ctx.state === 'running'); }

  /** 偶数バイトの Int16LE → Float32 */
  function toFloat(bytes) {
    const n = bytes.length >> 1, out = new Float32Array(n);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
    return out;
  }

  /** 奇数バイトを次へ持ち越す切り分け器（中継と同じ規則） */
  function makeCarry() {
    let carry = null;
    return (chunk) => {
      let b = chunk;
      if (carry) { const m = new Uint8Array(carry.length + b.length); m.set(carry); m.set(b, carry.length); b = m; carry = null; }
      if (b.length % 2) { carry = b.slice(-1); b = b.subarray(0, b.length - 1); }
      return b;
    };
  }

  /**
   * <audio> の代わりになる再生物。reader=応答本文の reader（最初のかたまりは first で受け取り済み）
   * opts: { ctx, abort(), onFirstPlay(), log(t) }
   */
  function create(reader, first, opts = {}) {
    const c = opts.ctx || ctx();
    const listeners = { ended: [], error: [] };
    const fire = (t) => { for (const f of listeners[t].splice(0)) { try { f({ type: t }); } catch (e) { /* ignore */ } } };
    const cut = makeCarry();
    const sources = [];
    let nextAt = 0, playing = 0, done = false, stopped = false, started = false, bytes = 0, underruns = 0;
    const log = opts.log || (() => {});
    const el = {
      src: '', playbackRate: 1, truncated: false,
      get currentTime() { return 0; }, set currentTime(v) { /* stop() 互換 */ },
      get _ttsStreamBytes() { return bytes; }, get _ttsUnderruns() { return underruns; },
      addEventListener(t, f) { if (listeners[t]) listeners[t].push(f); },
      removeEventListener(t, f) { if (listeners[t]) listeners[t] = listeners[t].filter(x => x !== f); },
      play() { if (!started) { started = true; schedule(first); pump(); } return Promise.resolve(); },
      pause() {
        if (stopped) return; stopped = true;
        try { opts.abort && opts.abort(); } catch (e) { /* ignore */ }     // 停止ボタン → fetch も止める（中継→Googleも止まる）
        try { reader.cancel(); } catch (e) { /* ignore */ }
        for (const s of sources.splice(0)) { try { s.onended = null; s.stop(); } catch (e) { /* ignore */ } }
        listeners.ended = []; listeners.error = [];
      },
    };
    function finishIfDone() { if (done && playing === 0 && !stopped) { stopped = true; fire('ended'); } } // 最後のかたまりが鳴り終わってから
    function schedule(chunk) {
      const b = cut(chunk); if (!b.length || stopped) return;
      bytes += b.length;
      const f = toFloat(b);
      const buf = c.createBuffer(1, f.length, RATE);
      if (buf.copyToChannel) buf.copyToChannel(f, 0); else buf.getChannelData(0).set(f);
      const s = c.createBufferSource();
      s.buffer = buf; s.playbackRate.value = el.playbackRate || 1; s.connect(c.destination);
      const now = c.currentTime;
      if (nextAt < now + 0.005) { if (nextAt > 0) underruns++; nextAt = now + LEAD_S; }   // 足りなくなったら今から並べ直す
      s.start(nextAt);
      nextAt += buf.duration / (el.playbackRate || 1);
      playing++; sources.push(s);
      s.onended = () => { playing--; const i = sources.indexOf(s); if (i >= 0) sources.splice(i, 1); finishIfDone(); };
    }
    async function pump() {
      try {
        for (;;) {
          const { done: d, value } = await reader.read();
          if (d || stopped) break;
          if (value && value.length) schedule(value);
        }
      } catch (e) {
        if (!stopped) { el.truncated = true; log(`⚠️ 読み上げの流れが途中で切れた(truncated) ${bytes}B まで鳴らす`); }
      }
      done = true; finishIfDone();
    }
    return el;
  }

  return { RATE, ctx, unlock, isRunning, toFloat, makeCarry, create, _reset() { _ctx = null; } };
})();

if (typeof window !== 'undefined') {
  window.PcmStreamPlayer = PcmStreamPlayer;
  // マイクボタン・吹き出しタップなどの操作の中で AudioContext を起こす（どの操作でも害はない）
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('pointerdown', () => PcmStreamPlayer.unlock(), { capture: true, passive: true });
  }
}
