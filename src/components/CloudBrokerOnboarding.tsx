import type { CloudBrokerStatus } from "../lib/cloud-broker";

interface CloudBrokerOnboardingProps {
  loading: boolean;
  status: CloudBrokerStatus | null;
  error: string | null;
  onStartLogin: () => void;
}

export const CloudBrokerOnboarding = ({
  loading,
  status,
  error,
  onStartLogin,
}: CloudBrokerOnboardingProps) => {
  const pending = status?.state === "login_pending";
  const unavailable = status?.state === "unavailable";

  return (
    <main className="cloud-onboarding-shell">
      <section className="cloud-onboarding-card" aria-live="polite">
        <p className="section-kicker">AGENT RUNWAY · MOBILE</p>
        <h1>{pending ? "OpenAIアカウントを接続" : "スマホ単独モード"}</h1>
        {loading && !status ? <p>安全な接続状態を確認しています…</p> : null}

        {!status && !loading ? (
          <p>この端末は、最初に発行された一回限りの初期設定リンクから接続します。リンクをもう一度開いてください。</p>
        ) : null}

        {status?.state === "signed_out" ? (
          <>
            <p>MacやTailscaleは不要です。この端末からOpenAIへ一度だけ接続すると、以後は利用枠を直接更新できます。</p>
            <button className="primary-button" type="button" disabled={loading} onClick={onStartLogin}>
              {loading ? "接続準備中…" : "OpenAIで接続する"}
            </button>
          </>
        ) : null}

        {pending ? (
          <div className="cloud-login-card">
            <p>下の接続コードを確認し、OpenAIの画面で入力してください。認証情報はこのアプリへ送られません。</p>
            {status.userCode ? <code className="device-code" aria-label="OpenAI接続コード">{status.userCode}</code> : null}
            <a className="primary-button external-link" href={status.verificationUrl} target="_blank" rel="noreferrer">OpenAIでコードを入力</a>
            <p className="quiet-note">ログイン完了後、この画面は自動的に利用枠表示へ切り替わります。</p>
          </div>
        ) : null}

        {unavailable ? <p>サービスを起動できません：{status.error}</p> : null}
        {error ? <p className="setting-error" role="alert">{error}</p> : null}
        <p className="cloud-privacy-note">利用枠だけを表示します。会話、プロンプト、リポジトリ、メールアドレスはこの画面に保存・表示しません。</p>
      </section>
    </main>
  );
};
