// COCOMITalk - グループモード（👥三姉妹リレー応答）
// このファイルは通常チャット画面内で三姉妹全員がリレー応答するロジックを管理する
// v0.9 Step 3.5 - chat-core.jsから分離して新規作成

'use strict';

/**
 * グループチャットモジュール
 * - 通常チャット画面内で三姉妹がリレー応答（LINE的パターンB）
 * - 動的ルーティングで発言順＋主担当を決定
 * - 前の姉妹の発言を次に渡す文脈積み重ね
 */
const ChatGroup = (() => {

  /**
   * グループリレー応答を実行
   * @param {string} userText - ユーザーの入力テキスト
   * @param {Object} ctx - ChatCoreから渡されるコンテキスト
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

    // 三姉妹のリレー履歴（このターン分）
    const relayContext = [];

    for (let i = 0; i < order.length; i++) {
      const sisterKey = order[i];
      const sister = SISTERS[sisterKey];
      const sisterAPI = SISTER_API[sisterKey];
      const apiModule = sisterAPI ? sisterAPI.module() : null;
      const isLead = (sisterKey === lead);

      // タイピングインジケーター（姉妹名付き）
      _showGroupTyping(sisterKey, sister, chatArea, hideTyping);

      try {
        if (apiModule && apiModule.hasApiKey()) {
          const reply = await _callSisterInGroup(
            userText, sisterKey, isLead, sisterAPI, chatHistories, relayContext, SISTERS
          );

          hideTyping();
          addMessage('ai', reply, { sisterKey, isLead });
          relayContext.push({ sisterKey, content: reply, isLead });

        } else {
          // API未接続時のデモ返答
          hideTyping();
          const demoReply = `（${sister.name}はAPI未接続です。設定で認証トークンを入れてね！）`;
          addMessage('ai', demoReply, { sisterKey, isLead });
          relayContext.push({ sisterKey, content: demoReply, isLead });
        }
      } catch (error) {
        hideTyping();
        const errMsg = `ごめん、通信エラーだった…💦（${error.message}）`;
        addMessage('ai', errMsg, { sisterKey, isLead });
        relayContext.push({ sisterKey, content: errMsg, isLead });
        console.error(`[ChatGroup] ${sister.name} グループ応答エラー:`, error);
      }
    }

    // 履歴にグループ応答を保存（現在の姉妹タブの履歴に要約で追加）
    _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS);
  }

  /**
   * 個別の姉妹APIを呼び出す（グループモード用）
   */
  async function _callSisterInGroup(userText, sisterKey, isLead, sisterAPI, chatHistories, relayContext, SISTERS) {
    const apiModule = sisterAPI.module();
    const systemPrompt = sisterAPI.prompt();

    // 主担当 or 補助の追加指示
    const leadNote = isLead
      ? '\n\n【この議題ではあなたが主担当です。深く分析して具体的に提案してください。】'
      : '\n\n【この議題では別の姉妹が主担当です。あなたの専門視点から補足してください。】';

    // 前の姉妹の発言を履歴に含める（文脈の積み重ね）
    const history = [...(chatHistories[sisterKey] || [])];
    for (const prev of relayContext) {
      const prevSister = SISTERS[prev.sisterKey];
      history.push({
        role: 'assistant',
        content: `${prevSister.icon}${prevSister.name}: ${prev.content}`,
      });
    }

    // モデルキー取得
    const modelKey = (typeof ModeSwitcher !== 'undefined')
      ? ModeSwitcher.getModelKey(sisterKey)
      : undefined;

    return await apiModule.sendMessage(
      userText, systemPrompt + leadNote, history, { model: modelKey }
    );
  }

  /**
   * グループモード用タイピングインジケーター（姉妹名付き）
   */
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

    // スクロール
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  /**
   * グループ応答を履歴に保存
   */
  function _saveGroupHistory(currentSister, chatHistories, relayContext, SISTERS) {
    const groupSummary = relayContext.map(r => {
      const s = SISTERS[r.sisterKey];
      return `${s.icon}${s.name}: ${r.content}`;
    }).join('\n\n');

    chatHistories[currentSister].push({ role: 'assistant', content: groupSummary });

    // IndexedDB保存
    if (typeof ChatHistory !== 'undefined') {
      ChatHistory.save(currentSister, chatHistories[currentSister]).catch(e => {
        console.warn('[ChatGroup] 履歴保存エラー:', e);
      });
    }
  }

  return {
    handleGroupReply,
  };
})();
