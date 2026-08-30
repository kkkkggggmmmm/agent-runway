import { useCallback, useEffect, useState } from "react";
import {
  getAutostartEnabled,
  isDesktopRuntime,
  setAutostartEnabled,
} from "../lib/runtime";

interface DesktopPreferences {
  isDesktop: boolean;
  autostartEnabled: boolean;
  autostartLoading: boolean;
  autostartError: string | null;
  updateAutostart: (enabled: boolean) => Promise<void>;
}

export const useDesktopPreferences = (): DesktopPreferences => {
  const isDesktop = isDesktopRuntime();
  const [autostartEnabled, setEnabled] = useState(false);
  const [autostartLoading, setLoading] = useState(isDesktop);
  const [autostartError, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void getAutostartEnabled()
      .then((enabled) => {
        if (!cancelled) setEnabled(enabled);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const updateAutostart = useCallback(async (enabled: boolean) => {
    const previous = autostartEnabled;
    setEnabled(enabled);
    setLoading(true);
    setError(null);
    try {
      setEnabled(await setAutostartEnabled(enabled));
    } catch (error) {
      setEnabled(previous);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [autostartEnabled]);

  return {
    isDesktop,
    autostartEnabled,
    autostartLoading,
    autostartError,
    updateAutostart,
  };
};
