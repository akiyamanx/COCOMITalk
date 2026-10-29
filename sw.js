// COCOMITalk - Service Worker
// このファイルはPWAのオフライン対応とキャッシュを管理する
// v3.43 2026-04-06 - お散歩モード改善（会話ラリー一時停止+表示/送信分離）
// v3.60 2026-07-17 - お散歩ゲートPoC A反映（voice-sender v1.1 / vision-ui v1.5 / chat-core v2.2）
// v3.61 2026-07-17 - バッファ待ち窓修正反映（voice-sender v1.2 / vision-ui v1.5.1）
// v3.63 2026-10-28 - 思考の強さ/STTモデル/Gemini TTS追加（model-effort/effort-settings-ui/stt-model/gemini-tts-provider）
// v3.64 2026-10-28 - 5人のGemini TTSの声を割り当て（characters.js / tts-provider.js）
// v3.65 2026-10-28 - 読み上げの既定をGeminiに＋場面ごとの口調切替（tone-style.js追加）
// v3.66 2026-10-28 - お散歩の費用上限（walk-spend-core/walk-spend/walk-spend-ui追加）
// v3.67 2026-10-28 - 画面レイアウト改善（layout-main.css / layout-panels.css / layout-ui.js追加）
// v3.68 2026-10-28 - 画面レイアウトv2（layout2-core.js / layout2-ui.js / layout2-main.css / layout2-panels.css追加）
// v3.69 2026-10-28 - グループの帯の札タップ=話しかけ先（chat-group / layout2-core / layout2-ui / layout2-main.css）
// v3.71 2026-10-28 - グループの帯に準備中の葵・キミも淡く並べる＋🔄つづきを右端に固定（layout2-core / layout2-ui / layout2-main.css）
// v3.72 2026-10-29 - 葵・きみの最小プロンプト追加（prompts/common-env.js / aoi-system.js / kimi-system.js）＋三姉妹に家族の1〜2行＋「きみちゃん」ひらがな統一
// v3.80 2026-10-29 - 目の顔をあたたかいクリーム色＋ほっぺに変更し、避けて動くときのピョン(つぶれて伸びて着地)を追加（mascot-eyes.js/css v1.2）
// v3.81 2026-10-29 - 指示文に今の日本時間の1行を追加（prompt-builder v1.9）、ここちゃんの「あとで調べる」約束だけをやめる（koko-system v1.9）
// v3.82 2026-10-30 - 約束だけで止まった返事の自動フォローアップ（promise-followup.js追加・chat-core v2.4）、Gemini thoughtSignature保持（api-gemini v1.5）、共通プロンプトに1行（common-env v1.2）
// v3.83 2026-10-30 - 「最新の会話へ」ボタン（scroll-latest.js追加）、ツールを使った吹き出しに小さな印、フォローアップ指示の強化
// v3.79 2026-10-29 - 目の顔から口を外し、全画面のbody直下fixed表示に変更（mascot-eyes.js/css v1.1、app.jsで取り付け。名前ボタンは元の位置へ）
// v3.78 2026-10-29 - 上の帯に目が動く小さな顔を追加（mascot-eyes.js / mascot-eyes.css、layout2-ui.jsで取り付け）
// v3.77 2026-10-29 - 配色を落ち着いた青に（styles/design-tokens/layout/各CSSと一部JSの色のみ。姉妹の色は識別用に彩度控えめ）
// v3.76 2026-10-29 - 起動オープニング追加（opening.js / opening-scene.js / opening-audio.js / opening.css）
// v3.75 2026-10-29 - 音が鳴っている間の吹き出しタップで停止できるように（voice-output v2.7 / chat-ui v1.4）
// v3.74 2026-10-29 - 吹き出しタップの二重再生ガード（voice-output v2.6 / voice-input v2.5.1 / chat-ui v1.3 / styles.css）
// v3.73 2026-10-29 - 三姉妹の機能リストを共通定数に統一＋葵(xAI)/きみ(Kimi)のAPIモジュール追加（準備のみ・無効）（api-compat-core / api-xai / api-kimi）
// v3.62 2026-10-28 - モデル3段階化（model-tiers/characters/model-migration/api-openai-responses追加）
// 作成: 葵(Aoi) / 最終更新: 葵(Aoi), 2026-10-29
const CACHE_NAME = 'cocomitalk-v3.83';

