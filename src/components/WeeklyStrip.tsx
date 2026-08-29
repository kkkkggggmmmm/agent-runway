import type { PaceMetric } from "../core";

interface WeeklyStripProps {
  metric: PaceMetric;
}

const weekdayFormatter = new Intl.DateTimeFormat("ja-JP", { weekday: "short" });

export const WeeklyStrip = ({ metric }: WeeklyStripProps) => {
  const elapsedDays = metric.elapsedFraction * 7;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(metric.windowStart + index * 86_400_000);
    const completed = elapsedDays >= index + 1;
    const active = elapsedDays >= index && elapsedDays < index + 1;
    return { index, label: weekdayFormatter.format(date), completed, active };
  });

  return (
    <section className="week-strip-card">
      <div className="card-heading">
        <div>
          <p className="section-kicker">WEEK ALLOCATION</p>
          <h2>7日間の基準線</h2>
        </div>
        <span className="quiet-note">均等配分 14.3% / 日</span>
      </div>
      <div className="week-strip" aria-label="週次期間の経過">
        {days.map((day) => (
          <div className={`day-cell ${day.completed ? "completed" : ""} ${day.active ? "active" : ""}`} key={day.index}>
            <span className="day-index">D{day.index + 1}</span>
            <span className="day-label">{day.label}</span>
          </div>
        ))}
      </div>
      <p className="week-strip-note">実使用の位置は上段タイムラインに表示。日別内訳が取得できない部分は補完していません。</p>
    </section>
  );
};
