// COCOMITalk - 会議リレー制御（三姉妹が順番にAPIを呼び出すリレー会話のエンジン）
// v0.8〜v1.5 初期作成〜なりすまし防止 / v1.7 PromptBuilder共通化
// v1.8-1.9 ファイル添付対応 / v2.0 会議グレード3段階 / v2.1 APIリトライ / v2.2 Vectorize議題検索
// v2.3 エラー日本語化+致命的エラー判定（B案: クレジット切れ等は即停止）

'use strict';

/**
 * 会議リレーモジュール
 * - 動的ルーティングで決まった順番に三姉妹がリレー発言
 * - 前の姉妹の発言を次に渡す（文脈の積み重ね）
 * - 最大3ラウンド（安全ガイド準拠） / v2.1: 失敗時に最大2回リトライ（指数バックオフ）
 */
const MeetingRelay = (() => {

  // --- 安全ガイド: ラウンド上限 ---
  const MAX_ROUNDS = 3;

  // --- 姉妹情報 ---
  // v2.0改修 - prompt()に会議グレード引数を追加（meeting-lite/meeting/meeting-full）
  const SISTERS = {
    koko: {
      name: 'ここちゃん',
      emoji: '🌸',
      api: () => (typeof ApiGemini !== 'undefined') ? ApiGemini : null,
      prompt: (grade) => (typeof KokoSystemPrompt !== 'undefined') ? KokoSystemPrompt.getPrompt(grade || 'meeting') : '',
    },
    gpt: {
      name: 'お姉ちゃん',
      emoji: '🌙',
      api: () => (typeof ApiOpenAI !== 'undefined') ? ApiOpenAI : null,
      prompt: (grade) => (typeof GptSystemPrompt !== 'undefined') ? GptSystemPrompt.getPrompt(grade || 'meeting') : '',
    },
    claude: {
      name: 'クロちゃん',
      emoji: '🔮',
      api: () => (typeof ApiClaude !== 'undefined') ? ApiClaude : null,
      prompt: (grade) => (typeof ClaudeSystemPrompt !== 'undefined') ? ClaudeSystemPrompt.getPrompt(grade || 'meeting') : '',
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
  // v1.8追加 - 会議用添付ファイル（#73）/ v1.9改修 - 複数ファイル対応
  let _currentAttachments = null;
  // v2.0追加 - 現在の会議グレード（meeting-lite/meeting/meeting-full）
  let _meetingGrade = 'meeting';

  /** 会議を開始する（topic=議題, routing=分析結果, attachments=添付, meetingGrade=グレード） */
  async function startMeeting(topic, routing, attachments, meetingGrade) {
    if (isRunning) {
      console.warn('[MeetingRelay] 会議は既に進行中');
      return null;
    }

    isRunning = true;
    abortRequested = false;
    currentRound = 0;
    meetingHistory = [];
    originalTopic = topic; // v1.2追加
    _currentAttachments = attachments || null; // v1.9改修 - 複数ファイル対応
    // v2.0追加 - 会議グレード設定（デフォルトは通常会議）
    _meetingGrade = meetingGrade || 'meeting';
    console.log(`[MeetingRelay] 会議グレード: ${_meetingGrade}`);

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

    // v1.7改修 - PromptBuilderで事前メモリー取得 + v2.2追加 - Vectorize議題検索
    _memoryPrompt = '';
    if (typeof PromptBuilder !== 'undefined') {
      try {
        _memoryPrompt = await PromptBuilder.preloadMemory(5);
        // v2.2追加 - 議題テキストでVectorize検索し過去の関連記憶を注入
        const vectorPrompt = await PromptBuilder.preloadVectorSearch(topic, 3);
        if (vectorPrompt) _memoryPrompt += vectorPrompt;
        if (_memoryPrompt) console.log('[MeetingRelay] メモリー+Vectorize注入準備OK');
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

  /** 1ラウンドの実行（三姉妹全員が順に発言） */
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
        // v2.0追加 - API呼び出し（リトライ機構付き、最大2回リトライ＝計3回試行）
        const MAX_RETRIES = 2;
        let reply = null;
        let lastError = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            reply = await _callSisterAPI(sisterKey, topic, isLead, roundNum);
            break; // 成功したらループ抜ける
          } catch (e) {
            lastError = e;
            // v2.3追加 - 致命的エラー（クレジット切れ等）はリトライしない
            if (_isFatalError(e.message)) {
              console.error(`[MeetingRelay] ${sister.name} 致命的エラー（リトライ不可）:`, e.message);
              break;
            }
            if (attempt < MAX_RETRIES) {
              const wait = 1000 * (attempt + 1);
              console.warn(`[MeetingRelay] ${sister.name} リトライ${attempt + 1}/${MAX_RETRIES}（${wait}ms待機）:`, e.message);
              if (typeof MeetingUI !== 'undefined') {
                MeetingUI.addSystemMessage(`${sister.emoji}${sister.name} 通信エラー…リトライ中(${attempt + 1}/${MAX_RETRIES}) 🔄`);
              }
              await new Promise(r => setTimeout(r, wait));
            }
          }
        }
        // リトライ全滅した場合
        if (reply === null) {
          throw lastError || new Error('不明なエラー');
        }

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
        const jaMsg = _translateError(error.message);
        if (typeof MeetingUI !== 'undefined') {
          MeetingUI.hideTyping();
          MeetingUI.addSisterMessage(sisterKey,
            `ごめん、通信エラーだった…💦（${jaMsg}）`, isLead);
        }
        console.error(`[MeetingRelay] ${sister.name}のAPI呼び出しエラー:`, error);
        // v2.3追加 - 致命的エラー時は残りの姉妹もスキップして会議中断
        if (_isFatalError(error.message)) {
          if (typeof MeetingUI !== 'undefined') {
            MeetingUI.addSystemMessage(`⚠️ ${jaMsg}。会議を一時停止します。問題を解決してからやり直してください。`);
          }
          break;
        }
      }
    }

    // v1.3追加 - ラウンド完了後にTTSキュー再生（パターンB: まとめて再生）
    _speakRoundEntries(roundNum);
  }

  // v2.3追加 - 致命的エラー判定（リトライしても無意味なエラー）
  function _isFatalError(msg) {
    if (!msg) return false;
    const m = msg.toLowerCase();
    return m.includes('credit balance') || m.includes('credit') && m.includes('low')
      || m.includes('invalid api key') || m.includes('invalid x-api-key')
      || m.includes('authentication') || m.includes('unauthorized')
      || m.includes('account') && m.includes('deactivated');
  }

  // v2.3追加 - APIエラーメッセージを日本語に変換
  function _translateError(msg) {
    if (!msg) return '不明なエラーが発生しました';
    const m = msg.toLowerCase();
    if (m.includes('credit balance') || m.includes('credit') && m.includes('low'))
      return 'APIクレジット残高が不足しています。Anthropicダッシュボードでクレジットを追加してください';
    if (m.includes('invalid api key') || m.includes('invalid x-api-key'))
      return 'APIキーが無効です。設定画面で正しいキーを入力してください';
    if (m.includes('authentication') || m.includes('unauthorized'))
      return '認証エラーです。APIキーを確認してください';
    if (m.includes('rate limit') || m.includes('429'))
      return 'APIの利用制限に達しました。しばらく待ってからやり直してください';
    if (m.includes('timeout') || m.includes('timed out'))
      return '通信がタイムアウトしました。電波状況を確認してやり直してください';
    if (m.includes('overloaded') || m.includes('503'))
      return 'APIサーバーが混雑しています。しばらく待ってからやり直してください';
    if (m.includes('network') || m.includes('fetch'))
      return 'ネットワーク接続エラーです。通信状況を確認してください';
    return `エラー: ${msg}`;
  }

  /** 個別の姉妹APIを呼び出す */
  async function _callSisterAPI(sisterKey, topic, isLead, roundNum) {
    const sister = SISTERS[sisterKey];
    const apiModule = sister.api();

    if (!apiModule || !apiModule.hasApiKey()) {
      return `（${sister.name}はAPI未接続です。設定画面で認証トークンを設定してください）`;
    }

    // 会議用システムプロンプト
    // v2.0改修 - 会議グレードに応じたプロンプト取得
    const systemPrompt = sister.prompt(_meetingGrade);

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

    // v1.7改修 - PromptBuilderで検索結果を注入（会議中はクリアしない）
    // メモリーは会議開始時に事前取得済み（_memoryPrompt）
    let searchPrompt = '';
    if (typeof PromptBuilder !== 'undefined') {
      searchPrompt = await PromptBuilder.build({
        mode: 'meeting',
        skipMemory: true,  // メモリーは_memoryPromptで既に持っている
      });
    }
    const fullPrompt = systemPrompt + leadInstruction + _memoryPrompt + searchPrompt;
    const opts = { model: modelKey, maxTokens: 6144 };
    // v1.9追加 - 会議モードではClaude Tool Useをスキップ（tool_use/tool_result不整合エラー防止）
    opts.skipTools = true;
    // v1.9改修 - 複数ファイル添付対応（テキストは結合、画像は先頭1枚のみ）
    if (_currentAttachments && _currentAttachments.length > 0) {
      const textAtts = _currentAttachments.filter(a => a.type === 'text');
      const imageAtts = _currentAttachments.filter(a => a.type === 'image');
      if (textAtts.length > 0) {
        // テキストファイルは全て結合して1つのattachmentにする
        const combined = textAtts.map(a => `【添付ファイル: ${a.name}】\n${a.content}`).join('\n\n---\n\n');
        opts.attachment = { type: 'text', name: textAtts.map(a => a.name).join(', '), size: combined.length, content: combined, mimeType: 'text/plain' };
      }
      if (imageAtts.length > 0 && !opts.attachment) {
        // 画像のみの場合は先頭1枚を渡す（APIの制約上）
        opts.attachment = imageAtts[0];
      }
    }
    const reply = await apiModule.sendMessage(
      `【会議議題】${topic}`,
      fullPrompt,
      history,
      opts,
    );

    return reply;
  }

  /** 会議コンテキストを構築（v1.1: 全ラウンド履歴含む） */
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

  /** 追加ラウンドを実行（followUp=追加指示, routing=ルーティング, attachments=添付） */
  async function continueRound(followUp, routing, attachments) {
    if (!isRunning && currentRound > 0) {
      isRunning = true;
      _currentAttachments = attachments || null; // v1.9改修 - 複数ファイル対応
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

  /** 会議を中断 */
  function abort() { abortRequested = true; }

  /** 現在の会議履歴を取得 */
  function getHistory() { return [...meetingHistory]; }
  /** 進行中かどうか */
  function getIsRunning() { return isRunning; }
  /** 現在のラウンド数 */
  function getCurrentRound() { return currentRound; }
  /** v1.0追加 - 現在の会議ID */
  function getCurrentMeetingId() { return currentMeetingId; }

  /** v1.3追加 - ラウンドの全発言をTTSキュー再生 */
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

  /** v1.0追加 - MeetingHistoryに発言を非同期保存 */
  function _saveEntryToHistory(entry) {
    if (!currentMeetingId || typeof MeetingHistory === 'undefined') return;
    MeetingHistory.addEntry(currentMeetingId, entry).catch(e => {
      console.warn('[MeetingRelay] 発言保存エラー（続行）:', e);
    });
  }

  /** v1.0追加 - 会議ステータスを更新 */
  function _updateMeetingStatus(status) {
    if (!currentMeetingId || typeof MeetingHistory === 'undefined') return;
    MeetingHistory.updateStatus(currentMeetingId, status).catch(e => {
      console.warn('[MeetingRelay] ステータス更新エラー（続行）:', e);
    });
  }

  /** v1.1追加 - IndexedDBから会議状態を復元 */
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

  /** v1.1追加 - 履歴から最大ラウンド番号を検出 */
  function _detectMaxRound(history) {
    if (!history || history.length === 0) return 0;
    return Math.max(...history.map(m => m.round || 1));
  }

  // v2.0追加 - 現在の会議グレードを取得
  function getMeetingGrade() {
    return _meetingGrade;
  }

  return {
    startMeeting,
    continueRound,
    abort,
    getHistory,
    getIsRunning,
    getCurrentRound,
    getCurrentMeetingId,
    getMeetingGrade,
    restoreFromDB,
    MAX_ROUNDS,
  };
})();
