# GitHub workspace access

The Codespaces launcher uses private GitHub account access without a second token/password prompt. See [CODESPACES.md](CODESPACES.md). Other hosts retain the password and token described below.

# KARVIN IDE deployment

On Linux amd64 run `bash scripts/build-ide.sh`, set `WEB_AGENT_TOKEN` to a random password of at least 24 characters, then run `npm run start:ide`.

The landing page is at `/`, Mission Control at `/workspace`, code-server at `/ide/`, health at `/healthz`. IDE password and dashboard token match. code-server authenticates HTTP and WebSocket access. Editor, explorer, terminal, Git, extensions, Cline and app previews are included. Preview apps using `/ide/proxy/PORT/`. Mission Control projects share the IDE project root.

Connect your model in dashboard Connections or the Cline extension settings. Keys never return through the API. This is one trusted owner's workspace, not a multi-tenant SaaS.

Free Render storage is temporary: push to Git or export ZIP before closing. Files and credentials can be lost on sleep, restart or deployment. Paid compute with a persistent disk is required for durable files. Heavy Cline and Chromium workloads can exceed free instance memory.

code-server 4.139.1 uses the official release with verified SHA256. The Cline extension installs from Open VSX during build; installation failure stops the build. Existing licenses are retained.

---

# Karvin

An agent workspace combining browser automation with the official Cline coding engine. Give Karvin a goal, inspect streamed activity, approve proposed code changes, and download the resulting project.

## What works in this implementation

- **Browser missions:** natural language goals, real Chromium runner, observed-control actions, snapshots, repeated-action detection, exact page evidence and structured JSON results.
- **Cline coding:** official `@cline/sdk` 0.0.89 agent engine, source search/read/write tools, tool approval policy, streamed responses, token usage and persisted conversations for follow-up tasks.
- **Plan / Act:** Plan exposes read/search and completion tools; Act adds approved edits and optional project checks. Plan cannot invoke writes or project commands.
- **Projects:** create projects, import text files or source folders, inspect/edit files, download a source ZIP, and undo a task's edits if no later changes conflict.
- **Unified missions:** one history, concurrency-limited queue, project locking, cancellation, JSON export, SSE progress and SQLite persistence. Interrupted work is identified after restart.
- **Model connections:** separate coding/browser models or one shared OpenAI-compatible connection. Coding can alternatively use Cline's native provider adapters.

Karvin embeds Cline's supported SDK rather than copying its IDE extension into a webpage. The app supplies its own UI, project tools, storage and approval routing. Cline's entire IDE extension, full ClineCore runtime, MCP/plugin management, subagent teams and scheduled agents are not part of this implementation.

## Run

Requires Node 22.13+ and a Chromium-capable host for browser missions.

```bash
cd WebAgent
npm ci
npx playwright install --with-deps chromium
cp .env.example .env
# Configure model connections in .env.
npm start
```

Open http://127.0.0.1:3000. Create a project under Projects & source files, import existing source if needed, select Coding, choose Plan or Act, and launch a mission. Click Approve or Reject for each proposed file edit. Coding can run without Chromium; browser research tools are only offered when the browser model is configured.

### Model setup

Browser missions use `LLM_API_KEY`, `LLM_MODEL`, and optionally `LLM_BASE_URL`. The selected provider must implement OpenAI-compatible `/chat/completions` and JSON response mode.

Coding uses `CODE_API_KEY`, `CODE_MODEL`, and optionally `CODE_BASE_URL`; missing values fall back to the browser connection. The default coding adapter requires streaming `/chat/completions` with tool calls. To use a native Cline provider adapter, set `CODE_PROVIDER_ID` (for example `anthropic` or `openrouter`) and its key/model. Native adapters use the SDK's provider-specific transport.

No model credentials were supplied during implementation. Fixture tests establish the adapter contract, not live provider/model accuracy. Keys stay on the server, are not stored in task records, and are not passed in the environment to project checks. File tools reject `.env` files, protected directories, traversal and symlinks.

### Project checks

Set `ENABLE_PROJECT_COMMANDS=true` only on a dedicated trusted worker or appropriately isolated container. This exposes `run_check` with `node_test`, `npm_test` and `npm_build`. Each invocation requires approval and runs with a one-minute timeout. Output and actual exit status are recorded. Dependencies must already be installed for npm checks/builds; this version does not offer automatic package installation.

File-path guards are not an OS sandbox. Project tests/build scripts execute code on the worker and can access its filesystem or network. Keep provider secrets and unrelated files outside that worker; do not use this shared process as a hostile multi-tenant execution service.

