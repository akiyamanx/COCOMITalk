// gemini-tts-provider.js v1.8
// このファイルはGemini TTS（gemini-3.8-flash-lite-tts / gemini-3.8-flash-tts）を中継Worker経由で呼ぶ読み上げプロバイダー
// TTSProviderインターフェースに準拠（openai-tts-provider.js と同じ使い方）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
// v1.3 2026-10-30 - ⏱用に audio._ttsModel / _ttsBytes を付ける（音声の中身・送り方は変更なし）
// v1.4 2026-10-30 - 中継の Server-Timing(upstream;dur=ms) を読んで audio._ttsUpstreamMs に（⏱で「Google側の時間」と「通信など」を分ける）
// v1.5 2026-10-30 - 中継が upstream-ttfb（Googleのヘッダ到着）と upstream（本文読了）の2つを返すので両方読む（audio._ttsTtfbMs）
// v1.6 2026-10-31 - stream:true を付けて送り、応答が audio/L16 なら PcmStreamPlayer で受け取りながら鳴らす（中継が未対応で WAV が来たら今まで通り）。
//   0バイト/失敗は stream なしで送り直し。設定 cocomitalk-gemini-tts-stream='off' で止める。音程を変えないため stream 時は1.0倍で鳴らす
// v1.7 2026-10-31 - クロ指摘(j): stream で !res.ok ならステータスを問わず1回だけ stream なし(WAV)で送り直し。
//   (i): AudioContext が running の時だけ stream（止まっていたら WAV の <audio> で鳴らし、ended が来ないままマイクが戻らない事故を防ぐ）
// v1.8 2026-10-31 - クロ宿題(j'): 429 は WAV で送り直さない。Retry-After 秒（無ければ20秒）の間は Google を呼ばずにすぐ例外
//   → voice-output の既存フォールバック（OpenAI の声）が使われる。待ち時間はこのプロバイダーの _cooldownUntil に持つ
// v1.0 2026-10-28 - 新規作成。声が空なら例外を投げ、voice-output側がOpenAIへ戻す
// v1.1 2026-10-28 - 5人の声が決定（割り当ては tts-provider.js の SISTER_VOICE_MAP.gemini / characters.js）。本ファイルのコード変更なし（コメントのみ）
// v1.2 2026-10-28 - 場面ごとの話し方: options.style(英語の自由文・200字以内)を中継の style 欄で送る（tone-style.js が作る）。空なら送らない
//
// ★未確認★ 中継の /gemini-tts は提案パッチ（relay_stt_tts.patch・未デプロイ）で、実キーで動かしたことはない。
//   使うには中継への反映が必要。キャラごとの声は tts-provider.js の gemini 欄（決定済み）。
//   style は中継(提案パッチ)が speech_metadata.style に入れる。実際に声の調子が変わるかは未確認。

class GeminiTTSProvider extends TTSProvider {
  constructor() {
    super('Gemini TTS');
    this._defaultSpeed = 1.0;
  }

  /** 設定: 'lite'（日常・散歩。既定）または 'flash'（高音質） */
  static getQuality() {
    try { return localStorage.getItem(GeminiTTSProvider.QUALITY_KEY) === 'flash' ? 'flash' : 'lite'; } catch (e) { return 'lite'; }
  }
  static setQuality(q) {
    const v = q === 'flash' ? 'flash' : 'lite';
    try { localStorage.setItem(GeminiTTSProvider.QUALITY_KEY, v); } catch (e) { /* ignore */ }
    return v;
  }
  static modelId(q) { return (q || GeminiTTSProvider.getQuality()) === 'flash' ? 'gemini-3.8-flash-tts' : 'gemini-3.8-flash-lite-tts'; }

  /** 公式の事前定義30声（名前のみ。割り当ては SISTER_VOICE_MAP） */
  getAvailableVoices() {
    return GeminiTTSProvider.PREBUILT_VOICES.map(id => ({ id, name: id, description: '' }));
  }

  isAvailable() {
    return (typeof ApiCommon !== 'undefined') && ApiCommon.hasAuthToken();
  }

  /** WAV(RIFF)の長さ(秒)。ヘッダが読めなければ 0 */
  /** 'upstream;dur=1234.5' → 1235（ms）。無い/読めない時は null */
  static upstreamMs(h, name = 'upstream') {
    const m = new RegExp(`(?:^|,)\\s*${name}\\s*;[^,]*?dur=([\\d.]+)`).exec(String(h || ''));
    return m ? Math.round(Number(m[1])) : null;
  }

