// COCOMITalk - 音声認識の先読み（案B）: 話し終わりを待つ間に「仮」の文字起こしを始める
// このファイルは whisper-provider.js から使う。1発話ぶんの「仮」送信（最大3回）を管理し、区切り（設定秒数の無音）が来たら
// 飛んでいる仮の応答を待ち、最新の仮（区切りまでの音を全部ふくむ）を確定文にする。うまくつなげない時は null を返し、従来どおり「全体を1回」送る。
// クロの条件 ①区切り秒数は不変 ②最大3回・超えたら全体1回 ③AIへは確定文のみ(仮は薄い表示だけ) ④連番順・新規送信しない
//   ⑤仮2・仮3も最初から全体（v4.3）・確定時の送り直し保険(既定OFF) ⑥マイク開閉に触らない・読み上げ中は送らない ⑦回数を⏱に ⑧仮の失敗で発話を落とさない
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.0 2026-10-31 - 新規作成（v4.2）
// v1.1 2026-10-31 - v4.3: ⑤変更 仮2・仮3も最初から全体を送り結果を置き換える（続きの切り出しは実機でHTTP 400のため廃止）・雑音の定型句は表示しない
// v1.2 2026-10-31 - v4.4: 長い発話の費用ガード（クロ§2-③）録音30秒超なら以後の仮は送らず、確定時に全体1回。表示は「聞き取り中…（長文）」
'use strict';

const WhisperPreread = (() => {
  const PROVISIONAL_MS = 1000;   // 無音がこの長さになったら「仮」を送る（⑦: 平均1.3回を超えるなら1500へ）
  const LONG_MS = 30000;         // v4.4 ③費用ガード: 録音がこれを超えたら仮は送らない
  const LONG_DISPLAY = '🎤 聞き取り中…（長文）';
  const MAX_SENDS = 3;           // ② 1発話あたりの仮送信の上限（v4.3: 3回とも最初から全体）
  const MIN_BYTES = 3000;        // whisper-provider と同じ「小さすぎ」基準
  const RESEND_KEY = 'cocomitalk-stt-confirm-resend'; // ⑤ 確定時に全体を1回送り直す保険（既定OFF）
  const DISPLAY_PREFIX = '🎤 聞き取り中: '; // 🎤で始める＝voice-input は仮の文字を確定扱い(_lastText)にしない

  function resendOn() { try { return localStorage.getItem(RESEND_KEY) === '1'; } catch (e) { return false; } }
  function setResend(on) { try { localStorage.setItem(RESEND_KEY, on ? '1' : '0'); } catch (e) { /* 保存不可なら既定OFF */ } return !!on; }

  /**
   * 1発話ぶんの先読み係
   * @param {object} deps - { transcribe(blob, ext, prompt, seq) => Promise<{text}>, log(msg), show(text), canSend() => bool, onText(text), clean(text)=>text }
   */
  function create(deps) {
    const sends = []; let cut = 0; let voiceSinceCut = false; let overflow = false; let shownSeq = 0; let long = false;
    const log = (m) => { try { deps.log(m); } catch (e) { /* ignore */ } };
    const newest = () => sends.filter(s => s.text != null).sort((x, y) => y.seq - x.seq)[0] || null;

    function refresh(entry) {
      if (long) return; // v4.4 長文中は「聞き取り中…（長文）」のまま
      if (entry.seq < shownSeq) { log(`⏱ STT 仮${entry.seq}は古い応答（仮${shownSeq}が先に届いた）→ 表示を上書きしない`); return; } // ④ 新しい方が勝つ
      shownSeq = entry.seq;
      let t = entry.text;
      if (t && deps.clean) { try { t = deps.clean(t); } catch (e) { /* 失敗時はそのまま */ } }
      if (!t) return;
      try { deps.show(DISPLAY_PREFIX + t); } catch (e) { /* 表示失敗は無視 */ }
      try { if (deps.onText) deps.onText(t); } catch (e) { /* ignore */ }
    }

    return {
      get count() { return sends.length; },
      get overflow() { return overflow; },
      get long() { return long; },
      /** 発話が聞こえている（=まだ仮に入っていない音がある） */
      onVoice() { voiceSinceCut = true; },
      /**
       * 無音 PROVISIONAL_MS の時点で呼ぶ。送ったら true
       * v1.1(v4.3): 2回目・3回目も「最初から全部」を送る（正しいwebm。続きだけの切り出しは実機でHTTP 400 Invalid file format だった）
       */
      provisional(chunks, mimeType, ext, recMs = 0) {
        if (long) return false;
        if (!voiceSinceCut || chunks.length <= cut) return false;
        if (recMs > LONG_MS) { // v4.4 ③ 長い発話は仮を送らない（全体を最大3回送ると費用が3倍）
          long = true; log(`⏱ STT 先読み: 録音${(recMs / 1000).toFixed(1)}秒が${LONG_MS / 1000}秒超 → 長文ガード・以後の仮は送らず確定時に全体1回`);
          try { deps.show(LONG_DISPLAY); } catch (e) { /* ignore */ }
          return false;
        }
        if (!deps.canSend()) { log('⏱ STT 先読み: 読み上げ中/停止中 → 仮送信しない'); return false; } // ⑥
        if (sends.length >= MAX_SENDS) { overflow = true; log(`⏱ STT 先読み: 仮${MAX_SENDS}回を超えた → 確定時に全体を1回送る`); return false; } // ②
        const to = chunks.length;
        const blob = new Blob(chunks.slice(0, to), { type: mimeType }); // ⑤ 常に最初から（続きの切り出しは廃止）
        if (blob.size < MIN_BYTES) return false;
        const seq = sends.length + 1;
        const entry = { seq, text: null, failed: false, t0: Date.now() };
        log(`⏱ STT 仮${seq}送信 (最初から chunk0〜${to}) ${blob.size}B`);
        entry.p = Promise.resolve().then(() => deps.transcribe(blob, ext, '', seq)).then((r) => {
          entry.text = ((r && r.text) || '').trim();
          log(`⏱ STT 仮${seq}応答 ${Date.now() - entry.t0}ms "${entry.text}"`);
          refresh(entry);
        }).catch((e) => { entry.failed = true; log(`⏱ STT 仮${seq}失敗 ${Date.now() - entry.t0}ms: ${e && e.message} → 確定時は全体を送る`); }); // ⑧
        sends.push(entry); cut = to; voiceSinceCut = false;
        return true;
      },
      /**
       * 区切り（設定秒数の無音）で呼ぶ。新しい送信はしない（④）。
       * @returns {Promise<{text:string, sends:number}|null>} null=先読みを使えない→全体を1回送る
       */
      async confirm() {
        if (sends.length === 0) return null;
        const why = long ? '長文(30秒超)' : overflow ? '上限超え' : (voiceSinceCut ? '最後の仮の後にも声がある' : (resendOn() ? '送り直し保険ON' : ''));
        if (why) { log(`⏱ STT 確定: 先読みを使わない（${why}）→ 全体を1回`); return null; }
        await Promise.all(sends.map(s => s.p)); // ④ 飛んでいる仮の応答を待つ（同じ録音なので新しく送らない）
        if (sends.some(s => s.failed)) { log('⏱ STT 確定: 仮の失敗あり → 全体を1回'); return null; } // ⑧
        const last = newest(); // 最後の仮＝区切りまでの音を全部ふくむ
        return { text: last ? last.text : '', sends: sends.length };
      },
    };
  }

  return { PROVISIONAL_MS, MAX_SENDS, LONG_MS, LONG_DISPLAY, RESEND_KEY, DISPLAY_PREFIX, resendOn, setResend, create };
})();

