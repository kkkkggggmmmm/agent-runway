# Agent Runway engineering contract

## Product invariant

- ChatGPT Work and Codex are one shared allowance in the primary UI.
- Never invent a Work-versus-Codex attribution split.
- Treat App Server values as authoritative. Derived forecasts must disclose freshness and confidence.
- Missing windows are unavailable, never zero or full.

## Security invariant

- Never read, copy, serialize, upload, or directly manage OAuth credential files.
- In Cloud Broker mode, only the documented `codex app-server` may manage its own authentication state in the host-owned private persistent volume. Agent Runway code must never inspect that state or move it between hosts.
- Never call private ChatGPT backend endpoints.
- Never store prompts, thread contents, repository paths, or email addresses.
- Bind the local bridge to loopback only.
- Mobile access may relay quota snapshots only through encrypted HTTPS and a revocable high-entropy token.
- Cloud Broker mode may return only authentication state and quota snapshots over same-origin HTTPS. It must use app-server's stdio protocol internally; never expose an app-server WebSocket or generic Codex execution endpoint to the internet.
- The Cloud Broker must run on a single-user, private persistent container with TLS at the edge. Serverless/edge runtimes without a durable private volume are not valid auth hosts.
- The cloud snapshot table must deny direct browser/table access; only the custom-authenticated Edge Function may read or write it.
- Pairing and bootstrap secrets must stay out of query strings, server logs, and source control. A one-time bootstrap secret may appear only in a URL fragment and must be invalidated after issuance of the mobile session.
- Desktop builds must use the documented `codex app-server` stdio protocol and discard stderr that may contain local paths.
- Do not bundle, copy, or inspect the user's Codex authentication files.

## Quality gate

Run `npm run check` and `npm run desktop:test` on a Rust-capable host. Core calculation or App Server protocol regressions block release.
