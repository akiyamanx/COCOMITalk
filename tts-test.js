// tts-test.js v1.1
// このファイルはTTS声聴き比べテストツールのスクリプト部分
// OpenAI TTSとVOICEVOX(tts.quest)の声を試聴して三姉妹への割り当てを確定する
// v1.0 2026-03-09 Step 5a - OpenAI TTS 6voice比較
// v1.1 2026-03-09 VOICEVOX試聴機能追加

'use strict';

// 状態管理
let currentAudio = null;
let isPlaying = false;

// 設定の保存・復元（LocalStorage）
const LS_KEY = 'cocomi-tts-test';

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  // 保存済み設定を復元
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const cfg = JSON.parse(saved);
      if (cfg.workerUrl) document.getElementById('worker-url').value = cfg.workerUrl;
      if (cfg.authToken) document.getElementById('auth-token').value = cfg.authToken;
      if (cfg.speed) {
        document.getElementById('speed').value = cfg.speed;
        document.getElementById('speed-val').textContent = cfg.speed;
      }
      // v1.1追加 - VOICEVOXのAPIキー復元
      if (cfg.vvApiKey) document.getElementById('vv-api-key').value = cfg.vvApiKey;
      // v1.1追加 - 割り当て復元
      if (cfg.vvAssignKoko) document.getElementById('vv-assign-koko').value = cfg.vvAssignKoko;
      if (cfg.vvAssignGpt) document.getElementById('vv-assign-gpt').value = cfg.vvAssignGpt;
      if (cfg.vvAssignClaude) document.getElementById('vv-assign-claude').value = cfg.vvAssignClaude;
    }
  } catch (e) { /* 初回は無視 */ }

  // スピードスライダー
  document.getElementById('speed').addEventListener('input', (e) => {
    document.getElementById('speed-val').textContent = e.target.value;
  });

  // プリセットボタン
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('tts-text').value = btn.dataset.text;
    });
  });

  // 設定変更時に自動保存
  ['worker-url', 'auth-token', 'speed', 'vv-api-key'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveConfig);
  });
  // v1.1追加 - 割り当て変更時も保存
  ['vv-assign-koko', 'vv-assign-gpt', 'vv-assign-claude'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveConfig);
  });
});

