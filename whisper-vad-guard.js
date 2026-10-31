// whisper-vad-guard.js v1.0
// このファイルはCOCOMITalkの音声認識(Whisper)の「耳が死んでいないか」の判定と、録音区切りを送るかどうかの判断、
// 同じ文のくり返し(まだだよ。まだだよ。)を1つにまとめる処理を持つ（DOMに触らない純粋な部品＝テストしやすい）
// v1.0 2026-10-31 - 新規: 無音(maxVol=0)1.5秒で死亡判定 / 生存判定は2秒続いてから / VADが見えていなかった区切りも送る / 連続重複の除去
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';

const WhisperVadGuard = (() => {
  const DEAD_TICKS = 15;   // 100ms×15 = 1.5秒 maxVol=0 が続いたら「耳が死んでる」（旧: 50回=5秒＋α）
  const ALIVE_TICKS = 20;  // 100ms×20 = 2秒 maxVol>0 が続いて初めて「復活」（旧: 1回で即リセット→はしごが1段目から上がれなかった）
  const BLIND_MIN_BYTES = 8000; // VADが見えていなかった区切りでも、この大きさ以上の録音なら文字起こしへ送る

  /** 耳の生死トラッカー。tick()は 'dead'（はしごを上る合図）/'alive'（はしごリセット合図）/null を返す */
  function createTracker() {
    let zero = 0, live = 0, blind = false;
    return {
      tick(maxVol, ctxDead) {
        if (ctxDead || maxVol === 0) {
          live = 0; zero++;
          if (zero >= DEAD_TICKS) { zero = 0; blind = true; return 'dead'; }
          return null;
        }
        zero = 0; live++;
        if (live === ALIVE_TICKS) return 'alive';
        return null;
      },
      /** この区切りの間に耳が死んでいた時間があったか（区切りごとにreset） */
      wasBlind() { return blind || zero >= 5; },
      reset() { zero = 0; live = 0; blind = false; },
    };
  }

  /**
   * 区切りを文字起こしへ送るか
   * hadVoice: VADが発話を見た / blind: VADが見えていない時間があった / forced: 25秒の最大で切った
   */
  function shouldSend({ hadVoice, blind, forced, bytes, durationMs, minMs = 800 }) {
    if ((durationMs || 0) < minMs) return false;
    if (hadVoice) return true;
    // VADが「発話なし」と言っても、耳が死んでいた/最大長で切った区切りは信用しない（大きければ送る）
    return !!(blind || forced) && (bytes || 0) >= BLIND_MIN_BYTES;
  }

  /** 同じ文が「続けて」くり返されたときだけ1つにする（X。X。X。→X。 / X。Y。X。はそのまま） */
  function dedupeRepeats(text) {
    if (!text) return text;
    const parts = String(text).match(/[^。！？!?]+[。！？!?]*/g);
    if (!parts || parts.length < 2) return text;
    const out = [];
    const norm = s => s.replace(/[\s、,。！？!?]/g, '');
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last !== undefined && norm(last) && norm(last) === norm(p)) continue;
      out.push(p);
    }
    return out.map(s => s.trim()).join('');
  }

  /** UI用: 平均音量(0〜255)→0〜1 のレベル（閾値の少し下から上がり始める） */
  function level(avg, threshold = 35) {
    const v = (avg - threshold * 0.6) / (threshold * 1.8);
    return Math.max(0, Math.min(1, v));
  }

  return { DEAD_TICKS, ALIVE_TICKS, BLIND_MIN_BYTES, createTracker, shouldSend, dedupeRepeats, level };
})();

if (typeof window !== 'undefined') window.WhisperVadGuard = WhisperVadGuard;
