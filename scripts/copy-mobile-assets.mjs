import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

await mkdir(distRoot, { recursive: true });
await Promise.all([
  copyFile(path.join(projectRoot, "src-tauri/icons/icon.png"), path.join(distRoot, "app-icon-512.png")),
  copyFile(
    path.join(projectRoot, "src-tauri/icons/128x128@2x.png"),
    path.join(distRoot, "app-icon-256.png"),
  ),
]);
