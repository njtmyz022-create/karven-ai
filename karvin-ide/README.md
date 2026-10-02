# KARVIN AI

KARVIN AI serves the upstream browser workspace directly at `/`, with its original Home, Sessions, Chat, Models, Rules, Hooks, MCP, Plugins, Skills, Agents, Tools, Channels, Schedules, Settings, and Account pages. The bundled interface keeps its existing layout and behavior and is branded for KARVIN during the build. No editor extension is installed. The separate code-server IDE is available at `/ide/`.

The old generated landing and Mission Control pages have been removed. Sign in at `/login`; `/workspace` redirects to the browser workspace.

## Accounts and data

- Owner, administrator, and member accounts with invitation-only registration by default.
- Each account's browser workspace and IDE run as a separate Linux UID, with a private home and project directory.
- Browser chat sessions, provider settings, rules, plugins, skills, and other workspace data are scoped to that account's home directory.
- KARVIN's account API encrypts its own saved settings at rest. Provider settings saved by the browser workspace are protected by per-user filesystem permissions; volume encryption is needed to encrypt those files at rest.
- Billing is disabled. No payment provider is configured.

## First owner and user access

In Codespaces, the verified private GitHub port controls first-owner setup, so no owner email or deployment token is required. On other hosts, set `OWNER_EMAIL` before first signup and keep the service private until that account is created. Later registration is invitation-only unless `ALLOW_SIGNUP=true`. Users can change their password after signing in.

There is no email delivery, email verification, or password-reset workflow yet. Invitations are single-use links. Passwords are stored as salted scrypt hashes, session cookies are HTTP-only, and state-changing account requests require CSRF checks.

## Run locally

Requires Node.js 22.13 or later. The build script fetches the pinned Bun runtime and browser workspace source, builds its existing web interface, downloads code-server, and installs Chromium for browser tasks.

```bash
npm ci
bash scripts/build-ide.sh
npm run start:ide
```

Open `http://127.0.0.1:3000`. `/` is the signed-in browser workspace, `/login` is KARVIN account sign-in, `/workspace` redirects to `/`, `/ide/` opens the separate IDE, and `/healthz` reports service readiness.

The browser workspace has its own per-user provider settings. KARVIN's legacy service settings remain available through its API and are encrypted in the account store. Preserve the `/data` volume across restarts; it contains account data and private workspaces.

## Container deployment

Build from the repository root so the full application and pinned browser runtime are included:

```bash
docker build -f karvin-ide/Dockerfile.ide -t karvin-ai .
docker run --rm --init -p 3000:3000 -v karvin-data:/data karvin-ai
```

Keep port 3000 behind a private workspace gateway or HTTPS reverse proxy. The container needs root privileges internally to assign per-account Linux UIDs and file ownership; each user's workspace services run under their own UID. If the host blocks ownership changes or per-UID process spawning, isolated workspace access fails closed. `ENABLE_PROJECT_COMMANDS` remains off by default.

## Verification

```bash
npm test
npm run test:browser
```

`npm test` covers account ownership, the authenticated browser-workspace proxy, per-user routing, settings encryption, IDE isolation, and the retained APIs. Browser tests require a runnable Chromium binary.

## Attribution

The browser workspace is built from the Apache-2.0 Cline repository at commit `a7ad50bae34c43823facf2c2ee726b45dc7c0145`; its license and copyright notice are retained in `CLINE-LICENSE` and in the runtime source. The coding SDK keeps its published Apache-2.0 notice. Browser automation retains the MIT license notice in `LICENSE`.
