import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutostartEnabled,
  getMobileAccessInfo,
  readRateLimits,
  rotateMobileAccessToken,
  setAutostartEnabled,
  setMobileAccessEnabled,
  subscribeRateLimits,
} from "./runtime";
import { MOBILE_TOKEN_STORAGE_KEY } from "./mobile";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);

describe("runtime transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isTauriMock.mockReturnValue(false);
  });

  it("keeps the HTTP bridge as the browser transport", async () => {
    const payload = { source: "live" as const, observedAt: 123 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readRateLimits(false)).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/rate-limits", expect.objectContaining({ method: "GET" }));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses native commands for desktop reads and refreshes", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ source: "live", observedAt: 123 });

    await readRateLimits(false);
    await readRateLimits(true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_rate_limits");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "refresh_rate_limits");
  });

  it("subscribes to native rate-limit updates", async () => {
    isTauriMock.mockReturnValue(true);
    const dispose = vi.fn();
    const callback = vi.fn();
    listenMock.mockImplementation(async (_event, handler) => {
      handler({ event: "agent-runway-rate-limits", id: 1, payload: { source: "live", observedAt: 456 } });
      return dispose;
    });

    const unlisten = await subscribeRateLimits(callback);
    expect(callback).toHaveBeenCalledWith({ source: "live", observedAt: 456 });
    unlisten();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("uses native autostart commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(getAutostartEnabled()).resolves.toBe(true);
    await expect(setAutostartEnabled(false)).resolves.toBe(false);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_autostart_enabled");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "set_autostart_enabled", { enabled: false });
  });

  it("sends the mobile bearer token without putting it in the request URL", async () => {
    localStorage.setItem(MOBILE_TOKEN_STORAGE_KEY, "A".repeat(64));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ source: "live" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await readRateLimits(false);

    expect(fetchMock).toHaveBeenCalledWith("/api/rate-limits", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${"A".repeat(64)}` }),
    }));
  });

  it("controls mobile sharing through native desktop commands", async () => {
    isTauriMock.mockReturnValue(true);
    const info = { enabled: true, ready: true, pairingUrl: "https://runway.ts.net/#access_token=secret", hostname: "runway.ts.net", error: null };
    invokeMock.mockResolvedValue(info);

    await expect(getMobileAccessInfo()).resolves.toEqual(info);
    await expect(setMobileAccessEnabled(true)).resolves.toEqual(info);
    await expect(rotateMobileAccessToken()).resolves.toEqual(info);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_mobile_access_info");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "set_mobile_access_enabled", { enabled: true });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "rotate_mobile_access_token");
  });
});
