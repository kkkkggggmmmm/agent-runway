import {
  calculatePace,
  calculateTodayBudget,
  findWeeklyWindow,
  forecastRunway,
  isSnapshotStale,
} from "./core";
import { EmptyState } from "./components/EmptyState";
import { GaugeIcon, ClockIcon, ShieldIcon } from "./components/Icons";
import { HeroPanel, type SignalTone } from "./components/HeroPanel";
import { InstallPrompt } from "./components/InstallPrompt";
import { LimitWindows } from "./components/LimitWindows";
import { MetricCard } from "./components/MetricCard";
import { MobileAccessPanel } from "./components/MobileAccessPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusHeader } from "./components/StatusHeader";
import { WeeklyStrip } from "./components/WeeklyStrip";
import { useBudgetSettings } from "./hooks/useBudgetSettings";
import { useDesktopPreferences } from "./hooks/useDesktopPreferences";
import { useMobileAccess } from "./hooks/useMobileAccess";
import { useNow } from "./hooks/useNow";
import { useQuotaSnapshot } from "./hooks/useQuotaSnapshot";
import {
  confidenceLabel,
  formatDateTime,
  formatPercent,
  formatRemainingDuration,
  formatTime,
} from "./lib/format";

const toneFromState = (
  stale: boolean,
  remainingPercent: number,
  paceDays: number,
  exhaustAt: number | null,
  resetAt: number,
): SignalTone => {
  if (stale) return "stale";
  if (remainingPercent <= 5 || paceDays >= 1) return "danger";
  if (exhaustAt !== null && exhaustAt < resetAt - 24 * 3_600_000) return "danger";
  if (remainingPercent <= 15 || paceDays >= 0.5 || (exhaustAt !== null && exhaustAt < resetAt)) return "warning";
  return "safe";
};

const metricEmphasis = (tone: SignalTone): "neutral" | "positive" | "warning" | "danger" => {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "safe") return "positive";
  return "neutral";
};

export default function App() {
  const { snapshot, history, events, loading, refreshing, error, refresh } = useQuotaSnapshot();
  const { settings, setReservePercent } = useBudgetSettings();
  const desktop = useDesktopPreferences();
  const mobileAccess = useMobileAccess();
  const now = useNow();

  if (!snapshot) return <EmptyState loading={loading} error={error} onRetry={refresh} />;

  const stale = isSnapshotStale(snapshot.observedAt, now);
  const weekly = findWeeklyWindow(snapshot);

  if (!weekly) {
    return (
      <div className="app-shell">
        <StatusHeader
          source={snapshot.source}
          planType={snapshot.planType}
          observedAt={snapshot.observedAt}
          stale={stale}
          refreshing={refreshing}
          onRefresh={refresh}
        />
        <main className="dashboard">
          <section className="no-weekly-card">
            <p className="section-kicker">WEEKLY WINDOW UNAVAILABLE</p>
            <h2>週次枠は現在報告されていません</h2>
            <p>0%や100%として補完せず、App Serverが返している利用枠だけを表示します。</p>
          </section>
          <LimitWindows windows={snapshot.windows} />
        </main>
      </div>
    );
  }

  const pace = calculatePace(weekly, now);
  const todayBudget = calculateTodayBudget(weekly, settings, now);
  const forecast = forecastRunway(history, weekly.remainingPercent, now);
  const resetAtMs = weekly.resetsAt * 1_000;
  const tone = toneFromState(stale, weekly.remainingPercent, pace.paceDays, forecast?.exhaustAt ?? null, resetAtMs);
  const forecastBeforeReset = forecast ? forecast.exhaustAt < resetAtMs : false;
  const resetCredits = snapshot.resetCreditsAvailable;

  return (
    <div className="app-shell">
      <StatusHeader
        source={snapshot.source}
        planType={snapshot.planType}
        observedAt={snapshot.observedAt}
        stale={stale}
        refreshing={refreshing}
        onRefresh={refresh}
      />
      <main className="dashboard">
        <InstallPrompt />
        {snapshot.source === "demo" ? (
          <aside className="demo-banner">これはfixtureによるデモ表示です。実アカウントの値ではありません。</aside>
        ) : null}
        {error ? <aside className="error-banner" role="alert">最新値の再取得に失敗しました：{error}</aside> : null}

        <HeroPanel weekly={weekly} pace={pace} tone={tone} />

        <section className="metric-grid" aria-label="意思決定指標">
          <MetricCard
            icon={<GaugeIcon />}
            label="今日あと使える量"
            value={formatPercent(todayBudget, 1)}
            detail={`予備枠 ${settings.reservePercent}% を確保して再配分`}
            emphasis={todayBudget > 0 ? "positive" : "danger"}
          />
          <MetricCard
            icon={<ClockIcon />}
            label="現在ペースの枯渇予測"
            value={forecast ? formatTime(forecast.exhaustAt) : "学習中"}
            detail={forecast
              ? `${formatDateTime(Math.round(forecast.exhaustAt / 1_000))} · ${confidenceLabel(forecast.confidence)}`
              : "2時間以上の有効な観測を待っています"}
            emphasis={forecastBeforeReset ? metricEmphasis(tone) : "positive"}
          />
          <MetricCard
            icon={<ClockIcon />}
            label="次回リセット"
            value={formatRemainingDuration(pace.remainingMs)}
            detail={formatDateTime(weekly.resetsAt)}
          />
          <MetricCard
            icon={<ShieldIcon />}
            label="獲得済みリセット"
            value={resetCredits === null ? "未報告" : `${resetCredits}回`}
            detail={snapshot.nextResetCreditExpiry
              ? `最短期限 ${formatDateTime(snapshot.nextResetCreditExpiry)}`
              : "App Serverが返した場合のみ表示"}
          />
        </section>

        <section className="lower-grid">
          <WeeklyStrip metric={pace} />
          <SettingsPanel
            reservePercent={settings.reservePercent}
            onReserveChange={setReservePercent}
            desktop={desktop.isDesktop ? {
              autostartEnabled: desktop.autostartEnabled,
              autostartLoading: desktop.autostartLoading,
              autostartError: desktop.autostartError,
              onAutostartChange: (enabled) => void desktop.updateAutostart(enabled),
            } : undefined}
          />
        </section>

        {mobileAccess.isDesktop ? (
          <MobileAccessPanel
            info={mobileAccess.info}
            loading={mobileAccess.loading}
            onEnabledChange={(enabled) => void mobileAccess.updateEnabled(enabled)}
            onRotateToken={() => void mobileAccess.rotateToken()}
          />
        ) : null}

        <LimitWindows windows={snapshot.windows} />

        {events.length > 0 ? (
          <section className="events-card">
            <div className="card-heading compact">
              <div>
                <p className="section-kicker">QUOTA EVENTS</p>
                <h2>変化の検出</h2>
              </div>
            </div>
            <ul className="event-list">
              {events.slice(0, 4).map((event) => (
                <li key={`${event.detectedAt}-${event.type}-${event.windowKey}`}>
                  <span>{event.type.replaceAll("_", " ")}</span>
                  <p>{event.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="app-footer">
          <span>Private by default · No prompts or credentials shared</span>
          <span>{desktop.isDesktop ? "Native tray active · " : "Mobile companion · "}Agent Runway v0.3.0</span>
        </footer>
      </main>
    </div>
  );
}
