// COCOMITalk - 会議ドキュメントアクション（議事録DL＋指示書生成）
// v1.0 2026-03-10 - meeting-ui.jsから分離
// v1.1 2026-03-23 - 連続ダウンロードに間隔追加（Android Chromeブロック対策）
// v1.2 2026-03-24 - DL間隔を1500msに拡大＋多ファイル時の案内（上位モデルで7-9ファイル生成時のブロック対策）
// v1.3 2026-03-24 - 分割ボタン対応（fileType引数でCLAUDE.md/設計書/指示書を個別生成可能に）
// v1.4 2026-03-24 - エラー詳細表示強化（デバッグ情報をチャットに表示、改行をスペースに変換）
// v3.77 2026-10-29 - 姉妹の色を彩度控えめに
// v1.5 2026-11-01 - 議事録の日付をJSTに（UTC日付＋JST時刻のずれ修正）・二重保存防止（処理中はボタン無効、同じ会議の2回目は「もう保存したよ」・10秒以内にもう一度で保存し直し）・クロのチェック失敗理由を表示
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-11-01
'use strict';

/** 会議ドキュメントアクションモジュール */
const MeetingDocActions = (() => {

  // 姉妹表示情報（MeetingUIと共通）
  // 2026-10-30 - 登録簿から作る（葵・きみも同じ表示に）。登録簿が無い時だけ固定の5人
  const SISTER_DISPLAY = (typeof CharacterRegistry !== 'undefined') ? CharacterRegistry.displayMap() : {
    koko: { name: 'ここちゃん', emoji: '🌸', color: '#E8779F' },
    gpt: { name: 'お姉ちゃん', emoji: '🌙', color: '#7469D4' },
    claude: { name: 'クロちゃん', emoji: '🔮', color: '#DB8250' },
    aoi: { name: '葵ちゃん', emoji: '🦋', color: '#3BA7D9' }, kimi: { name: 'きみちゃん', emoji: '🌟', color: '#E0A21B' }, // 2026-11-01 5人に
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

  /** v1.5 - 日本時間(JST)の 'YYYY-MM-DD' と 'HH:MM'（端末のタイムゾーンに左右されない） */
  function jstParts(ms = Date.now()) {
    const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }

  // v1.5 - 二重保存防止。kind(minutes / doc:all 等) → { key, warnedAt }
  const RESAVE_WINDOW_MS = 10000;
  const _saved = {};
  const _busy = {};
  /** 会議ID＋発言数で「同じ内容」を判定 */
  function _contentKey(history) {
    const id = (typeof MeetingRelay !== 'undefined' && MeetingRelay.getCurrentMeetingId) ? MeetingRelay.getCurrentMeetingId() : '';
    return `${id || 'none'}#${history.length}`;
  }
  /** 保存してよいか。同じ内容の2回目は「もう保存したよ」、そのあと10秒以内にもう一度押したら保存し直す */
  function _allowSave(kind, key, now = Date.now()) {
    const s = _saved[kind];
    if (!s || s.key !== key) return true;
    if (s.warnedAt && now - s.warnedAt <= RESAVE_WINDOW_MS) { s.warnedAt = 0; return true; }
    s.warnedAt = now;
    _sysMsg('✅ もう保存したよ（同じ会議・同じ内容）。保存し直したい時は10秒以内にもう一回押してね');
    return false;
  }
  function _markSaved(kind, key) { _saved[kind] = { key, warnedAt: 0 }; }
  function _setBtn(id, disabled) {
    const b = (typeof document !== 'undefined') ? document.getElementById(id) : null;
    if (b) b.disabled = disabled;
  }

  /** 議事録をMarkdownでダウンロード */
  function downloadMinutes(currentRouting) {
    if (typeof MeetingRelay === 'undefined') return;
    const history = MeetingRelay.getHistory();
    if (!history || history.length === 0) {
      _sysMsg('まだ発言がないよ。会議を始めてからダウンロードしてね');
      return;
    }
    if (_busy.minutes) return;
    const key = _contentKey(history);
    if (!_allowSave('minutes', key)) return;
    _busy.minutes = true;
    _setBtn('btn-meeting-minutes', true);
    try { _writeMinutes(history, currentRouting); _markSaved('minutes', key); } finally {
      _busy.minutes = false;
      _setBtn('btn-meeting-minutes', false);
    }
  }

  function _writeMinutes(history, currentRouting) {
    const { date: dateStr, time: timeStr } = jstParts();
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

    if (_busy.doc || (DocGenerator.isGenerating && DocGenerator.isGenerating())) {
      _sysMsg('⏳ いま指示書を作っているよ。終わるまで待ってね');
      return;
    }
    const kind = `doc:${fileType}`;
    const key = _contentKey(history);
    if (!_allowSave(kind, key)) return;

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

    _busy.doc = true;
    _setBtn('btn-meeting-doc', true);
    try {
      const result = await DocGenerator.generate(chatMessages, fileType);
      if (result.success && result.files.length > 0) {
        _markSaved(kind, key);
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
        // v1.3 - クロちゃんチェックがスキップされた場合の丁寧な案内
        if (result.reviewSkipped) {
          _sysMsg('⚠️ お姉ちゃん版です。クロちゃん復旧後に再チェックしてね');
          // v1.5 - どのファイルが・なぜ（HTTP番号/種類）失敗したかを表示（秘密は含めない）
          for (const f of (result.reviewFailures || [])) _sysMsg(`🔍 クロのチェック失敗: ${f.file} → ${f.reason}`);
        }
      }
    } catch (error) {
      // v1.4修正 - エラー詳細をチャットに丁寧に表示（改行をスペースに変換して1行で見やすく）
      const cleanMsg = (error.message || String(error)).replace(/\n/g, ' ');
      _sysMsg(`❌ ${label}生成エラー: ${cleanMsg}`);
    } finally {
      _busy.doc = false;
      _setBtn('btn-meeting-doc', false);
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
    jstParts,
    _allowSave, _markSaved, // テスト用
  };
})();
