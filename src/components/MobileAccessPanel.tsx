import { useEffect, useState } from "react";
import type { MobileAccessInfo } from "../lib/runtime";

interface MobileAccessPanelProps {
  info: MobileAccessInfo;
  loading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onRotateToken: () => void;
}

export const MobileAccessPanel = ({ info, loading, onEnabledChange, onRotateToken }: MobileAccessPanelProps) => {
  const [qrCode, setQrCode] = useState<{ url: string; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!info.pairingUrl) return;
    const pairingUrl = info.pairingUrl;
    void import("qrcode")
      .then(({ toDataURL }) => toDataURL(pairingUrl, {
        width: 240,
        margin: 1,
        color: { dark: "#111827", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }))
      .then((dataUrl) => {
        if (!cancelled) setQrCode({ url: pairingUrl, dataUrl });
      });
    return () => {
      cancelled = true;
    };
  }, [info.pairingUrl]);

  const currentQrCode = qrCode?.url === info.pairingUrl ? qrCode.dataUrl : null;

  const copyPairingUrl = async () => {
    if (!info.pairingUrl) return;
    await navigator.clipboard.writeText(info.pairingUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const rotate = () => {
    if (window.confirm("現在接続しているスマホは切断されます。接続コードを再発行しますか？")) onRotateToken();
  };

  return (
    <section className="mobile-access-card">
      <div className="card-heading compact">
        <div>
          <p className="section-kicker">MOBILE COMPANION</p>
          <h2>iPhone / Androidで見る</h2>
        </div>
        <label className="switch-control">
          <span className="visually-hidden">スマホ共有を有効にする</span>
          <input
            type="checkbox"
            role="switch"
            checked={info.enabled}
            disabled={loading}
            onChange={(event) => onEnabledChange(event.currentTarget.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </label>
      </div>

      <p className="mobile-access-copy">
        Codexの認証情報はこのPCに残したまま、利用枠の数値だけを暗号化された専用リンクへ同期します。リンクはいつでも停止・再発行できます。
      </p>

      {info.error ? <p className="setting-error mobile-error" role="alert">{info.error}</p> : null}

      {info.ready && info.pairingUrl ? (
        <div className="pairing-layout">
          {currentQrCode ? <img className="pairing-qr" src={currentQrCode} alt="スマホ接続用QRコード" /> : <div className="pairing-qr skeleton" aria-hidden="true" />}
          <div className="pairing-details">
            <strong>スマホでQRコードを読み取る</strong>
            <ol>
              <li>このスマホでQRコードを読み取り、Agent Runwayを開く</li>
              <li>iPhoneは「ホーム画面に追加」、Androidは「インストール」</li>
            </ol>
            <code className="pairing-host">{info.hostname}</code>
            <div className="pairing-actions">
              <button type="button" className="primary-button" onClick={() => void copyPairingUrl()}>{copied ? "コピー済み" : "接続URLをコピー"}</button>
              <button type="button" className="quiet-button" onClick={rotate}>コード再発行</button>
            </div>
          </div>
        </div>
      ) : info.enabled && loading ? (
        <p className="mobile-waiting">プライベートHTTPS接続を準備しています…</p>
      ) : null}
    </section>
  );
};
