import type { LimitWindow, PaceMetric } from "../core";
import { formatDateTime, formatPercent } from "../lib/format";

interface PaceTimelineProps {
  window: LimitWindow;
  metric: PaceMetric;
}

export const PaceTimeline = ({ window, metric }: PaceTimelineProps) => {
  const expectedUsed = metric.elapsedFraction * 100;
  return (
    <section className="pace-timeline" aria-label="週次利用ペース">
      <div className="timeline-meta">
        <span>開始</span>
        <span>リセット {formatDateTime(window.resetsAt)}</span>
      </div>
      <div className="timeline-track">
        <div className="timeline-used" style={{ width: `${window.usedPercent}%` }} />
        <div className="timeline-plan-marker" style={{ left: `${expectedUsed}%` }}>
          <span>理想 {formatPercent(expectedUsed)}</span>
        </div>
        <div className="timeline-actual-marker" style={{ left: `${window.usedPercent}%` }}>
          <span>実績 {formatPercent(window.usedPercent)}</span>
        </div>
      </div>
      <div className="timeline-caption">
        <span>0%</span>
        <span>100%</span>
      </div>
    </section>
  );
};
