// voice-input.js v1.5
// このファイルは音声会話の全体フロー制御を担当する
// マイクボタン→STT→自動送信→TTS再生のフローを管理
// UI操作はvoice-ui.jsのVoiceUIクラスに委譲する

// v1.0 新規作成 - Step 5b 音声会話フロー制御
// v1.1 修正 - 自動送信＋息継ぎ1.5秒待機＋セレクタバグ修正
// v1.2 修正 - STT繰り返し問題対策: finalText優先＋interim蓄積防止
// v1.3 追加 - Step 5c: 会議モード音声入力対応（マイクボタン＋会議入力欄送信）
// v1.5 追加 - Step 5e: 音声コマンド対応（ストップ・姉妹切替・スピード調整）

/**
 * VoiceController
 * 音声会話の全体フロー制御
 *
 * フロー:
 * ① マイクボタン押す → 🎤赤く光る
 * ② 話し始める → リアルタイムで途中テキスト表示
 * ③ 話し終わる → 1.5秒待ってから自動送信（息継ぎで切れない）
 * ④ AI応答テキスト着信 → テキスト表示
 * ⑤ TTS変換＋音声再生 → キャラアイコン発光
 * ⑥ 再生完了 → マイクボタン待機状態
 */
class VoiceController {
  constructor() {
    this._stt = new WebSpeechProvider();
    this._playback = new AudioPlaybackManager();
    this._ui = new VoiceUI();
    // 音声モードが有効か（一度でもマイクを押したらtrue）
    this._enabled = false;
    // 現在の姉妹ID
    this._currentSisterId = 'koko';
    // 音声設定
    this._speed = 1.0;
    this._autoListen = false;
    // 息継ぎ対策: 無音タイマー
    this._silenceTimer = null;
    // v1.5改善: ハンズフリー時は長め（運転中は考えながら話す）
    this._SILENCE_DELAY = 3500; // v1.5修正: 2500→3500ms
    this._SILENCE_DELAY_HANDSFREE = 5000; // ハンズフリー時は5秒
    // 最後に受け取ったテキスト（タイマー用）
    this._lastText = '';

    this._setupCallbacks();
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // --- STTコールバック ---
    // v1.2追加 - finalテキストを確定済みフラグで管理
    this._hasFinalText = false;
    this._finalText = '';

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._updateMeetingMicState('listening'); // v1.3追加
      this._ui.showInterim('🎤 聞いてるよ...');
      this._lastText = '';
      this._finalText = '';
      this._hasFinalText = false;
      this._clearSilenceTimer();
    };

    this._stt.onInterim = (text) => {
      // v1.2: finalが来た後のinterimは無視（モバイル二重発火対策）
      if (this._hasFinalText) return;
      this._ui.showInterim(text);
      this._lastText = text;
      // v1.5追加: interimが来てる=まだ話し中。タイマーリセットして延長
      if (this._silenceTimer) { this._clearSilenceTimer(); this._resetSilenceTimer(); }
    };

    this._stt.onFinal = (text) => {
      // v1.2: finalは1回だけ採用。2回目以降は無視
      if (this._hasFinalText) {
        console.log(`[Voice] final重複無視: "${text}"`);
        return;
      }
      console.log(`[Voice] 確定テキスト: "${text}"`);
      this._finalText = text;
      this._hasFinalText = true;
      this._lastText = text;
      this._ui.showInterim(text);
    };

    this._stt.onEnd = () => {
      // v1.2: finalTextを最優先、なければlastText（interim）をフォールバック
      const text = this._hasFinalText
        ? this._finalText
        : (this._stt.stopAndGetText() || this._lastText);
      console.log(`[Voice] onEnd: hasFinal=${this._hasFinalText} text="${text}"`);
      if (text && text.trim().length > 0) {
        this._lastText = text;
        this._ui.showInterim(text + ' ⏳ 送信中...');
        this._clearSilenceTimer();
        this._resetSilenceTimer();
      } else {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle'); // v1.3修正
        this._ui.hideInterim();
      }
    };

    this._stt.onError = (error) => {
      this._clearSilenceTimer();
      this._ui.updateMicState('error');
      this._updateMeetingMicState('error'); // v1.3修正
      this._ui.showStatus(error, 'error');
      setTimeout(() => {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle'); // v1.3修正
      }, 2000);
    };

