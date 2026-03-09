// COCOMITalk - グループモード（👥三姉妹リレー応答）
// このファイルは通常チャット画面内で三姉妹全員がリレー応答するロジックを管理する
// v0.9 Step 3.5 - chat-core.jsから分離して新規作成
// v0.9.1 - 前ターン補完方式: 各姉妹が「自分の後に話した姉妹」の前ターン発言を受け取る
// v0.9.2 - 姉妹間対話促進: 他の姉妹の発言に自然に反応するグループ会話ルール追加

'use strict';

/**
 * グループチャットモジュール
 * - 通常チャット画面内で三姉妹がリレー応答（LINE的パターンB）
 * - 動的ルーティングで発言順＋主担当を決定
 * - 前ターン補完: 各姉妹は「自分が見れなかった分」だけ前ターンから補完される
 *   1番目 → 前ターンの2番目＋3番目の発言を受け取る
 *   2番目 → 前ターンの3番目の発言を受け取る ＋ 今ターンの1番目
 *   3番目 → 補完不要（今ターンの1番目＋2番目で全部見れる）
 */
const ChatGroup = (() => {

  // --- 前ターンのリレー履歴を保持（ターン間で引き継ぐ） ---
  let prevTurnRelay = [];

  /**
   * グループリレー応答を実行
   */
  async function handleGroupReply(userText, ctx) {
    const { currentSister, chatHistories, addMessage, hideTyping,
            chatArea, SISTERS, SISTER_API } = ctx;

    // 動的ルーティングで発言順を決定
    let order = ['koko', 'gpt', 'claude'];
    let lead = 'koko';

    if (typeof MeetingRouter !== 'undefined') {
      try {
        const routing = await MeetingRouter.analyzeTopic(userText);
        order = routing.order;
        lead = routing.lead;
      } catch (e) {
        console.warn('[ChatGroup] ルーティング分析フォールバック:', e);
      }
    }

    // 今ターンのリレー履歴
    const relayContext = [];

    for (let i = 0; i < order.length; i++) {
      const sisterKey = order[i];
      const sister = SISTERS[sisterKey];
      const sisterAPI = SISTER_API[sisterKey];
      const apiModule = sisterAPI ? sisterAPI.module() : null;
      const isLead = (sisterKey === lead);

      _showGroupTyping(sisterKey, sister, chatArea, hideTyping);

      try {
        if (apiModule && apiModule.hasApiKey()) {
          // v0.9.1 - 前ターン補完分を計算
          const complement = _getPrevTurnComplement(i, order, SISTERS);

          const reply = await _callSisterInGroup(
            userText, sisterKey, isLead, sisterAPI,
            chatHistories, relayContext, complement, SISTERS
          );

          hideTyping();
          addMessage('ai', reply, { sisterKey, isLead });
          relayContext.push({ sisterKey, content: reply, isLead });

        } else {
          hideTyping();
          const demoReply = `（${sister.name}はAPI未接続です。設定で認証トークンを入れてね！）`;
          addMessage('ai', demoReply, { sisterKey, isLead });
          relayContext.push({ sisterKey, content: demoReply, isLead });
        }
      } catch (error) {
        hideTyping();
        const errMsg = `ごめん、通信エラーだった…💦（${error.message}）`;
        // v0.9.4 - エラーは画面表示のみ、履歴には入れない（トークン節約）
        addMessage('ai', errMsg, { sisterKey, isLead, noHistory: true });
        relayContext.push({ sisterKey, content: '（通信エラーのため発言なし）', isLead });
        console.error(`[ChatGroup] ${sister.name} グループ応答エラー:`, error);
      }
    }

    // 今ターンのリレーを保存（次ターンの補完用）
    prevTurnRelay = relayContext.map(r => ({
      sisterKey: r.sisterKey,
      content: r.content,
      isLead: r.isLead,
    }));

    _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS);

    // v1.1修正 - 音声モード時、3人全員の応答を順番に再生（キュー方式）
    if (window.voiceController && window.voiceController.isEnabled() && relayContext.length > 0) {
      const queueItems = relayContext.map(r => ({
        text: r.content,
        sisterId: r.sisterKey
      }));
      window.voiceController.speakQueue(queueItems);
    }
  }

  /**
   * v0.9.1 - 前ターンの「自分の後」の姉妹の発言を取得（補完分）
   * @param {number} currentIndex - 今ターンでの自分の順番（0,1,2）
   * @param {string[]} order - 今ターンの発言順
   * @param {Object} SISTERS - 姉妹情報
   * @returns {Array} 補完用の履歴エントリ
   */
  function _getPrevTurnComplement(currentIndex, order, SISTERS) {
    if (prevTurnRelay.length === 0) return []; // 1ターン目は補完なし

    // 前ターンで「自分より後に話した姉妹」を特定
    const mySisterKey = order[currentIndex];
    const prevIndex = prevTurnRelay.findIndex(r => r.sisterKey === mySisterKey);

    if (prevIndex === -1) return []; // 前ターンに自分がいない（通常ありえないが安全策）

    // 自分より後の発言だけ取得
    const complement = prevTurnRelay.slice(prevIndex + 1);

    return complement.map(r => {
      const sister = SISTERS[r.sisterKey];
      return {
        // v0.9.5 - 他の姉妹の発言はrole:'user'で渡す（自分の発言と混同しない）
        role: 'user',
        content: `【前の会話より】${sister.icon}${sister.name}: ${r.content}`,
      };
    });
  }

  /**
   * 個別の姉妹APIを呼び出す（グループモード用）
   * v0.9.1変更 - 前ターン補完分（complement）を履歴に追加
   */
  async function _callSisterInGroup(userText, sisterKey, isLead, sisterAPI, chatHistories, relayContext, complement, SISTERS, extraInstruction) {
    const apiModule = sisterAPI.module();
    const systemPrompt = sisterAPI.prompt();

    // v0.9.2 - 姉妹間対話＋主担当の指示
    // 前の姉妹の発言がある場合は名前を取得
    const prevNames = relayContext.map(r => SISTERS[r.sisterKey].name);
    const complementNames = complement.map(c => {
      const match = c.content.match(/【前の会話より】(.)(.+?):/);
      return match ? match[2] : '';
    }).filter(Boolean);
    const otherNames = [...complementNames, ...prevNames];

    let groupInstruction = '\n\n【グループ会話ルール】';
    groupInstruction += '\nこれは三姉妹＋アキヤの家族グループチャットです。';
    groupInstruction += '\n・アキヤの発言に答えるだけでなく、他の姉妹の発言にも自然に反応してください。';
    groupInstruction += '\n・「ここちゃんの○○いいね」「クロちゃんが言ってた○○だけど」など、名前を出して触れてOK。';
    groupInstruction += '\n・賛成、補足、やさしい反論、質問など、家族の会話らしい自然なキャッチボールを。';
    groupInstruction += '\n・ただし長くなりすぎないこと。自分の専門視点からの意見を中心に。';

    if (otherNames.length > 0) {
      groupInstruction += `\n・今回の会話に ${otherNames.join('、')} の発言があります。必ず目を通してから返答してね。`;
    }

    const leadNote = isLead
      ? groupInstruction + '\n\n【あなたが主担当です。深く分析して具体的に提案を主導してください。】'
      : groupInstruction + '\n\n【別の姉妹が主担当です。あなたの専門視点から補足・チェック・別角度の意見を。】';

    // 履歴構築: 自分の過去履歴 + 前ターン補完 + 今ターンの前の姉妹
    const history = [...(chatHistories[sisterKey] || [])];

    // v0.9.1追加 - 前ターンの補完分（自分が見れなかった姉妹の発言）
    for (const entry of complement) {
      history.push(entry);
    }

    // 今ターンの前の姉妹の発言（role:'user'で渡して自分の発言と混同させない）
    for (const prev of relayContext) {
      const prevSister = SISTERS[prev.sisterKey];
      history.push({
        role: 'user',
        content: `${prevSister.icon}${prevSister.name}: ${prev.content}`,
      });
    }

    const modelKey = (typeof ModeSwitcher !== 'undefined')
      ? ModeSwitcher.getModelKey(sisterKey)
      : undefined;

    return await apiModule.sendMessage(
      userText, systemPrompt + leadNote + (extraInstruction || ''), history, { model: modelKey }
    );
  }

  /** グループモード用タイピングインジケーター（姉妹名付き） */
  function _showGroupTyping(sisterKey, sister, chatArea, hideTyping) {
    hideTyping();
    const colors = { koko: '#FF6B9D', gpt: '#6B5CE7', claude: '#E6783E' };
    const color = colors[sisterKey] || '#888';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai';
    msgDiv.id = 'typing-msg';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = sister.icon;

    const indicator = document.createElement('div');
    indicator.className = 'msg-bubble typing-indicator';
    indicator.innerHTML = `
      <span class="typing-name" style="color:${color}">${sister.name}</span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(indicator);
    chatArea.appendChild(msgDiv);
    requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
  }

  /** グループ応答を履歴に保存 */
  function _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS) {
    const groupSummary = relayContext.map(r => {
      const s = SISTERS[r.sisterKey];
      return `${s.icon}${s.name}: ${r.content}`;
    }).join('\n\n');

    chatHistories[currentSister].push({ role: 'assistant', content: groupSummary });

    if (typeof ChatHistory !== 'undefined') {
      ChatHistory.save(currentSister, chatHistories[currentSister]).catch(e => {
        console.warn('[ChatGroup] 履歴保存エラー:', e);
      });
    }
  }

  /** prevTurnRelayをリセット（ページ遷移やグループ解除時用） */
  function resetHistory() {
    prevTurnRelay = [];
  }

  /**
   * v0.9.3追加 - 姉妹だけで会話を続ける（アキヤの発言なし）
   * 前ターンの会話を踏まえて三姉妹だけで1ターン会話する
   */
  async function continueTalk(ctx) {
    if (prevTurnRelay.length === 0) {
      console.warn('[ChatGroup] 前の会話がないため続けられません');
      return;
    }

    const { currentSister, chatHistories, addMessage, hideTyping,
            chatArea, SISTERS, SISTER_API } = ctx;

    // 前ターンの会話を要約して「続きの話題」にする
    const lastTopic = prevTurnRelay.map(r => {
      const s = SISTERS[r.sisterKey];
      return `${s.icon}${s.name}: ${r.content}`;
    }).join('\n');

    // 前回と同じ順番で発言（動的ルーティング再計算はしない）
    const order = prevTurnRelay.map(r => r.sisterKey);
    const lead = prevTurnRelay.find(r => r.isLead)?.sisterKey || order[0];

    // 今ターンのリレー履歴
    const relayContext = [];

    // v0.9.3 - 区切り表示
    addMessage('ai', '── みんなで話してるよ 🔄 ──', { sisterKey: order[0] });

    for (let i = 0; i < order.length; i++) {
      const sisterKey = order[i];
      const sister = SISTERS[sisterKey];
      const sisterAPI = SISTER_API[sisterKey];
      const apiModule = sisterAPI ? sisterAPI.module() : null;
      const isLead = (sisterKey === lead);

      _showGroupTyping(sisterKey, sister, chatArea, hideTyping);

      try {
        if (apiModule && apiModule.hasApiKey()) {
          const complement = _getPrevTurnComplement(i, order, SISTERS);

          // v0.9.3 - 「姉妹同士で会話を続けて」という指示付き
          const continueInstruction = '\n\n【アキヤは今は見守っています。前の会話の続きを姉妹同士で自然に会話してください。相手の姉妹の発言に反応したり、新しい視点を出したり、議論を深めたり。アキヤへの報告じゃなくて、姉妹同士のおしゃべりとして。】';

          const reply = await _callSisterInGroup(
            '（アキヤは見守り中。前の会話の続きを姉妹同士で話してね）\n\n前の会話:\n' + lastTopic,
            sisterKey, isLead, sisterAPI,
            chatHistories, relayContext, complement, SISTERS,
            continueInstruction
          );

          hideTyping();
          addMessage('ai', reply, { sisterKey, isLead });
          relayContext.push({ sisterKey, content: reply, isLead });
        } else {
          hideTyping();
          const demoReply = `（${sister.name}はAPI未接続です）`;
          addMessage('ai', demoReply, { sisterKey });
          relayContext.push({ sisterKey, content: demoReply, isLead });
        }
      } catch (error) {
        hideTyping();
        const errMsg = `ごめん、通信エラーだった…💦（${error.message}）`;
        addMessage('ai', errMsg, { sisterKey, noHistory: true });
        relayContext.push({ sisterKey, content: '（通信エラーのため発言なし）', isLead });
      }
    }

    // 今ターンのリレーを保存（次のcontinueTalkや通常ターンの補完用）
    prevTurnRelay = relayContext.map(r => ({
      sisterKey: r.sisterKey, content: r.content, isLead: r.isLead,
    }));

    _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS);
  }

  return {
    handleGroupReply,
    continueTalk,
    resetHistory,
    hasPrevTurn: () => prevTurnRelay.length > 0,
  };
})();
