import { usePwaInstall } from "../hooks/usePwaInstall";

export const InstallPrompt = () => {
  const install = usePwaInstall();
  if (!install.visible) return null;

  const instruction = install.platform === "ios"
    ? "Safariの共有ボタンから「ホーム画面に追加」を選ぶと、アプリとして使えます。"
    : "ブラウザのメニューから「アプリをインストール」を選ぶと、ホーム画面から開けます。";

  return (
    <aside className="install-prompt" aria-label="スマホへインストール">
      <div>
        <strong>ホーム画面にAgent Runwayを追加</strong>
        <p>{install.canPrompt ? "1タップでアプリとしてインストールできます。" : instruction}</p>
      </div>
      <div className="install-actions">
        {install.canPrompt ? (
          <button type="button" className="primary-button" onClick={() => void install.install()}>インストール</button>
        ) : null}
        <button type="button" className="quiet-button" onClick={install.dismiss}>あとで</button>
      </div>
    </aside>
  );
};
