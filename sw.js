// COCOMITalk - Service Worker
// このファイルはPWAのオフライン対応とキャッシュを管理する
// v3.15 2026-03-28 - voice-output.js v2.2 クリーンアップ（デバッグパネル削除）
const CACHE_NAME = 'cocomitalk-v3.30';

const CACHE_FILES = [
  './', './index.html', './styles.css', './meeting-styles.css',
  './meeting-archive-styles.css', './app.js', './chat-ui.js',
  './chat-core.js', './chat-group.js', './chat-history.js',
  './token-monitor.js', './api-common.js', './api-gemini.js',
  './api-openai.js', './api-claude.js', './mode-switcher.js',
  './meeting-router.js', './meeting-history.js', './meeting-memory.js',
  './chat-memory.js', './meeting-relay.js', './meeting-doc-actions.js',
  './meeting-ui.js', './meeting-archive-ui.js', './memory-ui.js',
  './memory-import-ui.js', './memory-ui-styles.css', './search-ui.js',
  './search-ui-styles.css', './token-monitor-styles.css',
  './search-caller.js', './tool-registry.js', './prompt-builder.js',
  './meeting-voice.js', './doc-generator.js', './file-handler.js',
  './tts-provider.js', './openai-tts-provider.js',
  './voicevox-tts-provider.js', './speech-provider.js',
  './web-speech-provider.js', './debug-logger.js', './whisper-provider.js',
  './voice-output.js', './voice-ui.js', './audio-health.js',
  './voice-state.js', './voice-command.js', './voice-input.js',
  './voice-sender.js', './app-settings.js',
  './prompts/koko-system.js', './prompts/gpt-system.js',
  './prompts/claude-system.js', './manifest.json',
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
