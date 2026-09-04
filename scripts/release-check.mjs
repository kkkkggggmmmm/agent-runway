import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const failures = [];

const fail = (message) => failures.push(message);
const readText = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");
const readDistText = (relativePath) => readFile(path.join(distRoot, relativePath), "utf8");

const packageJson = JSON.parse(await readText("package.json"));
const tauriConfig = JSON.parse(await readText("src-tauri/tauri.conf.json"));
const cargoToml = await readText("src-tauri/Cargo.toml");
const hosting = JSON.parse(await readText(".openai/hosting.json"));

const cargoVersion = /^version = "([^"]+)"/m.exec(cargoToml)?.[1] ?? null;
const versions = [
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoVersion],
];
if (new Set(versions.map(([, version]) => version)).size !== 1) {
  fail(`version mismatch: ${versions.map(([file, version]) => `${file}=${version}`).join(", ")}`);
}
if (packageJson.version !== "0.5.0") fail(`expected release version 0.5.0, got ${packageJson.version}`);
if (hosting.static?.directory !== "dist") fail("hosting manifest must publish dist");
if (!/^appgprj_[A-Za-z0-9]+$/.test(hosting.project_id ?? "")) fail("hosting manifest must identify the existing Sites project");

const requiredFiles = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "app-icon-256.png",
  "app-icon-512.png",
];
for (const relativePath of requiredFiles) {
  try {
    const metadata = await stat(path.join(distRoot, relativePath));
    if (!metadata.isFile() || metadata.size === 0) fail(`missing or empty dist/${relativePath}`);
  } catch {
    fail(`missing dist/${relativePath}`);
  }
}

const indexHtml = await readDistText("index.html");
const manifest = JSON.parse(await readDistText("manifest.webmanifest"));
const serviceWorker = await readDistText("sw.js");
const mobileSource = await readText("src/lib/mobile.ts");

if (!indexHtml.includes('rel="manifest"')) fail("index.html does not link the PWA manifest");
if (!indexHtml.includes('name="apple-mobile-web-app-capable" content="yes"')) {
  fail("iOS standalone capability is not declared");
}
if (manifest.display !== "standalone" || manifest.start_url !== "/" || manifest.scope !== "/") {
  fail("manifest must use standalone display with root start_url and scope");
}
for (const icon of [
  { sizes: "256x256", type: "image/png" },
  { sizes: "512x512", type: "image/png" },
]) {
  if (!manifest.icons?.some((candidate) => candidate.sizes === icon.sizes && candidate.type === icon.type)) {
    fail(`manifest is missing ${icon.sizes} PNG icon`);
  }
}
if (!serviceWorker.includes('url.pathname.startsWith("/api/")')) {
  fail("service worker must bypass authenticated quota API requests");
}
if (/cache\.put\([^\n]*\/api\//i.test(serviceWorker)) {
  fail("service worker must not cache authenticated quota API responses");
}
if (!/^export const CLOUD_SYNC_ENDPOINT = "https:\/\//m.test(mobileSource)) {
  fail("cloud sync endpoint must use HTTPS");
}
if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(indexHtml + serviceWorker + mobileSource)) {
  fail("public client or static shell contains a service-role secret marker");
}

if (failures.length > 0) {
  console.error("Release surface checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release surface checks passed: Agent Runway ${packageJson.version}; PWA shell, iOS metadata, service-worker API bypass, and Sites identity are present.`);
