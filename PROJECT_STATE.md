# PROJECT_STATE

- project: Agent Runway
- version: 0.4.0
- date: 2026-08-30
- state: PUBLIC_MOBILE_LINK_CANDIDATE
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
- automated tests: 35 pass
- production build: pass
- demo HTTP/API/CSP integration: pass
- missing Codex CLI recovery: pass
- live authenticated account: accepted by the user on their machine

## Mobile companion slice

- installable PWA for iPhone and Android from the existing React UI
- desktop-owned cloud-sync client; only quota snapshots leave the desktop
- public PWA link backed by a private Supabase row and custom-authenticated Edge Function
- QR pairing with a 256-bit URL-fragment token and exact Bearer validation
- service-worker app-shell cache and last-known live quota fallback
- responsive safe-area and touch-target treatment
- no Codex or ChatGPT credential material leaves the desktop

## Environment note

The current build environment has Node.js but does not have Rust or the Codex CLI. Native compilation and installer generation therefore run on GitHub-hosted Windows and macOS runners. The App Server bridge is covered by fake stdio integration tests; the user has separately confirmed the live authenticated account path.

## Release follow-up

Add Apple Developer ID/notarization and Windows Authenticode credentials before broad public distribution.
