import { describe, expect, it } from "vitest";
import {
  calculatePace,
  calculateTodayBudget,
  detectQuotaEvents,
  findFiveHourWindow,
  findWeeklyWindow,
  forecastRunway,
  isSnapshotStale,
  mergeSparse,
  normalizeRateLimits,
} from "./index";
import type { LimitWindow, NormalizedQuotaSnapshot, RawRateLimitResponse } from "./types";

const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const NOW_SECONDS = NOW / 1_000;
const DAY_SECONDS = 86_400;

const weeklyWindow = (overrides: Partial<LimitWindow> = {}): LimitWindow => ({
  key: "codex:10080",
  limitId: "codex",
  limitName: "Work + Codex shared",
  label: "週次枠",
  usedPercent: 42,
  remainingPercent: 58,
  windowDurationMins: 10_080,
  resetsAt: NOW_SECONDS + 5 * DAY_SECONDS,
  planType: "pro",
  reachedType: null,
  ...overrides,
});

const snapshot = (window: LimitWindow, observedAt = NOW): NormalizedQuotaSnapshot => ({
  observedAt,
  source: "live",
  windows: [window],
  planType: "pro",
  creditsBalance: null,
  creditsUnlimited: false,
  resetCreditsAvailable: null,
  nextResetCreditExpiry: null,
});

describe("normalizeRateLimits", () => {
  it("maps windows by duration even when primary and secondary are reversed", () => {
    const raw: RawRateLimitResponse = {
      observedAt: NOW,
      rateLimitsByLimitId: {
        codex: {
          limitId: "codex",
          planType: "pro",
          primary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: NOW_SECONDS + 100 },
          secondary: { usedPercent: 36, windowDurationMins: 300, resetsAt: NOW_SECONDS + 200 },
        },
      },
    };

    const normalized = normalizeRateLimits(raw, NOW);
    expect(findFiveHourWindow(normalized)?.usedPercent).toBe(36);
    expect(findWeeklyWindow(normalized)?.usedPercent).toBe(42);
    expect(normalized.windows.map((window) => window.label)).toEqual(["5時間枠", "週次枠"]);
  });

  it("keeps a missing five-hour window unavailable", () => {
    const normalized = normalizeRateLimits({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: NOW_SECONDS + 100 },
      },
    }, NOW);
    expect(findFiveHourWindow(normalized)).toBeNull();
    expect(findWeeklyWindow(normalized)?.remainingPercent).toBe(90);
  });

  it("clamps invalid percentages without changing valid server fields", () => {
    const normalized = normalizeRateLimits({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 140, windowDurationMins: 300, resetsAt: NOW_SECONDS + 100 },
      },
    }, NOW);
    expect(normalized.windows[0].usedPercent).toBe(100);
    expect(normalized.windows[0].remainingPercent).toBe(0);
  });
});

describe("derived pace", () => {
  it("reports 0.94 days ahead after 2/7 of the window with 42 percent used", () => {
    const metric = calculatePace(weeklyWindow(), NOW);
    expect(metric.elapsedFraction).toBeCloseTo(2 / 7, 6);
    expect(metric.paceDays).toBeCloseTo(0.94, 6);
  });

  it("allocates remaining spendable capacity across partial local days", () => {
    const localNoon = new Date(2026, 7, 29, 12, 0, 0).getTime();
    const resetAtLocalNoon = new Date(2026, 8, 1, 12, 0, 0).getTime() / 1_000;
    const budget = calculateTodayBudget(
      weeklyWindow({ resetsAt: resetAtLocalNoon }),
      { reservePercent: 10, weekdayWeights: [1, 1, 1, 1, 1, 1, 1] },
      localNoon,
    );
    expect(budget).toBeCloseTo(8, 5);
  });

  it("returns zero when the reserve consumes all remaining capacity", () => {
    const budget = calculateTodayBudget(
      weeklyWindow({ remainingPercent: 8 }),
      { reservePercent: 10, weekdayWeights: [1, 1, 1, 1, 1, 1, 1] },
      NOW,
    );
    expect(budget).toBe(0);
  });
});

describe("forecastRunway", () => {
  it("uses robust positive deltas and returns a confidence label", () => {
    const observations = [0, 1, 2, 3, 4].map((hour) => ({
      observedAt: NOW + hour * 3_600_000,
      usedPercent: 10 + hour * 2,
      resetsAt: NOW_SECONDS + 5 * DAY_SECONDS,
    }));
    const forecast = forecastRunway(observations, 40, NOW + 4 * 3_600_000);
    expect(forecast?.burnPercentPerHour).toBeCloseTo(2, 6);
    expect(forecast?.exhaustAt).toBe(NOW + 24 * 3_600_000);
    expect(forecast?.confidence).toBe("medium");
  });

  it("refuses to forecast across a reset boundary", () => {
    const forecast = forecastRunway([
      { observedAt: NOW, usedPercent: 60, resetsAt: NOW_SECONDS + 10_000 },
      { observedAt: NOW + 3_600_000, usedPercent: 10, resetsAt: NOW_SECONDS + 20_000 },
      { observedAt: NOW + 7_200_000, usedPercent: 11, resetsAt: NOW_SECONDS + 20_000 },
    ], 89, NOW + 7_200_000);
    expect(forecast).toBeNull();
  });
});

describe("event detection and sparse updates", () => {
  it("detects an early reset and reset-time change", () => {
    const previousWindow = weeklyWindow({ usedPercent: 42, remainingPercent: 58 });
    const currentWindow = weeklyWindow({
      usedPercent: 20,
      remainingPercent: 80,
      resetsAt: previousWindow.resetsAt + 3_600,
    });
    const events = detectQuotaEvents(snapshot(previousWindow), snapshot(currentWindow, NOW + 60_000));
    expect(events.map((event) => event.type)).toEqual(["early_reset", "reset_time_changed"]);
  });

  it("does not erase prior values when a sparse notification contains null", () => {
    const base = { rateLimits: { planType: "pro", credits: { balance: "50" } } };
    const merged = mergeSparse(base, { rateLimits: { planType: null, credits: { balance: "40" } } });
    expect(merged).toEqual({ rateLimits: { planType: "pro", credits: { balance: "40" } } });
  });

  it("classifies a drop at the announced boundary as a scheduled reset", () => {
    const prior = weeklyWindow({ resetsAt: NOW_SECONDS + 60 });
    const current = weeklyWindow({ usedPercent: 4, remainingPercent: 96, resetsAt: NOW_SECONDS + 7 * DAY_SECONDS });
    const events = detectQuotaEvents(snapshot(prior), snapshot(current, NOW + 120_000));
    expect(events.some((event) => event.type === "scheduled_reset")).toBe(true);
  });

  it("reports windows that appear or disappear without inventing values", () => {
    const added = detectQuotaEvents(
      { ...snapshot(weeklyWindow()), windows: [] },
      snapshot(weeklyWindow(), NOW + 60_000),
    );
    const removed = detectQuotaEvents(
      snapshot(weeklyWindow()),
      { ...snapshot(weeklyWindow(), NOW + 60_000), windows: [] },
    );
    expect(added.map((event) => event.type)).toEqual(["window_added"]);
    expect(removed.map((event) => event.type)).toEqual(["window_removed"]);
  });
});

describe("freshness", () => {
  it("marks observations stale only after the configured threshold", () => {
    expect(isSnapshotStale(NOW - 5 * 60_000, NOW)).toBe(false);
    expect(isSnapshotStale(NOW - 5 * 60_000 - 1, NOW)).toBe(true);
  });
});
