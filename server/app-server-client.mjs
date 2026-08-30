import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

const REQUEST_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 5 * 60_000;

export class CodexAppServerClient extends EventEmitter {
  #command;
  #appServerArgs;
  #process = null;
  #reader = null;
  #pending = new Map();
  #nextId = 1;
  #pollTimer = null;
  #refreshTimer = null;

  constructor({ command = process.env.CODEX_BIN || "codex", appServerArgs = ["app-server"] } = {}) {
    super();
    this.#command = command;
    this.#appServerArgs = appServerArgs;
    this.status = "idle";
    this.latest = null;
    this.lastError = null;
  }

  async start() {
    if (this.#process) return;
    this.status = "connecting";
    this.lastError = null;

    const child = spawn(this.#command, this.#appServerArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.#process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // App Server diagnostics may include local paths. Keep them out of the UI and logs.
    });
    child.on("exit", (code, signal) => {
      const wasStopped = this.status === "stopped";
      this.#failPending(new Error("Codex App Server stopped"));
      this.#cleanupProcess();
      if (!wasStopped) {
        this.status = "unavailable";
        this.lastError = `Codex App Server exited (${signal || code || "unknown"})`;
        this.emit("status", this.snapshot());
      }
    });

    try {
      await Promise.race([
        once(child, "spawn"),
        once(child, "error").then(([error]) => Promise.reject(error)),
      ]);
      this.#reader = readline.createInterface({ input: child.stdout });
      this.#reader.on("line", (line) => this.#handleLine(line));

      await this.#request("initialize", {
        clientInfo: {
          name: "agent_runway",
          title: "Agent Runway",
          version: "0.3.0",
        },
        capabilities: {
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "item/reasoning/summaryTextDelta",
            "item/commandExecution/outputDelta",
          ],
        },
      });
      this.#send({ method: "initialized", params: {} });
      this.status = "connected";
      await this.refresh();
      this.#pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
      this.#pollTimer.unref?.();
      this.emit("status", this.snapshot());
    } catch (error) {
      this.status = "unavailable";
      this.lastError = error?.code === "ENOENT"
        ? "Codex CLIが見つかりません"
        : error instanceof Error
          ? error.message
          : "Codex App Serverへ接続できません";
      this.#process?.kill();
      this.#cleanupProcess();
      this.emit("status", this.snapshot());
    }
  }

  async refresh() {
    if (!this.#process || this.status === "unavailable") return null;
    try {
      const result = await this.#request("account/rateLimits/read", {});
      this.latest = {
        ...result,
        observedAt: Date.now(),
        source: "live",
      };
      this.lastError = null;
      this.status = "connected";
      this.emit("snapshot", this.latest);
      return this.latest;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "利用枠を取得できません";
      this.emit("status", this.snapshot());
      return null;
    }
  }

  snapshot() {
    return {
      status: this.status,
      latest: this.latest,
      error: this.lastError,
    };
  }

  stop() {
    this.status = "stopped";
    this.#failPending(new Error("Agent Runway stopped"));
    this.#process?.kill();
    this.#cleanupProcess();
  }

  #send(message) {
    if (!this.#process?.stdin.writable) throw new Error("Codex App Server is not writable");
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #request(method, params) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "App Server request failed"));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method === "account/rateLimits/updated") {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = setTimeout(() => void this.refresh(), 400);
      this.#refreshTimer.unref?.();
    }
  }

  #failPending(error) {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
  }

  #cleanupProcess() {
    clearInterval(this.#pollTimer);
    clearTimeout(this.#refreshTimer);
    this.#pollTimer = null;
    this.#refreshTimer = null;
    this.#reader?.close();
    this.#reader = null;
    this.#process = null;
  }
}
