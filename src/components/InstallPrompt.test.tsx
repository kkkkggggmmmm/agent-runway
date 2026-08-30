import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallPrompt } from "./InstallPrompt";

const originalUserAgent = navigator.userAgent;

describe("mobile PWA install prompt", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
  });

  it("shows the iPhone home-screen instruction", () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone) Mobile Safari" });
    render(<InstallPrompt />);

    expect(screen.getByText(/Safariの共有ボタンから「ホーム画面に追加」/)).toBeInTheDocument();
  });

  it("uses the native Android install prompt when the browser offers it", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Linux; Android 16) Chrome" });
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<InstallPrompt />);

    const installEvent = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => window.dispatchEvent(installEvent));
    fireEvent.click(await screen.findByRole("button", { name: "インストール" }));

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  });
});