const CACHE_FILES = [
  './', './index.html', './design-tokens.css', './styles.css', './meeting-styles.css',
  './meeting-archive-styles.css', './consultation-styles.css', './vision-styles.css', './layout-main.css', './layout-panels.css', './layout-ui.js', './layout2-core.js', './layout2-ui.js', './layout2-main.css', './layout2-panels.css',
  './app.js', './mascot-eyes.js', './mascot-eyes.css', './opening.js', './opening-scene.js', './opening-audio.js', './opening.css', './chat-ui.js',
  './chat-core.js', './chat-group.js', './chat-history.js',
  './model-tiers.js', './model-effort.js', './characters.js', './model-migration.js',
  './token-monitor.js', './walk-spend-core.js', './walk-spend.js', './walk-spend-ui.js', './api-common.js', './api-gemini.js',
  './api-openai.js', './api-openai-responses.js', './api-claude.js', './api-compat-core.js', './api-xai.js', './api-kimi.js', './mode-switcher.js',
  './meeting-router.js', './meeting-history.js', './meeting-memory.js',
  './chat-memory.js', './meeting-relay.js', './meeting-doc-actions.js',
  './meeting-ui.js', './meeting-archive-ui.js', './memory-ui.js',
  './memory-import-ui.js', './memory-ui-styles.css', './search-ui.js',
  './search-ui-styles.css', './token-monitor-styles.css',
  './search-caller.js', './tool-registry.js', './prompt-builder.js', './promise-followup.js', './scroll-latest.js',
  './consultation-ui.js',
  './meeting-voice.js', './doc-generator.js', './file-handler.js',
  './tone-style.js', './tts-provider.js', './openai-tts-provider.js', './gemini-tts-provider.js',
  './voicevox-tts-provider.js', './speech-provider.js',
  './web-speech-provider.js', './debug-logger.js', './whisper-provider.js', './stt-model.js',
  './voice-output.js', './voice-ui.js', './audio-health.js',
  './voice-state.js', './voice-command.js', './voice-input.js',
  './voice-sender.js', './effort-settings-ui.js', './app-settings.js',
  './chat-style-modes.js', './style-resolver.js',
  './escape-hatch-detector.js',
  './vision-engine.js', './vision-ui-controller.js',
  './prompts/common-env.js', './prompts/koko-system.js', './prompts/gpt-system.js',
  './prompts/claude-system.js', './prompts/aoi-system.js', './prompts/kimi-system.js', './manifest.json',
];

const CACHE_FONTS = [
  'https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700&family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] キャッシュ作成: ' + CACHE_NAME);
      await cache.addAll(CACHE_FILES);
      for (const url of CACHE_FONTS) {
        try { await cache.add(url); } catch (e) {
          console.warn('[SW] フォントキャッシュスキップ:', url);
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[SW] 古いキャッシュ削除: ' + key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('generativelanguage.googleapis.com') ||
      url.includes('api.openai.com') ||
      url.includes('api.anthropic.com') ||
      url.includes('workers.dev')) return;

  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || _offlineResponse()))
  );
});

function _offlineResponse() {
  return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>COCOMITalk - オフライン</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#FAF7F4;color:#2D2520;text-align:center;}.msg{padding:20px;}.icon{font-size:48px;margin-bottom:12px;}h2{font-size:18px;margin-bottom:8px;}p{font-size:14px;color:#8B7E74;}</style></head><body><div class="msg"><div class="icon">📡</div><h2>オフラインだよ</h2><p>ネットに繋がったらまた話そうね！🌸</p></div></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
