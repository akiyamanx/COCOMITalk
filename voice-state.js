// voice-state.js v1.0
// 音声入出力の単一状態機械（ステートマシン）＋ sessionID管理
// 全モジュール（voice-input / whisper-provider / voice-ui）はこのクラスを参照する
// 三姉妹会議決定: 「録音を止める」ではなく「このターンの入力を世界から無効にする」

// v1.0 新規作成 - 実装指示書 Step 1

/**
 * VoiceStateMachine
 * 音声入出力の状態を一元管理するステートマシン
 *
 * 状態一覧:
 *   idle             — 待機中（マイクOFF or 音声モードOFF）
 *   listening        — マイクON、音声認識中
 *   transcribing     — Whisper APIにデータ送信中（応答待ち）
 *   speaking         — TTS再生中
 *   recovering_input — TTS終了後、AudioContext復帰処理中
 *   blocked-needs-tap — 自動復旧失敗、ユーザータップ待ち
 *   error            — 致命的エラー
 *
 * sessionIDの役割:
 *   TTS開始時にインクリメントし、古いWhisper応答・タイマー発火を無効化する
 *   お姉ちゃんの設計思想: 「このターンの入力を世界から無効にする」
 */
class VoiceStateMachine {
  constructor() {
    // 現在の状態
    this._state = 'idle';
    // セッションID（TTS開始時にインクリメント）
    this._sessionId = 0;
    // 状態変更リスナー: (newState, prevState, sessionId) => void
    this._listeners = [];
    // 遷移中フラグ（リスナー内からのtransition循環を防止）
    this._transitioning = false;
    // デバッグログ蓄積
    this._debugLogs = [];
    // ログ出力有効フラグ
    this._debugEnabled = true;

    this._log('info', '初期化完了 — state=idle, sessionId=0');
  }

  // ═══════════════════════════════════════════
  // 許可される状態遷移マップ（設計書 1-2 準拠）
  // ═══════════════════════════════════════════

  /**
   * 各状態から許可される遷移先の一覧
   * 設計書で定義された遷移以外は全て拒否する
   * ※ error への遷移は全状態から許可（* → error）
   */
  static get TRANSITIONS() {
    return {
      'idle':              ['listening'],
      'listening':         ['transcribing', 'speaking', 'idle', 'error'],
      'transcribing':      ['speaking', 'listening', 'idle', 'error'],
      'speaking':          ['recovering_input', 'idle', 'error'],
      'recovering_input':  ['listening', 'blocked-needs-tap', 'error'],
      'blocked-needs-tap': ['recovering_input', 'listening', 'idle', 'error'],
      'error':             ['idle'],
    };
  }

  // ═══════════════════════════════════════════
  // 状態遷移
  // ═══════════════════════════════════════════

  /**
   * 状態遷移を試みる
   * 不正な遷移はログ出力のみで無視（アプリをクラッシュさせない）
   * @param {string} newState - 遷移先の状態
   * @returns {boolean} 遷移成功ならtrue
   */
  transition(newState) {
    // 同じ状態への遷移は無視（ログも出さない）
    if (this._state === newState) return true;

    // 遷移中の再帰呼び出し防止（リスナー内からtransitionを呼ぶ循環を防ぐ）
    if (this._transitioning) {
      this._log('warn', `遷移中に再帰呼び出し: ${this._state} → ${newState} ← キューイングせず無視`);
      return false;
    }

    // 許可チェック
    const allowed = VoiceStateMachine.TRANSITIONS[this._state];
    if (!allowed || !allowed.includes(newState)) {
      this._log('warn', `不正な遷移: ${this._state} → ${newState} ← 拒否`);
      return false;
    }

    // 遷移実行
    const prev = this._state;
    this._state = newState;
    this._log('info', `状態遷移: ${prev} → ${newState} [session=${this._sessionId}]`);

    // リスナー通知（遷移中フラグで二重遷移を防止）
    this._transitioning = true;
    try {
      for (const fn of this._listeners) {
        try {
          fn(newState, prev, this._sessionId);
        } catch (e) {
          this._log('error', `リスナーエラー: ${e.message}`);
        }
      }
    } finally {
      this._transitioning = false;
    }

    return true;
  }

  // ═══════════════════════════════════════════
  // sessionID管理
  // ═══════════════════════════════════════════

  /**
   * 新しいセッションを開始する（sessionIDをインクリメント）
   * TTS開始時 or 入力無効化タイミングで呼ぶ
   * 古いWhisper応答・タイマー発火はこのIDで無効化される
   * @returns {number} 新しいsessionId
   */
  newSession() {
    this._sessionId++;
    this._log('info', `新セッション開始: sessionId=${this._sessionId}`);
    return this._sessionId;
  }

