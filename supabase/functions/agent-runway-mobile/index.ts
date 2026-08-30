import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const table = "agent_runway_mobile_snapshots";
const tokenPattern = /^[a-f0-9]{64}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const allowedOrigin = (origin: string | null): string => {
  if (origin === "http://localhost:5173") return origin;
  if (origin === "https://agent-runway.vercel.app") return origin;
  if (origin === "https://agent-runway-mobile.keijimizoguchi.chatgpt.site") return origin;
  if (origin && /^https:\/\/agent-runway-[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return "https://agent-runway-mobile.keijimizoguchi.chatgpt.site";
};

const headersFor = (request: Request, noStore = false): HeadersInit => ({
  "access-control-allow-origin": allowedOrigin(request.headers.get("origin")),
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
  "vary": "Origin",
  ...(noStore ? { "cache-control": "no-store" } : {}),
});

const reply = (request: Request, status: number, body: Record<string, unknown>, noStore = true) =>
  new Response(JSON.stringify(body), { status, headers: headersFor(request, noStore) });

const bearerToken = (request: Request): string | null => {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,160})$/.exec(value);
  return match ? match[1] : null;
};

const digest = async (value: string): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const equalSecrets = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

const sanitizePayload = (input: unknown): Record<string, unknown> | null => {
  if (!isRecord(input)) return null;
  const payload: Record<string, unknown> = { source: "live" };
  for (const key of ["rateLimits", "rateLimitsByLimitId"] as const) {
    if (isRecord(input[key])) payload[key] = input[key];
  }
  if (!payload.rateLimits && !payload.rateLimitsByLimitId) return null;

  if (typeof input.planType === "string" && input.planType.length <= 80) payload.planType = input.planType;
  if (typeof input.resetCreditsAvailable === "number" && Number.isFinite(input.resetCreditsAvailable)) {
    payload.resetCreditsAvailable = input.resetCreditsAvailable;
  }
  if (typeof input.nextResetCreditExpiry === "number" && Number.isFinite(input.nextResetCreditExpiry)) {
    payload.nextResetCreditExpiry = input.nextResetCreditExpiry;
  }
  const observedAt = typeof input.observedAt === "number" && Number.isFinite(input.observedAt)
    ? input.observedAt
    : Date.now();
  payload.observedAt = observedAt;
  return JSON.stringify(payload).length <= 48_000 ? payload : null;
};

const authorizeWrite = async (request: Request, body: Record<string, unknown>) => {
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const secret = bearerToken(request);
  if (!uuidPattern.test(deviceId) || !secret || !tokenPattern.test(secret)) return null;
  const writeHash = await digest(secret);
  const { data, error } = await admin
    .from(table)
    .select("write_secret_hash")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) throw new Error("lookup failed");
  if (data && !equalSecrets(data.write_secret_hash, writeHash)) return { deviceId, writeHash, authorized: false, exists: true };
  return { deviceId, writeHash, authorized: true, exists: Boolean(data) };
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(request) });

  try {
    if (request.method === "GET") {
      const token = bearerToken(request);
      if (!token || !tokenPattern.test(token)) return reply(request, 401, { error: "スマホ接続コードが無効です" });
      const { data, error } = await admin
        .from(table)
        .select("payload")
        .eq("share_token_hash", await digest(token))
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw new Error("read failed");
      if (!data) return reply(request, 401, { error: "スマホ接続コードが無効です。PCで新しいQRコードを読み取ってください" });
      return reply(request, 200, data.payload as Record<string, unknown>);
    }

    if (request.method !== "POST") return reply(request, 405, { error: "Method not allowed" });
    const body = await request.json();
    if (!isRecord(body)) return reply(request, 400, { error: "無効な同期データです" });
    const authorization = await authorizeWrite(request, body);
    if (!authorization || !authorization.authorized) return reply(request, 401, { error: "同期認証に失敗しました" });

    if (body.action === "revoke") {
      if (!authorization.exists) return reply(request, 200, { ok: true });
      const { error } = await admin
        .from(table)
        .update({ share_token_hash: null, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("device_id", authorization.deviceId);
      if (error) throw new Error("revoke failed");
      return reply(request, 200, { ok: true });
    }

    if (body.action !== "sync") return reply(request, 400, { error: "無効な同期操作です" });
    const shareToken = typeof body.shareToken === "string" ? body.shareToken : "";
    const payload = sanitizePayload(body.payload);
    if (!tokenPattern.test(shareToken) || !payload) return reply(request, 400, { error: "同期できる利用枠データではありません" });
    const observedAt = new Date(Number(payload.observedAt)).toISOString();
    const row = {
      device_id: authorization.deviceId,
      write_secret_hash: authorization.writeHash,
      share_token_hash: await digest(shareToken),
      payload,
      observed_at: observedAt,
      updated_at: new Date().toISOString(),
      revoked_at: null,
    };
    const query = authorization.exists
      ? admin.from(table).update(row).eq("device_id", authorization.deviceId)
      : admin.from(table).insert(row);
    const { error } = await query;
    if (error) throw new Error("sync failed");
    return reply(request, 200, { ok: true });
  } catch {
    return reply(request, 503, { error: "スマホ同期サービスを一時的に利用できません" });
  }
});
