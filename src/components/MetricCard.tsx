import type { ReactNode } from "react";

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  emphasis?: "neutral" | "positive" | "warning" | "danger";
}

export const MetricCard = ({ icon, label, value, detail, emphasis = "neutral" }: MetricCardProps) => (
  <article className={`metric-card metric-${emphasis}`}>
    <div className="metric-head">
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
    </div>
    <p className="metric-value">{value}</p>
    <p className="metric-detail">{detail}</p>
  </article>
);
