// COCOMITalk - グループモード（👥三姉妹リレー応答）
// このファイルは通常チャット画面内で三姉妹全員がリレー応答するロジックを管理する
// v0.9 Step 3.5 - chat-core.jsから分離して新規作成
// v0.9.1 - 前ターン補完方式: 各姉妹が「自分の後に話した姉妹」の前ターン発言を受け取る
// v0.9.2 - 姉妹間対話促進: 他の姉妹の発言に自然に反応するグループ会話ルール追加
// v1.3 2026-03-11 - PromptBuilder共通化リファクタ（メモリー＋検索注入をprompt-builder.jsに委譲）
// v1.4 2026-03-13 - 他姉妹セリフ代弁バグ修正（グループ会話ルールに自分の言葉だけ制約を追加）
// v1.5 2026-03-16 - グループモードファイル添付対応（方針C: テキスト全員・画像リードのみ）
// v1.6 2026-03-23 - グループモードでもAI自発的記憶保存マーカー検知（detectAndSave対応）
// v1.7 2026-03-30 - Sprint 2: PromptBuilder.buildにsister引数追加（ownerベース記憶注入制御）

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
            chatArea, SISTERS, SISTER_API, attachment } = ctx;

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

          // v1.5追加 - 添付ファイル振り分け（テキスト:全員、画像:リードのみ）
          let sisterAttachment = null;
          if (attachment) {
            if (attachment.type === 'text') {
              sisterAttachment = attachment;
            } else if (attachment.type === 'image' && i === 0) {
              sisterAttachment = attachment;
            }
          }

          let reply = await _callSisterInGroup(
            userText, sisterKey, isLead, sisterAPI,
            chatHistories, relayContext, complement, SISTERS,
            undefined, sisterAttachment
          );

          // v1.6追加 - グループモードでもAI自発的記憶保存マーカーを検知
          if (typeof ChatMemory !== 'undefined' && reply.includes('💾SAVE:')) {
            reply = await ChatMemory.detectAndSave(reply, sisterKey, chatHistories[sisterKey] || []);
          }

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
        addMessage('ai', errMsg, { sisterKey, isLead, noHistory: true });
        relayContext.push({ sisterKey, content: '（通信エラーのため発言なし）', isLead });
        console.error(`[ChatGroup] ${sister.name} グループ応答エラー:`, error);
      }
    }

    if (typeof PromptBuilder !== 'undefined') PromptBuilder.clearSearch();

    prevTurnRelay = relayContext.map(r => ({
      sisterKey: r.sisterKey,
      content: r.content,
      isLead: r.isLead,
    }));

    _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS);

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
   */
  function _getPrevTurnComplement(currentIndex, order, SISTERS) {
    if (prevTurnRelay.length === 0) return [];

    const mySisterKey = order[currentIndex];
    const prevIndex = prevTurnRelay.findIndex(r => r.sisterKey === mySisterKey);

    if (prevIndex === -1) return [];

    const complement = prevTurnRelay.slice(prevIndex + 1);

    return complement.map(r => {
      const sister = SISTERS[r.sisterKey];
      return {
        role: 'user',
        content: `【前の会話より】${sister.icon}${sister.name}: ${r.content}`,
      };
    });
  }

  /**
   * 個別の姉妹APIを呼び出す（グループモード用）
   * v1.7変更 - PromptBuilder.buildにsister引数追加
   */
  async function _callSisterInGroup(userText, sisterKey, isLead, sisterAPI, chatHistories, relayContext, complement, SISTERS, extraInstruction, attachment) {
    const apiModule = sisterAPI.module();
    const systemPrompt = sisterAPI.prompt();

    const prevNames = relayContext.map(r => SISTERS[r.sisterKey].name);
    const complementNames = complement.map(c => {
      const match = c.content.match(/【前の会話より】(.)(.+?):/);
      return match ? match[2] : '';
    }).filter(Boolean);
    const otherNames = [...complementNames, ...prevNames];

    let groupInstruction = '\n\n【グループ会話ルール — 最重要】';
    groupInstruction += '\nこれは三姉妹＋アキヤの家族グループチャットです。';
    groupInstruction += '\n★絶対厳守★ あなたの応答には【自分自身の言葉だけ】を書いてください。';
    groupInstruction += '\n・他の姉妹のセリフを代弁・代筆してはいけません。';
    groupInstruction += '\n・「🌙お姉ちゃん:」「🔮クロちゃん:」「🌸ここちゃん:」のような他の姉妹の発言は絶対に含めないでください。';
    groupInstruction += '\n・他の姉妹にはそれぞれ自分のAPIがあり、自分の言葉で応答します。あなたが代わりに書く必要はありません。';
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

    const history = [...(chatHistories[sisterKey] || [])];

    for (const entry of complement) {
      history.push(entry);
    }

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

    // v1.7変更 - PromptBuilder.buildにsister引数追加（ownerベース記憶注入制御）
    let extraPrompt = '';
    if (typeof PromptBuilder !== 'undefined') {
      extraPrompt = await PromptBuilder.build({ mode: 'group', sister: sisterKey, userText });
    }

    const opts = { model: modelKey };
    if (attachment) opts.attachment = attachment;
    return await apiModule.sendMessage(
      userText, systemPrompt + leadNote + (extraInstruction || '') + extraPrompt, history, opts
    );
  }

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

  function resetHistory() {
    prevTurnRelay = [];
  }

  /**
   * v0.9.3追加 - 姉妹だけで会話を続ける（アキヤの発言なし）
   */
  async function continueTalk(ctx) {
    if (prevTurnRelay.length === 0) {
      console.warn('[ChatGroup] 前の会話がないため続けられません');
      return;
    }

    const { currentSister, chatHistories, addMessage, hideTyping,
            chatArea, SISTERS, SISTER_API } = ctx;

    const lastTopic = prevTurnRelay.map(r => {
      const s = SISTERS[r.sisterKey];
      return `${s.icon}${s.name}: ${r.content}`;
    }).join('\n');

    const order = prevTurnRelay.map(r => r.sisterKey);
    const lead = prevTurnRelay.find(r => r.isLead)?.sisterKey || order[0];

    const relayContext = [];

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