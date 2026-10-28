// COCOMITalk - 起動オープニング（オーバーレイ・進行・スキップ）
// このファイルは起動画面の上に全画面オーバーレイを出し、opening-scene.js(映像)と opening-audio.js(音)を進行させる
// v1.0 2026-10-29 - cocomi_opening_v3.html の再生/ミュート制御を移植。location遷移とリプレイは外し onEnd と cocomi:opening-done に置換
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
'use strict';
/** CocomiOpening.start({onEnd(reason)}) → コントローラ or null（未対応。呼び出し側は従来スプラッシュにする）
 *  reason: 'ended'(最後まで/最後の画面をタップ) / 'skipped'(スキップ・Esc) / 'error'(描画失敗。従来スプラッシュへ) */
(function () {
  var HOLD_MS = 1800;        // 最後の画面を見せる時間（タップで早められる）
  var HOLD_REDUCED_MS = 4000; // reduced-motion は静止画なので少し長く
  var FADE_MS = 800;
  var active = null;

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function isSupported() {
    return !!(window.CocomiOpeningScene && document && document.createElement && document.body && window.requestAnimationFrame);
  }

  function el(tag, id, cls, text) {
    var n = document.createElement(tag);
    if (id) n.id = id;
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function start(opts) {
    opts = opts || {};
    if (active) return active;
    if (!isSupported()) return null;

    var reduce = reducedMotion();
    var overlay = el('div', 'opening-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'COCOMI CORE オープニング');
    var canvas = el('canvas', 'op-canvas');
    var startEl = el('button', 'op-start');
    startEl.setAttribute('type', 'button');
    startEl.setAttribute('aria-label', '再生');
    startEl.appendChild(el('span', null, 'op-btn', '▶'));
    startEl.appendChild(el('span', null, 'op-lbl', '再生'));
    startEl.appendChild(el('span', null, 'op-sub', 'SOUND ON 推奨'));
    var fadeEl = el('div', 'op-fade');
    var muteEl = el('button', 'op-mute', 'op-ui', '♪ サウンド ON');
    muteEl.setAttribute('type', 'button');
    muteEl.setAttribute('aria-label', 'ミュート切替');
    var skipEl = el('button', 'op-skip', 'op-ui op-show', 'スキップ');
    skipEl.setAttribute('type', 'button');
    skipEl.setAttribute('aria-label', 'オープニングをスキップしてアプリを開く');

    var scene = null, audio = null, muted = false;
    var raf = 0, t0 = 0, running = false, ended = false, fading = false, done = false;
    var timers = [];
    var ctl = null;

    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }

    /** 後片付け: rAF停止・タイマー停止・AudioContext close・リスナー解除・DOM除去（何度呼んでもよい） */
    function destroy() {
      running = false;
      if (raf) { try { cancelAnimationFrame(raf); } catch (e) { /* 無視 */ } raf = 0; }
      timers.forEach(function (id) { clearTimeout(id); });
      timers = [];
      if (audio) { try { audio.close(); } catch (e) { /* 無視 */ } audio = null; }
      try { window.removeEventListener('resize', onResize); } catch (e) { /* 無視 */ }
      try { document.removeEventListener('keydown', onKey); } catch (e) { /* 無視 */ }
      try { canvas.width = 0; canvas.height = 0; } catch (e) { /* 無視 */ }
      try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* 無視 */ }
      if (active === ctl) active = null;
    }

    function finish(reason) {
      if (done) return;
      done = true;
      destroy();
      try { window.dispatchEvent(new CustomEvent('cocomi:opening-done', { detail: { reason: reason } })); } catch (e) { /* 無視 */ }
      try { if (typeof opts.onEnd === 'function') opts.onEnd(reason); } catch (e) { console.warn('[Opening] onEnd例外:', e); }
    }

    /** 最後の画面からフェードして終わる（自動 or 最後の画面のタップ） */
    function endWithFade() {
      if (done || !ended || fading) return;
      fading = true; // 二重起動防止
      fadeEl.classList.add('op-on');
      muteEl.classList.remove('op-show');
      later(function () { finish('ended'); }, FADE_MS);
    }

    function skip() { finish('skipped'); }

    function fail(e) {
      console.warn('[Opening] 描画失敗→従来スプラッシュにフォールバック:', e && e.message);
      finish('error');
    }

    function loop(now) {
      if (done || !running) return;
      try {
        var t = ((typeof now === 'number' ? now : performance.now()) - t0) / 1000;
        if (t >= scene.DUR && !ended) {
          ended = true;
          later(endWithFade, HOLD_MS);
        }
        scene.render(t);
        raf = requestAnimationFrame(loop);
      } catch (e) { fail(e); }
    }

    function play() {
      if (done || running) return;
      startEl.classList.add('op-hide');
      muteEl.classList.add('op-show');
      try { audio = window.CocomiOpeningAudio ? window.CocomiOpeningAudio.create(muted) : null; } catch (e) { audio = null; }
      if (!audio) muteEl.classList.remove('op-show'); // 音が出せない端末は映像だけ
      running = true;
      t0 = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function onResize() {
      try { scene.resize(); if (!running) scene.render(scene.time()); } catch (e) { fail(e); }
    }
    function onKey(e) { if (e && e.key === 'Escape') skip(); }

    try {
      overlay.appendChild(canvas);
      overlay.appendChild(startEl);
      overlay.appendChild(fadeEl);
      overlay.appendChild(muteEl);
      overlay.appendChild(skipEl);
      document.body.appendChild(overlay);
      scene = window.CocomiOpeningScene.create(canvas);
      if (!scene) throw new Error('canvas 2D 未対応');
      ctl = { skip: skip, destroy: destroy, isActive: function () { return !done; }, seek: seek };
      active = ctl;

      skipEl.addEventListener('click', skip);
      startEl.addEventListener('click', play);
      muteEl.addEventListener('click', function () {
        muted = !muted;
        muteEl.textContent = muted ? '♪ サウンド OFF' : '♪ サウンド ON';
        if (audio) audio.setMuted(muted);
      });
      canvas.addEventListener('click', function () { if (ended) endWithFade(); });
      window.addEventListener('resize', onResize);
      document.addEventListener('keydown', onKey);

      if (reduce) { // 動きを抑える設定: 最終フレームを静止表示（音なし・▶不要）。スキップ可、数秒後に自動で進む
        startEl.classList.add('op-hide');
        scene.render(scene.DUR);
        ended = true;
        later(endWithFade, HOLD_REDUCED_MS);
      } else {
        scene.render(0);
      }
    } catch (e) {
      console.warn('[Opening] 初期化失敗→従来スプラッシュにフォールバック:', e && e.message);
      done = true;
      destroy();
      return null;
    }

    /** 検証用: 指定秒の1フレームを静止表示（再生ループと音は止める） */
    function seek(t) {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      startEl.classList.add('op-hide');
      scene.render(t);
    }

    return ctl;
  }

  window.CocomiOpening = { version: 'v1.0', isSupported: isSupported, start: start };
})();
