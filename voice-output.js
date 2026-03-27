// voice-output.js v2.0
// このファイルはTTS音声の再生管理を担当する（AudioPlaybackManager）
// 再生キュー、割り込み停止、姉妹アイコン発光制御を行う
// openai-tts-provider.js / voicevox-tts-provider.js と連携してAI応答を声で再生する
// v2.0 デバッグ強化: 詳細ログ収集＋ファイルDL機能（#77根本原因調査）
// v2.0 修正: 連続スペース除去追加（cleanTextForTTS改善）

// v1.0 新規作成 - Step 5b TTS再生管理
// v1.5 追加 - #77改善: 長文チャンク分割読み上げ
// v1.6 修正 - #77改善: TTS読み飛ばし修正（改行→連続文変換）
// v1.8 修正 - 見出し行まるごと除去+太字見出し行除去
// v2.0 デバッグ - 詳細ログDL＋連続スペース除去（#77根本原因調査用）

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
    // v2.0 デバッグログ収集用
    this._debugLog = [];
  }

  switchProvider(providerName) {
    if (providerName === 'voicevox' && this._voicevoxProvider) {
      this._ttsProvider = this._voicevoxProvider;
    } else {
      this._ttsProvider = this._openaiProvider;
    }
  }

  // ═══════════════════════════════════════════
  // v2.0 デバッグシステム（ログ収集＋ミニパネル＋DLボタン）
  // ═══════════════════════════════════════════

  _log(msg, level) {
    const ts = new Date().toLocaleTimeString('ja-JP', {hour12:false});
    const entry = `[${ts}] ${msg}`;
    this._debugLog.push(entry);
    console.log(`[AudioPM] ${msg}`);
    this._miniLog(entry, level);
  }

  _miniLog(text, level) {
    let p = document.getElementById('tts-mini-panel');
    if (!p) return;
    const line = document.createElement('div');
    const colors = { info: '#0f0', warn: '#ff0', err: '#f00', data: '#0ff', stop: '#f80' };
    line.style.cssText = `color:${colors[level] || '#0f0'};margin:1px 0;`;
    line.textContent = text;
    const lines = p.querySelectorAll('.tts-log-line');
    if (lines.length > 15) lines[0].remove();
    line.className = 'tts-log-line';
    p.appendChild(line);
    p.scrollTop = p.scrollHeight;
  }

  _initPanel() {
    let p = document.getElementById('tts-mini-panel');
    if (p) { p.querySelectorAll('.tts-log-line').forEach(l => l.remove()); return; }
    p = document.createElement('div');
    p.id = 'tts-mini-panel';
    p.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:25vh;'
      + 'overflow-y:auto;background:rgba(0,0,0,0.85);color:#0f0;font-size:9px;'
      + 'padding:4px 6px;z-index:99999;font-family:monospace;'
      + 'border-top:2px solid #ff0;white-space:pre-wrap;word-break:break-all;';
    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:2px;';
    const dlBtn = document.createElement('span');
    dlBtn.textContent = '📥 ログDL';
    dlBtn.style.cssText = 'color:#0ff;font-size:11px;font-weight:bold;cursor:pointer;';
    dlBtn.onclick = () => this._downloadLog();
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕ 閉じる';
    closeBtn.style.cssText = 'color:#ff0;font-size:11px;font-weight:bold;cursor:pointer;';
    closeBtn.onclick = () => p.remove();
    hdr.appendChild(dlBtn);
    hdr.appendChild(closeBtn);
    p.appendChild(hdr);
    document.body.appendChild(p);
  }

  _downloadLog() {
    const text = this._debugLog.join('\n');
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const fname = `tts-debug-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}.txt`;
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    this._log('📥 ログDL完了: ' + fname, 'info');
  }

  // ═══════════════════════════════════════════

  async speak(text, sisterId, options = {}) {
    if (this._playing) this.stop();
    if (!text || text.trim().length === 0) return;

    this._debugLog = [];
    this._initPanel();

    const cleanText = this._cleanTextForTTS(text);

    this._log('══════ TTS再生開始 ══════', 'warn');
    this._log(`raw文字数: ${text.length}`, 'info');
    this._log(`clean文字数: ${cleanText.length}`, 'info');
    this._log(`--- raw全文 ---`, 'data');
    this._log(text, 'data');
    this._log(`--- clean全文 ---`, 'data');
    this._log(cleanText, 'data');
    this._log(`--- /全文 ---`, 'data');

    const spaceMatches = cleanText.match(/ {2,}/g);
    if (spaceMatches) {
      this._log(`⚠️ 連続スペース検出: ${spaceMatches.length}箇所（最大${Math.max(...spaceMatches.map(s=>s.length))}個連続）`, 'warn');
    }

    if (cleanText.length === 0) {
      this._log('クリーニング後空→スキップ', 'warn');
      return;
    }

    const CHUNK_LIMIT = 200;
    if (cleanText.length > CHUNK_LIMIT) {
      this._log(`${cleanText.length}字 > ${CHUNK_LIMIT} → チャンク分割`, 'warn');
      await this._speakChunked(cleanText, sisterId, options);
      return;
    }

    this._log(`${cleanText.length}字 ≤ ${CHUNK_LIMIT} → 単発再生`, 'warn');
    await this._speakSingle(cleanText, sisterId, options);
  }

  async _speakChunked(cleanText, sisterId, options = {}) {
    const chunks = this._splitTextToChunks(cleanText);
    this._log(`✂️ ${chunks.length}チャンクに分割`, 'warn');
    chunks.forEach((c, i) => {
      this._log(`  chunk[${i+1}] ${c.length}字: 「${c}」`, 'data');
    });

    this._chunkedPlaying = true;
    this._queueCancelled = false;
    const voiceConfig = getSisterVoice(sisterId);
    this._log(`voice: ${voiceConfig.voice} (${voiceConfig.label})`, 'info');

    this._playing = true;
    if (this.onPlayStart) this.onPlayStart(sisterId);

    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) {
        this._log(`🛑 chunk${i+1}でキャンセル！`, 'err');
        break;
      }
      const chunk = chunks[i];
      this._log(`▶️ chunk ${i+1}/${chunks.length} (${chunk.length}字)`, 'warn');
      try {
        const t0 = Date.now();
        await this._speakOneChunk(chunk, voiceConfig.voice, sisterId, options);
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        this._log(`✅ chunk ${i+1} 完了 (${sec}秒)`, 'info');
      } catch (e) {
        this._log(`❌ chunk ${i+1} エラー: ${e.message}`, 'err');
      }
    }

    this._playing = false;
    this._currentAudio = null;
    this._chunkedPlaying = false;
    this._log('🏁 全チャンク再生完了', 'warn');
    this._log('💡 📥ログDLボタンでファイル保存できます', 'warn');
    if (this.onPlayEnd) this.onPlayEnd(sisterId);
  }

  _speakOneChunk(chunkText, voice, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        this._log(`  🎵 TTS生成中... (${chunkText.length}字)`, 'info');
        const t0 = Date.now();
        const audio = await this._ttsProvider.synthesize(
          chunkText, voice, { speed: options.speed || 1.0 }
        );
        const genMs = Date.now() - t0;
        this._log(`  🎵 TTS生成OK (${genMs}ms) duration=${audio.duration || '?'}s`, 'info');

        this._currentAudio = audio;
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;

        audio.addEventListener('ended', () => {
          this._log(`  🔊 ended (実再生${((Date.now()-t0-genMs)/1000).toFixed(1)}秒)`, 'info');
          resolve();
        }, { once: true });
        audio.addEventListener('error', (e) => {
          this._log(`  💥 error: ${e?.message || 'unknown'}`, 'err');
          resolve();
        }, { once: true });

        await audio.play();
        this._log(`  🔊 play()開始`, 'info');
      } catch (error) {
        if (this._ttsProvider === this._voicevoxProvider && this._openaiProvider.isAvailable()) {
          this._log(`  🔄 VV→OpenAIフォールバック`, 'warn');
          try {
            const ov = SISTER_VOICE_MAP[sisterId]?.openai?.voice || 'alloy';
            const fb = await this._openaiProvider.synthesize(chunkText, ov, { speed: options.speed || 1.0 });
            this._currentAudio = fb; fb.playbackRate = this._speed;
            await new Promise(r => { fb.addEventListener('ended', r, {once:true}); fb.addEventListener('error', r, {once:true}); fb.play().catch(r); });
            resolve(); return;
          } catch (e2) { this._log(`  💥 FB失敗: ${e2.message}`, 'err'); }
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
    this._log(`🔊 単発再生: ${vc.label}`, 'info');
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
        this._log('✅ 単発再生完了', 'info');
        if (this.onPlayEnd) this.onPlayEnd(sisterId);
      });
      audio.addEventListener('error', (e) => {
        this._log('❌ 単発再生エラー', 'err');
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
    this._log(`⏹️ stop() playing=${this._playing} chunked=${this._chunkedPlaying}`, 'stop');
    try { throw new Error('stack'); } catch(e) {
      const st = e.stack.split('\n').slice(1, 4).map(s => s.trim()).join(' ← ');
      this._log(`  📍 ${st}`, 'stop');
    }
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
    for (let i = 0; i < this._queue.length; i++) {
      if (this._queueCancelled) break;
      try { await this._speakAndWait(this._queue[i].text, this._queue[i].sisterId, options); } catch(e) {}
      if (i < this._queue.length - 1 && !this._queueCancelled) await new Promise(r => setTimeout(r, 300));
    }
    this._queuePlaying = false; this._queue = [];
    if (!this._queueCancelled && this.onQueueEnd) this.onQueueEnd();
  }

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
        if (this.onPlayStart) this.onPlayStart(sisterId);
        const rc = a._vvRemainingChunks || [], sid = a._vvSpeakerId, ak = a._vvApiKey;
        a.addEventListener('ended', async () => {
          if (rc.length > 0 && !this._queueCancelled) await this._playVVChunks(rc, sid, ak, sisterId);
          this._playing = false; this._currentAudio = null;
          if (this.onPlayEnd) this.onPlayEnd(sisterId); resolve();
        });
        a.addEventListener('error', async () => {
          if (rc.length > 0 && !this._queueCancelled) await this._playVVChunks(rc, sid, ak, sisterId);
          this._playing = false; this._currentAudio = null;
          if (this.onPlayEnd) this.onPlayEnd(sisterId); resolve();
        });
        await a.play();
      } catch(e) { this._playing = false; this._currentAudio = null; resolve(); }
    });
  }

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
    // v2.0追加 - 連続スペースを1つに圧縮（TTS読み飛ばし防止）
    c = c.replace(/\s{2,}/g, ' ');
    c = c.trim();
    return c;
  }
}

window.AudioPlaybackManager = AudioPlaybackManager;
