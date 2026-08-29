import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createDemoRateLimits } from "./core";

const responseWith = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

describe("Agent Runway dashboard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the shared weekly allowance and clearly labels demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createDemoRateLimits()));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Agent Runway" })).toBeInTheDocument();
    expect(screen.getByText("WORK + CODEX SHARED")).toBeInTheDocument();
    expect(screen.getByText("DEMO DATA")).toBeInTheDocument();
    expect(screen.getAllByText("58%").length).toBeGreaterThan(0);
    expect(screen.getByText("1回")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/rate-limits", expect.objectContaining({ method: "GET" }));
  });

  it("refreshes through the local bridge and persists the reserve setting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(createDemoRateLimits()));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByText("DEMO DATA");

    fireEvent.click(screen.getByRole("button", { name: "利用枠を再取得" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/refresh", expect.objectContaining({ method: "POST" }));

    fireEvent.change(screen.getByLabelText("週末・緊急作業のために残す"), { target: { value: "20" } });
    expect(screen.getByText("20%")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("agent-runway:settings:v1")).toContain('"reservePercent":20'));
  });

  it("shows a recoverable connection state when the bridge is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseWith({ error: "Codex CLIが見つかりません" }, 503)));
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Codexへ接続できません" })).toBeInTheDocument();
    expect(screen.getByText("Codex CLIが見つかりません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再接続" })).toBeInTheDocument();
  });
});
