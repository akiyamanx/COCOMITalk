// COCOMITalk - 音声認識(STT)の文字起こしモデル設定と呼び出し
// このファイルは whisper-provider.js が使う「どのモデルで文字起こしするか」を設定値にし、新モデルが通らない時は旧モデルへ自動で戻す
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.0 2026-10-28 - 新規作成（既定 gpt-transcribe、whisper-1 は 2027-02-26 の停止日まで選べる／自動フォールバック。無音区切り秒数の設定つき）
// v1.1 2026-10-30 - 無音区切りに1.2秒/1.5秒を追加し既定を1.5秒に。旧既定(3秒)のまま保存されていた人は1回だけ1.5秒へ移す（4/5秒を選んだ人はそのまま）
// v1.2 2026-10-30 - 無音区切りに2秒/2.5秒を追加（既定1.5秒・保存済みの値は変えない）
//
// ★未確認★ gpt-transcribe を /whisper 経由で実際に呼んだことはない（公式docs 2026-10-28 のみ）。
//   公式docs: gpt-transcribe は language ではなく languages[] を使う（両方は送らない）。アプリは従来どおり language=ja を送り、
//   languages[] への変換は中継Worker側（relay_stt_tts.patch。提案・未デプロイ）が行う。未対応の中継で失敗しても
//   whisper-1 に自動で戻る（旧モデルが生きている間だけ）。
'use strict';

const SttModel = (() => {

  const KEY = 'cocomitalk-stt-model';
  const SILENCE_KEY = 'cocomitalk-stt-silence-ms';
  const DEFAULT_MODEL = 'gpt-transcribe';
  const LEGACY_MODEL = 'whisper-1';
  const LEGACY_RETIRE = '2027-02-26';          // OpenAI廃止予定表（whisper-1停止日）
  const RETRY_AFTER_MS = 10 * 60 * 1000;       // 新モデル失敗後、しばらくは旧モデルで送る
  const SILENCE_CHOICES = [1200, 1500, 2000, 2500, 3000, 4000, 5000];  // 長くすると文の途中で区切られにくい（反応は遅くなる）
  const SILENCE_DEFAULT = 1500;                // v1.1: 3000→1500（文の途中で切れても送信前の待ちで1つにまとめる）
  const SILENCE_MIGRATED_KEY = 'cocomitalk-stt-silence-v2'; // 旧既定3000→1500 の移行を1回だけ（以後3秒を選び直したら尊重）

  /** 選べる文字起こしモデル（価格はUSD/分。公式モデルページ） */
  const MODELS = {
    'gpt-transcribe': { label: 'gpt-transcribe（新・$0.0045/分）', perMin: 0.0045 },
    'whisper-1': { label: 'whisper-1（旧・$0.006/分・2027-02-26で停止）', perMin: 0.006 },
  };

  let _failedAt = 0;

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function get() {
    try { const v = localStorage.getItem(KEY); return v && own(MODELS, v) ? v : DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; }
  }
  function set(model) {
    const m = own(MODELS, model) ? model : DEFAULT_MODEL;
    try { localStorage.setItem(KEY, m); } catch (e) { /* 保存不可なら既定のまま */ }
    return m;
  }

  /** 旧モデルがまだ生きているか（停止日の翌日以降は戻さない） */
  function legacyAlive(day) {
    return (day || new Date().toISOString().slice(0, 10)) <= LEGACY_RETIRE;
  }

  function getSilenceMs() {
    try {
      let v = parseInt(localStorage.getItem(SILENCE_KEY), 10);
      if (!localStorage.getItem(SILENCE_MIGRATED_KEY)) {
        if (v === 3000) { v = SILENCE_DEFAULT; localStorage.setItem(SILENCE_KEY, String(v)); }
        localStorage.setItem(SILENCE_MIGRATED_KEY, '1');
      }
      return SILENCE_CHOICES.includes(v) ? v : SILENCE_DEFAULT;
    } catch (e) { return SILENCE_DEFAULT; }
  }
  function setSilenceMs(ms) {
    const v = SILENCE_CHOICES.includes(Number(ms)) ? Number(ms) : SILENCE_DEFAULT;
    try { localStorage.setItem(SILENCE_KEY, String(v)); localStorage.setItem(SILENCE_MIGRATED_KEY, '1'); } catch (e) { /* ignore */ }
    return v;
  }

  /** 今実際に使うモデル（新モデルが直近で失敗していて旧モデルが生きていれば旧モデル） */
  function effectiveModel(now = Date.now()) {
    const m = get();
    return (m !== LEGACY_MODEL && (now - _failedAt) < RETRY_AFTER_MS && legacyAlive()) ? LEGACY_MODEL : m;
  }

  /**
   * 1発話ぶんの音声を /whisper に送って {text} を得る。language は従来どおり ja。
   * 新モデルで失敗したら（旧モデルが生きていれば）whisper-1 で1回だけやり直す。
   */
  async function transcribe(blob, ext, prompt) {
    const fd = new FormData();
    fd.append('file', blob, `audio.${ext}`);
    fd.append('language', 'ja');
    fd.append('prompt', prompt || 'COCOMITalkでの日常会話。');
    const model = effectiveModel();
    fd.append('model', model);
    try {
      return await ApiCommon.callAPI('whisper', fd, { isFormData: true });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      if (model === LEGACY_MODEL || !legacyAlive()) throw err;
      _failedAt = Date.now();
      console.warn(`[SttModel] ${model} 失敗 → ${LEGACY_MODEL} で再試行:`, err && err.message);
      fd.set('model', LEGACY_MODEL);
      return await ApiCommon.callAPI('whisper', fd, { isFormData: true });
    }
  }

  /** テスト用: 失敗記憶を消す */
  function resetFailure() { _failedAt = 0; }

  return { KEY, DEFAULT_MODEL, LEGACY_MODEL, LEGACY_RETIRE, SILENCE_CHOICES, SILENCE_DEFAULT, MODELS, get, set, legacyAlive, getSilenceMs, setSilenceMs, effectiveModel, transcribe, resetFailure };
})();
