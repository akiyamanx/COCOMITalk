// voice-output.js v1.9-debug
// このファイルはTTS音声の再生管理を担当する（AudioPlaybackManager）
// 再生キュー、割り込み停止、姉妹アイコン発光制御を行う
// openai-tts-provider.js / voicevox-tts-provider.js と連携してAI応答を声で再生する
// v1.9-debug: チャンク再生進行ログ追加（#77調査用・一時的）

// v1.0 新規作成 - Step 5b TTS再生管理
// v1.1 追加 - キュー再生機能（グループモード3人全員対応）
// v1.2 追加 - プロバイダー切替＋VOICEVOX長文分割連続再生
// v1.3 追加 - playbackRate再生速度＋canplaythrough待ち
// v1.4 追加 - Step 5d TTSフォールバック（VOICEVOX→OpenAI自動切替）
// v1.5 追加 - #77改善: 長文チャンク分割読み上げ（句読点で分割→順次再生）
// v1.6 修正 - #77改善: TTS読み飛ばし修正（改行→連続文変換で全文読み上げ）
// v1.8 修正 - 見出し行まるごと除去+太字見出し行除去（TTS要約読み防止）
// v1.9-debug - チャンク再生進行ミニログ（#77調査用・一時的）

/**
 * AudioPlaybackManager
 * TTS音声の再生を管理するクラス
 */
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

  // v1.2追加 - TTSプロバイダーを切り替える
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

  // ═══ v1.9-debug: ミニログ管理 ═══
  _debugLog(msg, level = 'info') {
    const el = document.getElementById('tts-debug-log');
    if (!el) return;
    const colors = { info: '#0f0', warn: '#ff0', error: '#f55', ok: '#0ff' };
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    el.innerHTML += `<div style="color:${colors[level] || '#0f0'}">[${time}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }

  _showDebugPanel(cleanText, chunks) {
    // 既存パネル削除
    const old = document.getElementById('tts-debug-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'tts-debug-panel';
    panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;'
      + 'background:rgba(0,0,0,0.92);color:#0f0;font-size:11px;'
      + 'font-family:monospace;z-index:99999;max-height:55vh;'
      + 'display:flex;flex-direction:column;border-top:2px solid #0f0;';

    // ヘッダー（タップで閉じる）
    const header = document.createElement('div');
    header.style.cssText = 'padding:6px 10px;background:#111;color:#ff0;'
      + 'font-size:13px;font-weight:bold;cursor:pointer;flex-shrink:0;';
    header.textContent = `🔍 TTS DEBUG — clean: ${cleanText.length}字 → ${chunks.length}チャンク — [×閉じる]`;
    header.addEventListener('click', () => panel.remove());
    panel.appendChild(header);

    // チャンク一覧（スクロール可能）
    const chunkList = document.createElement('div');
    chunkList.style.cssText = 'padding:4px 10px;overflow-y:auto;flex-shrink:0;max-height:20vh;'
      + 'border-bottom:1px solid #333;';
    chunks.forEach((c, i) => {
      chunkList.innerHTML += `<div style="margin:2px 0;color:#888;">`
        + `<span style="color:#0ff;">C${i + 1}</span> `
        + `(${c.length}字) ${c.substring(0, 60)}…</div>`;
    });
    panel.appendChild(chunkList);

    // リアルタイムログ領域
    const log = document.createElement('div');
    log.id = 'tts-debug-log';
    log.style.cssText = 'padding:6px 10px;overflow-y:auto;flex:1;min-height:60px;';
    log.innerHTML = '<div style="color:#ff0;">▶ 再生開始...</div>';
    panel.appendChild(log);

    document.body.appendChild(panel);
  }

  _removeDebugPanel() {
    const p = document.getElementById('tts-debug-panel');
    if (p) {
      this._debugLog('━━ 完了 ━━ パネルは手動で閉じてね', 'ok');
    }
  }
  // ═══ ミニログ管理ここまで ═══

  /**
   * テキストを声で再生する（1対1チャット用）
   */
  async speak(text, sisterId, options = {}) {
    if (this._playing) {
      this.stop();
    }

    if (!text || text.trim().length === 0) {
      console.log('[AudioPM] テキストが空のためスキップ');
      return;
    }

    const cleanText = this._cleanTextForTTS(text);

    if (cleanText.length === 0) {
      console.log('[AudioPM] クリーニング後テキストが空のためスキップ');
      return;
    }

    // v1.9-debug: 常にチャンク分割して進行表示する（短文でも）
    const CHUNK_LIMIT = 200;
    if (cleanText.length > CHUNK_LIMIT) {
      console.log(`[AudioPM] 長文検出（${cleanText.length}文字）→ チャンク分割再生`);
      await this._speakChunked(cleanText, sisterId, options);
      return;
    }

    // 短文 → デバッグパネルなしで従来通り
    await this._speakSingle(cleanText, sisterId, options);
  }

  /**
   * v1.5追加 - 長文をチャンク分割して順次再生する
   * v1.9-debug: 再生進行をミニログに表示
   */
  async _speakChunked(cleanText, sisterId, options = {}) {
    const chunks = this._splitTextToChunks(cleanText);
    console.log(`[AudioPM] チャンク分割: ${chunks.length}個に分割`);

    // v1.9-debug: パネル表示
    this._showDebugPanel(cleanText, chunks);
    this._debugLog(`チャンク分割完了: ${chunks.length}個`);

    this._chunkedPlaying = true;
    this._queueCancelled = false;
    const voiceConfig = getSisterVoice(sisterId);

    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(sisterId);

    for (let i = 0; i < chunks.length; i++) {
      // v1.9-debug: キャンセルチェックのログ
      if (this._queueCancelled) {
        this._debugLog(`❌ キャンセル検出！ C${i + 1}で中断 (_queueCancelled=true)`, 'error');
        console.log(`[AudioPM] チャンク再生キャンセル（${i + 1}/${chunks.length}）`);
        break;
      }

      const chunk = chunks[i];
      this._debugLog(`▶ C${i + 1}/${chunks.length} 再生開始 (${chunk.length}字)`);
      console.log(`[AudioPM] チャンク${i + 1}/${chunks.length}: "${chunk.substring(0, 30)}..." (${chunk.length}文字)`);

      try {
        const startTime = Date.now();
        await this._speakOneChunk(chunk, voiceConfig.voice, sisterId, options);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this._debugLog(`✅ C${i + 1} 完了 (${elapsed}秒)`, 'ok');
      } catch (e) {
        this._debugLog(`⚠️ C${i + 1} エラー: ${e.message}`, 'error');
        console.warn(`[AudioPM] チャンク${i + 1}エラー（スキップ）:`, e.message);
      }
    }

    this._playing = false;
    this._currentAudio = null;
    this._chunkedPlaying = false;
    this._debugLog(`━━ 全${chunks.length}チャンク処理完了 ━━`, 'ok');
    console.log(`[AudioPM] チャンク分割再生完了: ${voiceConfig.label}`);
    if (this.onPlayEnd) this.onPlayEnd(sisterId);
    this._removeDebugPanel();
  }

  /**
   * v1.5追加 - 1チャンクだけTTS生成→再生完了まで待つ
   */
  _speakOneChunk(chunkText, voice, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        this._debugLog(`  🎵 TTS生成中...`, 'info');
        const audio = await this._ttsProvider.synthesize(
          chunkText, voice, { speed: options.speed || 1.0 }
        );
        this._debugLog(`  🎵 TTS生成OK → 再生開始`, 'info');

        this._currentAudio = audio;
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;

        audio.addEventListener('ended', () => {
          this._debugLog(`  🔚 ended発火`, 'info');
          resolve();
        }, { once: true });

        audio.addEventListener('error', (e) => {
          this._debugLog(`  ❌ error発火: ${e?.message || 'unknown'}`, 'error');
          console.warn(`[AudioPM] チャンク再生エラー:`, e);
          resolve();
        }, { once: true });

        await audio.play();
      } catch (error) {
        this._debugLog(`  💥 catch: ${error.message}`, 'error');
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          console.warn(`[AudioPM] VOICEVOXエラー → OpenAIフォールバック: ${error.message}`);
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
            console.error(`[AudioPM] フォールバックも失敗: ${fbErr.message}`);
          }
        }
        reject(error);
      }
    });
  }

  /**
   * テキストを句読点で分割する
   */
  _splitTextToChunks(text) {
    const MAX_CHUNK = 150;
    const chunks = [];
    const sentences = text.split(/(?<=[。！？\n])/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if (sentence.length > MAX_CHUNK) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const subParts = sentence.split(/(?<=[、])/);
        let subChunk = '';
        for (const part of subParts) {
          if ((subChunk + part).length > MAX_CHUNK) {
            if (subChunk) chunks.push(subChunk.trim());
            subChunk = part;
          } else {
            subChunk += part;
          }
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

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * 短文をそのまま再生する（従来のspeak()ロジック）
   */
  async _speakSingle(cleanText, sisterId, options = {}) {
    const voiceConfig = getSisterVoice(sisterId);
    console.log(`[AudioPM] 再生準備: ${voiceConfig.label} (voice=${voiceConfig.voice})`);

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
        console.log(`[AudioPM] 再生完了: ${voiceConfig.label}`);
        if (this.onPlayEnd) this.onPlayEnd(sisterId);
      });

      audio.addEventListener('error', (e) => {
        console.warn(`[AudioPM] 1stチャンクエラー、残りを試行:`, e);
        if (remainingChunks.length > 0 && !this._queueCancelled) {
          this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId).then(() => {
            this._playing = false;
            this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          });
        } else {
          this._playing = false;
          this._currentAudio = null;
          if (this.onPlayError) this.onPlayError(`再生エラー: ${voiceConfig.label}`, sisterId);
        }
      });

      await audio.play();

    } catch (error) {
      if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
        console.warn(`[AudioPM] VOICEVOXエラー → OpenAI TTSにフォールバック: ${error.message}`);
        if (this.onFallback) this.onFallback('🔄 VOICEVOX→OpenAI TTSに自動切替');
        try {
          const fbVoice = getSisterVoice(sisterId);
          const openaiVoice = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
          const fbAudio = await this._openaiProvider.synthesize(
            cleanText, openaiVoice, { speed: options.speed || 1.0 }
          );
          this._currentAudio = fbAudio;
          this._playing = true;
          fbAudio.playbackRate = this._speed;
          if (this.onPlayStart) this.onPlayStart(sisterId);
          fbAudio.addEventListener('ended', () => {
            this._playing = false;
            this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
          });
          fbAudio.addEventListener('error', () => {
            this._playing = false;
            this._currentAudio = null;
            if (this.onPlayError) this.onPlayError('フォールバック再生エラー', sisterId);
          });
          await fbAudio.play();
          return;
        } catch (fbErr) {
          console.error(`[AudioPM] フォールバックも失敗: ${fbErr.message}`);
        }
      }
      this._playing = false;
      this._currentAudio = null;
      const msg = `TTS生成エラー: ${error.message}`;
      console.error(`[AudioPM] ${msg}`);
      if (this.onPlayError) this.onPlayError(msg, sisterId);
    }
  }

  /**
   * 再生を即座に停止する（割り込み用）
   */
  stop() {
    if (this._currentAudio) {
      try {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
        if (this._currentAudio.src && this._currentAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(this._currentAudio.src);
        }
      } catch (e) {
        console.warn('[AudioPM] 停止エラー:', e.message);
      }
      this._currentAudio = null;
    }
    this._playing = false;
    this._queueCancelled = true;
    this._queue = [];
    this._queuePlaying = false;
    this._chunkedPlaying = false;
    this._debugLog('⏹ stop()呼ばれた → _queueCancelled=true', 'warn');
    console.log('[AudioPM] 再生停止');
  }

  // ═══ キュー再生（グループモード用） ═══

  async speakQueue(items, options = {}) {
    if (!items || items.length === 0) return;
    this.stop();
    this._queue = [...items];
    this._queuePlaying = true;
    this._queueCancelled = false;
    console.log(`[AudioPM] キュー再生開始: ${items.length}人分`);

    for (let i = 0; i < this._queue.length; i++) {
      if (this._queueCancelled) {
        console.log('[AudioPM] キュー再生キャンセル');
        break;
      }
      const item = this._queue[i];
      try {
        await this._speakAndWait(item.text, item.sisterId, options);
      } catch (e) {
        console.warn(`[AudioPM] キュー[${i}] エラー:`, e.message);
      }
      if (i < this._queue.length - 1 && !this._queueCancelled) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    this._queuePlaying = false;
    this._queue = [];
    if (!this._queueCancelled && this.onQueueEnd) {
      this.onQueueEnd();
    }
  }

  _speakAndWait(text, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      if (!text || text.trim().length === 0) { resolve(); return; }
      const cleanText = this._cleanTextForTTS(text);
      if (cleanText.length === 0) { resolve(); return; }

      const voiceConfig = getSisterVoice(sisterId);
      console.log(`[AudioPM] キュー再生: ${voiceConfig.label}`);

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
          if (this.onPlayEnd) this.onPlayEnd(sisterId);
          resolve();
        });

        audio.addEventListener('error', async (e) => {
          console.warn(`[AudioPM] キューチャンクエラー、残りを試行:`, e);
          if (remainingChunks.length > 0 && !this._queueCancelled) {
            await this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId);
          }
          this._playing = false;
          this._currentAudio = null;
          if (this.onPlayEnd) this.onPlayEnd(sisterId);
          resolve();
        });

        await audio.play();
      } catch (error) {
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          console.warn(`[AudioPM] キューVOICEVOXエラー → OpenAIフォールバック: ${error.message}`);
          if (this.onFallback) this.onFallback('🔄 VOICEVOX→OpenAI TTSに自動切替');
          try {
            const openaiVoice = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fbAudio = await this._openaiProvider.synthesize(
              cleanText, openaiVoice, { speed: options.speed || 1.0 }
            );
            this._currentAudio = fbAudio;
            this._playing = true;
            fbAudio.playbackRate = this._speed;
            if (this.onPlayStart) this.onPlayStart(sisterId);
            await new Promise((res) => {
              fbAudio.addEventListener('ended', res, { once: true });
              fbAudio.addEventListener('error', res, { once: true });
              fbAudio.play().catch(res);
            });
            this._playing = false;
            this._currentAudio = null;
            if (this.onPlayEnd) this.onPlayEnd(sisterId);
            resolve();
            return;
          } catch (fbErr) {
            console.error(`[AudioPM] キューフォールバックも失敗: ${fbErr.message}`);
          }
        }
        this._playing = false;
        this._currentAudio = null;
        console.warn(`[AudioPM] TTS生成エラー: ${error.message}`);
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
        console.log(`[AudioPM] VVチャンク${i + 2}/${chunks.length + 1}: "${chunks[i].substring(0, 20)}..."`);
        const audio = await provider.synthesizeChunk(chunks[i], speakerId, apiKey);
        this._currentAudio = audio;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { reject(new Error('チャンク読み込みタイムアウト')); }, 15000);
          audio.addEventListener('canplaythrough', () => { clearTimeout(timeout); resolve(); }, { once: true });
          audio.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('チャンク読み込みエラー')); }, { once: true });
          audio.load();
        });
        audio.playbackRate = this._speed;
        await new Promise((resolve) => {
          audio.addEventListener('ended', resolve, { once: true });
          audio.addEventListener('error', resolve, { once: true });
          audio.play().catch(resolve);
        });
      } catch (e) {
        console.warn(`[AudioPM] VVチャンク${i + 2}エラー（スキップ）:`, e.message);
      }
    }
  }

  isQueuePlaying() { return this._queuePlaying; }
  isPlaying() { return this._playing; }

  /**
   * TTS用にテキストをクリーニングする
   */
  _cleanTextForTTS(text) {
    let cleaned = text;

    cleaned = cleaned.replace(/```[\s\S]*?```/g, 'コードブロックは省略します。');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // v1.8修正 - 見出し行をまるごと除去
    cleaned = cleaned.replace(/^#{1,6}\s+.*$/gm, '');

    // v1.8修正 - 太字だけの行（見出し的な役割）も除去
    cleaned = cleaned.replace(/^\*\*[^*]+\*\*\s*$/gm, '');

    // 文中の太字・斜体記号を除去（中身だけ残す）
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

    // v1.6追加 - TTS向け改行→連続文変換
    cleaned = cleaned.replace(/^\s*$/gm, '');
    cleaned = cleaned.replace(/([。！？])\n+/g, '$1');
    cleaned = cleaned.replace(/([^\n。！？、])\n+/g, '$1。');
    cleaned = cleaned.replace(/\n+/g, '');
    cleaned = cleaned.replace(/。{2,}/g, '。');

    cleaned = cleaned.trim();
    return cleaned;
  }
}

// グローバルに公開
window.AudioPlaybackManager = AudioPlaybackManager;
