#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appName = `agent-runway-${randomBytes(6).toString("hex")}`;
const bootstrapToken = randomBytes(32).toString("hex");
const sessionSecret = randomBytes(32).toString("hex");

const flyCommand = ["flyctl", "fly"].find((candidate) => (
  spawnSync(candidate, ["version"], { stdio: "ignore" }).status === 0
));

const run = (command, args, { quiet = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: quiet ? "ignore" : "inherit",
  });
  child.once("error", reject);
  child.once("close", (code) => resolve(code ?? 1));
});

const runWithInput = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: ["pipe", "inherit", "inherit"],
  });
  child.once("error", reject);
  child.stdin.end(input);
  child.once("close", (code) => resolve(code ?? 1));
});

const runOrThrow = async (command, args) => {
  const exitCode = await run(command, args);
  if (exitCode !== 0) throw new Error(`${command} ${args[0]} を完了できませんでした`);
};

const runWithInputOrThrow = async (command, args, input) => {
  const exitCode = await runWithInput(command, args, input);
  if (exitCode !== 0) throw new Error(`${command} ${args[0]} を完了できませんでした`);
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const verifyHealth = async (origin) => {
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      const body = await response.json();
      if (response.ok && body?.status === "ok") return;
    } catch {
      // A new Machine and certificate can take a short time to become reachable.
    }
    await wait(5_000);
  }
  throw new Error("公開ヘルスチェックが時間内に成功しませんでした。Flyのログを確認してください。");
};

const openLocalFile = (filePath) => {
  const opener = process.platform === "darwin"
    ? ["open", [filePath]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", filePath]]
      : ["xdg-open", [filePath]];
  const child = spawn(opener[0], opener[1], { detached: true, stdio: "ignore" });
  child.unref();
};

const requireConfirmation = async () => {
  if (!stdin.isTTY) throw new Error("この起動ヘルパーは対話可能なMacまたはPCのターミナルで実行してください。");
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      "東京リージョンに常時起動の1 GB Machineと1 GB永続ボリュームを作成します。料金が発生します。続けるには DEPLOY と入力してください: ",
    );
    if (answer.trim() !== "DEPLOY") throw new Error("配備を中止しました。Fly上には何も作成していません。");
  } finally {
    prompt.close();
  }
};

const main = async () => {
  if (!flyCommand) {
    throw new Error("Fly CLIが見つかりません。macOSでは `brew install flyctl` を実行してから、もう一度試してください。");
  }

  const authenticated = await run(flyCommand, ["auth", "whoami"], { quiet: true });
  if (authenticated !== 0) {
    process.stdout.write("Flyへログインします。ブラウザで、登録済みのアカウントに接続してください。\n");
    await runOrThrow(flyCommand, ["auth", "login"]);
  }

  await requireConfirmation();
  await runOrThrow(flyCommand, ["apps", "create", appName, "--yes"]);
  await runOrThrow(flyCommand, [
    "volumes", "create", "agent_runway_state",
    "--app", appName,
    "--region", "nrt",
    "--size", "1",
    "--yes",
  ]);
  await runWithInputOrThrow(
    flyCommand,
    ["secrets", "import", "--app", appName, "--stage"],
    `AGENT_RUNWAY_BOOTSTRAP_TOKEN=${bootstrapToken}\nAGENT_RUNWAY_SESSION_SECRET=${sessionSecret}\n`,
  );
  await runOrThrow(flyCommand, ["deploy", "--remote-only", "--app", appName]);

  const origin = `https://${appName}.fly.dev`;
  await verifyHealth(origin);

  const setupUrl = `${origin}/#setup=${bootstrapToken}`;
  const { toString } = await import("qrcode");
  const svg = await toString(setupUrl, {
    type: "svg",
    width: 720,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#ffffff" },
  });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-runway-phone-"));
  await chmod(temporaryDirectory, 0o700);
  const qrFile = path.join(temporaryDirectory, "phone-setup.html");
  const qrPage = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Agent Runway phone setup</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827;font:18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:780px;text-align:center;background:white;border-radius:28px;padding:36px;box-shadow:0 20px 50px #1112}svg{max-width:min(720px,85vw);height:auto}p{line-height:1.65}</style><main><h1>Agent Runway をこのスマホに接続</h1>${svg}<p>Androidのカメラで読み取り、Chromeで開いてください。<br>このQRは一回だけ有効です。ほかの人には送らないでください。</p></main></html>`;
  await writeFile(qrFile, qrPage, { encoding: "utf8", mode: 0o600 });
  openLocalFile(qrFile);

  process.stdout.write(`\nCloud Brokerを公開しました: ${origin}\n`);
  process.stdout.write("Mac上に初回接続用QRコードを表示しました。スマホで読み取ってください。\n");

  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    await prompt.question("スマホでQRを開いたら、Enterを押してローカルのQRファイルを削除します: ");
  } finally {
    prompt.close();
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
  process.stdout.write("QRファイルを削除しました。スマホ側でOpenAI接続を完了し、アプリをインストールしてください。\n");
};

main().catch((error) => {
  process.stderr.write(`\n停止: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
