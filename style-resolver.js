// COCOMITalk - スタイル解決モジュール
// このファイルはモード（normal/dev/meeting）×スタイル（じっくり/ワイワイ）の
// 組み合わせが許可されるかを判定する
// v1.0 2026-04-05 - 新規作成（ワイワイモード Sprint 1）
'use strict';

const StyleResolver = (() => {

  // モード×スタイルの許可マトリクス
  // 'allow' = 許可, 'warn' = 許可（注意表示）, 'deny' = 禁止
  const MATRIX = {
    normal: { normal: 'allow', waiwai: 'allow' },
    dev:    { normal: 'allow', waiwai: 'allow' },
    meeting: { normal: 'allow', waiwai: 'allow' },
  };

  // 会議グレード別の上書き（meeting-fullのみ禁止）
  const MEETING_GRADE_OVERRIDE = {
    'meeting-lite': { waiwai: 'allow' },
    'meeting':      { waiwai: 'warn' },
    'meeting-full': { waiwai: 'deny' },
  };

  /**
   * モード×スタイルの許可判定
   * @param {string} toneMode - 'normal' / 'dev' / 'meeting'
   * @param {string} style - 'normal' / 'waiwai'
   * @param {string} [meetingGrade] - 'meeting-lite' / 'meeting' / 'meeting-full'
   * @returns {{ allowed: boolean, level: string, message: string }}
   */
  function resolve(toneMode, style, meetingGrade) {
    // normalスタイルは常に許可
    if (!style || style === 'normal') {
      return { allowed: true, level: 'allow', message: '' };
    }

    // 会議モードの場合、グレード別判定
    if (toneMode === 'meeting' && meetingGrade) {
      const override = MEETING_GRADE_OVERRIDE[meetingGrade];
      if (override && override[style]) {
        const level = override[style];
        if (level === 'deny') {
          return {
            allowed: false,
            level: 'deny',
            message: 'フル会議ではワイワイモードは使えないよ。じっくりモードで議論しよう！',
          };
        }
        if (level === 'warn') {
          return {
            allowed: true,
            level: 'warn',
            message: '会議中のワイワイモード。議論が浅くなるかも — 大事なところはじっくりに切替えてね',
          };
        }
      }
    }

    // 通常の判定
    const modeMatrix = MATRIX[toneMode] || MATRIX.normal;
    const level = modeMatrix[style] || 'allow';

    return {
      allowed: level !== 'deny',
      level,
      message: level === 'warn' ? 'このモードでワイワイは注意が必要かも' : '',
    };
  }

  return { resolve };
})();
