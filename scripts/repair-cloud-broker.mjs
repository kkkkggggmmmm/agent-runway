#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;
const appName = (() => {
  const args = process.argv.slice(2);
  const index = args.indexOf("--app");
  const value = index === -1 ? null : args[index + 1];
  if (args.length !== 2 || index !== 0 || !value || !APP_NAME_PATTERN.test(value)) {
    throw new Error("使い方: npm run cloud:repair -- --app <既存のFlyアプリ名>");
  }
  return value;
})();
const bootstrapToken = randomBytes(32).toString("hex");
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

const runOrThrow = async (command, args, options) => {
  const exitCode = await run(command, args, options);
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
      // Deploys and Machine restarts can take a short time to become reachable.
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

const requirePairConfirmation = async () => {
  if (!stdin.isTTY) throw new Error("この復旧ヘルパーは対話可能なMacまたはPCのターミナルで実行してください。");
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(
      "既存アプリを更新し、古い初回QRだけを無効化して新しいQRを発行します。既存のスマホ接続とOpenAI認証は維持されます。続けるには PAIR と入力してください: ",
    );
    if (answer.trim() !== "PAIR") throw new Error("QR再発行を中止しました。既存アプリは変更していません。");
  } finally {
    prompt.close();
  }
};

const createQr = async (setupUrl) => {
  const { toString } = await import("qrcode");
  const svg = await toString(setupUrl, {
    type: "svg",
    width: 720,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#111827", light: "#ffffff" },
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-runway-phone-"));
  await chmod(directory, 0o700);
  const qrFile = path.join(directory, "phone-setup.html");
  const qrPage = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Agent Runway phone setup</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;color:#111827;font:18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:780px;text-align:center;background:white;border-radius:28px;padding:36px;box-shadow:0 20px 50px #1112}svg{max-width:min(720px,85vw);height:auto}p{line-height:1.65}</style><main><h1>Agent Runway をこのスマホに接続</h1>${svg}<p>Androidのカメラで読み取り、Chromeで開いてください。<br>画面に「OpenAIで接続する」が出るまで、このターミナルでは何も入力しないでください。</p></main></html>`;
  await writeFile(qrFile, qrPage, { encoding: "utf8", mode: 0o600 });
  openLocalFile(qrFile);
  return directory;
};

const waitForQrConfirmation = async (directory) => {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = await prompt.question("スマホに「OpenAIで接続する」が出たことを確認したら DONE と入力してください（それまではQRを削除しません）: ");
      if (answer.trim() === "DONE") return;
      process.stdout.write("QRはまだ削除していません。スマホ画面を確認してから DONE と入力してください。\n");
    }
  } finally {
    prompt.close();
    await rm(directory, { recursive: true, force: true });
  }
};

const main = async () => {
  if (!flyCommand) {
    throw new Error("Fly CLIが見つかりません。公式の `curl -L https://fly.io/install.sh | sh` を実行してから、もう一度試してください。");
  }

  const authenticated = await run(flyCommand, ["auth", "whoami"], { quiet: true });
  if (authenticated !== 0) {
    process.stdout.write("Flyへログインします。ブラウザで、登録済みのアカウントに接続してください。\n");
    await runOrThrow(flyCommand, ["auth", "login"]);
  }
  await requirePairConfirmation();

  const origin = `https://${appName}.fly.dev`;
  await runOrThrow(flyCommand, ["deploy", "--remote-only", "--app", appName]);

  // Rotate before resetting the marker so an earlier QR can never become valid
  // again. Fly restarts the Machine when an active secret changes.
  await runWithInputOrThrow(
    flyCommand,
    ["secrets", "import", "--app", appName],
    `AGENT_RUNWAY_BOOTSTRAP_TOKEN=${bootstrapToken}\n`,
  );
  await runOrThrow(flyCommand, [
    "ssh", "console", "--app", appName,
    "-C", "rm -f /home/agentrunway/state/cloud-access-state.json",
  ]);
  await runOrThrow(flyCommand, ["apps", "restart", appName]);
  await verifyHealth(origin);

  const directory = await createQr(`${origin}/#setup=${bootstrapToken}`);
  process.stdout.write(`\nCloud Brokerを更新しました: ${origin}\n`);
  process.stdout.write("Mac上に新しい初回接続用QRコードを表示しました。スマホで読み取ってください。\n");
  await waitForQrConfirmation(directory);
  process.stdout.write("QRファイルを削除しました。スマホ側でOpenAI接続を完了し、アプリをインストールしてください。\n");
};

main().catch((error) => {
  process.stderr.write(`\n停止: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
