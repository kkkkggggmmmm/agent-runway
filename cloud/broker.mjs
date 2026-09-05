import { EventEmitter } from "node:events";

export class CloudBrokerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isChatGptAccount = (account) => account?.type === "chatgpt" || account?.type === "chatgptAuthTokens";

export class CloudBroker extends EventEmitter {
  #client;
  #started = false;
  #account = null;
  #login = null;

  constructor({ client }) {
    super();
    this.#client = client;
  }

  async start() {
    if (this.#started) return this.status();
    this.#started = true;
    this.#client.on("account", () => void this.#syncAccount());
    this.#client.on("login", () => {
      this.#login = this.#client.loginSnapshot?.() ?? null;
      void this.#syncAccount();
    });
    this.#client.on("status", () => this.emit("status", this.status()));
    this.#client.on("snapshot", (snapshot) => this.emit("snapshot", snapshot));
    await this.#client.start();
    await this.#syncAccount();
    return this.status();
  }

  async startLogin() {
    await this.start();
    if (this.#client.status === "unavailable") {
      throw new CloudBrokerError("app_server_unavailable", this.#client.lastError || "Codex App Serverへ接続できません");
    }
    let login;
    try {
      login = await this.#client.startHostedLogin();
    } catch {
      // Do not surface App Server paths or diagnostics to the phone. The
      // structured error lets the UI retain the retry action instead of
      // collapsing into an unhelpful generic 503 state.
      throw new CloudBrokerError(
        "login_start_failed",
        "OpenAIログインを開始できませんでした。数秒待ってから、もう一度お試しください。",
      );
    }
    this.#login = this.#client.loginSnapshot?.() ?? login;
    this.emit("status", this.status());
    return this.status();
  }

  async rateLimits({ refresh = false } = {}) {
    await this.start();
    if (!isChatGptAccount(this.#account)) {
      throw new CloudBrokerError("authentication_required", "OpenAIアカウントの接続が必要です");
    }
    const snapshot = refresh ? await this.#client.refresh() : this.#client.latest ?? await this.#client.refresh();
    if (!snapshot) {
      throw new CloudBrokerError("rate_limits_unavailable", this.#client.lastError || "利用枠を取得できません");
    }
    return snapshot;
  }

  status() {
    if (this.#client.status === "unavailable") {
      return { state: "unavailable", error: this.#client.lastError || "Codex App Serverへ接続できません" };
    }
    if (this.#login?.status === "pending") {
      return {
        state: "login_pending",
        verificationUrl: this.#login.verificationUrl,
        userCode: this.#login.userCode,
      };
    }
    if (isChatGptAccount(this.#account)) {
      return { state: "ready", planType: this.#account.planType || null };
    }
    if (this.#login?.status === "failed") {
      return { state: "signed_out", error: this.#login.error || "認証に失敗しました" };
    }
    return { state: "signed_out" };
  }

  stop() {
    this.#client.stop();
  }

  async #syncAccount() {
    try {
      this.#account = await this.#client.getAccount();
    } catch {
      this.#account = null;
    }
    this.#login = this.#client.loginSnapshot?.() ?? this.#login;
    this.emit("status", this.status());
  }
}
