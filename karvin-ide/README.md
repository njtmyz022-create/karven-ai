# KARVIN AI

Karvin is a private workspace for software projects. It combines a browser IDE, project files, coding and browser missions, approvals, model connections, user accounts, and application previews.

## Included

- Separate owner, administrator, and member accounts; invite-only registration by default.
- Per-account sessions, project/task ownership, model settings encrypted at rest, and private project directories.
- A separate IDE process and Linux UID per account when the host supports user ID ownership and process switching.
- Coding missions with Plan and Act modes, explicit edit/check approvals, history, follow-ups, export, and undo.
- Browser missions for public pages, app previews, terminal, Git, project files, and editor extension support.
- Billing is disabled. No subscription or payment provider is configured.

## First owner and user access

In Codespaces, the verified private GitHub port controls first-owner setup, so no owner email or deployment token is required. On other hosts, set `OWNER_EMAIL` before first signup and keep the service private until that account is created. Registration for everyone else is invitation-only unless you explicitly set `ALLOW_SIGNUP=true`. Owners and administrators can create seven-day invitation links from **Users & access**. Users can change their own password after signing in.

There is no email delivery, email verification, or password-reset workflow yet. An invitation is a single-use link; send it only to its intended user. Passwords are stored as salted scrypt hashes. Session cookies are HTTP-only, and state-changing account requests require CSRF checks.

## Run locally

Requires Node.js 22.13 or later. Browser missions also require a working Chromium installation. The full IDE launcher requires the code-server runtime produced by `scripts/build-ide.sh`.

```bash
npm ci
bash scripts/build-ide.sh
cp .env.example .env
# Set OWNER_EMAIL in .env before first startup.
npm run start:ide
```

Open `http://127.0.0.1:3000`. The landing page is `/`, sign-in is `/login`, mission control is `/workspace`, the IDE is `/ide/`, and the health endpoint is `/healthz`.

The first owner can connect browser and coding models in **AI connections**. Provider keys are encrypted with AES-256-GCM. Karvin creates its encryption key inside `DATA_DIR` if `DATA_ENCRYPTION_KEY` is not supplied. Back up the persistent data directory; losing it loses both account data and the key needed to decrypt saved provider settings.

## Container deployment

Build from the repository root so the Dockerfile can copy `karvin-ide/`:

```bash
docker build -f karvin-ide/Dockerfile.ide -t karvin-ai .
docker run --rm --init -p 3000:3000 \
  -e OWNER_EMAIL=owner@example.com \
  -v karvin-data:/data karvin-ai
```

Keep port 3000 behind a private workspace gateway or HTTPS reverse proxy. Preserve `/data` across restarts and deployments. The IDE image needs Linux root inside the container to create per-user file ownership and processes; each editor worker runs as its account's dedicated UID. If the host blocks `chown` or per-UID process spawning, the health check reports IDE isolation unavailable and IDE access fails closed. `ENABLE_PROJECT_COMMANDS` is off by default because build and test scripts execute project code.

## Tenant isolation limits

The API hides projects, tasks, and account settings from other users and checks ownership on each request. Project files are protected with per-user filesystem ownership, and editor processes do not receive server environment variables. Editor workers still share the container network namespace. For hostile public multi-tenant use, place each tenant in a separate container or network namespace before exposing the platform broadly. Add storage quotas, backups, email verification, and password recovery before operating it as a public SaaS.

## Verification

```bash
npm test
npm run test:browser
```

`npm test` covers account registration, invitations, session rotation, account ownership checks, encrypted provider settings, IDE proxy behavior, missions, and dashboard interactions. `npm run test:browser` additionally needs a runnable Chromium binary.

## Attribution

The coding assistant uses the published `@cline/sdk` package. Its Apache-2.0 license and copyright notice are retained in `CLINE-LICENSE`. Karvin provides its own interface, account system, project storage, and approval flow. Browser automation retains the MIT license notice in the repository's `LICENSE` file.
