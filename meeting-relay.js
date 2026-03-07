// COCOMITalk - 会議リレー制御
// このファイルは三姉妹が順番にAPIを呼び出すリレー会話のエンジン
// v0.8 Step 3 - 新規作成

'use strict';

/**
 * 会議リレーモジュール
 * - 動的ルーティングで決まった順番に三姉妹がリレー発言
 * - 前の姉妹の発言を次に渡す（文脈の積み重ね）
 * - 最大3ラウンド（安全ガイド準拠: 無限ループ防止）
 * - 各発言ごとにMeetingUIに表示＋トークン記録
 */
const MeetingRelay = (() => {

  // --- 安全ガイド: ラウンド上限 ---
  const MAX_ROUNDS = 3;

  // --- 姉妹情報 ---
  const SISTERS = {
    koko: {
      name: 'ここちゃん',
      emoji: '🌸',
      api: () => (typeof ApiGemini !== 'undefined') ? ApiGemini : null,
      prompt: () => (typeof KokoSystemPrompt !== 'undefined') ? KokoSystemPrompt.getPrompt('meeting') : '',
    },
    gpt: {
      name: 'お姉ちゃん',
      emoji: '🌙',
      api: () => (typeof ApiOpenAI !== 'undefined') ? ApiOpenAI : null,
      prompt: () => (typeof GptSystemPrompt !== 'undefined') ? GptSystemPrompt.getPrompt('meeting') : '',
    },
    claude: {
      name: 'クロちゃん',
      emoji: '🔮',
      api: () => (typeof ApiClaude !== 'undefined') ? ApiClaude : null,
      prompt: () => (typeof ClaudeSystemPrompt !== 'undefined') ? ClaudeSystemPrompt.getPrompt('meeting') : '',
    },
  };

  // --- 状態 ---
  let isRunning = false;
  let currentRound = 0;
  let meetingHistory = [];
  let abortRequested = false;

  /**
   * 会議を開始する
   * @param {string} topic - アキヤの議題
   * @param {Object} routing - MeetingRouter.analyzeTopic()の結果
   * @returns {Promise<Object>} 会議結果 { rounds, history, routing }
   */
  async function startMeeting(topic, routing) {
    if (isRunning) {
      console.warn('[MeetingRelay] 会議は既に進行中');
      return null;
    }

    isRunning = true;
    abortRequested = false;
    currentRound = 0;
    meetingHistory = [];

    const order = routing.order;
    const lead = routing.lead;

    // 会議UIに議題分析結果を表示
    if (typeof MeetingUI !== 'undefined') {
      MeetingUI.showRoutingResult(routing);
    }

    try {
      // ラウンド1は必ず実行
      await _runRound(topic, order, lead, 1);

      // ラウンド2以降はアキヤの判断 or 自動
      // 今は1ラウンドで完了（将来: 合意確認＋追加ラウンド）

      console.log(`[MeetingRelay] 会議完了: ${currentRound}ラウンド`);
      return { rounds: currentRound, history: meetingHistory, routing };

    } catch (error) {
      console.error('[MeetingRelay] 会議エラー:', error);
      if (typeof MeetingUI !== 'undefined') {
        MeetingUI.addSystemMessage(`会議中にエラーが発生しました: ${error.message}`);
      }
      return null;

    } finally {
      isRunning = false;
    }
  }

  /**
   * 1ラウンドの実行（三姉妹全員が順に発言）
   */
  async function _runRound(topic, order, lead, roundNum) {
    if (abortRequested) return;
    currentRound = roundNum;

    if (typeof MeetingUI !== 'undefined') {
      MeetingUI.addSystemMessage(`--- ラウンド ${roundNum} ---`);
    }

    for (let i = 0; i < order.length; i++) {
      if (abortRequested) break;

      const sisterKey = order[i];
      const sister = SISTERS[sisterKey];
      const isLead = (sisterKey === lead);

      // タイピングインジケーター表示
      if (typeof MeetingUI !== 'undefined') {
        MeetingUI.showTyping(sisterKey);
      }

      try {
        // API呼び出し
        const reply = await _callSisterAPI(sisterKey, topic, isLead, roundNum);

        // タイピング消去＋メッセージ表示
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.hideTyping();
          MeetingUI.addSisterMessage(sisterKey, reply, isLead);
        }

        // 履歴に追加（次の姉妹が参照できるように）
        meetingHistory.push({
          round: roundNum,
          sister: sisterKey,
          name: sister.name,
          isLead,
          content: reply,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.hideTyping();
          MeetingUI.addSisterMessage(sisterKey,
            `ごめん、通信エラーだった…💦（${error.message}）`, isLead);
        }
        console.error(`[MeetingRelay] ${sister.name}のAPI呼び出しエラー:`, error);
      }
    }
  }

  /**
   * 個別の姉妹APIを呼び出す
   */
  async function _callSisterAPI(sisterKey, topic, isLead, roundNum) {
    const sister = SISTERS[sisterKey];
    const apiModule = sister.api();

    if (!apiModule || !apiModule.hasApiKey()) {
      return `（${sister.name}はAPI未接続です。設定画面で認証トークンを設定してください）`;
    }

    // 会議用システムプロンプト
    const systemPrompt = sister.prompt();

    // 主担当の追加指示
    const leadInstruction = isLead
      ? '\n\n【重要】この議題ではあなたが主担当です。自分の専門領域の視点から深く分析し、具体的な提案を主導してください。他の姉妹の補助を待たず、まず自分の見解を詳しく述べてください。'
      : '\n\n【参考】この議題では別の姉妹が主担当です。あなたは自分の専門領域の視点から補足・チェック・別角度の意見を提供してください。';

    // 会話履歴を構築（前の姉妹の発言を含む）
    const history = _buildMeetingContext(topic, roundNum);

    // モデルキー取得（ModeSwitcherから）
    const modelKey = (typeof ModeSwitcher !== 'undefined')
      ? ModeSwitcher.getModelKey(sisterKey)
      : undefined;

    // API呼び出し
    const reply = await apiModule.sendMessage(
      `【会議議題】${topic}`,
      systemPrompt + leadInstruction,
      history,
      { model: modelKey }
    );

    return reply;
  }

  /**
   * 会議コンテキストを構築（前の姉妹の発言を履歴として渡す）
   */
  function _buildMeetingContext(topic, roundNum) {
    const context = [];

    // 現在ラウンドの前の発言を追加
    const currentRoundMessages = meetingHistory.filter(m => m.round === roundNum);
    for (const msg of currentRoundMessages) {
      const sister = SISTERS[msg.sister];
      const leadMark = msg.isLead ? '【主担当】' : '';
      context.push({
        role: 'assistant',
        content: `${sister.emoji}${sister.name}${leadMark}:\n${msg.content}`,
      });
    }

    return context;
  }

  /**
   * 追加ラウンドを実行
   * @param {string} followUp - アキヤの追加指示/質問
   * @param {Object} routing - 最初のルーティング結果
   */
  async function continueRound(followUp, routing) {
    if (!isRunning && currentRound > 0) {
      isRunning = true;
      const nextRound = currentRound + 1;

      if (nextRound > MAX_ROUNDS) {
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.addSystemMessage(
            `最大${MAX_ROUNDS}ラウンドに達しました。新しい会議を始めてください。`);
        }
        isRunning = false;
        return null;
      }

      try {
        await _runRound(followUp, routing.order, routing.lead, nextRound);
        return { rounds: currentRound, history: meetingHistory };
      } finally {
        isRunning = false;
      }
    }
    return null;
  }

  /**
   * 会議を中断
   */
  function abort() {
    abortRequested = true;
    console.log('[MeetingRelay] 会議中断リクエスト');
  }

  /**
   * 現在の会議履歴を取得
   */
  function getHistory() {
    return [...meetingHistory];
  }

  /**
   * 進行中かどうか
   */
  function getIsRunning() {
    return isRunning;
  }

  /**
   * 現在のラウンド数
   */
  function getCurrentRound() {
    return currentRound;
  }

  return {
    startMeeting,
    continueRound,
    abort,
    getHistory,
    getIsRunning,
    getCurrentRound,
    MAX_ROUNDS,
  };
})();
