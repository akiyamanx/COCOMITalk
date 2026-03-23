// COCOMITalk - 会議ドキュメントアクション（議事録DL＋指示書生成）
// v1.0 2026-03-10 - meeting-ui.jsから分離
// v1.1 2026-03-23 - 連続ダウンロードに間隔追加（Android Chromeブロック対策）
// v1.2 2026-03-24 - DL間隔を1500msに拡大＋多ファイル時の案内（上位モデルで7-9ファイル生成時のブロック対策）
// v1.3 2026-03-24 - 分割ボタン対応（fileType引数でCLAUDE.md/設計書/指示書を個別生成可能に）
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

  /** 会議履歴から指示書を生成＋ダウンロード
   * v1.3 - fileType: 'claude'/'design'/'step'/'all'（デフォルト'all'で後方互換）
   */
  async function generateDoc(fileType = 'all') {
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

    // v1.3 - fileTypeに応じたステータスメッセージ
    const LABEL_MAP = { claude: 'CLAUDE.md', design: '設計書', step: 'ステップ指示書', all: '全指示書' };
    const label = LABEL_MAP[fileType] || '指示書';
    _sysMsg(`📋 ${label}を生成中... お姉ちゃんが作成→クロちゃんがチェック`);

    try {
      const result = await DocGenerator.generate(chatMessages, fileType);
      if (result.success && result.files.length > 0) {
        // v1.2 - 多ファイル時の案内（上位モデルだと7-9ファイルになることがある）
        if (result.files.length > 3) {
          _sysMsg(`📋 ${result.files.length}ファイル生成完了！順番にダウンロードするよ（Chromeの「複数ダウンロード許可」が出たら許可してね）`);
          await new Promise(r => setTimeout(r, 1000));
        }
        // v1.2修正 - DL間隔を1500msに拡大（上位モデルの多ファイル連続DLでブロックされる対策）
        let dlCount = 0;
        for (let i = 0; i < result.files.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 1500));
          try {
            _downloadBlob(result.files[i].content, result.files[i].name, 'text/markdown; charset=utf-8');
            dlCount++;
          } catch (dlError) {
            console.error(`[MeetingDocActions] DL失敗: ${result.files[i].name}`, dlError);
          }
        }
        _sysMsg(`📋 指示書${dlCount}/${result.files.length}ファイルをダウンロードしたよ！`);
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
