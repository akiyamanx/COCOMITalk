// voice-output.js v3.0
// このファイルはTTS音声の再生管理を担当する（AudioPlaybackManager）
// 再生キュー、割り込み停止、姉妹アイコン発光制御を行う
// openai-tts-provider.js / voicevox-tts-provider.js と連携してAI応答を声で再生する

// v1.0 新規作成 - Step 5b TTS再生管理
// v1.5 追加 - #77改善: 長文チャンク分割読み上げ
// v1.6 修正 - #77改善: TTS読み飛ばし修正（改行→連続文変換）
// v1.8 修正 - 見出し行まるごと除去+太字見出し行除去
// v2.0 デバッグ - 詳細ログDL＋連続スペース除去（#77根本原因調査用）
// v2.1 修正 - _speakOneChunkにVOICEVOX残りチャンク再生追加（#77読み飛ばし根本修正）
// v2.2 クリーンアップ - デバッグパネル・ログDL機能削除（本番用）
// v2.3 修正 - speakQueueマイク復帰バグ修正（onPlayStart/onPlayEndをキュー全体で1回ずつに統一）
// v2.4 2026-10-28 - Gemini TTS追加（声が未割り当て/失敗時はOpenAIの声へ戻す。_synth()に集約）
// v2.5 2026-10-28 - 既定をGeminiに。場面の話し方(style)をGeminiへ渡す。Gemini→OpenAI→VOICEVOXの順に戻す。声が使えない時は選択名もOpenAIへ揃える
// v2.6 2026-10-29 - 吹き出しタップの二重再生を根本修正: ①speakBubble(準備中+再生中+キューを1つのガードで無視・finally/stop/保険タイマーで必ず解除) ②stop()/新しい読み上げの時に合成待ちの古い音声を捨てる(世代番号_gen)
// v2.7 2026-10-29 - 音が鳴っている間の吹き出しタップで停止できるように（鳴り始め700msの連打は無視。準備中は引き続き無視）
// v2.8 2026-10-30 - 速く: 最初の1文だけ先に声にして鳴らし、その間に次の文を先読み（つなぎ目の無音なし）。返事全体を1つの「話し中」として扱う（文の間でマイクを開けない）。話した文をこだま除け(VoiceFast)に記録
// v2.9 2026-10-30 - 1つ目のかたまりを20〜30字に短く・絵文字を読まない・2つ同時に先読み・TTSの送信/受信/再生を⏱で記録（VoiceFast v1.1）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-30
// v3.0 2026-10-30 - ⏱に中継のGoogle側の時間(upstream ms)を表示（v3.95: upstream-ttfb も / v3.96: stream の最初の音ms も）。受け取りながら読み上げは voice-stream.js（mixin）

class AudioPlaybackManager {
  constructor() {
    this._openaiProvider = new OpenAITTSProvider();
    this._voicevoxProvider = (typeof VoicevoxTTSProvider !== 'undefined')
      ? new VoicevoxTTSProvider() : null;
    this._geminiProvider = (typeof GeminiTTSProvider !== 'undefined') ? new GeminiTTSProvider() : null;
    this._ttsProvider = this._openaiProvider;
    this.switchProvider(typeof getTTSProviderName === 'function' ? getTTSProviderName() : 'gemini');
    this._currentAudio = null;
    this._playing = false;
    this._queue = [];
    this._queuePlaying = false;
    this._queueCancelled = false;
    this.onPlayStart = null;
    this.onPlayEnd = null;
    this.onPlayError = null;
    this.onQueueEnd = null;
    this._speed = 1.0;
    this.onFallback = null;
    this._chunkedPlaying = false;
    this._preparing = false; // 合成(ネット)待ち中。_playingは音が鳴り始めてからなので別に持つ
    this._gen = 0; // 読み上げの世代。stop()/新しい読み上げで進め、古い合成結果を捨てる
    this._bubbleHold = null; // 吹き出しタップのガード（準備中〜再生終了）
    this._bubblePollMs = 100;
    this._audioStartAt = 0; // 音が鳴り始めた時刻（鳴り始めの連打を止めタップと間違えない猶予に使う）
    this._stopGraceMs = 700; // 鳴り始めてからこの間のタップは無視（二重タップ対策）。過ぎたらタップで停止
    this._bubbleSafetyMs = 180000; // 合成が返らない等で固まった時の保険
  }

