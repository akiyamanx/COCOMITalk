// COCOMITalk - 会議リレー制御
// このファイルは三姉妹が順番にAPIを呼び出すリレー会話のエンジン
// v0.8 Step 3 - 新規作成
// v1.0 Step 3.5 - MeetingHistory連携（リアルタイムIndexedDB保存）
// v1.1 2026-03-09 - restoreFromDB()追加（セッション復元用）
//                  - _buildMeetingContext()全ラウンド対応（ラウンド2以降のコンテキスト引継ぎ）
// v1.2 2026-03-09 - ラウンド2以降に元議題＋フォローアップを両方渡すように修正
//                  - originalTopic保持でcontinueRound時のコンテキスト欠落を解消
// v1.3 2026-03-10 - Step 5c: ラウンド完了後にTTSキュー再生（パターンB方式）
// v1.4 2026-03-10 - Step 4: ラウンド完了時にMeetingMemory.autoSaveFromMeeting()呼び出し
// v1.5 2026-03-11 - 他の姉妹の発言をuser roleで渡す（assistant混同＝なりすまし防止）

'use strict';

/**
 * 会議リレーモジュール
 * - 動的ルーティングで決まった順番に三姉妹がリレー発言
 * - 前の姉妹の発言を次に渡す（文脈の積み重ね）
 * - 最大3ラウンド（安全ガイド準拠: 無限ループ防止）
 * - 各発言ごとにMeetingUIに表示＋トークン記録
 * - v1.0: 各発言ごとにMeetingHistoryにリアルタイム保存
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
  // v1.0追加 - 現在の会議ID（MeetingHistory用）
  let currentMeetingId = null;
  // v1.2追加 - 元の議題を保持（ラウンド2以降で参照）
  let originalTopic = '';
  // v1.4追加 - Step 4: 会議メモリーのプロンプト注入テキスト
  let _memoryPrompt = '';

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
    originalTopic = topic; // v1.2追加

    const order = routing.order;
    const lead = routing.lead;

    // v1.0追加 - MeetingHistoryにレコード作成
    try {
      if (typeof MeetingHistory !== 'undefined') {
        currentMeetingId = await MeetingHistory.createMeeting(topic, routing);
        // アキヤの議題も保存
        await MeetingHistory.addUserEntry(currentMeetingId, topic, 1);
        console.log(`[MeetingRelay] 会議ID: ${currentMeetingId}`);
      }
    } catch (e) {
      console.warn('[MeetingRelay] 会議履歴作成エラー（続行）:', e);
    }

    // 会議UIに議題分析結果を表示
    if (typeof MeetingUI !== 'undefined') {
      MeetingUI.showRoutingResult(routing);
    }

    // v1.4追加 - Step 4: KVから過去の記憶を取得してプロンプト注入用に保持
    _memoryPrompt = '';
    if (typeof MeetingMemory !== 'undefined') {
      try {
        _memoryPrompt = await MeetingMemory.getMemoryPrompt(5);
        if (_memoryPrompt) console.log('[MeetingRelay] メモリー注入準備OK');
      } catch (e) {
        console.warn('[MeetingRelay] メモリー取得エラー（続行）:', e);
      }
    }

    try {
      // ラウンド1は必ず実行
      await _runRound(topic, order, lead, 1);

      // v1.0追加 - 会議完了ステータスに更新
      _updateMeetingStatus('completed');

      // v1.4追加 - Step 4: 会議記憶をKVに自動保存
      if (typeof MeetingMemory !== 'undefined') {
        MeetingMemory.autoSaveFromMeeting(topic, meetingHistory, routing)
          .catch(e => console.warn('[MeetingRelay] メモリー保存エラー（続行）:', e));
      }

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
        const entry = {
          round: roundNum,
          sister: sisterKey,
          name: sister.name,
          isLead,
          content: reply,
          timestamp: new Date().toISOString(),
        };
        meetingHistory.push(entry);

        // v1.0追加 - MeetingHistoryにリアルタイム保存
        _saveEntryToHistory(entry);

      } catch (error) {
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.hideTyping();
          MeetingUI.addSisterMessage(sisterKey,
            `ごめん、通信エラーだった…💦（${error.message}）`, isLead);
        }
        console.error(`[MeetingRelay] ${sister.name}のAPI呼び出しエラー:`, error);
      }
    }

    // v1.3追加 - ラウンド完了後にTTSキュー再生（パターンB: まとめて再生）
    _speakRoundEntries(roundNum);
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
    // v1.1修正 - maxTokens:6144に増加（会議は長文発言＋コード例が必要）
    // v1.4追加 - メモリープロンプトをシステムプロンプトに注入
    const fullPrompt = systemPrompt + leadInstruction + _memoryPrompt;
    const reply = await apiModule.sendMessage(
      `【会議議題】${topic}`,
      fullPrompt,
      history,
      { model: modelKey, maxTokens: 6144 }
    );

    return reply;
  }

  /**
   * 会議コンテキストを構築（前の姉妹の発言を履歴として渡す）
   * v1.1修正 - 全ラウンドの履歴を含める（ラウンド2以降で前の内容が渡るように）
   */
  function _buildMeetingContext(topic, roundNum) {
    const context = [];

    for (const msg of meetingHistory) {
      const sister = SISTERS[msg.sister];
      if (!sister) continue; // userエントリはスキップ
      const leadMark = msg.isLead ? '【主担当】' : '';

      // v1.5修正 - 他の姉妹の発言はuser roleで渡す（assistant混同防止）
      // これにより各APIが「自分以外の発言」として正しく認識する
      if (msg.round < roundNum) {
        // 過去ラウンド: 先頭200文字に切り詰め（トークン節約）
        const truncated = msg.content.length > 200
          ? msg.content.slice(0, 200) + '…（省略）'
          : msg.content;
        context.push({
          role: 'user',
          content: `[ラウンド${msg.round}] ${sister.emoji}${sister.name}${leadMark}の発言:\n${truncated}`,
        });
      } else if (msg.round === roundNum) {
        // 現在ラウンド: 全文
        context.push({
          role: 'user',
          content: `${sister.emoji}${sister.name}${leadMark}の発言:\n${msg.content}`,
        });
      }
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

      // v1.0追加 - アキヤの追加指示をMeetingHistoryに保存
      if (currentMeetingId && typeof MeetingHistory !== 'undefined') {
        try {
          await MeetingHistory.addUserEntry(currentMeetingId, followUp, nextRound);
          // ステータスをin_progressに戻す
          await MeetingHistory.updateStatus(currentMeetingId, 'in_progress');
        } catch (e) {
          console.warn('[MeetingRelay] 追加指示保存エラー（続行）:', e);
        }
      }

      try {
        // v1.2修正 - 元の議題＋フォローアップを組み合わせて渡す
        const combinedTopic = `${originalTopic}\n\n【追加指示（ラウンド${nextRound}）】${followUp}`;
        await _runRound(combinedTopic, routing.order, routing.lead, nextRound);
        // v1.0追加 - 追加ラウンド完了
        _updateMeetingStatus('completed');

        // v1.4追加 - Step 4: 追加ラウンド後もKVメモリー更新
        if (typeof MeetingMemory !== 'undefined') {
          MeetingMemory.autoSaveFromMeeting(originalTopic, meetingHistory, routing)
            .catch(e => console.warn('[MeetingRelay] メモリー更新エラー（続行）:', e));
        }
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

  /**
   * v1.0追加 - 現在の会議ID
   */
  function getCurrentMeetingId() {
    return currentMeetingId;
  }

  /**
   * v1.3追加 - ラウンドの全発言をTTSキュー再生（パターンB方式）
   * 音声モードが有効な場合のみ再生。chat-group.jsと同じspeakQueue()を使用
   * @param {number} roundNum - 対象ラウンド番号
   */
  function _speakRoundEntries(roundNum) {
    if (!window.voiceController || !window.voiceController.isEnabled()) return;
    // 今ラウンドの発言を抽出
    const roundEntries = meetingHistory.filter(m => m.round === roundNum && m.sister !== 'user');
    if (roundEntries.length === 0) return;
    const queueItems = roundEntries.map(entry => ({
      text: entry.content,
      sisterId: entry.sister,
    }));
    console.log(`[MeetingRelay] ラウンド${roundNum} TTS再生: ${queueItems.length}人分`);
    window.voiceController.speakQueue(queueItems);
  }

  /**
   * v1.0追加 - MeetingHistoryに発言を非同期保存（エラーでも会議は止めない）
   */
  function _saveEntryToHistory(entry) {
    if (!currentMeetingId || typeof MeetingHistory === 'undefined') return;
    MeetingHistory.addEntry(currentMeetingId, entry).catch(e => {
      console.warn('[MeetingRelay] 発言保存エラー（続行）:', e);
    });
  }

  /**
   * v1.0追加 - 会議ステータスを更新（エラーでも止めない）
   */
  function _updateMeetingStatus(status) {
    if (!currentMeetingId || typeof MeetingHistory === 'undefined') return;
    MeetingHistory.updateStatus(currentMeetingId, status).catch(e => {
      console.warn('[MeetingRelay] ステータス更新エラー（続行）:', e);
    });
  }

  /**
   * v1.1追加 - IndexedDBから会議状態を復元（ページ再読み込み後の再開用）
   * @param {Object} meeting - MeetingHistory.getMeeting()の結果
   * @returns {Object|null} 復元されたルーティング情報
   */
  function restoreFromDB(meeting) {
    if (!meeting || !meeting.routing) {
      console.warn('[MeetingRelay] 復元データが不正');
      return null;
    }

    // 状態を復元（userエントリを除外してmeetingHistoryに入れる）
    meetingHistory = (meeting.history || []).filter(m => m.sister !== 'user');
    currentMeetingId = meeting.id;
    currentRound = _detectMaxRound(meeting.history);
    originalTopic = meeting.topic || ''; // v1.2追加
    isRunning = false;
    abortRequested = false;

    console.log(`[MeetingRelay] 会議復元: ${meeting.id}, ラウンド${currentRound}, 発言${meetingHistory.length}件, 議題: ${originalTopic.slice(0, 30)}...`);
    return meeting.routing;
  }

  /**
   * v1.1追加 - 履歴から最大ラウンド番号を検出
   */
  function _detectMaxRound(history) {
    if (!history || history.length === 0) return 0;
    return Math.max(...history.map(m => m.round || 1));
  }

  return {
    startMeeting,
    continueRound,
    abort,
    getHistory,
    getIsRunning,
    getCurrentRound,
    getCurrentMeetingId,
    restoreFromDB,
    MAX_ROUNDS,
  };
})();
