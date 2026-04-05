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
├── prompt-builder.js     プロンプト注入共通化モジュール（メモリー/検索/HOTトピック/RAG）
├── api-gemini.js         Gemini API呼び出し
├── api-openai.js         OpenAI API呼び出し
├── api-claude.js         Claude API呼び出し
├── api-common.js         API共通処理（Worker URL/認証トークン管理）
├── chat-group.js         グループチャットモード
├── chat-memory.js        チャット記憶保存・取得
├── chat-history.js       IndexedDB会話履歴
├── chat-ui.js            チャット表示系
├── token-monitor.js      トークン使用量モニター
├── voice-input.js        音声入力（Whisper + Web Speech API）
├── voice-output.js       音声出力（VOICEVOX + Web Speech TTS）
├── consultation-ui.js    相談トピック連携UI
├── meeting-ui.js         会議モードUI
├── meeting-relay.js      会議リレー処理
├── memory-ui.js          記憶管理UI
├── prompts/              プロンプトファイル
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

## COCOMI CI — 品質チェック詳細

cocomi-ci.yml でpush時に自動実行される。**pushする前に全チェック項目を確認すること。**

### ❌ CIが落ちるチェック（HARD FAIL — 必ず守ること）

#### 1. 行数制限（段階制）
- **500行超え → ⚠️ 警告**（CIは通るが分割を検討）
- **550行超え → ❌ CI失敗**（分割必須！）
- 対象: `.js`, `.html`, `.css` ファイル（node_modules, .github除外）
- **★pushする前に必ず `wc -l ファイル名` で行数を確認すること！**
- 追加でファイルが膨らみそうなら、先に分割してから追加する

#### 2. JS構文チェック
- `node --check` で全JSファイルの構文を検証
- 構文エラーがあると❌CI失敗
- **★pushする前に `node --check ファイル名.js` で確認すること！**

#### 3. グローバルクラス定義チェック
- 以下のクラスが `window.ClassName = ` 形式でグローバル定義されてるか確認
  - `VoiceCommand`, `WebSpeechProvider`, `AudioPlaybackManager`, `VoiceUI`
- これらのクラスを移動・リネームしたら❌CI失敗

### ⚠️ 警告のみ（CIは落ちないが意識すること）
- **ESLint**: `.eslintrc.json` に基づく品質チェック（警告のみモード）
- **先頭コメント**: 各JSファイル先頭5行以内に「このファイルは」or「COCOMITalk」が含まれてるか
- **バージョン番号**: 各JSファイルに `v数字.数字` 形式のバージョンが含まれてるか
- **console.log検出**: 件数レポート（開発中のため警告のみ）
- **TODO/FIXME検出**: 件数レポート

### CI合格後
- GitHub Pages自動デプロイ
- LINE通知（成功/失敗ともにアキヤに通知）

### ★ Claude Codeが作業完了前にやるべきこと
1. 変更した全ファイルの行数を `wc -l` で確認（550行超えてないか）
2. 変更したJSファイルを `node --check` で構文確認
3. 500行を超えそうなファイルは役割ごとに分割してからpush
4. 先頭コメントとバージョン番号が入ってるか確認

## ネット検索の活用ルール
Claude Codeは組み込みのWebSearch/WebFetchツールでネット検索が可能。
作業中に不明点があれば**自分で調べて解決する**こと。推測で進めるのは禁止。

### いつ検索すべきか
- APIのエラーコードやエラーメッセージの意味がわからない時
- Gemini / OpenAI / Claude APIの仕様・制限を確認したい時
- PWA（Service Worker、Cache API、IndexedDB等）の仕様を調べたい時
- CSS/HTMLの互換性やモバイル対応を確認したい時
- 新しいWeb API機能やベストプラクティスを確認したい時
- VOICEVOX / Web Speech API等の音声関連APIの仕様確認

### 検索のコツ
- 検索クエリは英語で短く具体的に（例: `Service Worker cache update strategy`）
- エラーメッセージはそのまま検索ワードに含める
- 公式ドキュメント（MDN, developers.google.com等）を優先する
- WebFetchで公式ドキュメントの特定ページを直接取得するのも有効

### 検索してはいけないケース
- COCOMI固有の内部仕様（Worker URL、認証トークン等）→ このCLAUDE.mdや既存コードを参照
- APIキーやシークレット情報を含む検索

## MCP web_search活用ルール（v1.7追加）
cocomi-mcp-serverに`web_search`ツールが搭載されている（v1.4.0）。
MCP経由の検索は**承認ダイアログなし**で実行できるため、組み込みWebSearchより効率的。

### MCP web_searchを優先すべき場面
- 連続して複数の検索が必要な時（承認なしで連続実行できる）
- Cloudflare Workers / D1 / Vectorize の公式ドキュメント確認
- npmパッケージの使い方やバージョン互換性の調査
- エラーメッセージの解決策検索

### 使い方
```
ツール名: web_search
パラメータ:
  query: 検索クエリ（英語推奨、短く具体的に）
  count: 結果数（1-10、デフォルト5）
  language: 検索言語（jp/en、デフォルトen）
  freshness: 鮮度フィルタ（pd=24時間, pw=1週間, pm=1ヶ月）
```

### 使い分け
| 場面 | 推奨ツール | 理由 |
|------|----------|------|
| 連続検索・調査作業 | MCP web_search | 承認不要で効率的 |
| 特定URLのページ取得 | 組み込みWebFetch | URLを直接指定できる |
| 初回の軽い検索 | どちらでもOK | 差は小さい |

### 注意
- MCP web_searchはBrave Search API経由（月1,000クエリ無料枠）
- 不要な検索を連打しない（無料枠を無駄にしない）
- 検索結果はスニペット（要約）のみ。全文が必要ならWebFetchで該当URLを取得

## 現在のバージョン: v3.52（2026-04-06時点）
- チャットUI（1対1＋グループ＋会議モード）
- 三姉妹API接続（Gemini/OpenAI/Claude - Worker中継＋ストリーミング）
- 三姉妹システムプロンプト（3モード: normal/dev/meeting）
- IndexedDB会話履歴
- PWA基盤（manifest + Service Worker）
- トークン使用量モニター
- VOICEVOX音声合成（ここちゃん=ずんだもん、お姉ちゃん=四国めたん、クロちゃん=WhiteCUL）
- 音声入力（Whisper API + Web Speech API）
- Vectorize RAG意味検索
- HOTトピック通知（直近24h新着記憶を自動表示）
- 代弁問題対策済み（ownerベース記憶注入制御 + 代弁禁止テンプレート）
- AI自発的記憶保存（💾SAVEマーカー）
- 相談トピック連携（claude.ai↔COCOMITalk会議室）
- ワイワイモード（Sprint1-3完了）
- ビジョンエンジン v1.2（カメラ+ズーム+解像度3段階切替+CSS分割）
- COCOMI CI配置（cocomi-ci.yml）+ LINE通知