  switchProvider(providerName) {
    let used = 'openai';
    if (providerName === 'voicevox' && this._voicevoxProvider) {
      this._ttsProvider = this._voicevoxProvider; used = 'voicevox';
    } else if (providerName === 'gemini' && this._geminiProvider) {
      this._ttsProvider = this._geminiProvider; used = 'gemini';
    } else {
      this._ttsProvider = this._openaiProvider; // 選んだ方が使えない時もOpenAI
    }
    // 声の名前の表(getSisterVoice)も実際に使うプロバイダーに揃える（Geminiの声名をOpenAIへ渡さない）
    if (typeof setTTSProviderName === 'function' && (typeof getTTSProviderName !== 'function' || getTTSProviderName() !== used)) setTTSProviderName(used);
  }

  /** 読み上げ音声を作る。Gemini選択時だけ、声が未割り当て/失敗ならOpenAIの声 → それも失敗ならVOICEVOXの声へ戻す（OpenAI TTSは2027-01-06停止まで） */
  async _synth(text, voice, sisterId, speed, style) {
    if ((typeof VoiceFast !== 'undefined')) VoiceFast.rememberSpoken(text); // こだま除け: 自分が話す言葉を覚えておく
    try {
      return await this._ttsProvider.synthesize(text, voice, { speed, style });
    } catch (e) {
      if (this._ttsProvider !== this._geminiProvider) throw e;
      const map = SISTER_VOICE_MAP[sisterId] || {};
      let err = e;
      if (this._openaiProvider.isAvailable()) {
        this._log(`Gemini TTS → OpenAIへ戻す: ${e.message}`);
        try {
          return await this._openaiProvider.synthesize(text, map.openai?.voice || 'alloy', { speed });
        } catch (e2) { err = e2; }
      }
      if (this._voicevoxProvider && map.voicevox?.voice) {
        this._log(`OpenAI TTS → VOICEVOXへ戻す: ${err.message}`);
        return await this._voicevoxProvider.synthesize(text, map.voicevox.voice, { speed });
      }
      throw err;
    }
  }

  /** この文のトーンから話し方(style)を決める。tone-style.js が無い/失敗でも読み上げは止めない */
  _styleFor(text) {
    try { return (typeof ToneStyle !== 'undefined') ? ToneStyle.styleForText(text) : undefined; } catch (e) { return undefined; }
  }

  // v2.2簡素化 - console.logのみ（デバッグパネル削除）
  _log(msg) {
    console.log(`[AudioPM] ${msg}`);
  }

  async speak(text, sisterId, options = {}) {
    if (this._playing || this._preparing || this._queuePlaying) this.stop();
    options = { ...options, _gen: ++this._gen }; // この読み上げの世代（合成待ちの間にstopされたら音を捨てる）
    if (!text || text.trim().length === 0) return;

    let cleanText = this._cleanTextForTTS(text);
    if ((typeof VoiceFast !== 'undefined')) cleanText = VoiceFast.ttsClean(cleanText); // v2.9 絵文字は読まない（文の切れ目の絵文字は「。」に）
    if (cleanText.length === 0) return;
    if (options.style === undefined) options = { ...options, style: this._styleFor(text) }; // 返信全体で1つのトーン（チャンクごとに変えない）

    // v2.9: 25字を超えて2つ以上に分かれるなら分割再生（短い1つ目を先に鳴らす）。ごく短い返事は1回で作る
    if (cleanText.length > 25 && this._splitTextToChunks(cleanText).length > 1) {
      this._log(`${cleanText.length}字 → チャンク分割再生（最初の1文を先に）`);
      await this._speakChunked(cleanText, sisterId, options);
      return;
    }

    await this._speakSingle(cleanText, sisterId, options);
  }