// 設定をLocalStorageに保存
function saveConfig() {
  try {
    const cfg = {
      workerUrl: document.getElementById('worker-url').value.trim(),
      authToken: document.getElementById('auth-token').value.trim(),
      speed: document.getElementById('speed').value,
      // v1.1追加
      vvApiKey: document.getElementById('vv-api-key').value.trim(),
      vvAssignKoko: document.getElementById('vv-assign-koko').value,
      vvAssignGpt: document.getElementById('vv-assign-gpt').value,
      vvAssignClaude: document.getElementById('vv-assign-claude').value,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch (e) { /* 無視 */ }
}

// ═══════════════════════════════════════════
// OpenAI TTS再生
// ═══════════════════════════════════════════

// OpenAI TTSの音声を再生
async function playVoice(voice, btnEl) {
  const workerUrl = document.getElementById('worker-url').value.trim();
  const authToken = document.getElementById('auth-token').value.trim();
  const text = document.getElementById('tts-text').value.trim();
  const speed = parseFloat(document.getElementById('speed').value);

  if (!workerUrl) { setStatus('Worker URLを入力してね', 'error'); return; }
  if (!authToken) { setStatus('認証トークンを入力してね', 'error'); return; }
  if (!text) { setStatus('テキストを入力してね', 'error'); return; }
  if (text.length > 500) { setStatus('テキストは500文字以内にしてね', 'error'); return; }

  stopAll();
  setStatus(`${voice} を生成中...`, '');
  if (btnEl) btnEl.disabled = true;

  const startTime = performance.now();

  try {
    const endpoint = `${workerUrl.replace(/\/+$/, '')}/tts-test`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-COCOMI-AUTH': authToken },
      body: JSON.stringify({ text, voice, speed, model: 'tts-1' }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg;
      try { errMsg = JSON.parse(errText).error; } catch { errMsg = errText; }
      throw new Error(errMsg || `HTTP ${res.status}`);
    }

    const audioBlob = await res.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const latency = Math.round(performance.now() - startTime);
    updateLatency(voice, latency);

    currentAudio = new Audio(audioUrl);
    isPlaying = true;

    const card = document.getElementById(`card-${voice}`);
    if (card) card.classList.add('playing');
    document.querySelectorAll('.voice-btn').forEach(b => b.classList.remove('playing'));
    if (btnEl && btnEl.classList.contains('voice-btn')) btnEl.classList.add('playing');

    currentAudio.addEventListener('ended', () => {
      isPlaying = false;
      if (card) card.classList.remove('playing');
      document.querySelectorAll('.voice-btn').forEach(b => b.classList.remove('playing'));
      setStatus(`${voice} 再生完了 (${latency}ms)`, 'success');
      URL.revokeObjectURL(audioUrl);
    });
    currentAudio.addEventListener('error', () => {
      setStatus('音声の再生に失敗しました', 'error');
    });

    await currentAudio.play();
    setStatus(`${voice} 再生中... (${latency}ms)`, 'success');
  } catch (err) {
    setStatus(`エラー: ${err.message}`, 'error');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// ═══════════════════════════════════════════
// 共通ユーティリティ
// ═══════════════════════════════════════════

// 全停止
function stopAll() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    if (currentAudio.src && currentAudio.src.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = null;
  }
  isPlaying = false;
  document.querySelectorAll('.sister-card').forEach(c => c.classList.remove('playing'));
  document.querySelectorAll('.voice-btn').forEach(b => b.classList.remove('playing'));
  document.querySelectorAll('.vv-char-btn').forEach(b => b.classList.remove('playing'));
}

// レイテンシ表示更新
function updateLatency(voice, ms) {
  const el1 = document.getElementById(`lat-${voice}`);
  const el2 = document.getElementById(`lat2-${voice}`);
  const text = `${ms}ms`;
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = text;
}

// ステータスバー更新
function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status-bar';
  if (type) el.classList.add(type);
}

// ═══════════════════════════════════════════
// v1.1追加 - VOICEVOX tts.quest API 再生
// ═══════════════════════════════════════════

/**
 * VOICEVOX話者IDで音声を再生する
 * tts.quest非公式Web APIを直接呼び出し（Worker不要）
 * @param {number} speakerId - 話者ID（整数）
 * @param {HTMLElement} btnEl - クリックされたボタン要素
 */
async function playVV(speakerId, btnEl) {
  const text = document.getElementById('tts-text').value.trim();
  if (!text) { setStatus('テキストを入力してね', 'error'); return; }
  if (text.length > 200) { setStatus('VOICEVOX用テキストは200文字以内にしてね', 'error'); return; }

  stopAll();
  if (btnEl) btnEl.classList.add('playing');
  setStatus(`VOICEVOX ID:${speakerId} を生成中...`, '');

  const startTime = performance.now();

  try {
    const audio = await _fetchVVAudio(speakerId, text);
    const latency = Math.round(performance.now() - startTime);
    const latEl = document.getElementById(`vvlat-${speakerId}`);
    if (latEl) latEl.textContent = `${latency}ms`;

    currentAudio = audio;
    isPlaying = true;

    audio.addEventListener('ended', () => {
      isPlaying = false;
      if (btnEl) btnEl.classList.remove('playing');
      setStatus(`VOICEVOX ID:${speakerId} 再生完了 (${latency}ms)`, 'success');
    });
    audio.addEventListener('error', () => {
      isPlaying = false;
      if (btnEl) btnEl.classList.remove('playing');
      setStatus('VOICEVOX音声の再生に失敗しました', 'error');
    });

    await audio.play();
    setStatus(`VOICEVOX ID:${speakerId} 再生中... (${latency}ms)`, 'success');
  } catch (err) {
    if (btnEl) btnEl.classList.remove('playing');
    setStatus(`VOICEVOX エラー: ${err.message}`, 'error');
  }
}

/**
 * tts.quest APIから音声を取得する共通関数
 * @param {number} speakerId - 話者ID
 * @param {string} text - テキスト
 * @returns {Promise<HTMLAudioElement>}
 */
async function _fetchVVAudio(speakerId, text) {
  const apiKey = document.getElementById('vv-api-key').value.trim();
  let url = `https://api.tts.quest/v3/voicevox/synthesis?speaker=${speakerId}&text=${encodeURIComponent(text)}`;
  if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`tts.quest API HTTP ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.mp3StreamingUrl && !data.mp3DownloadUrl) {
    throw new Error('音声URLが取得できませんでした');
  }

  // mp3DownloadUrlを優先（全生成後に再生→途切れ防止）
  const audioUrl = data.mp3DownloadUrl || data.mp3StreamingUrl;
  return new Audio(audioUrl);
}

/**
 * 三姉妹割り当てテスト — 個別再生
 */
async function playVVAssign(sister) {
  const selectEl = document.getElementById(`vv-assign-${sister}`);
  if (!selectEl) return;
  const speakerId = parseInt(selectEl.value, 10);
  const text = document.getElementById('tts-text').value.trim();
  if (!text) { setStatus('テキストを入力してね', 'error'); return; }

  stopAll();
  setStatus(`${sister} の声テスト中... (ID:${speakerId})`, '');

  try {
    const audio = await _fetchVVAudio(speakerId, text);
    currentAudio = audio;
    isPlaying = true;
    audio.addEventListener('ended', () => {
      isPlaying = false;
      setStatus(`${sister} 再生完了`, 'success');
    });
    await audio.play();
  } catch (err) {
    setStatus(`エラー: ${err.message}`, 'error');
  }
}

/**
 * 三姉妹まとめて順番に再生
 */
async function playVVAllSisters() {
  const text = document.getElementById('tts-text').value.trim();
  if (!text) { setStatus('テキストを入力してね', 'error'); return; }

  stopAll();
  const sisters = [
    { id: 'koko', label: '🌸 ここちゃん' },
    { id: 'gpt', label: '🌙 お姉ちゃん' },
    { id: 'claude', label: '🔮 クロちゃん' },
  ];

  for (let i = 0; i < sisters.length; i++) {
    const s = sisters[i];
    const speakerId = parseInt(document.getElementById(`vv-assign-${s.id}`).value, 10);
    setStatus(`${s.label} (ID:${speakerId}) 再生中...`, 'success');

    try {
      const audio = await _fetchVVAudio(speakerId, text);
      currentAudio = audio;
      isPlaying = true;
      await new Promise((resolve) => {
        audio.addEventListener('ended', resolve);
        audio.addEventListener('error', resolve);
        audio.play().catch(resolve);
      });
      isPlaying = false;
      // 姉妹間に500msの間を空ける
      if (i < sisters.length - 1) await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      setStatus(`${s.label} エラー: ${err.message}`, 'error');
    }
  }
  setStatus('三姉妹全員の再生完了！', 'success');
}

/**
 * VOICEVOX全話者リストをAPIから取得して表示
 */
async function loadVVSpeakers() {
  const listEl = document.getElementById('vv-full-list');
  listEl.innerHTML = '<span style="color:var(--dim);font-size:0.8em;">読み込み中...</span>';

  try {
    const res = await fetch('https://api.tts.quest/v3/voicevox/speakers_array');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const speakers = await res.json();

    listEl.innerHTML = '';
    speakers.forEach(sp => {
      const btn = document.createElement('button');
      btn.className = 'vv-char-btn';
      btn.innerHTML = `<span class="vv-name">${sp.name}</span><span class="vv-style">ID:${sp.id}</span><span class="vv-lat" id="vvlat-${sp.id}"></span>`;
      btn.addEventListener('click', () => playVV(sp.id, btn));
      listEl.appendChild(btn);
    });
    setStatus(`${speakers.length}人の話者を取得しました`, 'success');
  } catch (err) {
    listEl.innerHTML = `<span style="color:#ff6b6b;font-size:0.8em;">取得失敗: ${err.message}</span>`;
    setStatus(`話者リスト取得エラー: ${err.message}`, 'error');
  }
}