  /**
   * 指定IDが現在のセッションと一致するかチェック
   * Whisper応答受信時・バッファ追記時・タイマー発火時に使う
   * @param {number} id - チェックするsessionId
   * @returns {boolean}
   */
  isCurrentSession(id) {
    return id === this._sessionId;
  }

  /**
   * 現在のsessionIdを取得
   * @returns {number}
   */
  getSessionId() {
    return this._sessionId;
  }

  // ═══════════════════════════════════════════
  // 状態取得（便利メソッド）
  // ═══════════════════════════════════════════

  /** 現在の状態を取得 */
  getState() {
    return this._state;
  }

  /** idle状態か */
  isIdle() {
    return this._state === 'idle';
  }

  /** listening状態か */
  isListening() {
    return this._state === 'listening';
  }

  /** transcribing状態か */
  isTranscribing() {
    return this._state === 'transcribing';
  }

  /** speaking状態か（TTS再生中）*/
  isSpeaking() {
    return this._state === 'speaking';
  }

  /** 復帰処理中か（recovering_input or blocked-needs-tap） */
  isRecovering() {
    return this._state === 'recovering_input' || this._state === 'blocked-needs-tap';
  }

  /** タップ待ちか */
  isBlockedNeedsTap() {
    return this._state === 'blocked-needs-tap';
  }

  /** エラー状態か */
  isError() {
    return this._state === 'error';
  }

  /** 入力を受け付けてよい状態か（listening or transcribing） */
  isInputAcceptable() {
    return this._state === 'listening' || this._state === 'transcribing';
  }

  // ═══════════════════════════════════════════
  // リスナー管理
  // ═══════════════════════════════════════════

  /**
   * 状態変更リスナーを登録
   * voice-input.jsの初期化時にUI同期用コールバックを登録する
   * @param {function} callback - (newState, prevState, sessionId) => void
   */
  onStateChange(callback) {
    if (typeof callback === 'function') {
      this._listeners.push(callback);
    }
  }

  /**
   * リスナーを全て解除
   */
  clearListeners() {
    this._listeners = [];
  }

  // ═══════════════════════════════════════════
  // リセット
  // ═══════════════════════════════════════════

  /**
   * 状態をidleにリセットする
   * エラーからの復帰や、音声モードOFF時に使う
   * 遷移ルールを無視して強制的にidleにする（緊急用）
   */
  forceReset() {
    const prev = this._state;
    this._state = 'idle';
    this._log('info', `強制リセット: ${prev} → idle [session=${this._sessionId}]`);
    // リスナー通知
    this._transitioning = true;
    try {
      for (const fn of this._listeners) {
        try { fn('idle', prev, this._sessionId); } catch (e) { /* 無視 */ }
      }
    } finally {
      this._transitioning = false;
    }
  }

  /**
   * 完全破棄（ページ離脱時等）
   */
  destroy() {
    this._listeners = [];
    this._state = 'idle';
    this._sessionId = 0;
    this._debugLogs = [];
    this._log('info', 'destroy完了');
  }

  // ═══════════════════════════════════════════
  // デバッグログ（設計書 1-12 準拠）
  // ═══════════════════════════════════════════

  /**
   * ログ出力（console + 内部蓄積）
   * 命名規約: debugLog(event, data) 形式（CLAUDE.md準拠）
   * @param {'info'|'warn'|'error'} level - ログレベル
   * @param {string} message - メッセージ
   * @param {*} data - 追加データ（省略可）
   */
  _log(level, message, data = null) {
    if (!this._debugEnabled && level === 'info') return;

    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const entry = `[${ts}][VoiceState][${level}] ${message}`;

    // コンソール出力
    if (level === 'error') {
      console.error(entry, data || '');
    } else if (level === 'warn') {
      console.warn(entry, data || '');
    } else {
      console.log(entry, data || '');
    }

    // 内部蓄積（最大100件、古いものから破棄）
    this._debugLogs.push({ ts, level, message, data });
    if (this._debugLogs.length > 100) this._debugLogs.shift();
  }

  /**
   * デバッグログ出力を有効/無効にする
   * @param {boolean} enabled
   */
  setDebugEnabled(enabled) {
    this._debugEnabled = !!enabled;
  }

  /**
   * 蓄積されたデバッグログを取得（デバッグパネル表示用）
   * @returns {Array}
   */
  getDebugLogs() {
    return [...this._debugLogs];
  }

  /**
   * 現在の状態サマリーを取得（デバッグ用）
   * @returns {object}
   */
  getDebugSummary() {
    return {
      state: this._state,
      sessionId: this._sessionId,
      listenerCount: this._listeners.length,
      logCount: this._debugLogs.length,
    };
  }
}

// ═══════════════════════════════════════════
// グローバル公開 + シングルトン
// ═══════════════════════════════════════════

window.VoiceStateMachine = VoiceStateMachine;
// シングルトンインスタンス（全モジュールが同じインスタンスを参照する）
window.voiceState = new VoiceStateMachine();
