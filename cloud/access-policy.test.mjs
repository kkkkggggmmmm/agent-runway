// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudAccessPolicy } from "./access-policy.mjs";

const temporaryDirectories = [];
const setup = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-runway-cloud-test-"));
  temporaryDirectories.push(directory);
  const policy = new CloudAccessPolicy({
    bootstrapToken: "b".repeat(64),
    sessionSecret: "s".repeat(64),
    dataDirectory: directory,
    sessionTtlSeconds: 600,
  });
  await policy.start();
  return policy;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CloudAccessPolicy", () => {
  it("accepts one high-entropy setup token and issues a signed HttpOnly session", async () => {
    const policy = await setup();
    const session = await policy.bootstrap("b".repeat(64), 1_000_000);
    const request = { headers: { cookie: `agent_runway_session=${session}` } };

    expect(policy.authorize(request, 1_001_000)).toEqual(expect.objectContaining({ expiresAt: 1_600 }));
    expect(policy.sessionCookie(session, true)).toContain("HttpOnly");
    expect(policy.sessionCookie(session, true)).toContain("SameSite=Strict");
    expect(policy.sessionCookie(session, true)).toContain("Secure");
    await expect(policy.bootstrap("b".repeat(64))).rejects.toMatchObject({ code: "bootstrap_consumed" });
  });

  it("rejects altered and expired browser sessions", async () => {
    const policy = await setup();
    const session = await policy.bootstrap("b".repeat(64), 1_000_000);
    const request = { headers: { cookie: `agent_runway_session=${session}` } };

    expect(() => policy.authorize(request, 1_700_000)).toThrow(/期限/);
    expect(() => policy.authorize({ headers: { cookie: `agent_runway_session=${session}x` } })).toThrow(/無効/);
  });
});
