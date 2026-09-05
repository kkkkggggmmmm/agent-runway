# Agent Runway Cloud Broker deployment

## Purpose

Cloud Broker is the single-user, smartphone-only deployment mode. The phone uses an installable PWA and can update the shared ChatGPT Work / Codex allowance when the desktop application and Tailscale are offline.

The deployment boundary is intentionally narrow:

`PWA → same-origin HTTPS API → private Node container → codex app-server (stdio) → OpenAI`

The container exposes neither the Codex App Server protocol nor a generic coding/agent endpoint. Its public API is limited to a one-time mobile bootstrap, OpenAI device-code sign-in state, and rate-limit reads.

## Host requirements

Use a private container host that provides all of the following.

- HTTPS at the public edge and a stable custom or provider domain.
- A single private persistent volume mounted at `/home/agentrunway`.
- A non-public control plane; deployment secrets must not be committed to Git or returned to the browser.
- A private, encrypted-at-rest volume where available from the chosen host.
- No routing of `/api/*` to a Vercel/Supabase Edge Function or other serverless runtime.

The persistent volume contains only two classes of state: the Codex App Server's own managed authentication state and Agent Runway's non-credential `bootstrapConsumed` marker. Agent Runway never reads, copies, serializes, or uploads the App Server authentication files.

## Recommended host: Fly.io

The checked-in `fly.toml` is the supported production configuration. It uses the Tokyo region, one always-running 1 GB shared-CPU Machine, HTTPS at the Fly edge, and a dedicated 1 GB volume mounted at `/home/agentrunway`. The placeholder `app` value is always overridden with `-a`; do not rename the app to an account-identifying name.

Fly.io requires an account with billing enabled for a continuously running Machine. Complete the following one-time setup on your own computer. Never paste a Fly token, bootstrap token, session secret, password, or one-time code into chat.

Install `flyctl`, sign in using the browser opened by the CLI, then create an anonymous app name:

```bash
fly auth login
fly apps create --generate-name
```

Record the generated app name as `<app-name>`. Create the private volume in Tokyo:

```bash
fly volumes create agent_runway_state --app <app-name> --region nrt --size 1
```

## Configure and deploy

Generate two independent secrets locally:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Set them directly as protected Fly secrets. Use the two different values printed by the earlier commands; do not save them in the repository:

```bash
fly secrets set --app <app-name> \
  AGENT_RUNWAY_BOOTSTRAP_TOKEN=<first-value> \
  AGENT_RUNWAY_SESSION_SECRET=<second-value>
```

Deploy the first release and verify the non-sensitive health endpoint:

```bash
fly deploy --remote-only --app <app-name>
curl --fail https://<app-name>.fly.dev/api/health
```

The result must be `{"status":"ok"}`. Fly provides the `fly.dev` TLS certificate; no custom domain is needed.

### Optional GitHub deployment button

After the first deployment, create a deploy token limited to this app. A 90-day expiry avoids a long-lived all-account credential:

```bash
fly tokens create deploy --app <app-name> \
  --name "agent-runway-github" --expiry 2160h
```

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

- Repository secret `FLY_API_TOKEN`: the complete deploy-token output.
- Repository variable `FLY_APP_NAME`: the generated app name.

Do not add the bootstrap or session secrets to GitHub. Once this branch is merged into the default branch, run **Actions → Deploy cloud broker → Run workflow**. The workflow validates `fly.toml`, deploys with the app-scoped token, and confirms `/api/health` before succeeding.

For another release, use that workflow again. Rotate the deploy token before its expiry and revoke the old token in Fly.

### Generic host configuration

For a different compatible container host, set these protected environment variables:

```text
AGENT_RUNWAY_BOOTSTRAP_TOKEN=<first value>
AGENT_RUNWAY_SESSION_SECRET=<second value>
PORT=8080
```

Build from this repository's `Dockerfile`. Mount the provider's persistent volume at `/home/agentrunway`; do not attach that volume to another app. The included `docker-compose.cloud.yml` is suitable for a self-managed host behind a TLS reverse proxy.

Use `GET /api/health` as the deployment health check. It returns no account or quota information.

## First phone setup

1. In the phone browser, open the one-time link below. Do not send it through a public channel.

   ```text
   https://<app-name>.fly.dev/#setup=<AGENT_RUNWAY_BOOTSTRAP_TOKEN>
   ```

2. The PWA exchanges the fragment token over HTTPS for an HttpOnly, Secure, SameSite=Strict session cookie and records the bootstrap token as consumed.
3. Tap **OpenAIで接続する**. Open the supplied verification URL, enter the supplied device code, and complete the normal OpenAI sign-in.
4. Wait for the PWA to switch to the dashboard, then install it from Chrome or Safari.

The fragment is removed from the visible URL before the dashboard begins polling. Reuse is rejected after successful setup. If a device must be replaced, rotate both deployment secrets and redeploy, then issue a new bootstrap link.

## Acceptance checks

- `https://<deployment-domain>/api/health` returns `200`.
- Opening the root URL on an unpaired browser reveals no quota data.
- The one-time fragment link establishes a session and is rejected when replayed.
- Device-code login completes from the phone and switches the status to `ready`.
- `利用枠を再取得` returns a current App Server snapshot with no desktop or Tailscale connection.
- Chrome Android and Safari iOS can install the PWA; offline mode shows only the last cached snapshot.
- No route exposes `codex app-server`, OAuth files, prompts, threads, local paths, or generic command execution.

## Recovery and revocation

- To revoke the paired phone, rotate `AGENT_RUNWAY_SESSION_SECRET` and redeploy.
- To issue a new phone bootstrap link, rotate both secrets and redeploy. The existing persistent App Server volume may remain mounted so the user does not need to repeat OpenAI login.
- To revoke the OpenAI session itself, remove the provider volume only after deciding to clear the login intentionally. Removing the volume deletes the managed App Server sign-in and cannot be undone.
