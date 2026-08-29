# Agent Runway engineering contract

## Product invariant

- ChatGPT Work and Codex are one shared allowance in the primary UI.
- Never invent a Work-versus-Codex attribution split.
- Treat App Server values as authoritative. Derived forecasts must disclose freshness and confidence.
- Missing windows are unavailable, never zero or full.

## Security invariant

- Never read or persist OAuth credential files.
- Never call private ChatGPT backend endpoints.
- Never store prompts, thread contents, repository paths, or email addresses.
- Bind the local bridge to loopback only.
- Desktop builds must use the documented `codex app-server` stdio protocol and discard stderr that may contain local paths.
- Do not bundle, copy, or inspect the user's Codex authentication files.

## Quality gate

Run `npm run check` and `npm run desktop:test` on a Rust-capable host. Core calculation or App Server protocol regressions block release.
