// whisper-recovery.js v1.0
// このファイルはCOCOMITalkの音声認識(WhisperProvider)の「段階復帰はしご」を持つ（whisper-provider.js から分離・prototypeへ合成）
// v1.0 2026-10-31 - 新規: 「静か」と「死んでる」を区別し、静かなら1段目(解析の張替だけ)。録音(MediaRecorder)は止めない。
//   3段目(getUserMedia再取得)は trackが生きていない時だけ。その場合も録れていた分は先に文字起こしへ送る。区切り途中の張替はログに出す
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-31
'use strict';

const WhisperRecovery = {
  /** 番犬から: maxVol=0(またはctx停止)が続いた。証拠を見て段を決める */
  _climbRecoveryLadder(reason) {
    const G = WhisperVadGuard;
    const tr = this._stream && this._stream.getAudioTracks()[0];
    const trackLive = !!tr && tr.readyState === 'live';
    const ctxDead = !this._audioCtx || this._audioCtx.state !== 'running';
    const now = Date.now();
    const recentBps = G.bytesPerSec(this._byteLog, now);
    const kind = G.judgeDead({ ctxDead, trackLive, trackMuted: !!(tr && tr.muted), recentBps, quietBps: this._quietBps });
    if (kind === 'quiet') {
      // 静かなだけ: 静かな時のバイト/秒を学習（最小値＝話し声が混じっても引き上がらない）し、次の判定まで倍待つ
      if (recentBps > 0) this._quietBps = this._quietBps ? Math.min(this._quietBps, recentBps) : recentBps;
      const next = this._vad.backoff();
      this._debugLog(`🤫 静かなだけと判断（${reason}, 録音${recentBps.toFixed(0)}B/s, 静時${(this._quietBps || 0).toFixed(0)}B/s）→ 1段目のみ・次は${next / 10}秒後`);
    } else {
      this._recoveryAttempts++;
    }
    const stage = G.stageFor(kind, this._recoveryAttempts, trackLive);
    const mid = this._recorder && this._recorder.state === 'recording';
    const segSec = ((now - (this._recordStartTime || now)) / 1000).toFixed(1);
    this._debugLog(`🪜 復帰はしご${stage}段目 発火（${reason}, 判定=${kind}, 通算${this._recoveryAttempts}回）` +
      (mid ? ` ※区切りの途中 ${segSec}秒・発話=${this._hasVoiceStarted ? 'あり' : 'なし'}・録音は${stage === 3 ? '送ってから作り直し' : '止めずに継続'}` : ''));
    this._recovering = true;
    const safety = setTimeout(() => { this._recovering = false; }, 8000); // 宙吊り保険
    const done = () => { clearTimeout(safety); this._recovering = false; };
    const run = stage === 1 ? this._recoverStage1() : stage === 2 ? this._rebuildAudioGraph() : this._fullRestart();
    run.catch(e => this._debugLog(`${stage}段目エラー: ${e.message}`)).finally(done);
  },

  /** 1段目: resume完了をtimeout付きで待ってからAnalyser張替（録音には触れない） */
  async _recoverStage1() {
    if (!this._audioCtx || this._audioCtx.state === 'closed') return;
    const tr = this._stream && this._stream.getAudioTracks()[0];
    if (!tr || tr.readyState !== 'live') { this._debugLog('1段目: trackがlive以外 → 3段目へ'); return this._fullRestart(); }
    try {
      await Promise.race([
        this._audioCtx.resume(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 1000ms')), 1000)),
      ]);
      this._debugLog(`1段目: resume完了 state=${this._audioCtx.state}`);
    } catch (e) {
      this._debugLog(`1段目: resume未完（${e.message}）`);
    }
    if (this._stream && this._audioCtx && this._audioCtx.state === 'running') this._rewireAnalyser();
  },

  /** 現在のctx上でsource/analyserを張替（live trackを包み直す。旧sourceはdisconnect） */
  _rewireAnalyser() {
    try {
      if (this._sourceNode) { try { this._sourceNode.disconnect(); } catch (e) { /* ignore */ } }
      const live = this._stream.getAudioTracks().filter(t => t.readyState === 'live');
      const src = (live.length && typeof MediaStream !== 'undefined') ? new MediaStream(live) : this._stream;
      this._sourceNode = this._audioCtx.createMediaStreamSource(src);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 512;
      this._sourceNode.connect(analyser);
      this._analyser = analyser;
      this._debugLog('Analyser張替完了');
    } catch (e) {
      this._debugLog(`Analyser張替エラー: ${e.message}`);
    }
  },

  /** 2段目: AudioContextごと作り直し（MediaRecorderはstreamを直接録っているので止まらない） */
  async _rebuildAudioGraph() {
    if (!this._stream) return;
    this._debugLog('2段目: AudioContext作り直し（録音は継続）');
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      try { await this._audioCtx.close(); } catch (e) { /* ignore */ }
    }
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._sourceNode = null;
    this._rewireAnalyser();
    this._debugLog(`2段目: 再構築完了 state=${this._audioCtx.state}`);
  },

  /** 3段目: getUserMediaから再取得（trackが生きていない時だけ）。録れていた分は先に送る */
  async _fullRestart() {
    if (!this._listening || this._paused) { this._debugLog('3段目: pause/stop中 → 見送り'); return; }
    this._debugLog('3段目: streamごとフル再取得');
    this._flushBeforeRestart();
    this._stopRecording(false);
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      try { await this._audioCtx.close(); } catch (e) { /* ignore */ }
    }
    this._audioCtx = null; this._analyser = null; this._sourceNode = null;
    if (!this._listening) { this._debugLog('3段目: stop検出 → 見送り'); return; }
    if (this._paused) { this._debugLog('3段目: pause検出 → 見送り（TTS後の復帰に委ねる）'); return; }
    this._listening = false; // start()の二重起動ガードを通すため一旦落とす
    await this.start({ language: 'ja-JP' });
  },

  /** 3段目の前に、今の区切りで録れていた分を捨てずに送る（大きさが足りる時だけ） */
  _flushBeforeRestart() {
    const chunks = this._chunks || [];
    const bytes = chunks.reduce((n, c) => n + (c.size || 0), 0);
    if (bytes < WhisperVadGuard.BLIND_MIN_BYTES) return;
    this._debugLog(`💾 作り直しの前に録れていた ${(bytes / 1024).toFixed(1)}KB を送る`);
    this._chunks = [];
    this._transcribeChunks(chunks);
  },
};

if (typeof WhisperProvider !== 'undefined') Object.assign(WhisperProvider.prototype, WhisperRecovery);
if (typeof window !== 'undefined') window.WhisperRecovery = WhisperRecovery;
