// gemini-tts-provider.js v1.4
// このファイルはGemini TTS（gemini-3.8-flash-lite-tts / gemini-3.8-flash-tts）を中継Worker経由で呼ぶ読み上げプロバイダー
// TTSProviderインターフェースに準拠（openai-tts-provider.js と同じ使い方）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v1.3 2026-10-30 - ⏱用に audio._ttsModel / _ttsBytes を付ける（音声の中身・送り方は変更なし）
// v1.4 2026-10-30 - 中継の Server-Timing(upstream;dur=ms) を読んで audio._ttsUpstreamMs に（⏱で「Google側の時間」と「通信など」を分ける）
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
  static upstreamMs(h) {
    const m = /(?:^|,)\s*upstream\s*;[^,]*?dur=([\d.]+)/.exec(String(h || ''));
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

    const model = options.model || GeminiTTSProvider.modelId();
    const sendText = text.substring(0, GeminiTTSProvider.MAX_TEXT);
    const style = (typeof options.style === 'string') ? options.style.trim().substring(0, GeminiTTSProvider.MAX_STYLE) : '';
    const res = await fetch(`${ApiCommon.getWorkerURL()}/gemini-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-COCOMI-AUTH': ApiCommon.getAuthToken() },
      body: JSON.stringify(style ? { text: sendText, voice, model, style } : { text: sendText, voice, model }),
    });
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
    audio._ttsUpstreamMs = GeminiTTSProvider.upstreamMs(res.headers && res.headers.get ? res.headers.get('Server-Timing') : '');
    return audio; // 速さは呼び出し側が playbackRate で変える（Geminiは速度パラメータなし）
  }

  /** コスト見積り用: 出力は音声25トークン/秒（公式）、入力は文字数≒トークンの粗い見積り。2027-01-01から単価2倍はTokenMonitor側で日付判定 */
  _recordUsage(model, text, seconds, styleChars = 0) {
    if (typeof TokenMonitor === 'undefined') return;
    try { TokenMonitor.record(model, Math.ceil(text.length / 2) + Math.ceil(styleChars / 4), Math.round(seconds * 25)); } catch (e) { /* 記録失敗は無視 */ }
  }
}

GeminiTTSProvider.QUALITY_KEY = 'cocomitalk-gemini-tts-quality';
GeminiTTSProvider.MAX_STYLE = 200; // 中継の上限と同じ
GeminiTTSProvider.MAX_TEXT = 1500; // 中継側にも同じ上限（提案パッチ）。voice-outputが150〜200字ごとに分割するので余裕あり
GeminiTTSProvider.PREBUILT_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

window.GeminiTTSProvider = GeminiTTSProvider;
