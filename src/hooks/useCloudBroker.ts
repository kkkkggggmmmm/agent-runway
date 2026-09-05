import { useCallback, useEffect, useRef, useState } from "react";
import {
  bootstrapCloudBroker,
  CloudBrokerClientError,
  consumeCloudSetupToken,
  isCloudBrokerRuntime,
  readCloudBrokerStatus,
  startCloudBrokerLogin,
  type CloudBrokerStatus,
} from "../lib/cloud-broker";

interface CloudBrokerConnection {
  active: boolean;
  loading: boolean;
  status: CloudBrokerStatus | null;
  error: string | null;
  startLogin: () => Promise<void>;
}

const initialStatus = (): CloudBrokerStatus | null => isCloudBrokerRuntime() ? null : { state: "ready" };

export const useCloudBroker = (): CloudBrokerConnection => {
  const active = isCloudBrokerRuntime();
  const [status, setStatus] = useState<CloudBrokerStatus | null>(initialStatus);
  const [loading, setLoading] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await readCloudBrokerStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (reason) {
      if (reason instanceof CloudBrokerClientError && reason.code === "session_required") {
        setStatus(null);
        setError(null);
        return null;
      }
      setError(reason instanceof Error ? reason.message : "接続状態を確認できません");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const startLogin = useCallback(async () => {
    setLoading(true);
    try {
      const next = await startCloudBrokerLogin();
      setStatus(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "OpenAIへの接続を開始できません");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    const setupToken = consumeCloudSetupToken();
    if (setupToken) {
      void bootstrapCloudBroker(setupToken)
        .then(() => refreshStatus())
        .catch((reason) => {
          setError(reason instanceof Error ? reason.message : "初期設定を完了できません");
          setLoading(false);
        });
      return;
    }
    const timer = window.setTimeout(() => void refreshStatus(), 0);
    return () => window.clearTimeout(timer);
  }, [active, refreshStatus]);

  useEffect(() => {
    if (!active || status?.state !== "login_pending") return;
    const timer = window.setInterval(() => void refreshStatus(), 2_000);
    return () => window.clearInterval(timer);
  }, [active, refreshStatus, status?.state]);

  return { active, loading, status, error, startLogin };
};
