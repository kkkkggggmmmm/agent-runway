import { RefreshIcon } from "./Icons";
import { formatRelativeAge } from "../lib/format";
import type { QuotaSource } from "../core";

interface StatusHeaderProps {
  source: QuotaSource;
  planType: string | null;
  observedAt: number;
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export const StatusHeader = ({
  source,
  planType,
  observedAt,
  stale,
  refreshing,
  onRefresh,
}: StatusHeaderProps) => (
  <header className="topbar">
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">AR</div>
      <div>
        <p className="eyebrow">SHARED AGENT BUDGET</p>
        <h1>Agent Runway</h1>
      </div>
    </div>
    <div className="topbar-actions">
      <div className="source-status" aria-label={`データ状態: ${source === "demo" ? "デモ" : stale ? "古い" : "ライブ"}`}>
        <span className={`status-dot ${source === "demo" ? "demo" : stale ? "stale" : "live"}`} />
        <span>{source === "demo" ? "DEMO DATA" : stale ? "STALE" : "LIVE"}</span>
        {planType ? <span className="plan-chip">{planType.toUpperCase()}</span> : null}
      </div>
      <span className="updated-at">更新 {formatRelativeAge(observedAt)}</span>
      <button className="icon-button" type="button" onClick={onRefresh} disabled={refreshing} aria-label="利用枠を再取得">
        <span className={refreshing ? "spin" : undefined}><RefreshIcon /></span>
      </button>
    </div>
  </header>
);