    // --- TTS再生コールバック ---
    this._playback.onPlayStart = (sisterId) => {
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
      this._updateMeetingMicState('speaking'); // v1.3追加
      // v1.3追加: ハウリング防止 — TTS再生開始時にSTTを強制停止
      if (this._stt.isListening()) {
        this._clearSilenceTimer();
        this._stt.stop();
        this._lastText = '';
        console.log('[Voice] ハウリング防止: TTS再生中にSTT停止');
      }
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      // キュー再生中は自動マイク再開しない（次の姉妹の番）
      if (this._playback.isQueuePlaying()) return;
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle'); // v1.3追加
      if (this._autoListen && this._enabled) {
        // v1.3修正: 1.2秒待つ（スピーカー残響がマイクに入るのを防止）
        setTimeout(() => this.startListening(), 1200);
      }
    };

    // キュー全体が完了した時のコールバック
    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle'); // v1.3追加
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 1200);
      }
    };

    this._playback.onPlayError = (error, sisterId) => {
      this._ui.highlightSister(sisterId, false);
      this._ui.showStatus(error, 'error');
      this._ui.updateMicState('idle');
    };

    // v1.4追加 - TTSフォールバック通知（VOICEVOX→OpenAI切替時）
    this._playback.onFallback = (message) => {
      this._ui.showStatus(message, 'info');
    };
  }

  // ═══════════════════════════════════════════
  // 息継ぎ対策タイマー
  // ═══════════════════════════════════════════

  /**
   * 無音タイマーをリセット v1.5改修 - ハンズフリー時は長めに待つ
   */
  _resetSilenceTimer() {
    this._clearSilenceTimer();
    const text = (this._lastText || '').trim();
    const baseDelay = this._autoListen ? this._SILENCE_DELAY_HANDSFREE : this._SILENCE_DELAY;
    // 短いテキスト（5文字未満）はまだ話し始めたばかりなので+1.5秒
    const delay = (text.length < 5) ? baseDelay + 1500 : baseDelay;
    this._silenceTimer = setTimeout(() => {
      this._silenceTimer = null;
      const finalText = this._lastText.trim();
      if (finalText) {
        console.log(`[Voice] ${delay}ms無音 → 自動送信: "${finalText}"`);
        this._stt.stop();
        this._sendVoiceMessage(finalText);
      }
    }, delay);
  }

  /**
   * 無音タイマーをクリア
   */
  _clearSilenceTimer() {
    if (this._silenceTimer) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  // ═══════════════════════════════════════════
  // 公開API
  // ═══════════════════════════════════════════

  /** 音声モードを初期化（app.jsの初期化時に呼ぶ） */
  init() {
    this._ui.init(() => this.toggleListening());

    // v1.3追加 - 会議用マイクボタンのイベント接続
    const meetingMic = document.getElementById('btn-meeting-mic');
    if (meetingMic) {
      meetingMic.addEventListener('click', () => this.toggleListening());
    }

    if (!this._stt.isAvailable()) {
      this._ui.showStatus('このブラウザは音声入力に対応していません', 'error');
      this._ui.disableMic();
      // v1.3追加 - 会議マイクも無効化
      if (meetingMic) { meetingMic.disabled = true; meetingMic.style.opacity = '0.4'; }
      return;
    }

    if (!this._playback._ttsProvider.isAvailable()) {
      console.warn('[Voice] TTS未設定（Worker URL/認証トークンが必要）');
    }
    console.log('[Voice] 音声モード初期化完了（会議マイク対応）');
  }

  /** マイクボタン押下時の処理 v1.3改修 - silenceTimer稼働中も停止対象 */
  toggleListening() {
    // STT認識中 or 無音タイマー稼働中（＝送信待ち）→ 停止処理
    if (this._stt.isListening() || this._silenceTimer !== null) {
      this._clearSilenceTimer();
      const text = (this._lastText || '').trim();
      this._stt.stop();
      this._lastText = '';
      if (text) {
        this._sendVoiceMessage(text);
      } else {
        this._forceIdleState();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      // 再生中（キュー含む）→ 割り込み停止
      this._playback.stop();
      this._forceIdleState();
    } else {
      this.startListening();
    }
  }

  /** v1.3追加 - 全マイクUIを確実にidle状態に戻す */
  _forceIdleState() {
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
    this._ui.hideInterim();
  }

  /** 音声認識を開始 */
  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._clearSilenceTimer();
    this._stt.start({ language: 'ja-JP' });
  }

  /** 音声認識を停止 */
  stopListening() {
    this._clearSilenceTimer();
    this._stt.stop();
  }

  /**
   * AI応答を声で再生する（chat-core.jsから呼ばれる）
   * @param {string} responseText - AI応答テキスト
   * @param {string} sisterId - 'koko' | 'gpt' | 'claude'
   */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /**
   * v1.2追加 - 複数の姉妹の応答を順番に再生（chat-group.jsから呼ばれる）
   * @param {Array<{text: string, sisterId: string}>} items - 再生キュー
   */
  async speakQueue(items) {
    if (!this._enabled) return;
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  /** 現在の姉妹IDを設定 */
  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }

  /** 音声速度を設定（0.75〜1.25） */
  setSpeed(speed) { this._speed = Math.max(0.75, Math.min(1.25, speed)); }

  /**
   * v1.2追加 - ハンズフリーモード切替（設定画面から呼ばれる）
   * @param {boolean} enabled - true=TTS完了後に自動マイク再開
   */
  setAutoListen(enabled) {
    this._autoListen = !!enabled;
    console.log(`[Voice] ハンズフリー: ${this._autoListen ? 'ON' : 'OFF'}`);
  }

  /**
   * v1.2追加 - STTデバッグパネル表示切替（設定画面から呼ばれる）
   * @param {boolean} visible - true=デバッグパネル表示
   */
  setDebugVisible(visible) {
    if (this._stt && typeof this._stt.setDebugVisible === 'function') {
      this._stt.setDebugVisible(visible);
    }
  }

  /** 音声モードが有効かどうか */
  isEnabled() { return this._enabled; }

  /** 音声モードを完全停止 */
  destroy() {
    this._enabled = false;
    this._clearSilenceTimer();
    this._stt.stop();
    this._playback.stop();
    this._ui.hideInterim();
  }

  // ═══════════════════════════════════════════
  // 送信処理
  // ═══════════════════════════════════════════

  /**
   * 音声メッセージを自動送信（既存のチャット送信フローに合流）
   * v1.1修正: セレクタをCOCOMITalkの実際のID（#msg-input, #btn-send）に修正
   * v1.3追加: 会議モード時はmeeting-topic-inputに送信
   * v1.5追加: 送信前に音声コマンドチェック
   */
  _sendVoiceMessage(text) {
    // v1.5追加 - 音声コマンドチェック（コマンドなら送信しない）
    if (this._handleVoiceCommand(text)) return;

    this._ui.hideInterim();
    this._lastText = '';

    // v1.3追加 - 会議画面が表示中かチェック
    const inMeeting = typeof MeetingUI !== 'undefined' && MeetingUI.getIsVisible();

    if (inMeeting) {
      this._sendToMeeting(text);
    } else {
      this._sendToNormalChat(text);
    }
  }

  // ═══════════════════════════════════════════
  // v1.5追加 - 音声コマンド処理（Step 5e）
  // ═══════════════════════════════════════════

  /** 音声テキストが音声コマンドかチェックして実行。コマンドならtrue返す */
  _handleVoiceCommand(text) {
    // v1.5.1改善: STTが付ける句読点・記号を除去してからマッチ
    const t = (text || '').trim().replace(/[。、！？!?.，,\s]+$/g, '').trim();
    if (t.length < 2 || t.length > 20) return false;

    // 停止コマンド
    if (/^(ストップ|止めて|停止|とめて|やめて)$/.test(t)) {
      this._playback.stop(); this._forceIdleState();
      this._ui.showStatus('⏹️ 再生を停止しました', 'info');
      return true;
    }
    // マイク再開コマンド
    if (/^(もう一回|もう1回|もういっかい|聞いて)$/.test(t)) {
      this._forceIdleState(); setTimeout(() => this.startListening(), 500);
      return true;
    }
    // 姉妹切替コマンド
    const sisters = { 'ここちゃん': 'koko', 'お姉ちゃん': 'gpt', 'おねえちゃん': 'gpt', 'クロちゃん': 'claude', 'くろちゃん': 'claude' };
    for (const [kw, id] of Object.entries(sisters)) {
      if (t === kw || t === kw + 'に切り替え' || t === kw + 'にして') {
        if (typeof window.switchToSister === 'function') {
          window.switchToSister(id); this._currentSisterId = id;
          this._ui.showStatus(`🔄 ${kw}に切り替えました`, 'success');
          this._forceIdleState();
          if (this._autoListen) setTimeout(() => this.startListening(), 800);
          return true;
        }
      }
    }
    // グループモード切替コマンド
    if (/^(みんな|グループ|全員|みんなで)$/.test(t)) {
      if (typeof window.switchToGroup === 'function') {
        window.switchToGroup();
        this._ui.showStatus('👥 グループモードに切り替えました', 'success');
        this._forceIdleState();
        if (this._autoListen) setTimeout(() => this.startListening(), 800);
        return true;
      }
    }
    // スピード調整コマンド
    if (/^(速く|早く|はやく|スピードアップ)$/.test(t)) {
      this._speed = Math.min(1.5, this._speed + 0.25);
      this._ui.showStatus(`⏩ 速度: ${this._speed}x`, 'info'); this._forceIdleState(); return true;
    }
    if (/^(遅く|ゆっくり|おそく|スピードダウン)$/.test(t)) {
      this._speed = Math.max(0.5, this._speed - 0.25);
      this._ui.showStatus(`⏪ 速度: ${this._speed}x`, 'info'); this._forceIdleState(); return true;
    }
    return false;
  }

  /** v1.3追加 - 通常チャットへの音声送信 */
  _sendToNormalChat(text) {
    const input = document.getElementById('msg-input');
    if (!input) {
      console.error('[Voice] #msg-input が見つかりません');
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      return;
    }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => {
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        console.log('[Voice] 通常チャット音声送信完了');
      } else {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter',
          keyCode: 13, which: 13, bubbles: true
        });
        input.dispatchEvent(event);
      }
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
    }, 50);
  }

  /** v1.3追加 - 会議モードへの音声送信 */
  _sendToMeeting(text) {
    const topicInput = document.querySelector('.meeting-topic-input');
    if (!topicInput) {
      console.error('[Voice] .meeting-topic-input が見つかりません');
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      return;
    }
    topicInput.value = text;
    topicInput.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => {
      // 会議進行中かどうかで送信先を判定
      const isRunning = typeof MeetingRelay !== 'undefined' && MeetingRelay.getCurrentRound() > 0;
      if (isRunning) {
        const btnContinue = document.getElementById('btn-meeting-continue');
        if (btnContinue) {
          btnContinue.click();
          console.log('[Voice] 会議追加ラウンド音声送信完了');
        }
      } else {
        const btnStart = document.getElementById('btn-meeting-start');
        if (btnStart) {
          btnStart.click();
          console.log('[Voice] 会議開始音声送信完了');
        }
      }
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
    }, 50);
  }

  /**
   * v1.3追加 - 会議マイクボタンのUI状態を同期更新
   * @param {string} state - 'idle'|'listening'|'speaking'|'error'
   */
  _updateMeetingMicState(state) {
    const btn = document.getElementById('btn-meeting-mic');
    if (!btn) return;
    const styles = {
      idle:      { bg: 'white', border: 'var(--active-primary,#6c5ce7)', icon: '🎤' },
      listening: { bg: '#e74c3c', border: '#e74c3c', icon: '🎤' },
      speaking:  { bg: 'var(--active-primary,#6c5ce7)', border: 'var(--active-primary,#6c5ce7)', icon: '🔊' },
      error:     { bg: '#e74c3c', border: '#e74c3c', icon: '⚠️' },
    };
    const s = styles[state] || styles.idle;
    btn.style.background = s.bg;
    btn.style.borderColor = s.border;
    btn.innerHTML = s.icon;
    // 聞き取り中はパルスアニメーション
    btn.style.animation = state === 'listening'
      ? 'cocomi-mic-pulse 1s ease-in-out infinite' : 'none';
  }
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
