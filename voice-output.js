// voice-output.js v1.4
// このファイルはTTS音声の再生管理を担当する（AudioPlaybackManager）
// 再生キュー、割り込み停止、姉妹アイコン発光制御を行う
// openai-tts-provider.js / voicevox-tts-provider.js と連携してAI応答を声で再生する
// v2.1調査済み: チャンク間の_playing管理は正常。TTS途中切れの原因はvoice-input.js側

// v1.0 新規作成 - Step 5b TTS再生管理
// v1.1 追加 - キュー再生機能（グループモード3人全員対応）
// v1.2 追加 - プロバイダー切替＋VOICEVOX長文分割連続再生
// v1.3 追加 - playbackRate再生速度＋canplaythrough待ち
// v1.4 追加 - Step 5d TTSフォールバック（VOICEVOX→OpenAI自動切替）

/**
 * AudioPlaybackManager
 * TTS音声の再生を管理するクラス
 *
 * 機能:
 * - 単発再生（1対1チャット用）
 * - キュー再生（会議モード用 — Step 5cで拡張）
 * - 割り込み停止（ボタン押下 or テキスト入力で即停止）
 * - 姉妹アイコン発光の通知
 */
class AudioPlaybackManager {
  constructor() {
    // TTSプロバイダー（差し替え可能）
    this._openaiProvider = new OpenAITTSProvider();
    // v1.2追加 - VOICEVOXプロバイダー（利用可能ならインスタンス化）
    this._voicevoxProvider = (typeof VoicevoxTTSProvider !== 'undefined')
      ? new VoicevoxTTSProvider() : null;
    // 現在のプロバイダー参照
    this._ttsProvider = this._openaiProvider;
    // 現在再生中のAudioオブジェクト
    this._currentAudio = null;
    // 再生状態
    this._playing = false;
    // v1.1追加 - キュー再生用
    this._queue = [];
    this._queuePlaying = false;
    this._queueCancelled = false;
    // イベントコールバック
    this.onPlayStart = null;   // (sisterId) => {}
    this.onPlayEnd = null;     // (sisterId) => {}
    this.onPlayError = null;   // (error, sisterId) => {}
    // v1.1追加 - キュー全体完了コールバック
    this.onQueueEnd = null;    // () => {}
    // v1.3追加 - 再生速度（playbackRateで制御）
    this._speed = 1.0;
    // v1.4追加 - フォールバック通知コールバック
    this.onFallback = null; // (message) => {} — UI通知用
  }

  /**
   * v1.2追加 - TTSプロバイダーを切り替える
   * @param {string} providerName - 'openai' | 'voicevox'
   */
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

