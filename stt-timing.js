// COCOMITalk - 文字起こし(STT)の時間計測ログ ⏱
// このファイルは whisper-provider.js の「録音停止→音声データ→送信→返事→文字」の各区間の時間を測り、デバッグログに1行ずつ残す
// （書き出せる既存の DebugLogger に入る。計測だけで挙動は一切変えない・失敗しても録音/送信を止めない）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.0 2026-10-31 - 新規作成（4〜5秒の文字起こし待ちの内訳を見る用）
'use strict';

const SttTiming = (() => {
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const ms = (a, b) => (a == null || b == null) ? '?' : `${Math.round(b - a)}ms`;

  /** マイクの実際の設定（取れる端末だけ。取れなければ ?） */
  function trackInfo(stream) {
    try {
      const t = stream && stream.getAudioTracks && stream.getAudioTracks()[0];
      const s = t && t.getSettings ? t.getSettings() : {};
      return { sampleRate: s.sampleRate || '?', channels: s.channelCount || '?' };
    } catch (e) { return { sampleRate: '?', channels: '?' }; }
  }

  /**
   * 1区切りぶんの計測を始める
   * @param {function(string)} log - whisper-provider._debugLog
   * @param {object} seg - { stopAt, recStartAt, firstChunkAt, lastChunkAt, stream, ctxRate }
   */
  function start(log, seg = {}) {
    const m = { stop: seg.stopAt != null ? seg.stopAt : now() };
    const safe = (s) => { try { log(s); } catch (e) { /* ログ失敗は無視 */ } };
    return {
      blobReady(blob, ext) {
        m.blob = now();
        const ti = trackInfo(seg.stream);
        const dur = (seg.firstChunkAt != null && seg.lastChunkAt != null) ? `${((seg.lastChunkAt - seg.recStartAt) / 1000).toFixed(1)}s` : '?';
        safe(`⏱ STT a) 録音停止→blob: ${ms(m.stop, m.blob)} | ${blob ? blob.size : 0}B ${blob ? blob.type : '?'} (${ext}) 長さ≈${dur} rate=${ti.sampleRate}Hz ch=${ti.channels} ctx=${seg.ctxRate || '?'}Hz`);
      },
      /** api-common.callAPI の onTiming に渡す */
      hook(phase, info = {}) {
        if (phase === 'fetchStart') { m.fetch = now(); safe(`⏱ STT b) blob→fetch開始: ${ms(m.blob, m.fetch)}${info.model ? ` model=${info.model}` : ''}`); }
        else if (phase === 'headers') { m.head = now(); safe(`⏱ STT c) fetch開始→応答ヘッダ: ${ms(m.fetch, m.head)} HTTP ${info.status}`); }
        else if (phase === 'parsed') { m.parsed = now(); safe(`⏱ STT d) 応答→文字パース: ${ms(m.head, m.parsed)}`); }
      },
      done(textLen) { safe(`⏱ STT 合計 録音停止→文字: ${ms(m.stop, now())} (${textLen == null ? '?' : textLen}字)`); },
    };
  }

  return { now, start, trackInfo };
})();
