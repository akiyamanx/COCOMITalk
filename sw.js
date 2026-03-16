// COCOMITalk - Service Worker
// このファイルはPWAのオフライン対応とキャッシュを管理する
// v0.3 Session C - PWA強化（キャッシュ更新＋オフライン画面）
// v0.5 Step 3.5 - 会議系ファイル追加＋キャッシュバージョンアップ
// v0.8 2026-03-09 - meeting-relay v1.2対応
// v0.9 2026-03-09 - meeting-archive-ui v1.1対応
// v1.0 2026-03-09 - Step 5b 音声会話モジュール7ファイル追加
// v1.1 2026-03-09 - STTデバッグ＋キュー再生対応
// v2.2 2026-03-10 - chat-ui.js追加（chat-core.js分割）
// v2.3 2026-03-10 - chat-core.js v1.3メモリー注入対応
// v2.4 2026-03-10 - meeting-memory.js v1.1 AI要約対応
// v2.5 2026-03-11 - meeting-memory.js v1.2 フォールバック品質改善
// v2.6 2026-03-11 - meeting-relay.js v1.5 なりすまし防止（user role修正）
// v2.7 2026-03-11 - meeting-memory.js v1.3 マークダウン記法除去
// v2.8 2026-03-11 - マークダウン除去の正規表現改善

