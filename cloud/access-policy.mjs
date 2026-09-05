import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MIN_SECRET_LENGTH = 40;
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const encode = (value) => Buffer.from(value).toString("base64url");
const decode = (value) => Buffer.from(value, "base64url").toString("utf8");

const safeEqual = (left, right) => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const parseCookies = (header = "") => Object.fromEntries(
  header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return separator === -1 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
    }),
);

export class CloudAccessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class CloudAccessPolicy {
  #bootstrapToken;
  #sessionSecret;
  #stateFile;
  #sessionTtlSeconds;
  #bootstrapConsumed = false;

  constructor({ bootstrapToken, sessionSecret, dataDirectory, sessionTtlSeconds = DEFAULT_SESSION_TTL_SECONDS }) {
    if (typeof bootstrapToken !== "string" || bootstrapToken.length < MIN_SECRET_LENGTH) {
      throw new Error(`AGENT_RUNWAY_BOOTSTRAP_TOKEN must contain at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (typeof sessionSecret !== "string" || sessionSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(`AGENT_RUNWAY_SESSION_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`);
    }
    if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 60 * 60 * 24 * 180) {
      throw new Error("sessionTtlSeconds must be between 300 seconds and 180 days");
    }
    this.#bootstrapToken = bootstrapToken;
    this.#sessionSecret = sessionSecret;
    this.#stateFile = path.join(dataDirectory, "cloud-access-state.json");
    this.#sessionTtlSeconds = sessionTtlSeconds;
  }

  async start() {
    await mkdir(path.dirname(this.#stateFile), { recursive: true });
    try {
      const state = JSON.parse(await readFile(this.#stateFile, "utf8"));
      this.#bootstrapConsumed = state?.bootstrapConsumed === true;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw new Error("Cloud access state could not be read safely");
    }
  }

  async bootstrap(token, now = Date.now()) {
    if (this.#bootstrapConsumed) {
      throw new CloudAccessError("bootstrap_consumed", "この初期設定リンクは既に使用されています");
    }
    if (typeof token !== "string" || !safeEqual(token, this.#bootstrapToken)) {
      throw new CloudAccessError("bootstrap_invalid", "初期設定リンクが無効です");
    }
    this.#bootstrapConsumed = true;
    await this.#writeState();
    return this.#issueSession(now);
  }

  authorize(request, now = Date.now()) {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.agent_runway_session;
    if (!token) throw new CloudAccessError("session_required", "この端末は初期設定リンクから接続してください");
    const payload = this.#verifySession(token);
    if (payload.expiresAt <= Math.floor(now / 1_000)) {
      throw new CloudAccessError("session_expired", "この端末の接続期限が切れました。新しい初期設定リンクが必要です");
    }
    return payload;
  }

  sessionCookie(token, secure) {
    const secureFlag = secure ? "; Secure" : "";
    return `agent_runway_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.#sessionTtlSeconds}${secureFlag}`;
  }

  clearSessionCookie(secure) {
    const secureFlag = secure ? "; Secure" : "";
    return `agent_runway_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag}`;
  }

  #issueSession(now) {
    const issuedAt = Math.floor(now / 1_000);
    const payload = {
      issuedAt,
      expiresAt: issuedAt + this.#sessionTtlSeconds,
      nonce: randomBytes(16).toString("base64url"),
    };
    const encoded = encode(JSON.stringify(payload));
    return `${encoded}.${this.#sign(encoded)}`;
  }

  #verifySession(token) {
    const [encoded, signature, ...extra] = token.split(".");
    if (!encoded || !signature || extra.length > 0 || !safeEqual(signature, this.#sign(encoded))) {
      throw new CloudAccessError("session_invalid", "この端末の接続情報が無効です");
    }
    try {
      const payload = JSON.parse(decode(encoded));
      if (
        !payload
        || typeof payload.issuedAt !== "number"
        || typeof payload.expiresAt !== "number"
        || typeof payload.nonce !== "string"
      ) {
        throw new Error("invalid payload");
      }
      return payload;
    } catch {
      throw new CloudAccessError("session_invalid", "この端末の接続情報が無効です");
    }
  }

  #sign(encoded) {
    return createHmac("sha256", this.#sessionSecret).update(encoded).digest("base64url");
  }

  async #writeState() {
    const temporary = `${this.#stateFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, JSON.stringify({ bootstrapConsumed: true }), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#stateFile);
  }
}
