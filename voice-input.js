// voice-input.js v1.9.5
// このファイルは音声会話の全体フロー制御を担当する
// マイクボタン→STT→自動送信→TTS再生のフローを管理
// UI操作はvoice-ui.jsのVoiceUIクラスに委譲する
// 送信処理はvoice-sender.js v1.0にmixin分離

// v1.0 新規作成 - Step 5b 音声会話フロー制御
// v1.1 修正 - 自動送信＋息継ぎ1.5秒待機＋セレクタバグ修正
// v1.2 修正 - STT繰り返し問題対策: finalText優先＋interim蓄積防止
// v1.3 追加 - Step 5c: 会議モード音声入力対応（マイクボタン＋会議入力欄送信）
// v1.5 追加 - Step 5e: 音声コマンド対応（ストップ・姉妹切替・スピード調整）
// v1.7 修正 - コマンド処理を内蔵に戻し確実に動作。部分一致＋正規化強化＋try-catch
// v1.8 修正 - 3バグ全修正: コマンド→VoiceCommand分離 / 送信→VoiceSend分離 / STT即終了リトライ
// v1.8.3 追加 - 常時リスニング: 無音でSTT終了しても自動リスタート。明示的停止でenabled=false
// v1.9 リファクタ - 送信処理をvoice-sender.js v1.0にmixin分離（行数削減: 490→395行）
// v1.9.1 追加 - Step 6 Phase 1: 「覚えて」コマンドでチャット記憶手動保存
// v1.9.2 修正 - 全コマンドコールバック: _forceIdleState→showStatusの順に統一（表示即消え防止）
// v1.9.3 改善 - ピコンピコン対策＋無音タイマー延長＋送信キャンセル音声コマンド対応
// v1.9.4 改善 - 息継ぎ対策: STTセッション跨ぎテキスト蓄積＋再スタートで途切れ防止
// v1.9.5 改善 - continuous:true対応: STT再スタート不要化でピコンピコン根本解決＋コード大幅簡素化

