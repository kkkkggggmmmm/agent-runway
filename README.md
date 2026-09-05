# Agent Runway

ChatGPT WorkとCodexの共有利用枠を、残量だけでなく「何日分先行しているか」「いつ枯渇するか」「今日あと何%使えるか」で判断するローカルダッシュボードです。

## Desktop + mobile v0.5

- Windows: NSIS `.exe` / MSI `.msi` インストーラー
- macOS: Universal `.dmg`（Apple Silicon / Intel）
- ネイティブのタスクトレイ／メニューバー常駐
- macOSメニューバーに週次残量を数値表示
- トレイから「開く」「今すぐ更新」「ログイン時の自動起動」「終了」
- ウィンドウを閉じても監視を継続。終了はトレイメニューから明示
- 二重起動を防止し、既存ウィンドウを前面へ復帰
- Rustから `codex app-server` を直接起動するため、デスクトップ版の実行にNode.jsは不要
- iPhone / Androidへホーム画面インストールできるPWA companion
- 常設HTTPSリンク、QRコードペアリング、Bearer認証、いつでも無効化・再発行
- スマホが一時的にオフラインでも最後の正常な利用枠を表示
- **Cloud Broker mode**：Macを起動せず、スマホ単独で利用枠を更新するPWA

WorkとCodexを別々に推定配分せず、App Serverが返す共有利用枠を1本のメーターとして扱います。

## Requirements

- Codex CLIがインストール済みで、ChatGPTへサインイン済みであること
- Windows 10以降、またはmacOS 10.15以降

Codexが標準位置にない場合、アプリ起動前に `CODEX_BIN` に実行ファイルの絶対パスを設定できます。macOS版は `/opt/homebrew/bin/codex`、`/usr/local/bin/codex`、`~/.local/bin/codex`、`~/.npm-global/bin/codex`、`~/.volta/bin/codex` も探索します。

## iPhone / Android setup — desktop companion

1. PC版Agent Runwayの「iPhone / Androidで見る」を有効にします。
2. 表示されたQRコードをスマホで読み取ります。実際に使うURLは `https://agent-runway-mobile.keijimizoguchi.chatgpt.site/#access_token=…` 形式です。
3. iPhoneはSafariの共有メニューから「ホーム画面に追加」、Androidはブラウザの「アプリをインストール」を選びます。

PC版はトレイで起動したままにしてください。PC版は更新時と5分ごとに、利用枠・観測時刻・リセット時刻だけを同期します。Codex認証、プロンプト、会話、ローカルパスは同期しません。接続コードを再発行または共有を停止すると、以前のリンクは直ちに無効になります。

## Smartphone-only setup — Cloud Broker

Cloud Brokerは、Mac・Tailscale・QRなしでiPhone／Androidから利用枠を更新するための単一ユーザー用構成です。PWAと内部のCodex App Serverを同じTLSドメインで動かし、App Serverは外部へ公開しません。

1. Docker対応の**永続コンテナホスト**を用意し、`/home/agentrunway` を非公開の永続ボリュームとして割り当てます。推奨のFly.io設定はリポジトリの `fly.toml` に用意済みです。
2. それぞれ異なる64文字以上の `AGENT_RUNWAY_BOOTSTRAP_TOKEN` と `AGENT_RUNWAY_SESSION_SECRET` をホストのシークレットとして設定します。例：`openssl rand -hex 32`
3. コンテナをHTTPSドメインへ公開し、`https://<your-domain>/api/health` が `{"status":"ok"}` を返すことを確認します。
4. 初回だけ `https://<your-domain>/#setup=<AGENT_RUNWAY_BOOTSTRAP_TOKEN>` をこのスマホで開きます。トークンはURLフラグメントに置かれ、サーバーログに送られず、接続後は無効化されます。
5. 画面の「OpenAIで接続する」からデバイスコード認証を一度だけ実施します。以後は通常URLをホーム画面へインストールして使えます。

Cloud BrokerのPWAが取得・表示するのは認証の準備状態、プラン種別、App Serverの利用枠だけです。会話、プロンプト、スレッド、リポジトリ、メールアドレス、OAuthファイルはブラウザにもアプリのデータベースにも保存しません。

`Deploy cloud broker` GitHub Actionは手動実行専用で、対象アプリだけに限定したFlyデプロイトークンを使います。`docker compose -f docker-compose.cloud.yml` はローカル／自己管理ホスト用です。プロダクションでは必ずTLSを終端するホストを使ってください。Vercel FunctionsやSupabase Edge Functionsのような永続プライベートボリュームを持たない実行環境は、App Server認証の保存先として使いません。初回設定のコマンドは [Cloud Broker deployment](docs/cloud-broker-deployment.md) を参照してください。

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

Web検証はESLint、45件の自動テスト、TypeScript、本番ビルドを実行します。Rustテストは週次ウィンドウ判定、JSONL App Server接続、更新通知、CLI不在時の復旧状態、モバイル接続コードを検証します。CIではCloud BrokerのDockerイメージも起動し、非root実行とヘルスチェックを確認します。

## Local data and security

デスクトップ版は公式の `codex app-server` stdio JSONLプロトコルを使い、OAuth認証ファイルを直接読みません。スマホへ共有するのはApp Serverが返した利用枠、観測時刻、リセット時刻だけです。同期行にはブラウザから直接アクセスできず、専用Edge Functionが256ビット接続コードを照合して必要なスナップショットだけを返します。接続コードはURLフラグメントで受け渡すためHTTPログへ送られず、以降はAuthorizationヘッダーで照合します。

ブラウザ保存領域に残すのは利用枠スナップショット、観測時刻、リセット時刻、予備枠設定、スマホ接続コードだけです。プロンプト、スレッド、リポジトリパス、メールアドレス、Codex認証情報は保存・共有しません。ローカルHTTPサーバーは引き続き `127.0.0.1` のみにbindし、App Serverのstderrもローカルパス混入を避けるため破棄します。
