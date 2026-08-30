import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./app-server-client.mjs";
import { createDemoRateLimits } from "./demo-fixture.mjs";
import { createMobileAccessPolicy } from "./mobile-access.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distRoot = path.join(projectRoot, "dist");
const port = Number.parseInt(process.env.AGENT_RUNWAY_PORT || "4317", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("AGENT_RUNWAY_PORT must be a valid TCP port");
const demoMode = process.env.AGENT_RUNWAY_DEMO === "1";
const client = demoMode ? null : new CodexAppServerClient();
const accessPolicy = createMobileAccessPolicy({
  port,
  publicOrigin: process.env.AGENT_RUNWAY_PUBLIC_ORIGIN,
  mobileToken: process.env.AGENT_RUNWAY_MOBILE_TOKEN,
});

const json = (response, status, payload) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
};

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

const serveStatic = async (request, response, url) => {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    json(response, 400, { error: "Invalid path encoding" });
    return;
  }
  let filePath = path.resolve(distRoot, `.${requestedPath}`);
  if (!filePath.startsWith(`${distRoot}${path.sep}`)) {
    json(response, 400, { error: "Invalid path" });
    return;
  }

  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error("Not a file");
  } catch {
    filePath = path.join(distRoot, "index.html");
  }

  try {
    const contents = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") || filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    json(response, 503, {
      error: "UI is not built yet",
      instruction: "Run npm run build",
    });
  }
};

const server = http.createServer(async (request, response) => {
  if (!accessPolicy.allowedRequest(request)) {
    json(response, 403, { error: "Loopback access only" });
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/") && !accessPolicy.authorizedApiRequest(request)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    json(response, 401, { error: "スマホ接続コードが無効です。PCで新しいQRコードを読み取ってください" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, demoMode
      ? { status: "demo", source: "demo" }
      : { status: client.status, source: "live", error: client.lastError });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rate-limits") {
    if (demoMode) {
      json(response, 200, createDemoRateLimits());
      return;
    }
    if (client.latest) {
      json(response, 200, client.latest);
      return;
    }
    json(response, 503, {
      error: client.lastError || "利用枠をまだ取得できていません",
      status: client.status,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    if (demoMode) {
      json(response, 200, createDemoRateLimits());
      return;
    }
    const latest = await client.refresh();
    json(response, latest ? 200 : 503, latest ?? { error: client.lastError });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    json(response, 405, { error: "Method not allowed" });
    return;
  }
  await serveStatic(request, response, url);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Agent Runway listening at http://127.0.0.1:${port}${demoMode ? " (demo)" : ""}\n`);
});

if (client) void client.start();

const shutdown = () => {
  client?.stop();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
