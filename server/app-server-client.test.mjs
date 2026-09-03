// @vitest-environment node
import { once } from "node:events";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServerClient } from "./app-server-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const clients = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
});

describe("CodexAppServerClient", () => {
  it("initializes, reads limits, and refreshes on the documented notification", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      appServerArgs: [path.join(here, "test", "fake-app-server.mjs")],
    });
    clients.push(client);

    await client.start();
    expect(client.status).toBe("connected");
    expect(client.latest.rateLimits.primary.usedPercent).toBe(41);

    const [updated] = await Promise.race([
      once(client, "snapshot"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("notification refresh timed out")), 2_000)),
    ]);
    expect(updated.rateLimits.primary.usedPercent).toBe(42);
  });

  it("reports a missing executable without crashing the host", async () => {
    const client = new CodexAppServerClient({ command: "/agent-runway/missing-codex" });
    clients.push(client);

    await client.start();
    expect(client.status).toBe("unavailable");
    expect(client.lastError).toBe("Codex CLIが見つかりません");
  });

  it("uses the documented device-code login without retaining account identity", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      appServerArgs: [path.join(here, "test", "fake-app-server.mjs")],
    });
    clients.push(client);

    await client.start();
    await expect(client.getAccount()).resolves.toBeNull();
    await expect(client.startDeviceCodeLogin()).resolves.toMatchObject({
      status: "pending",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "FAKE-1234",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.accountSnapshot().account).toEqual({ type: "chatgpt", planType: "pro" });
    expect(JSON.stringify(client.accountSnapshot())).not.toContain("do-not-retain@example.test");
  });
});
