# PROJECT_STATE

- project: Agent Runway
- version: 0.2.0
- date: 2026-08-29
- state: NATIVE_DESKTOP_CANDIDATE
- canonical design: ../agent-runway-product-design-v0.1.md

## Native desktop slice

- Tauri 2 shell for Windows and macOS
- persistent Rust `codex app-server` JSONL client and rate-limit polling
- native tray/menu bar with weekly remaining quota, open, refresh, autostart, and quit
- close-to-tray behavior and single-instance window restore
- Tauri IPC/events in desktop builds with the HTTP bridge retained as a browser fallback
- GitHub Actions targets Windows NSIS/MSI and macOS Universal DMG artifacts
- unsigned development artifacts; production signing remains an operator concern

## Completed web slice

Deterministic quota core + live local bridge + responsive dashboard.

- `npm run check`: pass
- automated tests: 22 pass
- production build: pass
- demo HTTP/API/CSP integration: pass
- missing Codex CLI recovery: pass
- live authenticated account: accepted by the user on their machine

## Environment note

The current build environment has Node.js but does not have Rust or the Codex CLI. Native compilation and installer generation therefore run on GitHub-hosted Windows and macOS runners. The App Server bridge is covered by fake stdio integration tests; the user has separately confirmed the live authenticated account path.

## Release follow-up

Add Apple Developer ID/notarization and Windows Authenticode credentials before broad public distribution.
