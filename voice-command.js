// voice-command.js v1.2
// このファイルは音声コマンドの認識・実行を担当する
// voice-input.js から分離（500行制限対策＋責務分離）
// v1.0 新規作成 - Step 5e 音声コマンド対応（バグ修正版）
// v1.1 修正 - ひらがな/カタカナ揺れ対応強化＋部分一致緩和＋コマンド成功ログ改善
// v1.2 2026-03-12 - Step 6 Phase 1: 「覚えて」記憶保存コマンド追加

'use strict';

/**
 * VoiceCommand
 * 音声コマンドの認識と実行を一元管理する
 *
 * 使い方:
 *   const cmd = new VoiceCommand({ onStop, onResume, onSwitchSister, onSwitchGroup, onSpeedChange, onStatus });
 *   if (cmd.handle(sttText)) { // コマンド実行済み }
 */
class VoiceCommand {
  /**
   * @param {Object} callbacks - コマンド実行時のコールバック群
   * @param {Function} callbacks.onStop - 再生停止
   * @param {Function} callbacks.onResume - マイク再開
   * @param {Function} callbacks.onSwitchSister - 姉妹切替 (sisterKey, sisterName)
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

    // --- v1.2追加: 記憶保存コマンド ---
    if (this._matchSaveMemory(t)) {
      console.log('[VoiceCmd] 💾 記憶保存コマンド発動');
      this._cb.onSaveMemory?.();
      return true;
    }

    return false;
  }

  // ═══════════════════════════════════════════
  // テキスト正規化 v1.1強化
  // ═══════════════════════════════════════════

  /**
   * STT認識テキストを正規化する
   * - 句読点・記号を除去
   * - 全角スペース→除去
   * - 全角英数→半角英数
   * - v1.1追加: カタカナ長音「ー」のゆらぎ正規化
   * - スペースを全て除去
   */
  _normalize(text) {
    if (!text) return '';
    return text
      .trim()
      // 句読点・記号を除去（長音「ー」はカタカナ語で意味があるので残す）
      .replace(/[。、！？!?.，,：:；;…・～〜「」『』（）\(\)\[\]｛｝【】]+/g, '')
      // 全角スペース→半角
      .replace(/　/g, ' ')
      // 全角英数→半角
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      // スペースを全て除去（日本語コマンドではスペースは不要）
      .replace(/\s+/g, '')
      .trim();
  }

  // ═══════════════════════════════════════════
  // コマンドマッチング v1.1強化 - ひらがな/カタカナ揺れ対応
  // ═══════════════════════════════════════════

  /** 停止コマンド: 「ストップ」「止めて」「停止」「とめて」「やめて」「すとっぷ」 */
  _matchStop(t) {
    return /ストップ|すとっぷ|止めて|停止|とめて|やめて|ていし/.test(t);
  }

  /** マイク再開: 「もう一回」「もう1回」「もういっかい」「聞いて」「もう一度」 */
  _matchResume(t) {
    return /もう一回|もう1回|もういっかい|もういちど|もう一度|聞いて|きいて/.test(t);
  }

  /**
   * 姉妹切替: 「ここちゃん」「お姉ちゃん」「クロちゃん」＋語尾バリエーション
   * v1.1強化: STTのひらがな/カタカナ変換揺れに対応
   * @returns {{ key: string, name: string } | null}
   */
  _matchSisterSwitch(t) {
    const sisters = [
      { patterns: ['ここちゃん', 'ココちゃん', 'ココチャン'], key: 'koko', name: 'ここちゃん' },
      { patterns: ['お姉ちゃん', 'おねえちゃん', 'おねーちゃん', 'オネエチャン'], key: 'gpt', name: 'お姉ちゃん' },
      { patterns: ['クロちゃん', 'くろちゃん', 'くろちやん', 'クロチャン', 'くろちゃーん'], key: 'claude', name: 'クロちゃん' },
    ];

    // v1.1: 切替を示す語尾パターン
    const switchSuffixes = /^(にして|に切り替え|に替えて|に変えて|にかえて|にきりかえ|にきりかえて|お願い|おねがい|にかわって|に代わって|にチェンジ|にちぇんじ)/;

    for (const sister of sisters) {
      for (const pattern of sister.patterns) {
        if (t === pattern || t.startsWith(pattern)) {
          const suffix = t.slice(pattern.length);
          // 名前のみ or 名前+切替系語尾の場合だけコマンド扱い
          // 「ここちゃんおはよう」みたいな普通の呼びかけは除外
          if (suffix === '' || switchSuffixes.test(suffix)) {
            return { key: sister.key, name: sister.name };
          }
        }
      }
    }
    return null;
  }

  /** グループモード: 「みんな」「グループ」「全員」「みんなで」「ぐるーぷ」 */
  _matchGroup(t) {
    return /^(みんな|グループ|ぐるーぷ|ぐループ|全員|みんなで|ぜんいん|みんなで(話そう|はなそう|やろう))$/.test(t);
  }

  /**
   * スピードアップ v1.1強化
   * STTの認識揺れ: 「スピードアップ」→「スピード アップ」「すぴーどあっぷ」等
   * 正規化でスペース除去済みなので、ひらがなパターンを追加
   */
  _matchSpeedUp(t) {
    return /速く|早く|はやく|スピードアップ|すぴーどあっぷ|スピードup|speedup|はやくして/.test(t);
  }

  /** スピードダウン v1.1強化: ひらがなパターン追加 */
  _matchSpeedDown(t) {
    return /遅く|ゆっくり|おそく|スピードダウン|すぴーどだうん|スピードdown|speeddown|ゆっくりして|おそくして/.test(t);
  }

  /** v1.2追加: 記憶保存コマンド「覚えて」「セーブ」等 */
  _matchSaveMemory(t) {
    return /覚えて|おぼえて|記憶して|きおくして|セーブ|せーぶ|save/.test(t);
  }
}

// グローバルに公開
window.VoiceCommand = VoiceCommand;
