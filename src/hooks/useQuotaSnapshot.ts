import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectQuotaEvents,
  findWeeklyWindow,
  normalizeRateLimits,
  type NormalizedQuotaSnapshot,
  type QuotaEvent,
  type RawRateLimitResponse,
  type WindowObservation,
} from "../core";
import {
  appendObservation,
  clearHistory,
  createSyntheticDemoHistory,
  persistHistory,
  readHistory,
} from "../lib/history";
import { readRateLimits, subscribeRateLimits } from "../lib/runtime";
import { persistCachedSnapshot, readCachedSnapshot } from "../lib/snapshotCache";

interface QuotaState {
  snapshot: NormalizedQuotaSnapshot | null;
  history: WindowObservation[];
  events: QuotaEvent[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const initialState = (): QuotaState => {
  const cached = readCachedSnapshot();
  return {
    snapshot: cached ? normalizeRateLimits(cached) : null,
    history: readHistory(),
    events: [],
    loading: cached === null,
    refreshing: cached !== null,
    error: null,
  };
};

export const useQuotaSnapshot = () => {
  const [state, setState] = useState<QuotaState>(initialState);
  const requestNumber = useRef(0);

  const applyRawSnapshot = useCallback((raw: RawRateLimitResponse) => {
    const nextSnapshot = normalizeRateLimits(raw);
    persistCachedSnapshot(raw);
    setState((current) => {
      const detected = current.snapshot ? detectQuotaEvents(current.snapshot, nextSnapshot) : [];
      const resetDetected = detected.some((event) => event.type === "early_reset" || event.type === "scheduled_reset");
      const weekly = findWeeklyWindow(nextSnapshot);
      let nextHistory = resetDetected ? clearHistory() : current.history;
      if (weekly) {
        nextHistory = nextSnapshot.source === "demo"
          ? createSyntheticDemoHistory(weekly, nextSnapshot.observedAt)
          : appendObservation(nextHistory, weekly, nextSnapshot.observedAt);
      }
      return {
        snapshot: nextSnapshot,
        history: nextHistory,
        events: [...detected, ...current.events].slice(0, 20),
        loading: false,
        refreshing: false,
        error: null,
      };
    });
  }, []);

  const refresh = useCallback(async (manual = false) => {
    const currentRequest = requestNumber.current + 1;
    requestNumber.current = currentRequest;
    setState((current) => ({ ...current, refreshing: manual || current.snapshot !== null, error: null }));

    try {
      const raw = await readRateLimits(manual);
      if (requestNumber.current !== currentRequest) return;
      applyRawSnapshot(raw);
    } catch (error) {
      if (requestNumber.current !== currentRequest) return;
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : "利用枠を取得できません",
      }));
    }
  }, [applyRawSnapshot]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeRateLimits((raw) => {
      if (!disposed) applyRawSnapshot(raw);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyRawSnapshot]);

  useEffect(() => {
    if (state.snapshot?.source === "live") persistHistory(state.history);
  }, [state.history, state.snapshot?.source]);

  return { ...state, refresh: () => refresh(true) };
};
