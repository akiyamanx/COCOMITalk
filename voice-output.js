// voice-output.js v1.9
// このファイルはTTS音声の再生管理を担当する（AudioPlaybackManager）
// 再生キュー、割り込み停止、姉妹アイコン発光制御を行う
// openai-tts-provider.js / voicevox-tts-provider.js と連携してAI応答を声で再生する
// v1.9デバッグ: チャンク再生進行ログパネル追加（#77根本原因調査）

// v1.0 新規作成 - Step 5b TTS再生管理
// v1.1 追加 - キュー再生機能（グループモード3人全員対応）
// v1.2 追加 - プロバイダー切替＋VOICEVOX長文分割連続再生
// v1.3 追加 - playbackRate再生速度＋canplaythrough待ち
// v1.4 追加 - Step 5d TTSフォールバック（VOICEVOX→OpenAI自動切替）
// v1.5 追加 - #77改善: 長文チャンク分割読み上げ（句読点で分割→順次再生）
// v1.6 修正 - #77改善: TTS読み飛ばし修正（改行→連続文変換で全文読み上げ）
// v1.8 修正 - 見出し行まるごと除去+太字見出し行除去
// v1.9 デバッグ - チャンク再生進行ログパネル（#77根本原因調査用・一時的）

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

  // v1.2追加 - TTSプロバイダー切替
  switchProvider(providerName) {
    if (providerName === 'voicevox' && this._voicevoxProvider) {
      this._ttsProvider = this._voicevoxProvider;
      console.log('[AudioPM] プロバイダー切替: VOICEVOX');
    } else {
      this._ttsProvider = this._openaiProvider;
      if (providerName === 'voicevox') {
        console.warn('[AudioPM] VOICEVOXプロバイダー未読み込み、OpenAIにフォールバック');
      } else {
        console.log('[AudioPM] プロバイダー切替: OpenAI');
      }
    }
  }

  // ═══════════════════════════════════════════
  // v1.9追加 - デバッグログパネル（#77調査用・一時的）
  // ═══════════════════════════════════════════

  _dbgInit() {
    let p = document.getElementById('tts-dbg-panel');
    if (p) { p.innerHTML = ''; return p; }
    p = document.createElement('div');
    p.id = 'tts-dbg-panel';
    p.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;'
      + 'overflow-y:auto;background:rgba(0,0,0,0.85);color:#0f0;font-size:10px;'
      + 'padding:6px 8px;z-index:99999;font-family:monospace;'
      + 'border-top:2px solid #ff0;white-space:pre-wrap;word-break:break-all;';
    // 閉じるボタン
    const btn = document.createElement('div');
    btn.textContent = '✕ 閉じる';
    btn.style.cssText = 'color:#ff0;font-size:12px;font-weight:bold;cursor:pointer;'
      + 'text-align:right;margin-bottom:4px;';
    btn.onclick = () => p.remove();
    p.appendChild(btn);
    document.body.appendChild(p);
    return p;
  }

  _dbgLog(msg, color) {
    const p = document.getElementById('tts-dbg-panel');
    if (!p) return;
    const line = document.createElement('div');
    line.style.cssText = `color:${color || '#0f0'};margin:1px 0;`;
    line.textContent = `[${new Date().toLocaleTimeString('ja-JP')}] ${msg}`;
    p.appendChild(line);
    p.scrollTop = p.scrollHeight;
  }

  // ═══════════════════════════════════════════

  async speak(text, sisterId, options = {}) {
    if (this._playing) {
      this.stop();
    }
    if (!text || text.trim().length === 0) {
      console.log('[AudioPM] テキストが空のためスキップ');
      return;
    }

    const cleanText = this._cleanTextForTTS(text);

    // v1.9 デバッグパネル初期化＋cleanText全文表示
    const panel = this._dbgInit();
    this._dbgLog(`🔍 raw: ${text.length}字 → clean: ${cleanText.length}字`, '#ff0');
    this._dbgLog(`📝 clean全文:`, '#ff0');
    this._dbgLog(cleanText, '#0ff');

    if (cleanText.length === 0) {
      this._dbgLog('⚠️ クリーニング後テキストが空→スキップ', '#f00');
      return;
    }

    const CHUNK_LIMIT = 200;
    if (cleanText.length > CHUNK_LIMIT) {
      this._dbgLog(`📦 ${cleanText.length}字 > ${CHUNK_LIMIT} → チャンク分割再生`, '#ff0');
      await this._speakChunked(cleanText, sisterId, options);
      return;
    }

    this._dbgLog(`📦 ${cleanText.length}字 ≤ ${CHUNK_LIMIT} → 単発再生`, '#ff0');
    await this._speakSingle(cleanText, sisterId, options);
  }

  async _speakChunked(cleanText, sisterId, options = {}) {
    const chunks = this._splitTextToChunks(cleanText);
    this._dbgLog(`✂️ ${chunks.length}チャンクに分割`, '#ff0');
    chunks.forEach((c, i) => {
      this._dbgLog(`  [${i+1}] ${c.length}字: "${c.substring(0, 40)}..."`, '#888');
    });

    this._chunkedPlaying = true;
    this._queueCancelled = false;
    const voiceConfig = getSisterVoice(sisterId);

    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(sisterId);

    for (let i = 0; i < chunks.length; i++) {
      // キャンセルチェック
      if (this._queueCancelled) {
        this._dbgLog(`🛑 チャンク${i+1}でキャンセル検出！_queueCancelled=true`, '#f00');
        break;
      }

      const chunk = chunks[i];
      this._dbgLog(`▶️ チャンク${i+1}/${chunks.length} 再生開始 (${chunk.length}字)`, '#0f0');

      try {
        const startTime = Date.now();
        await this._speakOneChunk(chunk, voiceConfig.voice, sisterId, options);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this._dbgLog(`✅ チャンク${i+1} 完了 (${elapsed}秒)`, '#0f0');
      } catch (e) {
        this._dbgLog(`❌ チャンク${i+1} エラー: ${e.message}`, '#f00');
      }
    }

    this._playing = false;
    this._currentAudio = null;
    this._chunkedPlaying = false;
    this._dbgLog(`🏁 全チャンク再生完了`, '#ff0');
    if (this.onPlayEnd) this.onPlayEnd(sisterId);
  }

  _speakOneChunk(chunkText, voice, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        this._dbgLog(`  🎵 TTS生成中...`, '#888');
        const audio = await this._ttsProvider.synthesize(
          chunkText, voice, { speed: options.speed || 1.0 }
        );
        this._dbgLog(`  🎵 TTS生成OK → audio.duration=${audio.duration || '?'}`, '#888');

        this._currentAudio = audio;
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;

        audio.addEventListener('ended', () => {
          this._dbgLog(`  🔊 ended発火`, '#888');
          resolve();
        }, { once: true });

        audio.addEventListener('error', (e) => {
          this._dbgLog(`  💥 errorイベント: ${e?.message || 'unknown'}`, '#f00');
          resolve();
        }, { once: true });

        await audio.play();
        this._dbgLog(`  🔊 play()開始`, '#888');
      } catch (error) {
        // VOICEVOXフォールバック
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          this._dbgLog(`  🔄 VOICEVOXエラー→OpenAIフォールバック`, '#ff0');
          if (this.onFallback) this.onFallback('🔄 VOICEVOX→OpenAI TTSに自動切替');
          try {
            const openaiVoice = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fbAudio = await this._openaiProvider.synthesize(
              chunkText, openaiVoice, { speed: options.speed || 1.0 }
            );
            this._currentAudio = fbAudio;
            fbAudio.playbackRate = this._speed;
            await new Promise((res) => {
              fbAudio.addEventListener('ended', res, { once: true });
              fbAudio.addEventListener('error', res, { once: true });
              fbAudio.play().catch(res);
            });
            resolve();
            return;
          } catch (fbErr) {
            this._dbgLog(`  💥 フォールバックも失敗: ${fbErr.message}`, '#f00');
          }
        }
        reject(error);
      }
    });
  }

  _splitTextToChunks(text) {
    const MAX_CHUNK = 150;
    const chunks = [];
    const sentences = text.split(/(?<=[。！？\n])/);
    let currentChunk = '';
    for (const sentence of sentences) {
      if (sentence.length > MAX_CHUNK) {
        if (currentChunk) { chunks.push(currentChunk.trim()); currentChunk = ''; }
        const subParts = sentence.split(/(?<=[、])/);
        let subChunk = '';
        for (const part of subParts) {
          if ((subChunk + part).length > MAX_CHUNK) {
            if (subChunk) chunks.push(subChunk.trim());
            subChunk = part;
          } else { subChunk += part; }
        }
        if (subChunk) currentChunk = subChunk;
        continue;
      }
      if ((currentChunk + sentence).length <= MAX_CHUNK) {
        currentChunk += sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks.filter(c => c.length > 0);
  }

  async _speakSingle(cleanText, sisterId, options = {}) {
    const voiceConfig = getSisterVoice(sisterId);
    this._dbgLog(`🔊 単発再生: ${voiceConfig.label}`, '#0f0');
    try {
      const audio = await this._ttsProvider.synthesize(
        cleanText, voiceConfig.voice, { speed: options.speed || 1.0 }
      );
      this._currentAudio = audio;
      this._playing = true;
      this._speed = options.speed || 1.0;
      audio.playbackRate = this._speed;
      if (this.onPlayStart) this.onPlayStart(sisterId);

      const remainingChunks = audio._vvRemainingChunks || [];
      const vvSpeakerId = audio._vvSpeakerId;
      const vvApiKey = audio._vvApiKey;

      audio.addEventListener('ended', async () => {
        if (remainingChunks.length > 0 && !this._queueCancelled) {
          await this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId);
        }
        this._playing = false;
        this._currentAudio = null;
        this._dbgLog(`✅ 単発再生完了`, '#0f0');
        if (this.onPlayEnd) this.onPlayEnd(sisterId);
      });

      audio.addEventListener('error', (e) => {
        this._dbgLog(`❌ 単発再生エラー`, '#f00');
        if (remainingChunks.length > 0 && !this._queueCancelled) {
          this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId).then(() => {
            this._playing = false; this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          });
        } else {
          this._playing = false; this._currentAudio = null;
          if (this.onPlayError) this.onPlayError(`再生エラー: ${voiceConfig.label}`, sisterId);
        }
      });

      await audio.play();
    } catch (error) {
      // VOICEVOXフォールバック
      if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
        if (this.onFallback) this.onFallback('🔄 VOICEVOX→OpenAI TTSに自動切替');
        try {
          const openaiVoice = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
          const fbAudio = await this._openaiProvider.synthesize(
            cleanText, openaiVoice, { speed: options.speed || 1.0 }
          );
          this._currentAudio = fbAudio; this._playing = true;
          fbAudio.playbackRate = this._speed;
          if (this.onPlayStart) this.onPlayStart(sisterId);
          fbAudio.addEventListener('ended', () => {
            this._playing = false; this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          });
          fbAudio.addEventListener('error', () => {
            this._playing = false; this._currentAudio = null;
            if (this.onPlayError) this.onPlayError('フォールバック再生エラー', sisterId);
          });
          await fbAudio.play();
          return;
        } catch (fbErr) { /* フォールバックも失敗 */ }
      }
      this._playing = false; this._currentAudio = null;
      if (this.onPlayError) this.onPlayError(`TTS生成エラー: ${error.message}`, sisterId);
    }
  }

  stop() {
    // v1.9デバッグ: stop()呼び出しをログ
    this._dbgLog(`⏹️ stop()呼び出し！ playing=${this._playing} chunked=${this._chunkedPlaying}`, '#f80');
    // 呼び出し元を記録（超重要）
    try { throw new Error('stack'); } catch(e) {
      const stack = e.stack.split('\n').slice(1, 4).map(s => s.trim()).join(' ← ');
      this._dbgLog(`  📍 ${stack}`, '#f80');
    }

    if (this._currentAudio) {
      try {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
        if (this._currentAudio.src && this._currentAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(this._currentAudio.src);
        }
      } catch (e) { /* ignore */ }
      this._currentAudio = null;
    }
    this._playing = false;
    this._queueCancelled = true;
    this._queue = [];
    this._queuePlaying = false;
    this._chunkedPlaying = false;
  }

  // ═══════════════════════════════════════════
  // キュー再生（グループモード用）
  // ═══════════════════════════════════════════

  async speakQueue(items, options = {}) {
    if (!items || items.length === 0) return;
    this.stop();
    this._queue = [...items];
    this._queuePlaying = true;
    this._queueCancelled = false;

    for (let i = 0; i < this._queue.length; i++) {
      if (this._queueCancelled) break;
      const item = this._queue[i];
      try {
        await this._speakAndWait(item.text, item.sisterId, options);
      } catch (e) { /* エラーでも次に進む */ }
      if (i < this._queue.length - 1 && !this._queueCancelled) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    this._queuePlaying = false;
    this._queue = [];
    if (!this._queueCancelled && this.onQueueEnd) this.onQueueEnd();
  }

  _speakAndWait(text, sisterId, options = {}) {
    return new Promise(async (resolve) => {
      if (!text || text.trim().length === 0) { resolve(); return; }
      const cleanText = this._cleanTextForTTS(text);
      if (cleanText.length === 0) { resolve(); return; }

      const voiceConfig = getSisterVoice(sisterId);
      try {
        const audio = await this._ttsProvider.synthesize(
          cleanText, voiceConfig.voice, { speed: options.speed || 1.0 }
        );
        this._currentAudio = audio;
        this._playing = true;
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;
        if (this.onPlayStart) this.onPlayStart(sisterId);

        const remainingChunks = audio._vvRemainingChunks || [];
        const vvSpeakerId = audio._vvSpeakerId;
        const vvApiKey = audio._vvApiKey;

        audio.addEventListener('ended', async () => {
          if (remainingChunks.length > 0 && !this._queueCancelled) {
            await this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId);
          }
          this._playing = false; this._currentAudio = null;
          if (this.onPlayEnd) this.onPlayEnd(sisterId);
          resolve();
        });
        audio.addEventListener('error', async () => {
          if (remainingChunks.length > 0 && !this._queueCancelled) {
            await this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId);
          }
          this._playing = false; this._currentAudio = null;
          if (this.onPlayEnd) this.onPlayEnd(sisterId);
          resolve();
        });
        await audio.play();
      } catch (error) {
        // VOICEVOXフォールバック
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          if (this.onFallback) this.onFallback('🔄 VOICEVOX→OpenAI TTSに自動切替');
          try {
            const openaiVoice = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fbAudio = await this._openaiProvider.synthesize(
              cleanText, openaiVoice, { speed: options.speed || 1.0 }
            );
            this._currentAudio = fbAudio; this._playing = true;
            fbAudio.playbackRate = this._speed;
            if (this.onPlayStart) this.onPlayStart(sisterId);
            await new Promise((res) => {
              fbAudio.addEventListener('ended', res, { once: true });
              fbAudio.addEventListener('error', res, { once: true });
              fbAudio.play().catch(res);
            });
            this._playing = false; this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
            resolve(); return;
          } catch (fbErr) { /* フォールバックも失敗 */ }
        }
        this._playing = false; this._currentAudio = null;
        resolve();
      }
    });
  }

  async _playVVChunks(chunks, speakerId, apiKey, sisterId) {
    const provider = this._voicevoxProvider;
    if (!provider) return;
    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) break;
      try {
        const audio = await provider.synthesizeChunk(chunks[i], speakerId, apiKey);
        this._currentAudio = audio;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { reject(new Error('timeout')); }, 15000);
          audio.addEventListener('canplaythrough', () => { clearTimeout(timeout); resolve(); }, { once: true });
          audio.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('error')); }, { once: true });
          audio.load();
        });
        audio.playbackRate = this._speed;
        await new Promise((resolve) => {
          audio.addEventListener('ended', resolve, { once: true });
          audio.addEventListener('error', resolve, { once: true });
          audio.play().catch(resolve);
        });
      } catch (e) { /* スキップ */ }
    }
  }

  isQueuePlaying() { return this._queuePlaying; }
  isPlaying() { return this._playing; }

  _cleanTextForTTS(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/```[\s\S]*?```/g, 'コードブロックは省略します。');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    // v1.8 見出し行まるごと除去
    cleaned = cleaned.replace(/^#{1,6}\s+.*$/gm, '');
    // v1.8 太字だけの行（見出し的）も除去
    cleaned = cleaned.replace(/^\*\*[^*]+\*\*\s*$/gm, '');
    // 太字・斜体（文中）
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    cleaned = cleaned.replace(/https?:\/\/\S+/g, 'リンク');
    cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
    cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');
    cleaned = cleaned.replace(/\|.*\|/g, '');
    cleaned = cleaned.replace(/^[-|:\s]+$/gm, '');
    // v1.6 改行→連続文変換
    cleaned = cleaned.replace(/^\s*$/gm, '');
    cleaned = cleaned.replace(/([。！？])\n+/g, '$1');
    cleaned = cleaned.replace(/([^\n。！？、])\n+/g, '$1。');
    cleaned = cleaned.replace(/\n+/g, '');
    cleaned = cleaned.replace(/。{2,}/g, '。');
    cleaned = cleaned.trim();
    return cleaned;
  }
}

window.AudioPlaybackManager = AudioPlaybackManager;