  static wavSeconds(buf) {
    try {
      const v = new DataView(buf);
      if (v.byteLength < 44 || v.getUint32(0, false) !== 0x52494646) return 0; // 'RIFF'
      const byteRate = v.getUint32(28, true);
      return byteRate > 0 ? (v.byteLength - 44) / byteRate : 0;
    } catch (e) { return 0; }
  }

  /**
   * @param {string} text 読み上げ文
   * @param {string} voice 声ID（空なら未割り当て扱いで例外）
   * @param {object} options { speed, model, style }（style=話し方の指示文。空なら送らない）
   * @returns {Promise<HTMLAudioElement>}
   */
  async synthesize(text, voice, options = {}) {
    if (!text || text.trim().length === 0) throw new Error('テキストが空です');
    if (!voice) throw new Error('Gemini TTSの声が未割り当てです');
    if (typeof ApiCommon === 'undefined' || !ApiCommon.hasAuthToken()) throw new Error('Worker URLまたは認証トークンが未設定です');
    if (this.inCooldown()) throw new Error('Gemini TTS 429 待ち中（Googleは呼ばない）'); // v1.8

    const model = options.model || GeminiTTSProvider.modelId();
    const sendText = text.substring(0, GeminiTTSProvider.MAX_TEXT);
    const style = (typeof options.style === 'string') ? options.style.trim().substring(0, GeminiTTSProvider.MAX_STYLE) : '';
    const payload = style ? { text: sendText, voice, model, style } : { text: sendText, voice, model };
    const wantStream = !options.noStream && GeminiTTSProvider.streamEnabled();
    const ac = (wantStream && typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t0 = Date.now();
    let res = await fetch(`${ApiCommon.getWorkerURL()}/gemini-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-COCOMI-AUTH': ApiCommon.getAuthToken() },
      body: JSON.stringify(wantStream ? { ...payload, stream: true } : payload),
      ...(ac ? { signal: ac.signal } : {}),
    });
    if (wantStream && res.ok && GeminiTTSProvider.isPcm(res)) {
      const a = await this._streamAudio(res, ac, { text: sendText, voice, model, style, t0 });
      if (a) return a;
      return this.synthesize(text, voice, { ...options, noStream: true }); // 0バイト/失敗 → WAV で送り直し
    }
    if (res.status === 429) { // v1.8: 送り直さない。しばらく Gemini TTS を休む
      const sec = this._noteRateLimit(res);
      if (typeof VoiceFast !== 'undefined' && VoiceFast.tlog) VoiceFast.tlog(`⚠️ TTS 429 → ${sec}秒 Gemini TTS を休む（OpenAIの声へ）`);
      throw new Error('Gemini TTS エラー: 429');
    }
    if (wantStream && !res.ok) { // v1.7: 400/429/502/504など何でも → stream なし(WAV)で1回だけ（noStream なのでそれ以上は繰り返さない）
      if (typeof VoiceFast !== 'undefined' && VoiceFast.tlog) VoiceFast.tlog(`⚠️ TTS stream ${res.status} → WAVで送り直し`);
      return this.synthesize(text, voice, { ...options, noStream: true });
    }
    if (!res.ok) {
      let msg = `Gemini TTS エラー: ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch (e) { /* ステータスのまま */ }
      throw new Error(msg);
    }
    const buf = await res.arrayBuffer();
    this._recordUsage(model, sendText, GeminiTTSProvider.wavSeconds(buf), style.length);
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const audio = new Audio(url);
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    audio.addEventListener('error', () => URL.revokeObjectURL(url));
    audio._ttsVoice = voice;
    audio._ttsProvider = 'gemini';
    audio._ttsModel = model; audio._ttsBytes = buf.byteLength;
    const st = res.headers && res.headers.get ? res.headers.get('Server-Timing') : '';
    audio._ttsUpstreamMs = GeminiTTSProvider.upstreamMs(st); audio._ttsTtfbMs = GeminiTTSProvider.upstreamMs(st, 'upstream-ttfb');
    return audio; // 速さは呼び出し側が playbackRate で変える（Geminiは速度パラメータなし）
  }

  /** v1.8: 429 の待ち時間中か */
  inCooldown(now = Date.now()) { return !!this._cooldownUntil && now < this._cooldownUntil; }
  /** v1.8: Retry-After（秒）を読んで待ち終わりを記録。読めなければ20秒。返り値は秒 */
  _noteRateLimit(res) {
    const h = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
    const n = Number(h);
    const sec = (h != null && h !== '' && Number.isFinite(n) && n > 0) ? Math.min(n, 600) : GeminiTTSProvider.COOLDOWN_DEFAULT_SEC;
    this._cooldownUntil = Date.now() + sec * 1000;
    return sec;
  }

  /** stream の設定（既定ON。'off' で今まで通り）。AudioContext が無い/running でない時は使わない */
  static streamEnabled() {
    let off = false; try { off = localStorage.getItem(GeminiTTSProvider.STREAM_KEY) === 'off'; } catch (e) { /* 既定 */ }
    if (off || typeof PcmStreamPlayer === 'undefined' || !PcmStreamPlayer.ctx()) return false;
    PcmStreamPlayer.unlock(); // 次回のために起こしておく（resume は非同期なので今回は判定に使わない）
    return PcmStreamPlayer.isRunning(); // v1.7: running の時だけ stream（suspended なら WAV）
  }
  static isPcm(res) { return /^audio\/l16\b/i.test((res.headers && res.headers.get && res.headers.get('Content-Type')) || ''); }

  /** audio/L16 の応答: 最初のかたまりを受け取ってから再生物を返す（0バイト/失敗なら null＝WAVで送り直し） */
  async _streamAudio(res, ac, m) {
    const log = (t) => { if (typeof VoiceFast !== 'undefined' && VoiceFast.tlog) VoiceFast.tlog(t); };
    let reader, first = null;
    try {
      reader = res.body.getReader();
      for (;;) { const r = await reader.read(); if (r.done) break; if (r.value && r.value.length) { first = r.value; break; } }
    } catch (e) { first = null; }
    if (!first) { try { ac && ac.abort(); } catch (e) { /* ignore */ } log('⚠️ TTS stream 0バイト → WAVで送り直し'); return null; }
    const firstMs = Date.now() - m.t0;
    const st = res.headers.get('Server-Timing') || '';
    log(`🎵 TTS 最初の音のかたまり ${firstMs}ms（stream ${first.length}B${GeminiTTSProvider.upstreamMs(st, 'upstream-first') != null ? ` ⏱upstream-first ${GeminiTTSProvider.upstreamMs(st, 'upstream-first')}ms` : ''}）`);
    PcmStreamPlayer.unlock();
    const a = PcmStreamPlayer.create(reader, first, { abort: () => ac && ac.abort(), log });
    a._ttsVoice = m.voice; a._ttsProvider = 'gemini'; a._ttsModel = m.model + ' stream'; a._ttsFirstMs = firstMs;
    a._ttsTtfbMs = GeminiTTSProvider.upstreamMs(st, 'upstream-ttfb'); a._ttsUpstreamMs = null;
    a.addEventListener('ended', () => this._recordUsage(m.model, m.text, a._ttsStreamBytes / 48000, m.style.length));
    const lock = a; Object.defineProperty(lock, 'playbackRate', { get: () => 1, set: () => {} }); // 音程を変えない（1.0倍）
    return a;
  }

  /** コスト見積り用: 出力は音声25トークン/秒（公式）、入力は文字数≒トークンの粗い見積り。2027-01-01から単価2倍はTokenMonitor側で日付判定 */
  _recordUsage(model, text, seconds, styleChars = 0) {
    if (typeof TokenMonitor === 'undefined') return;
    try { TokenMonitor.record(model, Math.ceil(text.length / 2) + Math.ceil(styleChars / 4), Math.round(seconds * 25)); } catch (e) { /* 記録失敗は無視 */ }
  }
}

GeminiTTSProvider.QUALITY_KEY = 'cocomitalk-gemini-tts-quality';
GeminiTTSProvider.STREAM_KEY = 'cocomitalk-gemini-tts-stream'; // v1.6: 'off' で受け取りながら再生を止める
GeminiTTSProvider.COOLDOWN_DEFAULT_SEC = 20; // v1.8: Retry-After が無い時の休み（秒）
GeminiTTSProvider.MAX_STYLE = 200; // 中継の上限と同じ
GeminiTTSProvider.MAX_TEXT = 1500; // 中継側にも同じ上限（提案パッチ）。voice-outputが150〜200字ごとに分割するので余裕あり
GeminiTTSProvider.PREBUILT_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

window.GeminiTTSProvider = GeminiTTSProvider;