  async _speakChunked(cleanText, sisterId, options = {}) {
    const chunks = this._splitTextToChunks(cleanText);
    this._log(`${chunks.length}チャンクに分割`);

    const gen = options._gen;
    this._chunkedPlaying = true;
    this._queueCancelled = false;
    const voiceConfig = getSisterVoice(sisterId);

    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(sisterId);

    // v2.9 先読み: 2つ同時に作る（i番目ができたら i+2番目を作り始める）。鳴っている間に次ができる
    const pres = [];
    const start = (i) => {
      if (i >= chunks.length || pres[i] || gen !== this._gen) return;
      this._tlog(`🔊 TTS${i + 1}送信 ${chunks[i].length}字「${chunks[i].slice(0, 12)}…」 声=${voiceConfig.voice}`);
      pres[i] = this._synth(chunks[i], voiceConfig.voice, sisterId, options.speed || 1.0, options.style);
      pres[i].then(a => this._tlog(`📦 TTS${i + 1}受信 ${this._ttsInfo(a)}`), e => this._tlog(`⚠️ TTS${i + 1}失敗 ${e.message}`)).finally(() => start(i + 2));
    };
    start(0); start(1);
    for (let i = 0; i < chunks.length; i++) {
      start(i);
      if (this._queueCancelled || gen !== this._gen) break;
      try {
        await this._speakOneChunk(chunks[i], voiceConfig.voice, sisterId, { ...options, _idx: i + 1 }, pres[i]);
      } catch (e) {
        this._log(`chunk ${i+1} エラー: ${e.message}`);
      }
    }

    if (gen !== this._gen) return; // 途中でstop/新しい読み上げに替わった: 今の状態を壊さない
    this._playing = false;
    this._currentAudio = null;
    this._chunkedPlaying = false;
    if (this.onPlayEnd) this.onPlayEnd(sisterId);
  }

