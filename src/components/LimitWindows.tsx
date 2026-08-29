import type { LimitWindow } from "../core";
import { formatDateTime, formatPercent } from "../lib/format";

interface LimitWindowsProps {
  windows: LimitWindow[];
}

export const LimitWindows = ({ windows }: LimitWindowsProps) => (
  <section className="windows-card">
    <div className="card-heading">
      <div>
        <p className="section-kicker">SERVER WINDOWS</p>
        <h2>報告中の利用枠</h2>
      </div>
      <span className="quiet-note">App Server authoritative</span>
    </div>
    <div className="window-list">
      {windows.length > 0 ? windows.map((window) => (
        <article className="window-row" key={window.key}>
          <div className="window-title">
            <span>{window.label}</span>
            <span className="window-id">{window.limitId}</span>
          </div>
          <div className="window-progress" aria-label={`${window.label} 残量${formatPercent(window.remainingPercent)}`}>
            <span style={{ width: `${window.remainingPercent}%` }} />
          </div>
          <div className="window-values">
            <strong>{formatPercent(window.remainingPercent)}</strong>
            <span>{formatDateTime(window.resetsAt)}</span>
          </div>
        </article>
      )) : (
        <p className="unavailable-copy">利用枠は現在報告されていません。</p>
      )}
    </div>
  </section>
);
