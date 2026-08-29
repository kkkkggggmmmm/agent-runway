# Agent Runway

ChatGPT WorkとCodexの共有利用枠を、残量だけでなく「何日分先行しているか」「いつ枯渇するか」「今日あと何%使えるか」で判断するローカルダッシュボードです。

## Desktop v0.2

- Windows: NSIS `.exe` / MSI `.msi` インストーラー
- macOS: Universal `.dmg`（Apple Silicon / Intel）
- ネイティブのタスクトレイ／メニューバー常駐
- macOSメニューバーに週次残量を数値表示
- トレイから「開く」「今すぐ更新」「ログイン時の自動起動」「終了」
- ウィンドウを閉じても監視を継続。終了はトレイメニューから明示
- 二重起動を防止し、既存ウィンドウを前面へ復帰
- Rustから `codex app-server` を直接起動するため、デスクトップ版の実行にNode.jsは不要

WorkとCodexを別々に推定配分せず、App Serverが返す共有利用枠を1本のメーターとして扱います。

## Requirements

- Codex CLIがインストール済みで、ChatGPTへサインイン済みであること
- Windows 10以降、またはmacOS 10.15以降

Codexが標準位置にない場合、アプリ起動前に `CODEX_BIN` に実行ファイルの絶対パスを設定できます。macOS版は `/opt/homebrew/bin/codex`、`/usr/local/bin/codex`、`~/.local/bin/codex`、`~/.npm-global/bin/codex`、`~/.volta/bin/codex` も探索します。

## Installers

GitHub Actionsの `Desktop installers` がOSネイティブ環境で次を生成します。

| OS | Artifact | 内容 |
|---|---|---|
| Windows x64 | `agent-runway-windows-x64` | NSIS setup `.exe`、MSI `.msi` |
| macOS Universal | `agent-runway-macos-universal` | Universal `.dmg` |

現在のCI配布物はコード署名証明書を付けない開発ビルドです。WindowsではSmartScreen、macOSではGatekeeperの警告が出る場合があります。一般配布前にDeveloper ID / Windows Authenticode証明書とnotarizationを設定してください。

## Run the desktop app from source

Rust stable、Node.js 22.12以上、各OSのTauriビルド依存関係を用意します。

```bash
npm ci
npm run desktop:dev
```

インストーラーをローカル生成する場合:

```bash
npm run desktop:build
```

## Browser fallback

既存のNodeブリッジも残しています。ライブアカウントで起動する場合:

```bash
npm ci
npm run build
npm start
```

`http://127.0.0.1:4317` を開きます。デモ表示は `AGENT_RUNWAY_DEMO=1 npm start` です。

## Validation

```bash
npm run check
npm run desktop:test
```

Web検証はESLint、22件の自動テスト、TypeScript、本番ビルドを実行します。Rustテストは週次ウィンドウ判定、JSONL App Server接続、更新通知、CLI不在時の復旧状態を検証します。

## Local data and security

デスクトップ版は公式の `codex app-server` stdio JSONLプロトコルを使い、OAuth認証ファイルを直接読みません。ブラウザ保存領域に残すのは週次使用率・観測時刻・リセット時刻と予備枠設定だけです。プロンプト、スレッド、リポジトリパス、メールアドレス、認証情報は保存しません。App Serverのstderrもローカルパス混入を避けるため破棄します。