## Container

```bash
docker build -t karvin .
docker run --rm --init --ipc=host -p 3000:3000 --env-file .env \
  -e HOST=0.0.0.0 -v karvin-data:/app/data karvin
```

Set `WEB_AGENT_TOKEN` to a random value of at least 24 characters before binding to a public interface. Use HTTPS at your reverse proxy. Enter the token using Access token. Authentication currently protects a single shared workspace, not individual tenant accounts. SSE uses a query token; redact query strings in reverse-proxy logs. Model configuration changes require a server restart.

The Dockerfile was inspected but no Docker image was built in this workspace.

## API

When configured, send `Authorization: Bearer <WEB_AGENT_TOKEN>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Browser/coding configuration and worker status |
| GET / POST | `/api/projects` | List / create projects |
| GET | `/api/projects/:id/files` | List source files |
| GET / PUT | `/api/projects/:id/file` | Read via `?path=...` / save `{path,content}` |
| GET | `/api/projects/:id/export` | Download project source ZIP |
| GET / POST | `/api/tasks` | List / start missions |
| GET | `/api/tasks/:id` | Inspect task, events and conversation |
| GET | `/api/tasks/:id/events` | SSE progress, supports Last-Event-ID replay |
| POST | `/api/tasks/:id/approval` | Approve/reject `{id,approved}` |
| POST | `/api/tasks/:id/undo` | Restore changes, rejecting later-edit conflicts |
| DELETE | `/api/tasks/:id` | Cancel queued, running or approval-waiting tasks |
| GET | `/api/tasks/:id/export` | Download full task JSON |

Browser request:

```json
{"kind":"browser","url":"https://example.com","goal":"Summarize the page with supporting quotes","maxSteps":30}
```

Coding request (use a project ID returned from project creation):

```json
{"kind":"coding","projectId":"<project-id>","mode":"act","goal":"Create a small website with a clear README","maxSteps":30}
```

Add `parentTaskId` to continue a completed coding conversation in the same project. Each follow-up is a separate task with its own approvals and deadline.

## Verification

```bash
npm test
npm run test:browser  # Requires installed, runnable Chromium
```

All 15 core and interaction tests passed in this workspace. The core suite uses the actual Cline SDK with deterministic model fixtures. It exercises approved/rejected edits, Plan mode, cancellation, source guards, real Node check execution, the HTTP streaming adapter, authenticated APIs, persistence, approval routing, project locking, undo and ZIP export. The dashboard workflow test executes the actual UI script in JSDOM against the real API and Cline engine; this validates interaction logic, not visual browser rendering.

Native browser execution is blocked in this workspace: Chromium download endpoints returned invalid archives; an alternative binary terminated with SIGTRAP; agent-browser reported missing `/proc/self/exe`. Native browser workflows and visual layout are therefore not claimed as verified. Run the browser suite and visual checks on the deployment host.

## Current limits

- Browser completion evidence is checked against current page text; semantic result correctness depends on the model. No benchmark superiority over TinyFish or Cline is claimed.
- Browser research supports public sites. Login, CAPTCHA handling, cross-origin iframe interaction, popup workflows, downloads and uploads are not implemented.
- Browser transaction restrictions are prompt guidance, not a complete hard approval policy. Do not provide sensitive authenticated browser sessions to this runner.
- Project files are text-only, up to 100 KB each. Listings stop at 500 files; source ZIP exports stop at 10 MB. Dependency directories are excluded. Imports stop at the first error and retain earlier saved files.
- Task history retains page snapshots, file contents and conversation text. Storage quotas and retention controls are not yet included.
- Billing, individual user accounts, repository OAuth, automated deployment, true multi-tenant isolation and scheduled agents are not included.
- Undo checks all tracked files before restoration. It handles ordinary text file edits, not changes made indirectly by build/test scripts or external processes.

## Attribution

Browser automation is adapted from [shhivv/third-hand](https://github.com/shhivv/third-hand), revision `430394b35dbb44ff8b303bf19da29b0828d92bd2`; its MIT license is retained at the repository root. The macOS source remains in `Sources/ThirdHand` with its original signing and build process.

Coding uses [Cline](https://github.com/cline/cline) through the published `@cline/sdk` package version 0.0.89. Cline is Apache-2.0, copyright Cline Bot Inc.; the license is retained in `CLINE-LICENSE`. Karvin is an independent application and is not endorsed by either upstream project.

