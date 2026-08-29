import type { LimitWindow, WindowObservation } from "../core";

const STORAGE_KEY = "agent-runway:history:v1";
const MAX_OBSERVATIONS = 288;

const isObservation = (value: unknown): value is WindowObservation => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return [item.observedAt, item.usedPercent, item.resetsAt].every(
    (field) => typeof field === "number" && Number.isFinite(field),
  );
};

export const readHistory = (): WindowObservation[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isObservation).slice(-MAX_OBSERVATIONS) : [];
  } catch {
    return [];
  }
};

export const appendObservation = (
  history: WindowObservation[],
  window: LimitWindow,
  observedAt: number,
): WindowObservation[] => {
  const next: WindowObservation = {
    observedAt,
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt,
  };
  const last = history.at(-1);
  if (last && observedAt - last.observedAt < 30_000 && last.usedPercent === next.usedPercent) return history;
  return [...history, next].slice(-MAX_OBSERVATIONS);
};

export const persistHistory = (history: WindowObservation[]): void => {
  try {
    if (history.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  } catch {
    // Forecast history is optional; quota display must keep working without storage.
  }
};

export const clearHistory = (): WindowObservation[] => [];

export const createSyntheticDemoHistory = (window: LimitWindow, nowMs: number): WindowObservation[] =>
  [4, 3, 2, 1, 0].map((hoursAgo, index) => ({
    observedAt: nowMs - hoursAgo * 3_600_000,
    usedPercent: Math.max(window.usedPercent - (4 - index) * 2, 0),
    resetsAt: window.resetsAt,
  }));
