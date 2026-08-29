import type { NormalizedQuotaSnapshot, QuotaEvent } from "./types";

export const detectQuotaEvents = (
  previous: NormalizedQuotaSnapshot,
  current: NormalizedQuotaSnapshot,
): QuotaEvent[] => {
  const events: QuotaEvent[] = [];
  const previousByKey = new Map(previous.windows.map((window) => [window.key, window]));
  const currentByKey = new Map(current.windows.map((window) => [window.key, window]));

  for (const [key, window] of currentByKey) {
    const prior = previousByKey.get(key);
    if (!prior) {
      events.push({
        type: "window_added",
        windowKey: key,
        detectedAt: current.observedAt,
        detail: `${window.label}が追加されました`,
      });
      continue;
    }

    const usedDrop = prior.usedPercent - window.usedPercent;
    const resetShift = Math.abs(prior.resetsAt - window.resetsAt);
    const crossedScheduledReset = prior.resetsAt * 1_000 <= current.observedAt + 5 * 60_000;

    if (usedDrop >= 10) {
      events.push({
        type: crossedScheduledReset ? "scheduled_reset" : "early_reset",
        windowKey: key,
        detectedAt: current.observedAt,
        detail: `使用率が${usedDrop.toFixed(1)}ポイント低下しました`,
      });
    }

    if (resetShift > 300) {
      events.push({
        type: "reset_time_changed",
        windowKey: key,
        detectedAt: current.observedAt,
        detail: `リセット時刻が${Math.round(resetShift / 60)}分変更されました`,
      });
    }
  }

  for (const [key, window] of previousByKey) {
    if (!currentByKey.has(key)) {
      events.push({
        type: "window_removed",
        windowKey: key,
        detectedAt: current.observedAt,
        detail: `${window.label}が現在報告されていません`,
      });
    }
  }

  return events;
};
