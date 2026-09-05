# PROJECT_STATE

- project: Agent Runway
- version: 0.5.0
- date: 2026-09-03
- state: CLOUD_BROKER_DEPLOYMENT_READY
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
- automated tests: 45 pass
- production build: pass
- demo HTTP/API/CSP integration: pass
- missing Codex CLI recovery: pass
- live authenticated account: accepted by the user on their machine

## Mobile companion slice

- installable PWA for iPhone and Android from the existing React UI
- desktop-owned cloud-sync client; only quota snapshots leave the desktop
- public PWA link backed by a private Supabase row and custom-authenticated Edge Function
- hosted at `agent-runway-mobile.keijimizoguchi.chatgpt.site`; static shell is public, data remains token-gated
- QR pairing with a 256-bit URL-fragment token and exact Bearer validation
- service-worker app-shell cache and last-known live quota fallback
- responsive safe-area and touch-target treatment
- no Codex or ChatGPT credential material leaves the desktop

## Cloud Broker slice

- smartphone-only PWA route with no Mac, Tailscale, or QR requirement after setup
- private long-running container owns the documented Codex App Server stdio process; public internet never reaches App Server directly
- one-time URL-fragment bootstrap token establishes an HttpOnly, Secure, SameSite=Strict mobile session and is then invalidated in the container's non-credential state volume
- OpenAI device-code login is shown only to the paired phone; app-server alone manages its own auth state on the host-owned persistent volume
- the PWA receives only auth readiness, plan type, and App Server quota snapshots; it never receives prompts, threads, repositories, email, OAuth files, or generic agent execution
- Docker image, persistent-volume Compose contract, unit tests, and static-shell runtime configuration are implemented
- Fly.io production configuration and a manually triggered, app-scoped GitHub deployment workflow are ready
- **NOT DEPLOYED:** the owner must still create the Fly account/app/volume, set protected secrets, and run the first deployment

## Environment note

The current build environment has Node.js but does not have Rust or the Codex CLI. Native compilation and installer generation therefore run on GitHub-hosted Windows and macOS runners. The App Server bridge is covered by fake stdio integration tests; the user has separately confirmed the live authenticated account path.

## Release follow-up

Add Apple Developer ID/notarization and Windows Authenticode credentials before broad public distribution.

Before activating Cloud Broker, complete the one-time Fly account/app/volume setup in `docs/cloud-broker-deployment.md`, create deployment-only secrets without sending them through chat, verify mobile browser QA over HTTPS, and retain the existing desktop snapshot companion as a rollback path.
