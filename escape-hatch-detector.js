// escape-hatch-detector.js v1.0
// このファイルはワイワイモード中のエスケープハッチ（一時的詳細モード）を検出する
// 「詳しく教えて」「解説して」等のトリガーワードを検知し、
// その1回だけ通常モード相当の丁寧さで回答させる
// モード自体は切り替えない（次のメッセージからまたワイワイに戻る）
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 2+3統合）
'use strict';

const EscapeHatchDetector = (() => {

  // --- トリガーワード定義 ---
  // 「詳しく」「解説」「説明」系のワードを検出
  // 部分一致で判定（ユーザーの自然な言い回しに対応）
  const TRIGGER_PATTERNS = [
    /詳しく/,
    /くわしく/,
    /解説して/,
    /説明して/,
    /教えて/,
    /もっと知りたい/,
    /深掘り/,
    /具体的に/,
    /ちゃんと教えて/,
    /しっかり教えて/,
    /丁寧に/,
    /ていねいに/,
    /長めに/,
    /じっくり/,
    /ちゃんと説明/,
    /詳細/,
  ];

  // エスケープハッチを無視するパターン（誤検出防止）
  // 例: 「詳しくは知らないけど」→ 詳細を求めてるわけではない
  const IGNORE_PATTERNS = [
    /詳しくは(知らない|わからない|分からない)/,
    /詳しくない/,
    /詳しいことは/,
  ];

  // 一時解除フラグ（1回だけ有効）
  let _escapeActive = false;

  /**
   * ユーザーのメッセージにエスケープハッチトリガーが含まれるか検出
   * @param {string} userText - ユーザーの入力テキスト
   * @returns {boolean} トリガーが検出された場合true
   */
  function detect(userText) {
    if (!userText || typeof userText !== 'string') return false;

    // 無視パターンに該当したらfalse
    for (const ignore of IGNORE_PATTERNS) {
      if (ignore.test(userText)) return false;
    }

    // トリガーパターンに該当したらtrue
    for (const trigger of TRIGGER_PATTERNS) {
      if (trigger.test(userText)) {
        console.log(`[EscapeHatch] トリガー検出: "${userText}" → 一時的にじっくりモード`);
        _escapeActive = true;
        return true;
      }
    }

    return false;
  }

  /**
   * エスケープハッチが有効かチェックし、チェック後にリセットする
   * （1回限りの使い捨て。呼び出した時点でフラグが消える）
   * @returns {boolean} エスケープハッチが有効だった場合true
   */
  function consumeEscape() {
    if (_escapeActive) {
      _escapeActive = false;
      console.log('[EscapeHatch] エスケープ消費 → 次のメッセージからワイワイに戻る');
      return true;
    }
    return false;
  }

  /**
   * エスケープハッチが有効かどうか（消費せずに確認）
   * @returns {boolean}
   */
  function isActive() {
    return _escapeActive;
  }

  /**
   * 強制リセット（モード切替時など）
   */
  function reset() {
    _escapeActive = false;
  }

  return {
    detect,
    consumeEscape,
    isActive,
    reset,
  };
})();
