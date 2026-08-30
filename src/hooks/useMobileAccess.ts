import { useCallback, useEffect, useState } from "react";
import {
  getMobileAccessInfo,
  isDesktopRuntime,
  rotateMobileAccessToken,
  setMobileAccessEnabled,
  type MobileAccessInfo,
} from "../lib/runtime";

const initialInfo: MobileAccessInfo = {
  enabled: false,
  ready: false,
  pairingUrl: null,
  hostname: null,
  error: null,
};

export const useMobileAccess = () => {
  const isDesktop = isDesktopRuntime();
  const [info, setInfo] = useState<MobileAccessInfo>(initialInfo);
  const [loading, setLoading] = useState(isDesktop);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void getMobileAccessInfo()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setInfo((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  const updateEnabled = useCallback(async (enabled: boolean) => {
    setLoading(true);
    try {
      setInfo(await setMobileAccessEnabled(enabled));
    } catch (error) {
      setInfo((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setLoading(false);
    }
  }, []);

  const rotateToken = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await rotateMobileAccessToken());
    } catch (error) {
      setInfo((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setLoading(false);
    }
  }, []);

  return { isDesktop, info, loading, updateEnabled, rotateToken };
};