// v2.9 2026-03-12 - memory-ui.js + memory-ui-styles.css 追加（メモリー管理UI）
// v2.10 2026-03-12 - memory-ui-styles.css z-index修正（設定モーダルの上に表示）
// v2.11 2026-03-12 - Phase 2a 検索UI追加（search-ui.js, search-ui-styles.css）
// v2.12 2026-03-12 - 検索結果HTMLタグ除去 + 会議/グループ全モード検索対応
// v2.13 2026-03-11 - prompt-builder.js追加（プロンプト注入共通化）
// v2.15 2026-03-11 - Phase 2c tool-registry.js追加 + api-*.js ToolRegistry統合
// v2.16 2026-03-11 - tool-registry v1.0.1 get_datetime JST修正 + ツール説明強化
// v2.17 2026-03-11 - memory-ui v1.1 検索フィルタ＋一括削除＋件数正確化
// v2.18 2026-03-11 - memory-ui v1.2 期間指定削除 + CSS整備 + Worker limit引き上げ
// v2.19 2026-03-11 - Step 5e 音声コマンド対応(voice-input v1.5 + app.js グローバル関数)
// v2.20 2026-03-11 - voice-input v1.5.1 無音タイマー改善(息継ぎ対策強化)
// v2.21 2026-03-11 - voice-input v1.5.2 コマンド句読点除去修正
// v2.22 2026-03-11 - voice-command.js分離＋voice-input v1.6 try-catch追加（UI固まり防止）
// v2.23 2026-03-11 - voice-input v1.6.1 VoiceCommand未定義でもマイクボタン表示される防御
// v2.25 2026-03-11 - 3バグ全修正: voice-input v1.8 + voice-command v1.1 + voice-send v1.0新規
// v2.32 2026-03-12 - voice-input v1.8.2 送信ロジックをv1.7実績版に戻し（VoiceSend一時停止）
// v2.33 2026-03-12 - voice-input v1.8.3 常時リスニング（無音STT終了→自動リスタート）
// v2.34 2026-03-12 - voice-input v1.8.3 コマンド実行後もリスニング継続
// v2.35 2026-03-12 - voice-input v1.8.3 無音タイマー送信時の二重送信防止
// v2.36 2026-03-12 - voice-input v1.9 送信処理をvoice-sender.js v1.0にmixin分離
// v2.37 2026-03-12 - voice-ui v1.1 リングウェーブ＋呼吸グロー マイクボタンデザイン
// v2.38 2026-03-12 - voice-send.js（旧）削除、voice-sender.js（mixin方式）に統一
// v2.39 2026-03-12 - Step 6 Phase 1: chat-memory.js追加＋voice-command v1.2＋voice-input v1.9.1
// v2.40 2026-03-12 - voice-command v1.2.1 覚えてコマンドパターン拡張
// v2.41 2026-03-12 - chat-memory v1.0.1 保存通知トースト + voice-command v1.2.2 STT揺れ対策
// v2.42 2026-03-12 - 二重送信バグ修正（api-gemini/openai/claude全3社）+ voice-ui v1.1.1 showStatus修正
// v2.43 2026-03-12 - voice-input v1.9.2 showStatus順序修正＋無音タイマー延長（息継ぎ対策）
// v2.44 2026-03-12 - 常時リスニング無音ディレイ7秒に延長（考えながら喋る対応）
// v2.45 2026-03-12 - voice-ui v1.1.2 showStatus5秒保護 + chat-core v1.7 セッション別DL
// v2.46 2026-03-12 - app.js switchToGroup修正（togglePeopleMode使用）
// v2.47 2026-03-12 - app.js switchToSister グループ→1対1自動切替
// v2.48 2026-03-13 - styles.css分割: token-monitor-styles.css新規追加（トークンモニター系CSS分離）
// v2.49 2026-03-13 - AI自発的記憶保存（chat-memory v1.1 + chat-core v1.8 + prompts💾SAVE指示）
// v2.50 2026-03-13 - chat-memory v1.2 Worker側フィルタ対応（type/sister/category）
// v2.51 2026-03-13 - グループモード他姉妹セリフ代弁バグ修正（chat-group v1.4 + prompts更新）
// v2.52 2026-03-13 - 期間指定削除サーバーサイド化（meeting-memory v1.5 + memory-ui v1.3）
// v2.53 2026-03-15 - Step 6 Phase 2: Vectorize RAG（meeting-memory v1.6 + prompt-builder v1.2 + chat-core/group userText渡し）
// v2.54 2026-03-15 - TTS再生速度デフォルト1.25xに変更（voice-input v1.9.3 + voice-command v1.2.3）
// v2.55 2026-03-15 - app-settings v1.1 TTSスピードフォールバック1.25x + 感情温度UI
// v2.56 2026-03-16 - memory-ui v1.5 JST表示対応
// v2.57 2026-03-16 - グループモードファイル添付対応（chat-core v1.9 + chat-group v1.5）
// v2.58 2026-03-16 - ピコンピコン対策＋送信キャンセル音声コマンド＋無音タイマー延長
// v2.59 2026-03-16 - 息継ぎ対策: STTセッション跨ぎテキスト蓄積で途切れ送信防止
// v2.60 2026-03-16 - 蓄積中のSTT再スタートでテキスト・タイマーが消える問題修正
// v2.61 2026-03-16 - continuous:trueでピコンピコン根本解決＋コード大幅簡素化
// v2.62 2026-03-16 - voice-input/web-speech-providerをv2.57時点に復元＋voice-command v1.3のみ維持
const CACHE_NAME = 'cocomitalk-v2.62';

// v0.5更新 - 会議系・API系ファイル追加
const CACHE_FILES = [
  './',
  './index.html',
  './styles.css',
  './meeting-styles.css',
  './meeting-archive-styles.css',
  './app.js',
  './chat-ui.js',
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
  './meeting-memory.js',
  './chat-memory.js',
  './meeting-relay.js',
  './meeting-doc-actions.js',
  './meeting-ui.js',
  './meeting-archive-ui.js',
  './memory-ui.js',
  './memory-ui-styles.css',
  './search-ui.js',
  './search-ui-styles.css',
  './token-monitor-styles.css',
  './search-caller.js',
  './tool-registry.js',
  './prompt-builder.js',
  './meeting-voice.js',
  './doc-generator.js',
  './file-handler.js',
  './tts-provider.js',
  './openai-tts-provider.js',
  './voicevox-tts-provider.js',
  './speech-provider.js',
  './web-speech-provider.js',
  './voice-output.js',
  './voice-ui.js',
  './voice-command.js',
  './voice-input.js',
  './voice-sender.js',
  './app-settings.js',
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
