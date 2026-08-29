import { clamp } from "./normalize";
import type {
  BudgetSettings,
  LimitWindow,
  PaceMetric,
  RunwayForecast,
  WindowObservation,
} from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const calculatePace = (window: LimitWindow, nowMs = Date.now()): PaceMetric => {
  const durationMs = window.windowDurationMins * 60_000;
  const resetMs = window.resetsAt * 1_000;
  const windowStart = resetMs - durationMs;
  const elapsedFraction = clamp((nowMs - windowStart) / durationMs, 0, 1);
  const usedFraction = window.usedPercent / 100;
  return {
    elapsedFraction,
    usedFraction,
    paceDays: (usedFraction - elapsedFraction) * (durationMs / DAY_MS),
    windowStart,
    remainingMs: Math.max(resetMs - nowMs, 0),
  };
};

const startOfNextLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

const startOfLocalDay = (timestamp: number): number => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const dayFraction = (from: number, to: number): number => {
  const dayStart = startOfLocalDay(from);
  const nextDay = startOfNextLocalDay(from);
  return (to - from) / Math.max(nextDay - dayStart, 1);
};

export const calculateTodayBudget = (
  window: LimitWindow,
  settings: BudgetSettings,
  nowMs = Date.now(),
): number => {
  const resetMs = window.resetsAt * 1_000;
  if (resetMs <= nowMs) return 0;
  const spendable = Math.max(window.remainingPercent - clamp(settings.reservePercent, 0, 100), 0);
  if (spendable === 0) return 0;

  let cursor = nowMs;
  let totalWeightedTime = 0;
  let todayWeightedTime = 0;
  let firstSegment = true;

  while (cursor < resetMs) {
    const segmentEnd = Math.min(startOfNextLocalDay(cursor), resetMs);
    const weekday = new Date(cursor).getDay();
    const weighted = dayFraction(cursor, segmentEnd) * Math.max(settings.weekdayWeights[weekday], 0);
    totalWeightedTime += weighted;
    if (firstSegment) todayWeightedTime = weighted;
    firstSegment = false;
    cursor = segmentEnd;
  }

  if (totalWeightedTime <= 0) return 0;
  return spendable * (todayWeightedTime / totalWeightedTime);
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

export const forecastRunway = (
  observations: WindowObservation[],
  currentRemainingPercent: number,
  nowMs = Date.now(),
): RunwayForecast | null => {
  const recent = observations
    .filter((observation) => nowMs - observation.observedAt <= 24 * HOUR_MS)
    .sort((left, right) => left.observedAt - right.observedAt);
  const rates: number[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    const elapsedHours = (current.observedAt - previous.observedAt) / HOUR_MS;
    const sameWindow = Math.abs(current.resetsAt - previous.resetsAt) <= 300;
    const usedDelta = current.usedPercent - previous.usedPercent;
    if (elapsedHours > 0 && sameWindow && usedDelta > 0) rates.push(usedDelta / elapsedHours);
  }

  if (rates.length < 2) return null;
  const burnPercentPerHour = median(rates);
  if (!Number.isFinite(burnPercentPerHour) || burnPercentPerHour <= 0) return null;
  const observationSpanMs = recent.at(-1)!.observedAt - recent[0].observedAt;
  const confidence = rates.length >= 8 && observationSpanMs >= 8 * HOUR_MS
    ? "high"
    : rates.length >= 4 && observationSpanMs >= 2 * HOUR_MS
      ? "medium"
      : "low";

  return {
    burnPercentPerHour,
    exhaustAt: nowMs + (Math.max(currentRemainingPercent, 0) / burnPercentPerHour) * HOUR_MS,
    confidence,
    observationSpanMs,
    sampleCount: rates.length,
  };
};

export const isSnapshotStale = (observedAt: number, nowMs = Date.now(), thresholdMinutes = 5): boolean =>
  nowMs - observedAt > thresholdMinutes * 60_000;
