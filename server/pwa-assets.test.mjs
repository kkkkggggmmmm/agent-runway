// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("mobile PWA assets", () => {
  it("declares an installable standalone app with scalable and large icons", async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, "public/manifest.webmanifest"), "utf8"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "any", type: "image/svg+xml" }),
      expect.objectContaining({ sizes: "256x256", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    ]));
  });

  it("never caches authenticated quota API responses", async () => {
    const serviceWorker = await readFile(path.join(projectRoot, "public/sw.js"), "utf8");
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).not.toMatch(/cache\.put\([^\n]*api/i);
  });
});
