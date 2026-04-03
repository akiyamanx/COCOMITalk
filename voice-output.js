// voice-output.js v2.3
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

class AudioPlaybackManager {
  constructor() {
    this._openaiProvider = new OpenAITTSProvider();
    this._voicevoxProvider = (typeof VoicevoxTTSProvider !== 'undefined')
      ? new VoicevoxTTSProvider() : null;
    this._ttsProvider = this._openaiProvider;
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
  }

  switchProvider(providerName) {
    if (providerName === 'voicevox' && this._voicevoxProvider) {
      this._ttsProvider = this._voicevoxProvider;
    } else {
      this._ttsProvider = this._openaiProvider;
    }
  }

  // v2.2簡素化 - console.logのみ（デバッグパネル削除）
  _log(msg) {
    console.log(`[AudioPM] ${msg}`);
  }

  async speak(text, sisterId, options = {}) {
    if (this._playing) this.stop();
    if (!text || text.trim().length === 0) return;

    const cleanText = this._cleanTextForTTS(text);
    if (cleanText.length === 0) return;

    const CHUNK_LIMIT = 200;
    if (cleanText.length > CHUNK_LIMIT) {
      this._log(`${cleanText.length}字 → チャンク分割再生`);
      await this._speakChunked(cleanText, sisterId, options);
      return;
    }

    await this._speakSingle(cleanText, sisterId, options);
  }

  async _speakChunked(cleanText, sisterId, options = {}) {
    const chunks = this._splitTextToChunks(cleanText);
    this._log(`${chunks.length}チャンクに分割`);

    this._chunkedPlaying = true;
    this._queueCancelled = false;
    const voiceConfig = getSisterVoice(sisterId);

    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(sisterId);

    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) break;
      try {
        await this._speakOneChunk(chunks[i], voiceConfig.voice, sisterId, options);
      } catch (e) {
        this._log(`chunk ${i+1} エラー: ${e.message}`);
      }
    }

    this._playing = false;
    this._currentAudio = null;
    this._chunkedPlaying = false;
    if (this.onPlayEnd) this.onPlayEnd(sisterId);
  }

  // v2.1修正 - VOICEVOX残りチャンク再生を追加（#77読み飛ばし根本修正）
  _speakOneChunk(chunkText, voice, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const audio = await this._ttsProvider.synthesize(
          chunkText, voice, { speed: options.speed || 1.0 }
        );

        // v2.1追加 - VOICEVOX残りチャンク情報を取得
        const vvRemaining = audio._vvRemainingChunks || [];
        const vvSpeakerId = audio._vvSpeakerId;
        const vvApiKey = audio._vvApiKey;

        this._currentAudio = audio;
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

        await audio.play();
      } catch (error) {
        // v1.5追加 - VOICEVOX→OpenAIフォールバック
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          try {
            const ov = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fb = await this._openaiProvider.synthesize(chunkText, ov, { speed: options.speed || 1.0 });
            this._currentAudio = fb; fb.playbackRate = this._speed;
            await new Promise(r => { fb.addEventListener('ended', r, {once:true}); fb.addEventListener('error', r, {once:true}); fb.play().catch(r); });
            resolve(); return;
          } catch (e2) { /* フォールバックも失敗 */ }
        }
        reject(error);
      }
    });
  }

  _splitTextToChunks(text) {
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
      if ((cur + s).length <= MAX_CHUNK) cur += s;
      else { if (cur) chunks.push(cur.trim()); cur = s; }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(c => c.length > 0);
  }

  async _speakSingle(cleanText, sisterId, options = {}) {
    const vc = getSisterVoice(sisterId);
    try {
      const audio = await this._ttsProvider.synthesize(cleanText, vc.voice, { speed: options.speed || 1.0 });
      this._currentAudio = audio; this._playing = true;
      this._speed = options.speed || 1.0; audio.playbackRate = this._speed;
      if (this.onPlayStart) this.onPlayStart(sisterId);
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
      await audio.play();
    } catch (error) {
      this._playing = false; this._currentAudio = null;
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
    this._playing = false; this._queueCancelled = true;
    this._queue = []; this._queuePlaying = false; this._chunkedPlaying = false;
  }

  async speakQueue(items, options = {}) {
    if (!items || items.length === 0) return;
    this.stop();
    this._queue = [...items]; this._queuePlaying = true; this._queueCancelled = false;

    // v2.3追加 - キュー開始時に最初の姉妹のonPlayStartを1回だけ発火
    // （voice-input.jsのspeaking遷移＋STT停止を1回だけトリガー）
    const firstSisterId = this._queue[0].sisterId;
    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(firstSisterId);

    for (let i = 0; i < this._queue.length; i++) {
      if (this._queueCancelled) break;
      try {
        await this._speakAndWait(this._queue[i].text, this._queue[i].sisterId, options);
      } catch(e) {
        this._log(`speakQueue item ${i} エラー: ${e.message}`);
      }
      if (i < this._queue.length - 1 && !this._queueCancelled) await new Promise(r => setTimeout(r, 300));
    }

    // v2.3修正 - キュー完了時に確実にフラグクリア＋onQueueEnd発火
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
        const a = await this._ttsProvider.synthesize(clean, vc.voice, { speed: options.speed || 1.0 });
        this._currentAudio = a; this._playing = true;
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
      } catch(e) { this._playing = false; this._currentAudio = null; resolve(); }
    });
  }

  // v2.1追加 - VOICEVOX残りチャンク順次再生
  async _playVVChunks(chunks, speakerId, apiKey, sisterId) {
    if (!this._voicevoxProvider) return;
    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) break;
      try {
        const a = await this._voicevoxProvider.synthesizeChunk(chunks[i], speakerId, apiKey);
        this._currentAudio = a;
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
