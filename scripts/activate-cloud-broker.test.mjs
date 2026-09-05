import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "scripts/activate-cloud-broker.mjs");

describe("Cloud Broker activation helper", () => {
  it("creates a private Fly deployment without serializing its pairing secret", async () => {
    const source = await readFile(sourcePath, "utf8");

    expect(source).toContain('randomBytes(32).toString("hex")');
    expect(source).toContain('"volumes", "create", "agent_runway_state"');
    expect(source).toContain('"--region", "nrt"');
    expect(source).toContain('["secrets", "import", "--app", appName, "--stage"]');
    expect(source).toContain('"deploy", "--remote-only", "--app", appName');
    expect(source).toContain('type: "svg"');
    expect(source).toContain("mkdtemp(path.join(os.tmpdir(), \"agent-runway-phone-\"))");
    expect(source).toContain("await rm(temporaryDirectory, { recursive: true, force: true })");
    expect(source).toContain('answer.trim() === "DONE"');
    expect(source).not.toMatch(/console\.log\([^\n]*setupUrl/);
    expect(source).not.toContain("execSync");
  });
});
