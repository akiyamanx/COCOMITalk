// COCOMITalk - Service Worker
// このファイルはPWAのオフライン対応とキャッシュを管理する
// v0.3 Session C - PWA強化（キャッシュ更新＋オフライン画面）
// v0.5 Step 3.5 - 会議系ファイル追加＋キャッシュバージョンアップ

const CACHE_NAME = 'cocomitalk-v0.5';

// v0.5更新 - 会議系・API系ファイル追加
const CACHE_FILES = [
  './',
  './index.html',
  './styles.css',
  './meeting-styles.css',
  './app.js',
  './chat-core.js',
  './chat-group.js',
  './chat-history.js',
  './token-monitor.js',
  './api-common.js',
  './api-gemini.js',
  './api-openai.js',
  './api-claude.js',
  './mode-switcher.js',
  './meeting-router.js',
  './meeting-history.js',
  './meeting-relay.js',
  './meeting-ui.js',
  './meeting-archive-ui.js',
  './doc-generator.js',
  './file-handler.js',
  './prompts/koko-system.js',
  './prompts/gpt-system.js',
  './prompts/claude-system.js',
  './manifest.json',
];

// フォント（外部CDN）もキャッシュ
const CACHE_FONTS = [
  'https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700&family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap',
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] キャッシュ作成: ' + CACHE_NAME);
      // メインファイルは必須キャッシュ
      await cache.addAll(CACHE_FILES);
      // フォントは失敗しても無視（オフラインでもフォールバックがある）
      for (const url of CACHE_FONTS) {
        try { await cache.add(url); } catch (e) {
          console.warn('[SW] フォントキャッシュスキップ:', url);
        }
      }
    })
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] 古いキャッシュ削除: ' + key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// フェッチ時: ネットワーク優先、失敗時キャッシュ
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // API呼び出しはキャッシュしない
  if (url.includes('generativelanguage.googleapis.com') ||
      url.includes('api.openai.com') ||
      url.includes('api.anthropic.com') ||
      url.includes('workers.dev')) {
    return;
  }

  // Google Fontsはキャッシュ優先（変わらないから）
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

  // その他: ネットワーク優先、失敗時キャッシュ
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 成功したらキャッシュを更新
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request).then((cached) => {
          return cached || _offlineResponse();
        });
      })
  );
});

// v0.3追加 - オフライン時のフォールバック
function _offlineResponse() {
  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>COCOMITalk - オフライン</title>
<style>
  body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
  height:100vh;margin:0;background:#FAF7F4;color:#2D2520;text-align:center;}
  .msg{padding:20px;}
  .icon{font-size:48px;margin-bottom:12px;}
  h2{font-size:18px;margin-bottom:8px;}
  p{font-size:14px;color:#8B7E74;}
</style></head><body>
<div class="msg">
  <div class="icon">📡</div>
  <h2>オフラインだよ</h2>
  <p>ネットに繋がったらまた話そうね！🌸</p>
</div></body></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
