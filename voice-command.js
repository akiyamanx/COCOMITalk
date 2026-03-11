// voice-command.js v1.0
// このファイルは音声コマンドの認識・実行を担当する
// voice-input.js から分離（500行制限対策＋責務分離）
// v1.0 新規作成 - Step 5e 音声コマンド対応（バグ修正版）
//   - 正規表現を完全一致→部分一致に緩和
//   - STT認識テキストの正規化を強化（句読点・スペース・全角半角）
//   - デバッグログ追加（認識テキストを必ず出力）

'use strict';

/**
 * VoiceCommand
 * 音声コマンドの認識と実行を一元管理する
 *
 * 使い方:
 *   const cmd = new VoiceCommand({ onStop, onResume, onSwitchSister, onSwitchGroup, onSpeedChange, onStatus });
 *   if (cmd.handle(sttText)) { /* コマンド実行済み */ }
 */
class VoiceCommand {
  /**
   * @param {Object} callbacks - コマンド実行時のコールバック群
   * @param {Function} callbacks.onStop - 再生停止
   * @param {Function} callbacks.onResume - マイク再開
   * @param {Function} callbacks.onSwitchSister - 姉妹切替 (sisterKey)
   * @param {Function} callbacks.onSwitchGroup - グループモード切替
   * @param {Function} callbacks.onSpeedChange - 速度変更 (newSpeed)
   * @param {Function} callbacks.onStatus - ステータス表示 (message, type)
   */
  constructor(callbacks = {}) {
    this._cb = callbacks;
    this._speed = 1.0;
  }

  /** 現在の速度を外部から設定（voice-input.jsと同期用） */
  setSpeed(speed) { this._speed = speed; }
  /** 現在の速度を取得 */
  getSpeed() { return this._speed; }

  /**
   * STTテキストが音声コマンドか判定し、コマンドなら実行してtrueを返す
   * @param {string} rawText - STTの認識テキスト（生の状態）
   * @returns {boolean} コマンドだったらtrue
   */
  handle(rawText) {
    // === 正規化処理 ===
    // STTが付ける句読点・記号・スペースを除去
    const t = this._normalize(rawText);
    console.log(`[VoiceCmd] 正規化前: "${rawText}" → 正規化後: "${t}"`);

    if (t.length < 1 || t.length > 30) return false;

    // --- 停止コマンド ---
    if (this._matchStop(t)) {
      console.log('[VoiceCmd] ⏹️ 停止コマンド発動');
      this._cb.onStop?.();
      this._cb.onStatus?.('⏹️ 再生を停止しました', 'info');
      return true;
    }

    // --- マイク再開コマンド ---
    if (this._matchResume(t)) {
      console.log('[VoiceCmd] 🎤 マイク再開コマンド発動');
      this._cb.onResume?.();
      return true;
    }

    // --- 姉妹切替コマンド ---
    const sisterResult = this._matchSisterSwitch(t);
    if (sisterResult) {
      console.log(`[VoiceCmd] 🔄 姉妹切替: ${sisterResult.name} (${sisterResult.key})`);
      this._cb.onSwitchSister?.(sisterResult.key, sisterResult.name);
      return true;
    }

    // --- グループモード切替コマンド ---
    if (this._matchGroup(t)) {
      console.log('[VoiceCmd] 👥 グループモード切替');
      this._cb.onSwitchGroup?.();
      return true;
    }

    // --- スピードアップコマンド ---
    if (this._matchSpeedUp(t)) {
      this._speed = Math.min(1.5, this._speed + 0.25);
      console.log(`[VoiceCmd] ⏩ スピードアップ: ${this._speed}x`);
      this._cb.onSpeedChange?.(this._speed);
      this._cb.onStatus?.(`⏩ 速度: ${this._speed}x`, 'info');
      return true;
    }

    // --- スピードダウンコマンド ---
    if (this._matchSpeedDown(t)) {
      this._speed = Math.max(0.5, this._speed - 0.25);
      console.log(`[VoiceCmd] ⏪ スピードダウン: ${this._speed}x`);
      this._cb.onSpeedChange?.(this._speed);
      this._cb.onStatus?.(`⏪ 速度: ${this._speed}x`, 'info');
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════
  // テキスト正規化
  // ═══════════════════════════════════════════

  /**
   * STT認識テキストを正規化する
   * - 句読点・記号を除去
   * - 全角スペース→半角スペース→除去
   * - 全角英数→半角英数
   * - 前後の空白除去
   */
  _normalize(text) {
    if (!text) return '';
    return text
      .trim()
      // 句読点・記号を除去
      .replace(/[。、！？!?.，,：:；;…・～〜「」『』（）\(\)\[\]｛｝【】]+/g, '')
      // 全角スペース→半角
      .replace(/　/g, ' ')
      // 全角英数→半角（カタカナはそのまま）
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      // スペースを除去（日本語コマンドではスペースは不要）
      .replace(/\s+/g, '')
      .trim();
  }

  // ═══════════════════════════════════════════
  // コマンドマッチング（全て部分一致に緩和）
  // ═══════════════════════════════════════════

  /** 停止コマンド: 「ストップ」「止めて」「停止」「とめて」「やめて」 */
  _matchStop(t) {
    return /ストップ|止めて|停止|とめて|やめて/.test(t);
  }

  /** マイク再開: 「もう一回」「もう1回」「もういっかい」「聞いて」 */
  _matchResume(t) {
    return /もう一回|もう1回|もういっかい|聞いて|きいて/.test(t);
  }

  /**
   * 姉妹切替: 「ここちゃん」「お姉ちゃん」「クロちゃん」＋語尾バリエーション
   * @returns {{ key: string, name: string } | null}
   */
  _matchSisterSwitch(t) {
    const sisters = [
      { patterns: ['ここちゃん'], key: 'koko', name: 'ここちゃん' },
      { patterns: ['お姉ちゃん', 'おねえちゃん', 'おねーちゃん'], key: 'gpt', name: 'お姉ちゃん' },
      { patterns: ['クロちゃん', 'くろちゃん', 'くろちやん'], key: 'claude', name: 'クロちゃん' },
    ];

    for (const sister of sisters) {
      for (const pattern of sister.patterns) {
        // 名前だけ or 名前+語尾（にして、に切り替え、に変えて等）
        if (t === pattern || t.startsWith(pattern)) {
          // ただし「ここちゃんおはよう」みたいな普通の呼びかけは除外
          // → 名前のみ or 名前+切替系語尾の場合だけコマンド扱い
          const suffix = t.slice(pattern.length);
          if (suffix === '' ||
              /^(にして|に切り替え|に替えて|に変えて|にかえて|にきりかえ|お願い|おねがい)/.test(suffix)) {
            return { key: sister.key, name: sister.name };
          }
        }
      }
    }
    return null;
  }

  /** グループモード: 「みんな」「グループ」「全員」「みんなで」 */
  _matchGroup(t) {
    return /^(みんな|グループ|全員|みんなで|ぜんいん)$/.test(t) ||
           /みんなで(話そう|はなそう|やろう)/.test(t);
  }

  /** スピードアップ: 「速く」「早く」「スピードアップ」「はやく」 */
  _matchSpeedUp(t) {
    return /速く|早く|はやく|スピードアップ|speedup/.test(t);
  }

  /** スピードダウン: 「遅く」「ゆっくり」「スピードダウン」「おそく」 */
  _matchSpeedDown(t) {
    return /遅く|ゆっくり|おそく|スピードダウン|speeddown/.test(t);
  }
}

// グローバルに公開
window.VoiceCommand = VoiceCommand;
