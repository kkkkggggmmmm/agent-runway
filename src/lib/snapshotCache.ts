import type { RawRateLimitResponse } from "../core";

export const SNAPSHOT_CACHE_KEY = "agent-runway:last-live-snapshot:v1";

export const readCachedSnapshot = (): RawRateLimitResponse | null => {
  try {
    const value = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as RawRateLimitResponse;
    return parsed && typeof parsed === "object" && parsed.source !== "demo" ? parsed : null;
  } catch {
    return null;
  }
};

export const persistCachedSnapshot = (snapshot: RawRateLimitResponse): void => {
  if (snapshot.source === "demo") return;
  try {
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({ ...snapshot, source: "live" }));
  } catch {
    // Quota snapshots are an optional offline convenience; storage failures are non-fatal.
  }
};
