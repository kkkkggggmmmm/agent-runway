import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath) => readFile(path.resolve(process.cwd(), relativePath), "utf8");

describe("cloud broker deployment contract", () => {
  it("keeps the Fly machine persistent, HTTPS-only, and always available", async () => {
    const config = await read("fly.toml");

    expect(config).toContain('primary_region = "nrt"');
    expect(config).toContain('destination = "/home/agentrunway"');
    expect(config).toContain("internal_port = 8080");
    expect(config).toContain("force_https = true");
    expect(config).toContain('auto_stop_machines = "off"');
    expect(config).toContain("min_machines_running = 1");
    expect(config).toContain('path = "/api/health"');
    expect(config).toContain('memory = "1gb"');
    expect(config).not.toMatch(/AGENT_RUNWAY_(?:BOOTSTRAP_TOKEN|SESSION_SECRET)\s*=/);
  });

  it("deploys only on explicit request with app-scoped inputs", async () => {
    const workflow = await read(".github/workflows/cloud-deploy.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\n\s+push:/);
    expect(workflow).toContain("vars.FLY_APP_NAME");
    expect(workflow).toContain("secrets.FLY_API_TOKEN");
    expect(workflow).toContain('flyctl config validate --strict -a "$FLY_APP_NAME"');
    expect(workflow).toContain('flyctl deploy --remote-only -a "$FLY_APP_NAME"');
    expect(workflow).not.toContain("AGENT_RUNWAY_BOOTSTRAP_TOKEN");
    expect(workflow).not.toContain("AGENT_RUNWAY_SESSION_SECRET");
  });

  it("runs as an unprivileged user with state on the mounted volume", async () => {
    const dockerfile = await read("Dockerfile");
    const entrypoint = await read("cloud/docker-entrypoint.sh");
    const continuousIntegration = await read(".github/workflows/desktop-installers.yml");

    expect(dockerfile).toContain('HOME=/home/agentrunway');
    expect(dockerfile).toContain("AGENT_RUNWAY_DATA_DIR=/home/agentrunway/state");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/agent-runway-entrypoint"]');
    expect(entrypoint).toContain('exec gosu agentrunway "$@"');
    expect(entrypoint).not.toContain("chown -R");
    expect(continuousIntegration).toContain("docker build --tag agent-runway-cloud:test .");
    expect(continuousIntegration).toContain("awk '/^Uid:/ { print $2 }' /proc/1/status");
  });
});
