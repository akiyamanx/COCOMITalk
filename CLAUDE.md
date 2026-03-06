# COCOMITalk - COCOMI Family AI会話アプリ

## プロジェクト概要
COCOMI Family（三姉妹AI）と会話できるPWAアプリ。
ここちゃん（Gemini）・GPTお姉ちゃん（OpenAI）・クロちゃん（Claude）の
人格をプロンプトで注入し、内容に応じてモデルを自動切替するスマートルーティング搭載。

## プロジェクトルール
- 1ファイル500行以内（大きくなったら役割ごとに分割）
- 日本語コメント必須（各ファイル先頭に「このファイルは何をするか」）
- バージョン番号＋変更コメント（例: `// v0.2追加 - API接続機能`）
- 新機能は既存コードを壊さず追加（改善提案は相談の上で変更OK）
- コード内コメントは日本語で書く

## 技術スタック
- PWA（HTML/CSS/JS）- フレームワーク不使用
- Gemini API / OpenAI API / Claude API
- IndexedDB（会話履歴）- Phase 1c以降
- GitHub Pages公開

## ファイル構成
```
COCOMITalk/
├── index.html            メインHTML（スプラッシュ＋チャットUI）
├── styles.css            スタイル
├── app.js                アプリ初期化・画面管理
├── chat-core.js          チャットUI・メッセージ管理
├── persona-router.js     三姉妹人格切り替え＋プロンプト構築（Session B）
├── smart-router.js       内容別モデル自動選択（Session C）
├── api-gemini.js         Gemini API呼び出し（Session B）
├── api-openai.js         OpenAI API呼び出し（Session C）
├── api-claude.js         Claude API呼び出し（Session C）
├── chat-history.js       IndexedDB会話履歴（Session C）
├── token-monitor.js      トークン使用量モニター（Session D）
├── voice-io.js           音声入出力（Phase 2）
├── prompts/              プロンプトファイル（Session B）
│   ├── koko-system.js    ここちゃん用システムプロンプト
│   ├── gpt-system.js     GPTお姉ちゃん用
│   └── claude-system.js  クロちゃん用
├── sw.js                 Service Worker
├── manifest.json         PWA設定
└── CLAUDE.md             このファイル
```

## 設計思想: 器と魂の分離
- 「魂」= COCOMIOSファイル（プロンプト）→ 三姉妹の人格を定義
- 「器」= AIモデル（API）→ 内容に応じて最適なモデルを選択
- 同じ人格プロンプトを安いモデルに注入して日常会話をカバー
- 深い相談・技術的な話題の時だけ高品質モデルに切替

## COCOMI CI
- cocomi-ci.yml で品質チェック
- 500行制限、コメント・バージョン番号確認
- LINE通知（GitHub Pages URL含む）

## 現在のバージョン: v0.4（Session D）
- チャットUI表示
- 三姉妹タブ切替
- Gemini API接続（ここちゃん会話）
- IndexedDB会話履歴
- PWA基盤（manifest + Service Worker）
- トークン使用量モニター（月別集計＋料金概算）
