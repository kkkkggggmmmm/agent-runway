// @vitest-environment node
import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CloudBroker, CloudBrokerError } from "./broker.mjs";
import { CodexAppServerClient } from "../server/app-server-client.mjs";

class FakeClient extends EventEmitter {
  status = "idle";
  lastError = null;
  latest = null;
  account = null;
  login = null;

  async start() {
    this.status = "connected";
  }

  async getAccount() {
    return this.account;
  }

  loginSnapshot() {
    if (!this.login) return null;
    const { status, verificationUrl, userCode, error } = this.login;
    return { status, ...(verificationUrl ? { verificationUrl } : {}), ...(userCode ? { userCode } : {}), ...(error ? { error } : {}) };
  }

  async startDeviceCodeLogin() {
    this.login = {
      status: "pending",
      loginId: "test-login",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    };
    this.emit("login", this.loginSnapshot());
    return this.login;
  }

  async refresh() {
    this.latest = { source: "live", observedAt: 1, rateLimits: { primary: { usedPercent: 10 } } };
    return this.latest;
  }

  stop() {}
}

describe("CloudBroker", () => {
  it("consumes App Server account events without re-reading the account", async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      appServerArgs: [path.resolve("server/test/fake-app-server.mjs")],
    });
    const originalGetAccount = client.getAccount.bind(client);
    let reads = 0;
    client.getAccount = async () => {
      reads += 1;
      // Bound a regression so a failed assertion cannot create an RPC loop.
      if (reads > 2) return null;
      return originalGetAccount();
    };
    const broker = new CloudBroker({ client });
    try {
      await broker.start();
      expect(reads).toBe(1);
      expect(broker.status()).toEqual({ state: "signed_out" });
      client.emit("account", { account: { type: "chatgpt", planType: "pro" }, login: null });
      expect(broker.status()).toEqual({ state: "ready", planType: "pro" });
      client.emit("account", { account: null, login: null });
      expect(broker.status()).toEqual({ state: "signed_out" });
      expect(reads).toBe(1);
    } finally {
      broker.stop();
    }
  });

  it("keeps the service signed out until the managed app-server login completes", async () => {
    const client = new FakeClient();
    const broker = new CloudBroker({ client });
    await broker.start();
    expect(broker.status()).toEqual({ state: "signed_out" });

    const pending = await broker.startLogin();
    expect(pending).toEqual(expect.objectContaining({
      state: "login_pending",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234",
    }));
    await expect(broker.rateLimits()).rejects.toBeInstanceOf(CloudBrokerError);

    client.account = { type: "chatgpt", planType: "pro" };
    client.login = { status: "completed" };
    client.emit("account", { account: client.account, login: client.loginSnapshot() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(broker.status()).toEqual({ state: "ready", planType: "pro" });
    await expect(broker.rateLimits()).resolves.toEqual(expect.objectContaining({ source: "live" }));
  });

  it("returns a safe, actionable category when App Server rejects device-code login", async () => {
    const client = new FakeClient();
    client.startDeviceCodeLogin = async () => {
      const error = new Error("device code is disabled");
      error.code = "INVALID_REQUEST";
      throw error;
    };
    const broker = new CloudBroker({ client });

    await expect(broker.startLogin()).rejects.toMatchObject({
      code: "device_code_rejected",
      message: expect.stringContaining("デバイスコード認証"),
    });
  });
});