/** WhisperProvider へ合成する先読みの配線（whisper-provider.js の後に読み込む。whisper-recovery.js と同じ形） */
const WhisperPrereadHooks = {
  _newPreread() {
    return WhisperPreread.create({
      transcribe: (blob, ext, prompt, seq) => SttModel.transcribe(blob, ext, prompt || 'COCOMITalkでの日常会話。',
        (typeof SttTiming !== 'undefined') ? SttTiming.start((m) => this._debugLog(m), { label: `仮${seq}` }) : undefined),
      log: (m) => this._debugLog(m),
      show: (t) => { if (!this._paused && this.onInterim) this.onInterim(t); }, // ③ 仮は表示だけ（onFinalには渡さない）
      clean: (t) => this._noiseClean(t, this._loud, '仮'), // v4.3 雑音の定型句は表示も準備もしない
      canSend: () => this._canOpenNow() && !this._processing, // ⑥ 読み上げ中・pause中・停止中は送らない
      onText: (t) => { if (typeof VoicePrep !== 'undefined') VoicePrep.provisional(t); },
    });
  },
  /** 無音 PROVISIONAL_MS で呼ばれる（マイク・録音には触らない＝⑥） */
  _provisionalSend() {
    const pre = this._pre;
    if (!pre || !this._hasVoiceStarted || this._processing) return;
    const mimeType = this._getSupportedMimeType();
    const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
    const recMs = Date.now() - (this._recordStartTime || Date.now()); // v4.4 長文ガード用
    if (pre.provisional(this._chunks.slice(), mimeType, ext, recMs) && pre.count === 1 && typeof VoicePrep !== 'undefined') VoicePrep.begin(pre);
  },
  /** 区切りで呼ばれる。先読みで確定できたら true（送り直さない）、できなければ false（従来の全体送信へ） */
  async _confirmPreread(pre, seg, loud = null) {
    const sid = this._currentSessionId;
    const r = await pre.confirm();
    if (!r) return false;
    const since = (seg && seg.stopAt != null && typeof SttTiming !== 'undefined') ? `${Math.round(SttTiming.now() - seg.stopAt)}ms` : '?';
    this._debugLog(`⏱ STT 確定(先読み): 区切り→確定 ${since}・送り直しなし | この発話のWhisper回数: ${r.sends}回 "${r.text}"`); // ⑦
    if (sid !== this._currentSessionId) { this._debugLog(`旧session応答を破棄 (sent=${sid}, current=${this._currentSessionId})`); }
    else this._deliverText(r.text, sid, loud);
    this._afterWhisperResponse();
    return true;
  },
};

if (typeof WhisperProvider !== 'undefined') Object.assign(WhisperProvider.prototype, WhisperPrereadHooks);
if (typeof window !== 'undefined') { window.WhisperPreread = WhisperPreread; window.WhisperPrereadHooks = WhisperPrereadHooks; }
