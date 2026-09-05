import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RawRateLimitResponse } from "../core";
import {
  CLOUD_SYNC_ENDPOINT,
  cloudMobileHeaders,
  getMobileAccessToken,
  isCloudMobileEntry,
  mobileAuthorizationHeaders,
} from "./mobile";
import { isCloudBrokerRuntime } from "./cloud-broker";

const RATE_LIMIT_EVENT = "agent-runway-rate-limits";

export interface MobileAccessInfo {
  enabled: boolean;
  ready: boolean;
  pairingUrl: string | null;
  hostname: string | null;
  error: string | null;
}

export const isDesktopRuntime = (): boolean => isTauri();

const responseError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error || `利用枠を取得できません (${response.status})`;
  } catch {
    return `利用枠を取得できません (${response.status})`;
  }
};

const fetchRateLimits = async (manual: boolean): Promise<RawRateLimitResponse> => {
  const response = await fetch(manual ? "/api/refresh" : "/api/rate-limits", {
    method: manual ? "POST" : "GET",
    cache: "no-store",
    headers: { Accept: "application/json", ...mobileAuthorizationHeaders() },
  });
  if (!response.ok) throw new Error(await responseError(response));
  return await response.json() as RawRateLimitResponse;
};

const fetchCloudBrokerRateLimits = async (manual: boolean): Promise<RawRateLimitResponse> => {
  const response = await fetch(manual ? "/api/refresh" : "/api/rate-limits", {
    method: manual ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(await responseError(response));
  return await response.json() as RawRateLimitResponse;
};

const fetchCloudRateLimits = async (): Promise<RawRateLimitResponse> => {
  if (!getMobileAccessToken()) {
    throw new Error("スマホ接続リンクが必要です。PC版Agent Runwayで表示されるQRコードを読み取ってください");
  }
  const response = await fetch(CLOUD_SYNC_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    headers: cloudMobileHeaders(),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return await response.json() as RawRateLimitResponse;
};

export const readRateLimits = (manual: boolean): Promise<RawRateLimitResponse> => {
  if (!isDesktopRuntime()) {
    if (isCloudBrokerRuntime()) return fetchCloudBrokerRateLimits(manual);
    return isCloudMobileEntry() ? fetchCloudRateLimits() : fetchRateLimits(manual);
  }
  return invoke<RawRateLimitResponse>(manual ? "refresh_rate_limits" : "get_rate_limits");
};

export const subscribeRateLimits = async (
  onRateLimits: (payload: RawRateLimitResponse) => void,
): Promise<UnlistenFn> => {
  if (!isDesktopRuntime()) return () => undefined;
  return listen<RawRateLimitResponse>(RATE_LIMIT_EVENT, (event) => onRateLimits(event.payload));
};

export const getAutostartEnabled = async (): Promise<boolean> => {
  if (!isDesktopRuntime()) return false;
  return invoke<boolean>("get_autostart_enabled");
};

export const setAutostartEnabled = async (enabled: boolean): Promise<boolean> => {
  if (!isDesktopRuntime()) return false;
  return invoke<boolean>("set_autostart_enabled", { enabled });
};

export const getMobileAccessInfo = async (): Promise<MobileAccessInfo> => {
  if (!isDesktopRuntime()) throw new Error("スマホ共有はデスクトップ版から設定してください");
  return invoke<MobileAccessInfo>("get_mobile_access_info");
};

export const setMobileAccessEnabled = async (enabled: boolean): Promise<MobileAccessInfo> => {
  if (!isDesktopRuntime()) throw new Error("スマホ共有はデスクトップ版から設定してください");
  return invoke<MobileAccessInfo>("set_mobile_access_enabled", { enabled });
};

export const rotateMobileAccessToken = async (): Promise<MobileAccessInfo> => {
  if (!isDesktopRuntime()) throw new Error("スマホ共有はデスクトップ版から設定してください");
  return invoke<MobileAccessInfo>("rotate_mobile_access_token");
};
