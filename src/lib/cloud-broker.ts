const RUNTIME_MODE_KEY = "agent-runway:runtime-mode:v1";

export type CloudBrokerState = "ready" | "signed_out" | "login_pending" | "unavailable";

export interface CloudBrokerStatus {
  state: CloudBrokerState;
  planType?: string | null;
  verificationUrl?: string;
  userCode?: string;
  error?: string;
}

export class CloudBrokerClientError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const isCloudBrokerRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.__AGENT_RUNWAY_RUNTIME__?.mode === "cloud-broker"
    || storage()?.getItem(RUNTIME_MODE_KEY) === "cloud-broker";
};

const responseError = async (response: Response): Promise<CloudBrokerClientError> => {
  try {
    const payload = await response.json() as { error?: string; code?: string };
    return new CloudBrokerClientError(payload.code || `http_${response.status}`, payload.error || "接続を確認できません");
  } catch {
    return new CloudBrokerClientError(`http_${response.status}`, "接続を確認できません");
  }
};

const fetchStatus = async (): Promise<CloudBrokerStatus> => {
  const response = await fetch("/api/status", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw await responseError(response);
  return await response.json() as CloudBrokerStatus;
};

export const readCloudBrokerStatus = (): Promise<CloudBrokerStatus> => fetchStatus();

export const bootstrapCloudBroker = async (setupToken: string): Promise<void> => {
  const response = await fetch("/api/session/bootstrap", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupToken }),
  });
  if (!response.ok) throw await responseError(response);
};

export const startCloudBrokerLogin = async (): Promise<CloudBrokerStatus> => {
  const response = await fetch("/api/login/start", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await responseError(response);
  return await response.json() as CloudBrokerStatus;
};

export const consumeCloudSetupToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("setup");
  if (!token || token.length < 40 || token.length > 256) return null;
  fragment.delete("setup");
  const nextFragment = fragment.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextFragment ? `#${nextFragment}` : ""}`);
  return token;
};