  /**
   * テキストを声で再生する（1対1チャット用）
   * @param {string} text - 読み上げるテキスト
   * @param {string} sisterId - 'gemini' | 'openai' | 'claude'
   * @param {object} options - { speed: number }
   * @returns {Promise<void>}
   */
  async speak(text, sisterId, options = {}) {
    // 既に再生中なら停止してから新しい再生を開始
    if (this._playing) {
      this.stop();
    }

    // テキストが空なら何もしない
    if (!text || text.trim().length === 0) {
      console.log('[AudioPM] テキストが空のためスキップ');
      return;
    }

    // マークダウン記法やコードブロックを除去（読み上げに不要）
    const cleanText = this._cleanTextForTTS(text);
    if (cleanText.length === 0) {
      console.log('[AudioPM] クリーニング後テキストが空のためスキップ');
      return;
    }

    // 声の設定を取得
    const voiceConfig = getSisterVoice(sisterId);
    console.log(`[AudioPM] 再生準備: ${voiceConfig.label} (voice=${voiceConfig.voice})`);

    try {
      // TTS生成
      const audio = await this._ttsProvider.synthesize(
        cleanText,
        voiceConfig.voice,
        { speed: options.speed || 1.0 }
      );

      // 再生開始
      this._currentAudio = audio;
      this._playing = true;
      // v1.3追加 - 再生速度をplaybackRateで反映（全エンジン共通）
      this._speed = options.speed || 1.0;
      audio.playbackRate = this._speed;

      // 再生開始通知（アイコン発光用）
      if (this.onPlayStart) this.onPlayStart(sisterId);

      // v1.2追加 - VOICEVOX長文分割: 残りチャンクがあれば連続再生
      const remainingChunks = audio._vvRemainingChunks || [];
      const vvSpeakerId = audio._vvSpeakerId;
      const vvApiKey = audio._vvApiKey;

      // 再生完了時の処理
      audio.addEventListener('ended', async () => {
        // 残りチャンクがあれば次を再生
        if (remainingChunks.length > 0 && !this._queueCancelled) {
          await this._playVVChunks(remainingChunks, vvSpeakerId, vvApiKey, sisterId);
        }
        // 全チャンク完了（または残りなし）→ 再生終了通知
        this._playing = false;
        this._currentAudio = null;
        console.log(`[AudioPM] 再生完了: ${voiceConfig.label}`);
        if (this.onPlayEnd) this.onPlayEnd(sisterId);
      });

      // 再生エラー時 — 全チャンク再生を試みてからエラー通知
      audio.addEventListener('error', (e) => {
        console.warn(`[AudioPM] 1stチャンクエラー、残りを試行:`, e);
        // 最初のチャンクがエラーでも残りチャンクがあれば試す
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
      // v1.4追加 - VOICEVOXエラー時にOpenAI TTSへフォールバック
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
   * 再生を即座に停止する（割り込み用 — 200ms以内目標）
   */
  stop() {
    if (this._currentAudio) {
      try {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
        // ObjectURL解放
        if (this._currentAudio.src && this._currentAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(this._currentAudio.src);
        }
      } catch (e) {
        console.warn('[AudioPM] 停止エラー:', e.message);
      }
      this._currentAudio = null;
    }
    this._playing = false;
    // v1.1追加 - キュー再生中なら全キャンセル
    this._queueCancelled = true;
    this._queue = [];
    this._queuePlaying = false;
    console.log('[AudioPM] 再生停止');
  }

  // ═══════════════════════════════════════════
  // v1.1追加 - キュー再生（グループモード用）
  // ═══════════════════════════════════════════

  /**
   * 複数の姉妹の応答を順番に再生する（グループモード用）
   * @param {Array<{text: string, sisterId: string}>} items - 再生キュー
   * @param {object} options - { speed: number }
   */
  async speakQueue(items, options = {}) {
    if (!items || items.length === 0) return;

    // 既存の再生・キューをクリア
    this.stop();

    this._queue = [...items];
    this._queuePlaying = true;
    this._queueCancelled = false;
    console.log(`[AudioPM] キュー再生開始: ${items.length}人分`);

    for (let i = 0; i < this._queue.length; i++) {
      // キャンセルチェック
      if (this._queueCancelled) {
        console.log('[AudioPM] キュー再生キャンセル');
        break;
      }

      const item = this._queue[i];
      try {
        // 各姉妹の音声を順番に再生（awaitで完了を待つ）
        await this._speakAndWait(item.text, item.sisterId, options);
      } catch (e) {
        console.warn(`[AudioPM] キュー[${i}] エラー:`, e.message);
        // エラーが起きても次の姉妹に進む
      }

      // 姉妹間に300msの間を空ける（自然な会話感）
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

  /**
   * 1人分の再生を完了まで待つ（キュー再生の内部用）
   * @returns {Promise<void>}
   */
  _speakAndWait(text, sisterId, options = {}) {
    return new Promise(async (resolve, reject) => {
      if (!text || text.trim().length === 0) {
        resolve();
        return;
      }

      const cleanText = this._cleanTextForTTS(text);
      if (cleanText.length === 0) {
        resolve();
        return;
      }

      const voiceConfig = getSisterVoice(sisterId);
      console.log(`[AudioPM] キュー再生: ${voiceConfig.label}`);

      try {
        const audio = await this._ttsProvider.synthesize(
          cleanText, voiceConfig.voice, { speed: options.speed || 1.0 }
        );

        this._currentAudio = audio;
        this._playing = true;
        // v1.3追加 - 再生速度
        this._speed = options.speed || 1.0;
        audio.playbackRate = this._speed;
        if (this.onPlayStart) this.onPlayStart(sisterId);

        // v1.2追加 - VOICEVOX長文分割: 残りチャンク
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
        // v1.4追加 - VOICEVOXエラー時にOpenAI TTSへフォールバック
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
        resolve(); // エラーでも次に進む
      }
    });
  }

  /**
   * v1.2追加 - VOICEVOXの残りチャンクを順番に再生する
   * @param {string[]} chunks - 残りチャンクの配列
   * @param {number} speakerId - 話者ID
   * @param {string} apiKey - APIキー
   * @param {string} sisterId - 姉妹ID（ログ用）
   */
  async _playVVChunks(chunks, speakerId, apiKey, sisterId) {
    const provider = this._voicevoxProvider;
    if (!provider) return;
    for (let i = 0; i < chunks.length; i++) {
      if (this._queueCancelled) break;
      try {
        console.log(`[AudioPM] VVチャンク${i + 2}/${chunks.length + 1}: "${chunks[i].substring(0, 20)}..."`);
        const audio = await provider.synthesizeChunk(chunks[i], speakerId, apiKey);
        this._currentAudio = audio;
        // 読み込み完了を待ってから再生（途中切れ防止）
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { reject(new Error('チャンク読み込みタイムアウト')); }, 15000);
          audio.addEventListener('canplaythrough', () => { clearTimeout(timeout); resolve(); }, { once: true });
          audio.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('チャンク読み込みエラー')); }, { once: true });
          audio.load();
        });
        // load()後にplaybackRate設定（load()でリセットされるため）
        audio.playbackRate = this._speed;
        // 再生完了を待つ
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

  /**
   * キュー再生中かどうか
   * @returns {boolean}
   */
  isQueuePlaying() {
    return this._queuePlaying;
  }

  /**
   * 現在再生中かどうか
   * @returns {boolean}
   */
  isPlaying() {
    return this._playing;
  }

  /**
   * TTS用にテキストをクリーニングする
   * マークダウン記法やコードブロックは読み上げに不要なので除去
   * @param {string} text
   * @returns {string}
   */
  _cleanTextForTTS(text) {
    let cleaned = text;

    // コードブロックを除去（```...```）
    cleaned = cleaned.replace(/```[\s\S]*?```/g, 'コードブロックは省略します。');

    // インラインコードを除去（`...`）
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // マークダウンの見出し記号を除去（### など）
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

    // マークダウンの太字・斜体記号を除去
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

    // マークダウンのリンクをテキスト部分だけ残す
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // URLを除去（読み上げると長い）
    cleaned = cleaned.replace(/https?:\/\/\S+/g, 'リンク');

    // 箇条書き記号を除去
    cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
    cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

    // テーブルは省略
    cleaned = cleaned.replace(/\|.*\|/g, '');
    cleaned = cleaned.replace(/^[-|:\s]+$/gm, '');

    // 連続する空行を1つにまとめる
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 前後の空白をトリム
    cleaned = cleaned.trim();

    return cleaned;
  }
}

// グローバルに公開
window.AudioPlaybackManager = AudioPlaybackManager;
