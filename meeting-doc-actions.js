// COCOMITalk - 会議ドキュメントアクション（議事録DL＋指示書生成）
// v1.0 2026-03-10 - meeting-ui.jsから分離
// v1.1 2026-03-23 - 連続ダウンロードに間隔追加（Android Chromeブロック対策）
'use strict';

/** 会議ドキュメントアクションモジュール */
const MeetingDocActions = (() => {

  // 姉妹表示情報（MeetingUIと共通）
  const SISTER_DISPLAY = {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#FF6B9D' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#6B5CE7' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#E6783E' },
  };

  /** システムメッセージ表示ヘルパー（MeetingUI.addSystemMessage委譲） */
  function _sysMsg(text) {
    if (typeof MeetingUI !== 'undefined') {
      MeetingUI.addSystemMessage(text);
    }
  }

  /** Blobを生成してダウンロード実行 */
  function _downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** 議事録をMarkdownでダウンロード */
  function downloadMinutes(currentRouting) {
    if (typeof MeetingRelay === 'undefined') return;
    const history = MeetingRelay.getHistory();
    if (!history || history.length === 0) {
      _sysMsg('まだ発言がないよ。会議を始めてからダウンロードしてね');
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);
    let md = `# COCOMI Family 会議議事録\n`;
    md += `- 日時: ${dateStr} ${timeStr}\n`;
    if (currentRouting) {
      md += `- カテゴリ: ${currentRouting.label}\n`;
      md += `- 主担当: ${SISTER_DISPLAY[currentRouting.lead]?.name || currentRouting.lead}\n`;
    }
    md += `\n---\n\n`;

    let lastRound = 0;
    for (const msg of history) {
      if (msg.round !== lastRound) {
        md += `## ラウンド ${msg.round}\n\n`;
        lastRound = msg.round;
      }
      const sister = SISTER_DISPLAY[msg.sister] || { emoji: '?', name: msg.sister };
      const leadMark = msg.isLead ? ' 👑主担当' : '';
      md += `### ${sister.emoji} ${sister.name}${leadMark}\n\n`;
      md += `${msg.content}\n\n---\n\n`;
    }

    _downloadBlob(md, `COCOMI会議_${dateStr}.md`, 'text/markdown; charset=utf-8');
    _sysMsg('📝 議事録をダウンロードしたよ！');
  }

  /** 会議履歴から指示書を生成＋ダウンロード */
  async function generateDoc() {
    if (typeof MeetingRelay === 'undefined' || typeof DocGenerator === 'undefined') {
      _sysMsg('指示書生成モジュールが未読み込み');
      return;
    }
    const history = MeetingRelay.getHistory();
    if (!history || history.length === 0) {
      _sysMsg('まだ発言がないよ。会議を始めてから📋を押してね');
      return;
    }

    // 会議履歴をDocGeneratorが受け取れる形式に変換
    const chatMessages = history.map(msg => {
      const sister = SISTER_DISPLAY[msg.sister] || { name: msg.sister };
      return {
        role: 'ai',
        content: `【${sister.name}】\n${msg.content}`,
      };
    });

    _sysMsg('📋 指示書を生成中... お姉ちゃんが統合→クロちゃんがチェック');

    try {
      const result = await DocGenerator.generate(chatMessages);
      if (result.success && result.files.length > 0) {
        // v1.1修正 - 連続ダウンロードにAndroid Chromeがブロックするため500ms間隔を空ける
        for (let i = 0; i < result.files.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 500));
          _downloadBlob(result.files[i].content, result.files[i].name, 'text/markdown; charset=utf-8');
        }
        _sysMsg(`📋 指示書${result.files.length}ファイルをダウンロードしたよ！`);
      }
    } catch (error) {
      _sysMsg(`指示書生成エラー: ${error.message}`);
    }
  }

  /** 姉妹表示情報を取得（外部参照用） */
  function getSisterDisplay() {
    return SISTER_DISPLAY;
  }

  return {
    downloadMinutes,
    generateDoc,
    getSisterDisplay,
  };
})();
