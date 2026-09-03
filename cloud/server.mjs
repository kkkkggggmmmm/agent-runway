import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../server/app-server-client.mjs";
import { CloudAccessError, CloudAccessPolicy } from "./access-policy.mjs";
import { CloudBroker, CloudBrokerError } from "./broker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distRoot = path.join(projectRoot, "dist");
const port = Number.parseInt(process.env.PORT || "8080", 10);
const dataDirectory = process.env.AGENT_RUNWAY_DATA_DIR || "/var/lib/agent-runway";

const appServerArgs = (() => {
  if (!process.env.AGENT_RUNWAY_APP_SERVER_ARGS) return ["app-server"];
  try {
    const parsed = JSON.parse(process.env.AGENT_RUNWAY_APP_SERVER_ARGS);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("AGENT_RUNWAY_APP_SERVER_ARGS must be a JSON array of strings");
  }
})();

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");

const cloudAccess = new CloudAccessPolicy({
  bootstrapToken: process.env.AGENT_RUNWAY_BOOTSTRAP_TOKEN,
  sessionSecret: process.env.AGENT_RUNWAY_SESSION_SECRET,
  dataDirectory,
});
const broker = new CloudBroker({ client: new CodexAppServerClient({ appServerArgs }) });

const json = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...headers,
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

const runtimeConfig = "window.__AGENT_RUNWAY_RUNTIME__ = Object.freeze({ mode: 'cloud-broker' });\n"
  + "try { window.localStorage.setItem('agent-runway:runtime-mode:v1', 'cloud-broker'); } catch {}\n";

const forwardedValue = (request, name) => String(request.headers[name] || "").split(",")[0].trim();

const requestOrigin = (request) => {
  const protocol = forwardedValue(request, "x-forwarded-proto") || "http";
  const host = forwardedValue(request, "x-forwarded-host") || request.headers.host;
  return host ? `${protocol}://${host}` : null;
};

const isHttpsRequest = (request) => forwardedValue(request, "x-forwarded-proto") === "https" || request.socket.encrypted === true;
const sameOrigin = (request) => request.headers.origin === requestOrigin(request);

const readJson = async (request, maximumBytes = 8_192) => {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new CloudBrokerError("request_too_large", "リクエストが大きすぎます");
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new CloudBrokerError("invalid_request", "リクエスト形式が正しくありません");
  }
};

const authorize = (request, response) => {
  try {
    cloudAccess.authorize(request);
    return true;
  } catch (error) {
    const payload = error instanceof CloudAccessError
      ? { error: error.message, code: error.code }
      : { error: "この端末を確認できません", code: "session_invalid" };
    json(response, 401, payload);
    return false;
  }
};

const stateChangingRequest = (request, response) => {
  if (sameOrigin(request)) return true;
  json(response, 403, { error: "別のサイトからこの操作は実行できません", code: "origin_rejected" });
  return false;
};

const serveStatic = async (request, response, url) => {
  if (url.pathname === "/runtime-config.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : runtimeConfig);
    return;
  }

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
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    json(response, 503, { error: "UI is not built yet", instruction: "Run npm run build" });
  }
};

const handleApiError = (response, error) => {
  if (error instanceof CloudAccessError) {
    json(response, 401, { error: error.message, code: error.code });
    return;
  }
  if (error instanceof CloudBrokerError) {
    const status = error.code === "authentication_required" ? 409 : 503;
    json(response, status, { error: error.message, code: error.code });
    return;
  }
  json(response, 503, { error: "スマホ利用枠サービスを一時的に利用できません", code: "service_unavailable" });
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", requestOrigin(request) || "http://localhost");
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/session/bootstrap") {
      if (!stateChangingRequest(request, response)) return;
      const body = await readJson(request);
      const session = await cloudAccess.bootstrap(body.setupToken);
      json(response, 200, { ok: true }, {
        "Set-Cookie": cloudAccess.sessionCookie(session, isHttpsRequest(request)),
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!authorize(request, response)) return;
      if ((request.method === "POST" || request.method === "DELETE") && !stateChangingRequest(request, response)) return;

      if (request.method === "GET" && url.pathname === "/api/status") {
        json(response, 200, await broker.start());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/login/start") {
        json(response, 200, await broker.startLogin());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/rate-limits") {
        json(response, 200, await broker.rateLimits());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/refresh") {
        json(response, 200, await broker.rateLimits({ refresh: true }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session/logout") {
        json(response, 200, { ok: true }, {
          "Set-Cookie": cloudAccess.clearSessionCookie(isHttpsRequest(request)),
        });
        return;
      }
      json(response, 404, { error: "Not found" });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    handleApiError(response, error);
  }
});

await cloudAccess.start();
await broker.start();

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Agent Runway cloud broker listening on ${port}\n`);
});

const shutdown = () => {
  broker.stop();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
