import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

const REQUEST_TIMEOUT_MS = 12_000;
const LOGIN_REQUEST_TIMEOUT_MS = 60_000;
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
    this.account = null;
    this.login = null;
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
          version: "0.5.0",
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

  async getAccount() {
    if (!this.#process || this.status === "unavailable") return null;
    const result = await this.#request("account/read", { refreshToken: false });
    const account = result?.account;
    // The UI only needs the auth kind and plan. Do not retain account email or
    // any credential material returned by the App Server.
    this.account = account && typeof account === "object"
      ? {
        type: typeof account.type === "string" ? account.type : null,
        planType: typeof account.planType === "string" ? account.planType : null,
      }
      : null;
    this.emit("account", this.accountSnapshot());
    return this.account;
  }

  async startDeviceCodeLogin() {
    if (!this.#process || this.status === "unavailable") {
      throw new Error(this.lastError || "Codex App Serverへ接続できません");
    }
    if (this.login?.status === "pending") return this.login;

    // A browser login sends its callback to the App Server's localhost listener.
    // That listener is intentionally not exposed by the Cloud Broker, so a phone
    // cannot complete that flow. Device-code login lets the browser authorize the
    // App Server process without putting any callback, credential, or token in the
    // public app.
    const result = await this.#request("account/login/start", {
      type: "chatgptDeviceCode",
    }, LOGIN_REQUEST_TIMEOUT_MS);
    if (
      result?.type !== "chatgptDeviceCode"
      || typeof result.loginId !== "string"
      || typeof result.verificationUrl !== "string"
      || typeof result.userCode !== "string"
    ) {
      throw new Error("OpenAIログインを開始できません");
    }
    this.login = {
      status: "pending",
      loginId: result.loginId,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
    };
    this.emit("login", this.loginSnapshot());
    return this.login;
  }

  accountSnapshot() {
    return {
      account: this.account ? { ...this.account } : null,
      login: this.loginSnapshot(),
      status: this.status,
      error: this.lastError,
    };
  }

  loginSnapshot() {
    if (!this.login) return null;
    const { status, verificationUrl, userCode, error } = this.login;
    return {
      status,
      ...(verificationUrl ? { verificationUrl } : {}),
      ...(userCode ? { userCode } : {}),
      ...(error ? { error } : {}),
    };
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

  #request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
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
      return;
    }

    if (message.method === "account/login/completed") {
      if (!this.login || message.params?.loginId !== this.login.loginId) return;
      if (message.params?.success) {
        this.login = { status: "completed" };
        void this.getAccount().then(() => void this.refresh()).catch(() => undefined);
      } else {
        this.login = {
          status: "failed",
          error: typeof message.params?.error === "string" ? message.params.error : "認証に失敗しました",
        };
      }
      this.emit("login", this.loginSnapshot());
      return;
    }

    if (message.method === "account/updated") {
      const authMode = typeof message.params?.authMode === "string" ? message.params.authMode : null;
      const planType = typeof message.params?.planType === "string" ? message.params.planType : null;
      this.account = authMode ? { type: authMode, planType } : null;
      this.emit("account", this.accountSnapshot());
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
