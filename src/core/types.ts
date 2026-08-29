export type QuotaSource = "live" | "demo";

export interface RawLimitWindow {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

export interface RawCredits {
  hasCredits?: boolean | null;
  unlimited?: boolean | null;
  balance?: string | number | null;
}

export interface RawLimitBucket {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RawLimitWindow | null;
  secondary?: RawLimitWindow | null;
  planType?: string | null;
  credits?: RawCredits | null;
  rateLimitReachedType?: string | null;
}

export interface RawResetCredit {
  id?: string | null;
  status?: string | null;
  expiresAt?: number | null;
  title?: string | null;
  description?: string | null;
}

export interface RawResetCredits {
  availableCount?: number | null;
  credits?: RawResetCredit[] | null;
}

export interface RawRateLimitResponse {
  rateLimits?: RawLimitBucket | null;
  rateLimitsByLimitId?: Record<string, RawLimitBucket | null> | null;
  rateLimitResetCredits?: RawResetCredits | null;
  observedAt?: string | number | null;
  source?: QuotaSource;
}

export interface LimitWindow {
  key: string;
  limitId: string;
  limitName: string | null;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number;
  resetsAt: number;
  planType: string | null;
  reachedType: string | null;
}

export interface NormalizedQuotaSnapshot {
  observedAt: number;
  source: QuotaSource;
  windows: LimitWindow[];
  planType: string | null;
  creditsBalance: string | null;
  creditsUnlimited: boolean;
  resetCreditsAvailable: number | null;
  nextResetCreditExpiry: number | null;
}

export interface PaceMetric {
  elapsedFraction: number;
  usedFraction: number;
  paceDays: number;
  windowStart: number;
  remainingMs: number;
}

export interface WindowObservation {
  observedAt: number;
  usedPercent: number;
  resetsAt: number;
}

export type ForecastConfidence = "low" | "medium" | "high";

export interface RunwayForecast {
  burnPercentPerHour: number;
  exhaustAt: number;
  confidence: ForecastConfidence;
  observationSpanMs: number;
  sampleCount: number;
}

export interface BudgetSettings {
  reservePercent: number;
  weekdayWeights: readonly [number, number, number, number, number, number, number];
}

export type QuotaEventType =
  | "scheduled_reset"
  | "early_reset"
  | "reset_time_changed"
  | "window_added"
  | "window_removed";

export interface QuotaEvent {
  type: QuotaEventType;
  windowKey: string;
  detectedAt: number;
  detail: string;
}
