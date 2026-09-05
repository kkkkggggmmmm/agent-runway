// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { CloudBroker, CloudBrokerError } from "./broker.mjs";

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

  async startHostedLogin() {
    this.login = {
      status: "pending",
      loginId: "test-login",
      verificationUrl: "https://auth.openai.com/authorize?test=1",
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
  it("keeps the service signed out until the managed app-server login completes", async () => {
    const client = new FakeClient();
    const broker = new CloudBroker({ client });
    await broker.start();
    expect(broker.status()).toEqual({ state: "signed_out" });

    const pending = await broker.startLogin();
    expect(pending).toEqual(expect.objectContaining({
      state: "login_pending",
      verificationUrl: "https://auth.openai.com/authorize?test=1",
    }));
    await expect(broker.rateLimits()).rejects.toBeInstanceOf(CloudBrokerError);

    client.account = { type: "chatgpt", planType: "pro" };
    client.login = { status: "completed" };
    client.emit("account", client.loginSnapshot());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(broker.status()).toEqual({ state: "ready", planType: "pro" });
    await expect(broker.rateLimits()).resolves.toEqual(expect.objectContaining({ source: "live" }));
  });
});
