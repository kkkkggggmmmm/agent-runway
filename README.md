# Agent Runway

ChatGPT WorkとCodexの共有利用枠を、残量ではなく「何日分先行しているか」「いつ枯渇するか」「今日あと何%使えるか」で判断するローカルダッシュボードです。

## What is implemented

- Work + Codexの共有週次枠と、App Serverが報告する全ウィンドウ
- 経過率との差から算出する先行消費／余裕（日数換算）
- 予備枠を除いた「今日あと使える量」
- 直近24時間の観測から算出する枯渇予測と信頼度
- リセット、リセット時刻変更、枠の追加・消失の検知
- CLI不在・データ欠損・古いデータを明示する復旧可能な状態
- デモfixtureと、App Serverプロトコルを含む自動テスト

WorkとCodexを別々に推定配分することはしません。公式に共有される利用枠を1本のメーターとして扱います。

## Requirements

- Node.js 22.12以上
- ライブ表示では、`codex` CLIがインストール済みでChatGPTへサインイン済みであること

## Run with a live Codex account

```bash
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4317`.

実行ファイルがPATH上にない場合は `CODEX_BIN=/absolute/path/to/codex`、ポートを変える場合は `AGENT_RUNWAY_PORT=4321` を指定します。

## Run in demo mode

```bash
npm ci
npm run build
AGENT_RUNWAY_DEMO=1 npm start
```

Open `http://127.0.0.1:4317`. デモ値であることが画面上に常時表示されます。

UI開発時は次のコマンドを使えます。

```bash
AGENT_RUNWAY_DEMO=1 npm run dev:all
```

## Validation

```bash
npm run check
```

`npm run check` はESLint、18件の自動テスト、TypeScript、本番ビルドを実行します。

## Local data and security

ローカルブリッジは `127.0.0.1` のみにbindし、公式の `codex app-server` stdio JSONLプロトコルを使います。OAuth認証ファイルは読みません。ブラウザ保存領域に残すのは週次使用率・観測時刻・リセット時刻と予備枠設定だけで、プロンプト、スレッド、リポジトリパス、メールアドレス、認証情報は保存しません。

## Current packaging

v0.1.0はローカルWeb UI + Nodeブリッジです。ネイティブのメニューバー／トレイ常駐と署名済みインストーラーは次のパッケージング工程に分離しています。
