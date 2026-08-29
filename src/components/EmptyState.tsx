import { RefreshIcon } from "./Icons";

interface EmptyStateProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export const EmptyState = ({ loading, error, onRetry }: EmptyStateProps) => (
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
