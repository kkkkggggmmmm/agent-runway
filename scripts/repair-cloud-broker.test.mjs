import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "scripts/repair-cloud-broker.mjs");

describe("Cloud Broker pairing recovery", () => {
  it("rotates only the bootstrap secret before safely resetting the pairing marker", async () => {
    const source = await readFile(sourcePath, "utf8");

    expect(source).toContain('"deploy", "--remote-only", "--app", appName');
    expect(source).toContain('["secrets", "import", "--app", appName]');
    expect(source).toContain('AGENT_RUNWAY_BOOTSTRAP_TOKEN=${bootstrapToken}');
    expect(source).not.toContain("AGENT_RUNWAY_SESSION_SECRET=${");
    expect(source).toContain('"rm -f /home/agentrunway/state/cloud-access-state.json"');
    expect(source).toContain('["apps", "restart", appName]');
    expect(source).toContain('answer.trim() === "DONE"');
    expect(source).not.toMatch(/console\.log\([^\n]*setupUrl/);
  });
});
