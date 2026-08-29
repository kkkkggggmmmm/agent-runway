import { useEffect, useState } from "react";
import type { BudgetSettings } from "../core";

const STORAGE_KEY = "agent-runway:settings:v1";
const defaultSettings: BudgetSettings = {
  reservePercent: 10,
  weekdayWeights: [1, 1, 1, 1, 1, 1, 1],
};

const loadSettings = (): BudgetSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<BudgetSettings>;
    const reservePercent = typeof parsed.reservePercent === "number"
      ? Math.min(Math.max(parsed.reservePercent, 0), 30)
      : defaultSettings.reservePercent;
    return { ...defaultSettings, reservePercent };
  } catch {
    return defaultSettings;
  }
};

export const useBudgetSettings = () => {
  const [settings, setSettings] = useState<BudgetSettings>(loadSettings);
  const setReservePercent = (reservePercent: number) => {
    setSettings((current) => ({ ...current, reservePercent }));
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Settings remain usable for the current session when storage is unavailable.
    }
  }, [settings]);
  return { settings, setReservePercent };
};