  // v2.1修正 - VOICEVOX残りチャンク再生を追加（#77読み飛ばし根本修正）
  _speakOneChunk(chunkText, voice, sisterId, options = {}, pre = null) {
    return new Promise(async (resolve, reject) => {
      try {
        const audio = await (pre || this._synth(chunkText, voice, sisterId, options.speed || 1.0, options.style));
        if (options._gen !== this._gen) { resolve(); return; } // 合成待ち中にstopされた: 鳴らさない

        // v2.1追加 - VOICEVOX残りチャンク情報を取得
        const vvRemaining = audio._vvRemainingChunks || [];
        const vvSpeakerId = audio._vvSpeakerId;
        const vvApiKey = audio._vvApiKey;

        this._currentAudio = audio; this._audioStartAt = Date.now();
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;

        audio.addEventListener('ended', async () => {
          // v2.1追加 - VOICEVOX残りチャンクがあれば順次再生
          if (vvRemaining.length > 0 && !this._queueCancelled) {
            await this._playVVChunks(vvRemaining, vvSpeakerId, vvApiKey, sisterId);
          }
          resolve();
        }, { once: true });
        audio.addEventListener('error', () => resolve(), { once: true });

        this._tlog(`▶ ${options._idx || 1}つ目 play()呼び出し`);
        await audio.play(); this._tlog(`🔈 ${options._idx || 1}つ目 鳴り始め`); if ((typeof VoiceFast !== 'undefined')) VoiceFast.mark('tts');
      } catch (error) {
        // v1.5追加 - VOICEVOX→OpenAIフォールバック
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          try {
            const ov = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fb = await this._openaiProvider.synthesize(chunkText, ov, { speed: options.speed || 1.0 });
            this._currentAudio = fb; this._audioStartAt = Date.now(); fb.playbackRate = this._speed;
            await new Promise(r => { fb.addEventListener('ended', r, {once:true}); fb.addEventListener('error', r, {once:true}); fb.play().catch(r); });
            resolve(); return;
          } catch (e2) { /* フォールバックも失敗 */ }
        }
        reject(error);
      }
    });
  }

  /** v2.9 細かい⏱（VoiceFastが無ければ何もしない） */
  _tlog(t) { if ((typeof VoiceFast !== 'undefined')) VoiceFast.tlog(t); }
  _ttsInfo(a) { return a ? `${a._ttsProvider || '?'} ${a._ttsModel || ''} ${a._ttsBytes ? Math.round(a._ttsBytes / 1024) + 'KB' : ''}${a._ttsTtfbMs != null ? ` ⏱upstream-ttfb ${a._ttsTtfbMs}ms` : ''}${a._ttsUpstreamMs != null ? ` ⏱upstream ${a._ttsUpstreamMs}ms` : ''}${a._ttsFirstMs != null ? ` 🎵最初の音 ${a._ttsFirstMs}ms` : ''}`.trim() : ''; }

  _splitTextToChunks(text) {
    if ((typeof VoiceFast !== 'undefined')) return VoiceFast.splitForTTS(text); // v2.9 1つ目を短く
    const MAX_CHUNK = 150;
    const chunks = [];
    const sentences = text.split(/(?<=[。！？\n])/);
    let cur = '';
    for (const s of sentences) {
      if (s.length > MAX_CHUNK) {
        if (cur) { chunks.push(cur.trim()); cur = ''; }
        const parts = s.split(/(?<=[、])/);
        let sub = '';
        for (const p of parts) {
          if ((sub + p).length > MAX_CHUNK) { if (sub) chunks.push(sub.trim()); sub = p; }
          else sub += p;
        }
        if (sub) cur = sub;
        continue;
      }
      // v2.8: 最初の1文(8字以上)はそれだけで1チャンク（早く鳴らす）
      if ((cur + s).length <= MAX_CHUNK && !(chunks.length === 0 && cur.trim().length >= 8)) cur += s;
      else { if (cur) chunks.push(cur.trim()); cur = s; }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(c => c.length > 0);
  }

  async _speakSingle(cleanText, sisterId, options = {}) {
    const vc = getSisterVoice(sisterId);
    const gen = options._gen;
    this._preparing = true;
    try {
      this._tlog(`🔊 TTS送信(1回で) ${cleanText.length}字 声=${vc.voice}`);
      const audio = await this._synth(cleanText, vc.voice, sisterId, options.speed || 1.0, options.style);
      this._tlog(`📦 TTS受信 ${this._ttsInfo(audio)}`);
      if (gen !== this._gen) return; // 合成待ち中にstop/新しい読み上げ: この音声は捨てる（重なり防止）
      this._preparing = false;
      this._currentAudio = audio; this._playing = true; this._audioStartAt = Date.now();
      this._speed = options.speed || 1.0; audio.playbackRate = this._speed;
      if (this.onPlayStart) this.onPlayStart(sisterId);
      if ((typeof VoiceFast !== 'undefined')) VoiceFast.mark('tts');
      const rc = audio._vvRemainingChunks || [];
      const sid = audio._vvSpeakerId, ak = audio._vvApiKey;
      audio.addEventListener('ended', async () => {
        if (rc.length > 0 && !this._queueCancelled) await this._playVVChunks(rc, sid, ak, sisterId);
        this._playing = false; this._currentAudio = null;
        if (this.onPlayEnd) this.onPlayEnd(sisterId);
      });
      audio.addEventListener('error', () => {
        this._playing = false; this._currentAudio = null;
        if (this.onPlayError) this.onPlayError('再生エラー', sisterId);
      });
      await audio.play(); this._tlog('🔈 鳴り始め');
    } catch (error) {
      if (gen !== this._gen) return;
      this._preparing = false; this._playing = false; this._currentAudio = null;
      if (this.onPlayError) this.onPlayError(`TTS生成エラー: ${error.message}`, sisterId);
    }
  }

  stop() {
    if (this._currentAudio) {
      try {
        this._currentAudio.pause(); this._currentAudio.currentTime = 0;
        if (this._currentAudio.src?.startsWith('blob:')) URL.revokeObjectURL(this._currentAudio.src);
      } catch(e) {}
      this._currentAudio = null;
    }
    this._playing = false; this._queueCancelled = true; this._preparing = false; this._gen++; this._audioStartAt = 0;
    this._queue = []; this._queuePlaying = false; this._chunkedPlaying = false;
    this._releaseBubble(); // 止めたら吹き出しのガードも解く
  }

  /** 準備中・再生中・キュー中のどれか（新しい吹き出しタップを受けてはいけない間） */
  isBusy() { return !!(this._preparing || this._playing || this._queuePlaying || this._chunkedPlaying); }

  /** 実際に音が出ている（合成待ちは含まない。長文・キューのチャンク間も含む） */
  isAudible() { return !!(this._currentAudio || ((this._queuePlaying || this._chunkedPlaying) && this._audioStartAt > 0)); }

  /**
   * 吹き出しタップの読み上げ。準備中(合成待ち)は無視して false、音が鳴っている間のタップは停止して 'stopped' を返す
   * 始めたら true。解除は 再生終了/エラー/stop/保険タイマー のどれでも必ず行う。options.onBusyChange(bool)で見た目を切替
   */
  async speakBubble(text, sisterId, options = {}) {
    if (this.isAudible()) { // 音が鳴っている最中のタップ＝止める（鳴り始めの猶予内の連打は無視）
      if (Date.now() - this._audioStartAt < this._stopGraceMs) return false;
      this.stop();
      return 'stopped';
    }
    if (this._bubbleHold || this.isBusy()) return false; // 準備中などは無視
    const { onBusyChange, ...speakOpts } = options;
    const hold = this._bubbleHold = { gen: this._gen, onBusyChange, timer: null, safety: null };
    hold.safety = setTimeout(() => { this._log('吹き出しガード: 保険タイマーで解除'); this.stop(); }, this._bubbleSafetyMs);
    this._bubbleNotify(hold, true);
    try {
      const p = this.speak(text, sisterId, speakOpts);
      hold.gen = this._gen; // speak()が同期で進めた世代。これ以外になったら押し出された
      await p;
    } catch (e) {
      this._log(`吹き出し読み上げエラー: ${e.message}`);
    } finally {
      this._bubbleWait(hold);
    }
    return true;
  }

  _bubbleNotify(hold, busy) {
    if (typeof hold.onBusyChange !== 'function') return;
    try { hold.onBusyChange(busy); } catch (e) { /* 見た目の失敗で読み上げを止めない */ }
  }

  /** 再生が終わる(または押し出される)まで見張り、終わったらガード解除 */
  _bubbleWait(hold) {
    const check = () => {
      if (this._bubbleHold !== hold) return;
      if (this._gen !== hold.gen || !this.isBusy()) { this._releaseBubble(); return; }
      hold.timer = setTimeout(check, this._bubblePollMs);
    };
    check();
  }

  _releaseBubble() {
    const hold = this._bubbleHold;
    if (!hold) return;
    this._bubbleHold = null;
    clearTimeout(hold.timer); clearTimeout(hold.safety);
    this._bubbleNotify(hold, false);
  }

  async speakQueue(items, options = {}) {
    if (!items || items.length === 0) return;
    this.stop();
    const gen = ++this._gen;
    options = { ...options, _gen: gen };
    this._queue = [...items]; this._queuePlaying = true; this._queueCancelled = false;

    // v2.3追加 - キュー開始時に最初の姉妹のonPlayStartを1回だけ発火
    // （voice-input.jsのspeaking遷移＋STT停止を1回だけトリガー）
    const firstSisterId = this._queue[0].sisterId;
    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(firstSisterId);

    for (let i = 0; i < this._queue.length; i++) {
      if (this._queueCancelled || gen !== this._gen) break;
      try {
        await this._speakAndWait(this._queue[i].text, this._queue[i].sisterId, options);
      } catch(e) {
        this._log(`speakQueue item ${i} エラー: ${e.message}`);
      }
      if (i < this._queue.length - 1 && !this._queueCancelled && gen === this._gen) await new Promise(r => setTimeout(r, 300));
    }

    // v2.3修正 - キュー完了時に確実にフラグクリア＋onQueueEnd発火
    if (gen !== this._gen) return; // 途中で別の読み上げに替わった: 今の状態を壊さない
    this._playing = false;
    this._currentAudio = null;
    this._queuePlaying = false;
    this._queue = [];
    if (!this._queueCancelled && this.onQueueEnd) this.onQueueEnd();
  }

  // v2.3修正 - キュー中はonPlayStart/onPlayEndを発火しない（speakQueue側で一括制御）
  // 姉妹アイコン発光の切替はonSisterChangeコールバックで通知
  _speakAndWait(text, sisterId, options = {}) {
    return new Promise(async (resolve) => {
      if (!text?.trim()) { resolve(); return; }
      const clean = this._cleanTextForTTS(text);
      if (!clean) { resolve(); return; }
      const vc = getSisterVoice(sisterId);
      try {
        const a = await this._synth(clean, vc.voice, sisterId, options.speed || 1.0, options.style !== undefined ? options.style : this._styleFor(text));
        if (options._gen !== undefined && options._gen !== this._gen) { resolve(); return; } // 合成待ち中にstop: 鳴らさない
        this._currentAudio = a; this._playing = true; this._audioStartAt = Date.now();
        this._speed = options.speed || 1.0; a.playbackRate = this._speed;
        // v2.3変更 - キュー中のonPlayStartは発火しない（姉妹アイコン切替のみ）
        if (this._queuePlaying) {
          if (this.onSisterChange) this.onSisterChange(sisterId);
        } else {
          if (this.onPlayStart) this.onPlayStart(sisterId);
        }
        const rc = a._vvRemainingChunks || [], sid = a._vvSpeakerId, ak = a._vvApiKey;
        a.addEventListener('ended', async () => {
          if (rc.length > 0 && !this._queueCancelled) await this._playVVChunks(rc, sid, ak, sisterId);
          this._playing = false; this._currentAudio = null;
          // v2.3変更 - キュー中のonPlayEndは発火しない（speakQueueのonQueueEndに集約）
          if (!this._queuePlaying) {
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          }
          resolve();
        });
        a.addEventListener('error', async () => {
          if (rc.length > 0 && !this._queueCancelled) await this._playVVChunks(rc, sid, ak, sisterId);
          this._playing = false; this._currentAudio = null;
          if (!this._queuePlaying) {
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          }
          resolve();
        });
        await a.play();
      } catch(e) {
        if (options._gen === undefined || options._gen === this._gen) { this._playing = false; this._currentAudio = null; }
        resolve();
      }
    });
  }

  // v2.1追加 - VOICEVOX残りチャンク順次再生
  async _playVVChunks(chunks, speakerId, apiKey, sisterId) {
    if (!this._voicevoxProvider) return;
    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) break;
      try {
        const a = await this._voicevoxProvider.synthesizeChunk(chunks[i], speakerId, apiKey);
        this._currentAudio = a; this._audioStartAt = Date.now();
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout')), 15000);
          a.addEventListener('canplaythrough', () => { clearTimeout(t); res(); }, {once:true});
          a.addEventListener('error', () => { clearTimeout(t); rej(new Error('err')); }, {once:true});
          a.load();
        });
        a.playbackRate = this._speed;
        await new Promise(r => { a.addEventListener('ended', r, {once:true}); a.addEventListener('error', r, {once:true}); a.play().catch(r); });
      } catch(e) {}
    }
  }

  isQueuePlaying() { return this._queuePlaying; }
  isPlaying() { return this._playing; }

  // v1.6追加 - TTS用テキストクリーニング（改行→連続文変換、見出し除去、連続スペース除去）
  _cleanTextForTTS(text) {
    let c = text;
    // 万一タグが残っていても読み上げない（壊れていても本文はそのまま読む）
    if (typeof ToneStyle !== 'undefined') { try { c = ToneStyle.parse(c).text; } catch (e) { /* そのまま */ } }
    c = c.replace(/```[\s\S]*?```/g, 'コードブロックは省略します。');
    c = c.replace(/`([^`]+)`/g, '$1');
    c = c.replace(/^#{1,6}\s+.*$/gm, '');
    c = c.replace(/^\*\*[^*]+\*\*\s*$/gm, '');
    c = c.replace(/\*\*([^*]+)\*\*/g, '$1');
    c = c.replace(/\*([^*]+)\*/g, '$1');
    c = c.replace(/__([^_]+)__/g, '$1');
    c = c.replace(/_([^_]+)_/g, '$1');
    c = c.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    c = c.replace(/https?:\/\/\S+/g, 'リンク');
    c = c.replace(/^[\s]*[-*+]\s+/gm, '');
    c = c.replace(/^[\s]*\d+\.\s+/gm, '');
    c = c.replace(/\|.*\|/g, '');
    c = c.replace(/^[-|:\s]+$/gm, '');
    c = c.replace(/^\s*$/gm, '');
    c = c.replace(/([。！？])\n+/g, '$1');
    c = c.replace(/([^\n。！？、])\n+/g, '$1。');
    c = c.replace(/\n+/g, '');
    c = c.replace(/。{2,}/g, '。');
    c = c.replace(/\s{2,}/g, ' ');
    c = c.trim();
    return c;
  }
}

window.AudioPlaybackManager = AudioPlaybackManager;
