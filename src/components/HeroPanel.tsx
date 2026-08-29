import type { LimitWindow, PaceMetric } from "../core";
import { formatDateTime, formatPace, formatPercent, formatRemainingDuration } from "../lib/format";
import { PaceTimeline } from "./PaceTimeline";

export type SignalTone = "safe" | "warning" | "danger" | "stale";

interface HeroPanelProps {
  weekly: LimitWindow;
  pace: PaceMetric;
  tone: SignalTone;
}

const toneLabel: Record<SignalTone, string> = {
  safe: "予定内",
  warning: "ペース注意",
  danger: "枯渇リスク",
  stale: "更新待ち",
};

export const HeroPanel = ({ weekly, pace, tone }: HeroPanelProps) => {
  const paceCopy = formatPace(pace.paceDays);
  const gaugeStyle = {
    background: `conic-gradient(var(--signal-${tone}) ${weekly.remainingPercent * 3.6}deg, var(--track) 0deg)`,
  };

  return (
    <section className={`hero-panel tone-${tone}`}>
      <div className="hero-copy">
        <div className="hero-label-row">
          <p className="section-kicker">WORK + CODEX SHARED</p>
          <span className={`signal-badge ${tone}`}>{toneLabel[tone]}</span>
        </div>
        <div className="hero-numbers">
          <div>
            <p className="hero-number">{formatPercent(weekly.remainingPercent)}</p>
            <p className="hero-number-label">週次残量</p>
          </div>
          <div className="hero-divider" />
          <div>
            <p className="hero-number pace-number">{paceCopy.value}</p>
            <p className="hero-number-label">{paceCopy.label}</p>
          </div>
        </div>
        <PaceTimeline window={weekly} metric={pace} />
      </div>
      <div className="gauge-column">
        <div className="quota-gauge" style={gaugeStyle} role="img" aria-label={`週次残量${formatPercent(weekly.remainingPercent)}`}>
          <div className="quota-gauge-inner">
            <span className="gauge-value">{Math.round(weekly.remainingPercent)}</span>
            <span className="gauge-unit">%</span>
          </div>
        </div>
        <p className="gauge-reset">{formatRemainingDuration(pace.remainingMs)}後に更新</p>
        <p className="gauge-date">{formatDateTime(weekly.resetsAt)}</p>
      </div>
    </section>
  );
};
