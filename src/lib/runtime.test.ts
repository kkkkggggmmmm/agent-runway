import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutostartEnabled,
  readRateLimits,
  setAutostartEnabled,
  subscribeRateLimits,
} from "./runtime";

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
});
