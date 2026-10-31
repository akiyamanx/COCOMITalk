// COCOMITalk - 設定画面「🧠 思考の強さ」セクション（キャラ×段階ごと）
// このファイルは app-settings.js から呼ばれ、選んだモデルで公式に使える強さだけを選択肢に出す（model-effort.js の表が元）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-28
// v1.0 2026-10-28 - 新規作成（html(): 描画 / save(): 保存 / reset(): 全て既定へ）
'use strict';

const EffortSettingsUI = (() => {

  const sid = (provider, tier) => `effort-${provider}-${tier}`;

  /** 「既定」行の表示文: その段階で何が送られるか（Claude/Geminiは未指定＝API側の既定） */
  function _defaultText(provider, tier, r) {
    const d = ModelEffort.resolveEffort(provider, tier, r.id, ModelTiers.TIERS[provider][tier].params.reasoning_effort || null, true);
    const L = ModelEffort.LABELS;
    if (d.effort) return `段階の既定（${L[d.effort]}）`;
    return d.apiDefault ? `モデルの既定（${L[d.apiDefault]}）` : 'モデルの既定';
  }

  /** 1段階ぶんの <select> 行（選択肢は公式で有効な値だけ。保存値が今のモデルで無効なら「既定」を選んだ状態） */
  function _row(character, tier) {
    const r = ModelTiers.resolve(character.provider, tier);
    const levels = ModelEffort.levelsFor(character.provider, r.id);
    if (!levels.length) return '';
    const saved = ModelEffort.getPref(character.provider, tier, r.id) || '';
    const opts = [['', _defaultText(character.provider, tier, r)]].concat(levels.map(l => [l, ModelEffort.LABELS[l]]))
      .map(([v, t]) => `<option value="${v}"${v === saved ? ' selected' : ''}>${t}</option>`).join('');
    const note = ModelEffort.note(character.provider, r.id);
    return `<div class="setting-item model-select-row"><label for="${sid(character.provider, tier)}">${r.icon}${r.tierLabel} ${r.label}</label>`
      + `<select id="${sid(character.provider, tier)}" class="model-select effort-select" data-provider="${character.provider}" data-tier="${tier}">${opts}</select></div>`
      + (note ? `<p class="setting-hint">${note}</p>` : '');
  }

  /** セクション全体のHTML（有効なキャラのみ。準備中のキャラは出さない） */
  function html() {
    if (typeof ModelEffort === 'undefined' || typeof CharacterRegistry === 'undefined') return '';
    let h = `<div class="model-mode-block" data-mode="effort"><h4 class="model-mode-title">🧠 思考の強さ</h4>`
      + `<p class="setting-hint">段階ごとに「どれだけ考えてから答えるか」を選べます。強いほど賢くなりやすい反面、遅く・高くなります（超高/最大は数十秒〜かかることがあります）。保存すると全モードに効きます。</p>`;
    CharacterRegistry.enabledList().forEach(c => {
      h += `<p class="setting-hint"><b>${CharacterRegistry.displayName(c.key)}</b></p>`;
      ModelTiers.TIER_ORDER.forEach(t => { h += _row(c, t); });
    });
    return h + `</div>`;
  }

  /** 画面の選択を保存（'' は既定に戻す）。無効な値はmodel-effort側が拒否する */
  function save(root = document) {
    if (typeof ModelEffort === 'undefined') return;
    root.querySelectorAll('select.effort-select').forEach(sel => {
      const provider = sel.dataset.provider, tier = sel.dataset.tier;
      ModelEffort.setPref(provider, tier, ModelTiers.resolve(provider, tier).id, sel.value);
    });
  }

  function reset() { if (typeof ModelEffort !== 'undefined') ModelEffort.clearAll(); }

  return { html, save, reset };
})();