/** VoiceController - 音声会話の全体フロー制御（マイク→STT→送信→TTS→マイク待機） */
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
    // v1.9.3変更 - デフォルト速度を1.25xに（アキヤの普段使いに合わせて一段階アップ）
    this._speed = 1.25;
    this._autoListen = false;
    // 息継ぎ対策: 無音タイマー
    this._silenceTimer = null;
    // v1.5改善: ハンズフリー時は長め（運転中は考えながら話す）
    // v1.9.2改善 - 常時リスニング中もゆったり待つ＋息継ぎ・考え中に対応
    // v1.9.3改善 - さらに延長（息継ぎで途切れて誤送信する対策）
    // v1.9.4改善 - STT蓄積方式に変更したので適正値に調整
    this._SILENCE_DELAY = 4000;            // 通常: 4秒（息継ぎはSTT蓄積で吸収）
    this._SILENCE_DELAY_HANDSFREE = 7000;  // ハンズフリー/常時リスニング: 7秒
    // 最後に受け取ったテキスト（タイマー用）
    this._lastText = '';
    // v1.9.4追加: 息継ぎ対策 — STTセッション跨ぎでテキスト蓄積
    this._accumulatedText = '';
    // v1.9.5: STT開始時刻記録（デバッグ用）
    this._sttStartTime = 0;

    this._setupVoiceCommand(); // v1.8: VoiceCommandモジュール初期化
    this._setupCallbacks();
  }

  // ═══════════════════════════════════════════
  // v1.8 VoiceCommandモジュール初期化
  // ═══════════════════════════════════════════

  _setupVoiceCommand() {
    if (typeof VoiceCommand === 'undefined') {
      console.warn('[Voice] VoiceCommandが未定義 — 音声コマンド無効');
      this._voiceCmd = null;
      return;
    }
    this._voiceCmd = new VoiceCommand({
      onStop: () => {
        this._playback.stop();
        this._enabled = false; // v1.8.3: ストップだけは明示的停止
        this._forceIdleState();
      },
      onResume: () => {
        this._forceIdleState();
        setTimeout(() => this.startListening(), 500);
      },
      onSwitchSister: (key, name) => {
        if (typeof window.switchToSister === 'function') {
          window.switchToSister(key);
          this._currentSisterId = key;
          // v1.9.2修正: _forceIdleState→showStatusの順（hideInterimで消される対策）
          this._forceIdleState();
          this._ui.showStatus(`🔄 ${name}に切り替えました`, 'success');
          if (this._enabled) setTimeout(() => this.startListening(), 800);
        }
      },
      onSwitchGroup: () => {
        if (typeof window.switchToGroup === 'function') {
          window.switchToGroup();
          this._forceIdleState();
          this._ui.showStatus('👥 グループモードに切り替えました', 'success');
          if (this._enabled) setTimeout(() => this.startListening(), 800);
        }
      },
      onSpeedChange: (newSpeed) => {
        this._speed = newSpeed;
        if (this._enabled) setTimeout(() => this.startListening(), 500);
      },
      onStatus: (msg, type) => {
        this._forceIdleState();
        this._ui.showStatus(msg, type);
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      },
      // v1.9.1追加: 「覚えて」コマンドでチャット記憶を手動保存
      onSaveMemory: () => {
        this._forceIdleState();
        if (typeof ChatMemory !== 'undefined' && typeof ChatCore !== 'undefined') {
          const ctx = ChatCore.getGroupContext();
          const history = ctx.chatHistories[ctx.currentSister];
          ChatMemory.manualSave(ctx.currentSister, history);
          this._ui.showStatus('💾 覚えたよ！', 'success');
        } else {
          this._ui.showStatus('💾 記憶機能が未準備です', 'warning');
        }
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      },
      // v1.9.3追加: 「キャンセル」「取り消し」で送信キャンセル
      onCancel: () => {
        this._forceIdleState();
        if (typeof ChatCore !== 'undefined' && ChatCore._handleCancel) {
          ChatCore._handleCancel();
          this._ui.showStatus('⏹ 送信をキャンセルしました', 'info');
        } else {
          this._ui.showStatus('⏹ キャンセル対象がありません', 'info');
        }
        if (this._enabled) setTimeout(() => this.startListening(), 800);
      }
    });
  }

  /**
   * STT/TTSのコールバック設定
   */
  _setupCallbacks() {
    // --- STTコールバック ---
    // v1.9.5: continuous:true対応 — STTは止まらないのでonFinalで蓄積、onEndは万が一の再スタートのみ

    this._stt.onStart = () => {
      this._ui.updateMicState('listening');
      this._updateMeetingMicState('listening');
      this._ui.showInterim(this._accumulatedText ? this._accumulatedText + ' 🎤...' : '🎤 聞いてるよ...');
      this._sttStartTime = Date.now();
    };

    this._stt.onInterim = (text) => {
      // 蓄積テキスト＋現在の途中経過を表示
      const display = this._accumulatedText ? this._accumulatedText + ' ' + text : text;
      this._ui.showInterim(display);
      this._lastText = display;
      // interimが来てる=まだ話し中。タイマーリセットして延長
      this._clearSilenceTimer();
      this._resetSilenceTimer();
    };

    this._stt.onFinal = (text) => {
      // v1.9.5: continuous:trueでは息継ぎのたびにfinalが来る → 蓄積
      console.log(`[Voice] 確定テキスト: "${text}"`);
      this._accumulatedText += (this._accumulatedText ? ' ' : '') + text.trim();
      this._lastText = this._accumulatedText;
      this._ui.showInterim(this._accumulatedText + ' 🎤...');
      // 無音タイマーリセット（蓄積テキスト全体に対して待機）
      this._clearSilenceTimer();
      this._resetSilenceTimer();
    };

    this._stt.onEnd = () => {
      // v1.9.5: continuous:trueでは基本呼ばれない（エラーやstop()時のみ）
      console.log(`[Voice] onEnd: accumulated="${this._accumulatedText}"`);
      // 蓄積テキストがあり、タイマーも走ってないなら送信
      if (this._accumulatedText && !this._silenceTimer) {
        const finalText = this._accumulatedText;
        this._accumulatedText = '';
        this._lastText = '';
        this._sendVoiceMessage(finalText);
        return;
      }
      // 音声モード中に予期せず終了した場合 → 再スタート
      if (this._enabled && !this._playback.isPlaying() && !this._playback.isQueuePlaying()) {
        console.log('[Voice] STT予期せず終了 → 再スタート');
        setTimeout(() => {
          if (this._enabled) this._stt.start({ language: 'ja-JP' });
        }, 500);
      } else if (!this._enabled) {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle');
        this._ui.hideInterim();
      }
    };

    this._stt.onError = (error) => {
      this._clearSilenceTimer();
      this._ui.updateMicState('error');
      this._updateMeetingMicState('error');
      this._ui.showStatus(error, 'error');
      setTimeout(() => {
        this._ui.updateMicState('idle');
        this._updateMeetingMicState('idle');
      }, 2000);
    };

    // --- TTS再生コールバック ---
    this._playback.onPlayStart = (sisterId) => {
      this._ui.highlightSister(sisterId, true);
      this._ui.updateMicState('speaking');
      this._updateMeetingMicState('speaking');
      // ハウリング防止 — TTS再生開始時にSTTを強制停止
      if (this._stt.isListening()) {
        this._clearSilenceTimer();
        this._stt.stop();
        this._lastText = '';
        console.log('[Voice] ハウリング防止: TTS再生中にSTT停止');
      }
    };

    this._playback.onPlayEnd = (sisterId) => {
      this._ui.highlightSister(sisterId, false);
      if (this._playback.isQueuePlaying()) return;
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      // v1.9.3改善: 1200ms→2500ms（TTS残響・エコーがマイクに入る対策）
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 2500);
      }
    };

    this._playback.onQueueEnd = () => {
      this._ui.updateMicState('idle');
      this._updateMeetingMicState('idle');
      // v1.9.3改善: 1200ms→2500ms（グループTTS全完了後の残響対策）
      if (this._autoListen && this._enabled) {
        setTimeout(() => this.startListening(), 2500);
      }
    };

    this._playback.onPlayError = (error, sisterId) => {
      this._ui.highlightSister(sisterId, false);
      this._ui.showStatus(error, 'error');
      this._ui.updateMicState('idle');
    };

    // TTSフォールバック通知
    this._playback.onFallback = (message) => {
      this._ui.showStatus(message, 'info');
    };
  }

  // ═══════════════════════════════════════════
  // 息継ぎ対策タイマー
  // ═══════════════════════════════════════════

  /** 無音タイマーをリセット v1.5改修 - ハンズフリー時は長めに待つ */
  _resetSilenceTimer() {
    this._clearSilenceTimer();
    const text = (this._lastText || '').trim();
    // v1.9.2改善 - 常時リスニング中（_enabled）もハンズフリー同等の余裕を持たせる
    const isRelaxed = this._autoListen || this._enabled;
    const baseDelay = isRelaxed ? this._SILENCE_DELAY_HANDSFREE : this._SILENCE_DELAY;
    // 短い発言（5文字未満）→ +1.5秒、長い発言（30文字以上）→ +2秒（考えながら喋ってる）
    let delay = baseDelay;
    if (text.length < 5) {
      delay = baseDelay + 1500;
    } else if (text.length >= 30) {
      delay = baseDelay + 2000;
    }
    this._silenceTimer = setTimeout(() => {
      this._silenceTimer = null;
      // v1.9.5: 蓄積テキストを送信
      const finalText = (this._accumulatedText || this._lastText || '').trim();
      if (finalText) {
        // 送信前にすべてクリア
        this._lastText = '';
        this._accumulatedText = '';
        console.log(`[Voice] ${delay}ms無音 → 自動送信: "${finalText}"`);
        this._stt.stop();
        this._sendVoiceMessage(finalText);
      }
    }, delay);
  }

  /** 無音タイマーをクリア */
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

    const meetingMic = document.getElementById('btn-meeting-mic');
    if (meetingMic) {
      meetingMic.addEventListener('click', () => this.toggleListening());
    }

    if (!this._stt.isAvailable()) {
      this._ui.showStatus('このブラウザは音声入力に対応していません', 'error');
      this._ui.disableMic();
      if (meetingMic) { meetingMic.disabled = true; meetingMic.style.opacity = '0.4'; }
      return;
    }

    if (!this._playback._ttsProvider.isAvailable()) {
      console.warn('[Voice] TTS未設定（Worker URL/認証トークンが必要）');
    }
    console.log(`[Voice] 音声モード初期化完了（v1.8.3） cmd=${!!this._voiceCmd}`);
  }

  /** マイクボタン押下時の処理 */
  toggleListening() {

    if (this._stt.isListening() || this._silenceTimer !== null) {
      this._clearSilenceTimer();
      // v1.9.4改善: 蓄積テキストも含めて送信
      const text = (this._accumulatedText || this._lastText || '').trim();
      this._enabled = false; // v1.8.3: 明示的停止 → 自動リスタート防止
      this._stt.stop();
      this._lastText = '';
      this._accumulatedText = '';
      if (text) {
        this._enabled = true; // テキストありなら送信後に音声モード継続
        this._sendVoiceMessage(text);
      } else {
        this._forceIdleState();
      }
    } else if (this._playback.isPlaying() || this._playback.isQueuePlaying()) {
      this._playback.stop();
      this._enabled = false; // v1.8.3: TTS停止も明示的停止
      this._forceIdleState();
    } else {
      this.startListening();
    }
  }

  /** 全マイクUIを確実にidle状態に戻す */
  _forceIdleState() {
    this._ui.updateMicState('idle');
    this._updateMeetingMicState('idle');
    this._ui.hideInterim();
  }

  /** 音声認識を開始 */
  startListening() {
    this._enabled = true;
    this._lastText = '';
    this._accumulatedText = '';
    this._clearSilenceTimer();
    this._stt.start({ language: 'ja-JP' });
  }

  /** 音声認識を停止 */
  stopListening() {
    this._clearSilenceTimer();
    this._stt.stop();
  }

  /** AI応答を声で再生する */
  async speakResponse(responseText, sisterId) {
    if (!this._enabled) return;
    await this._playback.speak(responseText, sisterId, { speed: this._speed });
  }

  /** 複数の姉妹の応答を順番に再生 */
  async speakQueue(items) {
    if (!this._enabled) return;
    await this._playback.speakQueue(items, { speed: this._speed });
  }

  /** 現在の姉妹IDを設定 */
  setCurrentSister(sisterId) { this._currentSisterId = sisterId; }

  /** 音声速度を設定（0.5〜1.5） */
  setSpeed(speed) {
    this._speed = Math.max(0.5, Math.min(1.5, speed));
    if (this._voiceCmd) this._voiceCmd.setSpeed(this._speed);
  }

  /** ハンズフリーモード切替 */
  setAutoListen(enabled) {
    this._autoListen = !!enabled;
    console.log(`[Voice] ハンズフリー: ${this._autoListen ? 'ON' : 'OFF'}`);
  }

  /** STTデバッグパネル表示切替 */
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
  // 送信処理はvoice-sender.js v1.0にmixin分離
  // VoiceController.prototypeに_sendVoiceMessage等を注入
  // ═══════════════════════════════════════════
}

// グローバルに公開
window.VoiceController = VoiceController;
window.voiceController = null;
