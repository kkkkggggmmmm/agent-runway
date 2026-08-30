import { RefreshIcon } from "./Icons";
import { getMobileAccessToken, isCloudMobileEntry } from "../lib/mobile";

interface EmptyStateProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export const EmptyState = ({ loading, error, onRetry }: EmptyStateProps) => (
  <ConnectionState loading={loading} error={error} onRetry={onRetry} />
);

const ConnectionState = ({ loading, error, onRetry }: EmptyStateProps) => {
  const mobileEntry = isCloudMobileEntry();
  const hasMobileToken = getMobileAccessToken() !== null;

  if (mobileEntry) {
    const needsPairing = !hasMobileToken;
    return (
      <main className="empty-shell">
        <div className="empty-card">
          <div className="empty-mark" aria-hidden="true">AR</div>
          <p className="section-kicker">MOBILE COMPANION</p>
          <h1>{loading ? "スマホ接続を確認しています" : needsPairing ? "スマホ接続リンクが必要です" : "接続リンクを確認できません"}</h1>
          <p>{loading
            ? "利用枠の安全な同期を確認しています。"
            : needsPairing
              ? "この公開ページだけでは利用枠を表示しません。PC版から発行した専用リンクで開いてください。"
              : error}</p>
          {!loading ? (
            <>
              <ul>
                <li>PC版Agent Runwayで「iPhone / Androidで見る」をオンにします</li>
                <li>表示されたQRコードをこのスマホで読み取ります</li>
                <li>共有を停止または接続コードを再発行すると、以前のリンクは無効になります</li>
              </ul>
              {!needsPairing ? (
                <button className="retry-button" type="button" onClick={onRetry}>
                  <RefreshIcon /> 再接続
                </button>
              ) : null}
            </>
          ) : <div className="loading-line" />}
        </div>
      </main>
    );
  }

  return (
    <main className="empty-shell">
      <div className="empty-card">
        <div className="empty-mark" aria-hidden="true">AR</div>
        <p className="section-kicker">LOCAL CONNECTION</p>
        <h1>{loading ? "利用枠を取得しています" : "Codexへ接続できません"}</h1>
        <p>{loading ? "公式App Serverの応答を待っています。" : error}</p>
        {!loading ? (
          <>
            <ul>
              <li>`codex` がインストールされ、PATHから実行できること</li>
              <li>CodexでChatGPTアカウントにサインイン済みであること</li>
              <li>デモ確認では `AGENT_RUNWAY_DEMO=1 npm run dev:all` を使うこと</li>
            </ul>
            <button className="retry-button" type="button" onClick={onRetry}>
              <RefreshIcon /> 再接続
            </button>
          </>
        ) : <div className="loading-line" />}
      </div>
    </main>
  );
};
