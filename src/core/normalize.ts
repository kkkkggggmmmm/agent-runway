import type {
  LimitWindow,
  NormalizedQuotaSnapshot,
  RawLimitBucket,
  RawLimitWindow,
  RawRateLimitResponse,
} from "./types";

const FIVE_HOURS_MINUTES = 300;
const WEEK_MINUTES = 10_080;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const finiteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const epochSeconds = (value: unknown): number | null => {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric <= 0) return null;
  return numeric > 10_000_000_000 ? Math.round(numeric / 1_000) : Math.round(numeric);
};

export const durationLabel = (durationMins: number): string => {
  if (durationMins === FIVE_HOURS_MINUTES) return "5時間枠";
  if (durationMins === WEEK_MINUTES) return "週次枠";
  if (durationMins % 1_440 === 0) return `${durationMins / 1_440}日枠`;
  if (durationMins % 60 === 0) return `${durationMins / 60}時間枠`;
  return `${durationMins}分枠`;
};

const normalizeWindow = (
  raw: RawLimitWindow | null | undefined,
  bucket: RawLimitBucket,
  fallbackLimitId: string,
): LimitWindow | null => {
  if (!raw) return null;
  const usedPercent = finiteNumber(raw.usedPercent);
  const windowDurationMins = finiteNumber(raw.windowDurationMins);
  const resetsAt = epochSeconds(raw.resetsAt);
  if (usedPercent === null || windowDurationMins === null || windowDurationMins <= 0 || resetsAt === null) {
    return null;
  }

  const limitId = bucket.limitId?.trim() || fallbackLimitId;
  const safeUsed = clamp(usedPercent, 0, 100);
  return {
    key: `${limitId}:${windowDurationMins}`,
    limitId,
    limitName: bucket.limitName ?? null,
    label: durationLabel(windowDurationMins),
    usedPercent: safeUsed,
    remainingPercent: 100 - safeUsed,
    windowDurationMins,
    resetsAt,
    planType: bucket.planType ?? null,
    reachedType: bucket.rateLimitReachedType ?? null,
  };
};

const addBucketWindows = (
  destination: Map<string, LimitWindow>,
  bucket: RawLimitBucket,
  fallbackLimitId: string,
): void => {
  for (const rawWindow of [bucket.primary, bucket.secondary]) {
    const normalized = normalizeWindow(rawWindow, bucket, fallbackLimitId);
    if (normalized) destination.set(normalized.key, normalized);
  }
};

const normalizedObservedAt = (value: RawRateLimitResponse["observedAt"], nowMs: number): number => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : nowMs;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1_000;
  }
  return nowMs;
};

export const normalizeRateLimits = (
  raw: RawRateLimitResponse,
  nowMs = Date.now(),
): NormalizedQuotaSnapshot => {
  const windows = new Map<string, LimitWindow>();
  const buckets = raw.rateLimitsByLimitId ?? {};

  for (const [fallbackLimitId, bucket] of Object.entries(buckets)) {
    if (bucket) addBucketWindows(windows, bucket, fallbackLimitId);
  }

  if (raw.rateLimits) {
    const fallback = raw.rateLimits.limitId?.trim() || "codex";
    addBucketWindows(windows, raw.rateLimits, fallback);
  }

  const orderedWindows = [...windows.values()].sort(
    (left, right) => left.windowDurationMins - right.windowDurationMins,
  );
  const codexBucket = buckets.codex ?? raw.rateLimits ?? null;
  const allResetCredits = raw.rateLimitResetCredits?.credits ?? [];
  const expiries = allResetCredits
    .map((credit) => epochSeconds(credit.expiresAt))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const balance = codexBucket?.credits?.balance;

  return {
    observedAt: normalizedObservedAt(raw.observedAt, nowMs),
    source: raw.source ?? "live",
    windows: orderedWindows,
    planType: codexBucket?.planType ?? orderedWindows[0]?.planType ?? null,
    creditsBalance: balance === null || balance === undefined ? null : String(balance),
    creditsUnlimited: codexBucket?.credits?.unlimited === true,
    resetCreditsAvailable: raw.rateLimitResetCredits?.availableCount ?? null,
    nextResetCreditExpiry: expiries[0] ?? null,
  };
};

export const findWeeklyWindow = (snapshot: NormalizedQuotaSnapshot): LimitWindow | null =>
  snapshot.windows.find(
    (window) => window.limitId === "codex" && window.windowDurationMins === WEEK_MINUTES,
  ) ?? snapshot.windows.find((window) => window.windowDurationMins === WEEK_MINUTES) ?? null;

export const findFiveHourWindow = (snapshot: NormalizedQuotaSnapshot): LimitWindow | null =>
  snapshot.windows.find(
    (window) => window.limitId === "codex" && window.windowDurationMins === FIVE_HOURS_MINUTES,
  ) ?? snapshot.windows.find((window) => window.windowDurationMins === FIVE_HOURS_MINUTES) ?? null;

export const mergeSparse = <T>(base: T, patch: unknown): T => {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return patch as T;
  if (typeof base !== "object" || base === null || typeof patch !== "object") return patch as T;

  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    const prior = merged[key];
    merged[key] =
      typeof prior === "object" && prior !== null && !Array.isArray(prior) && typeof value === "object" && !Array.isArray(value)
        ? mergeSparse(prior, value)
        : value;
  }
  return merged as T;
};
