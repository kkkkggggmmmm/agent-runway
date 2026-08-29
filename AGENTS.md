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

## Quality gate

Run `npm run check`. Core calculation regressions block release.
