const MOBILE_TOKEN_KEY = "agent-runway:mobile-token:v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,160}$/;
export const CLOUD_SYNC_ENDPOINT = "https://cjjxjoaugpmttwxmtgyp.supabase.co/functions/v1/agent-runway-mobile";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DvgeGVQ1Q3WHEnfpGuoRoA_nvYi9zu_";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const consumeMobileAccessToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("access_token");
  if (!token || !TOKEN_PATTERN.test(token)) return getMobileAccessToken();

  storage()?.setItem(MOBILE_TOKEN_KEY, token);
  fragment.delete("access_token");
  const nextFragment = fragment.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextFragment ? `#${nextFragment}` : ""}`);
  return token;
};

export const getMobileAccessToken = (): string | null => {
  if (typeof window === "undefined") return null;
  const token = storage()?.getItem(MOBILE_TOKEN_KEY) ?? null;
  return token && TOKEN_PATTERN.test(token) ? token : null;
};

export const disconnectMobileCompanion = (): void => {
  storage()?.removeItem(MOBILE_TOKEN_KEY);
};

export const isMobileCompanion = (): boolean =>
  !window.location.hostname.match(/^(127\.0\.0\.1|localhost)$/) && getMobileAccessToken() !== null;

export const isCloudMobileEntry = (): boolean =>
  !window.location.hostname.match(/^(127\.0\.0\.1|localhost)$/);

export const mobileAuthorizationHeaders = (): HeadersInit | undefined => {
  const token = getMobileAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
};

export const cloudMobileHeaders = (): HeadersInit => ({
  Accept: "application/json",
  apikey: SUPABASE_PUBLISHABLE_KEY,
  ...(mobileAuthorizationHeaders() ?? {}),
});

export const MOBILE_TOKEN_STORAGE_KEY = MOBILE_TOKEN_KEY;
