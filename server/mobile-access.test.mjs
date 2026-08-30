// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMobileAccessPolicy } from "./mobile-access.mjs";

const request = (headers) => ({ headers });

describe("mobile access policy", () => {
  it("keeps loopback access local and backwards compatible", () => {
    const policy = createMobileAccessPolicy({ port: 4317 });
    const local = request({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" });
    expect(policy.allowedRequest(local)).toBe(true);
    expect(policy.authorizedApiRequest(local)).toBe(true);
    expect(policy.allowedRequest(request({ host: "attacker.example" }))).toBe(false);
  });

  it("requires an exact HTTPS origin and bearer token for mobile API access", () => {
    const token = "A".repeat(64);
    const policy = createMobileAccessPolicy({
      port: 4317,
      publicOrigin: "https://runway.example.ts.net:8443",
      mobileToken: token,
    });
    const shell = request({
      host: "runway.example.ts.net:8443",
      origin: "https://runway.example.ts.net:8443",
    });
    expect(policy.allowedRequest(shell)).toBe(true);
    expect(policy.authorizedApiRequest(shell)).toBe(false);
    expect(policy.authorizedApiRequest(request({
      ...shell.headers,
      authorization: `Bearer ${token}`,
    }))).toBe(true);
    expect(policy.allowedRequest(request({ host: "other.example.ts.net:8443" }))).toBe(false);
  });

  it("rejects public mode without a strong token", () => {
    expect(() => createMobileAccessPolicy({
      port: 4317,
      publicOrigin: "https://runway.example.ts.net",
      mobileToken: "short",
    })).toThrow(/40 characters/);
  });
});
