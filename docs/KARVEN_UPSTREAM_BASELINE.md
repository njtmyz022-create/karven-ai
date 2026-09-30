# Karven AI upstream baseline and architecture map

Audit date: 2026-09-29. This checkout is a fresh, isolated clone created for Karven AI in the current workspace. No earlier Karven project directory or brand asset was imported.

## Source baselines

| Component | Actual upstream baseline | Purpose | License / reuse decision |
|---|---|---|---|
| OpenHands Agent Canvas | `OpenHands/OpenHands` commit `da8f701e0e8e9c25cf2a8065a0debd930107a765`; package `@openhands/agent-canvas@1.24.0` | React Router customer UI, conversations, workspace UI, file browser, terminal, diff viewer, settings, integrations, automations UI, Electron desktop | Root `LICENSE` is MIT. Reuse code, preserve notices. Do not reuse upstream marks as Karven marks. |
| Software Agent SDK / Agent Server | `OpenHands/software-agent-sdk` commit `dcf401af7a9a302ef92cb7d092e1df9bb659daa5`; Canvas currently pins `@openhands/typescript-client@1.49.6` | Agent engine, REST/WebSocket contracts, tools, workspace implementations, SDK clients | MIT notice present. Reuse within product boundaries; do not assume tenancy or SaaS policy is supplied. |
| Automation | `OpenHands/automation` commit `53f3209f4e4565c1d4cc6ca27b9f28a603ad905c` | Scheduling, event triggers, webhook dispatch and run history | MIT notice present; upstream calls the service beta. Reuse only after separate operational/security verification. |
| Extensions | Canvas dependency `@openhands/extensions@0.24.0` | Public skills, integrations, extensions | Verify bundled extension/content licenses item-by-item before commercial distribution. |
| OpenHands CLI | `OpenHands/cli` commit `954f2ba646e8d749261a8f2b2b7e3031fa39be9f` | Historical CLI | Upstream repository says it is no longer actively maintained; do not make it the new Karven CLI. |
| Payload | `payload` tag `v3.90.2`, commit `6254c3bf561a205223849a6497d7dae824d4e81b` | Separate private administrative application foundation | MIT. License text copied to `karven-admin/LICENSES/Payload-MIT.md`. |
| OpenHands Cloud / Enterprise charts | Current self-hosted chart distribution examined | Hosted product deployment components | Polyform Free Trial terms; excluded from Karven commercial reuse absent separate rights. |
| OpenHands marketing website | No source checkout, asset inventory, or item-level asset license records in this workspace | Marketing, docs, public product pages | Not reused. Source availability and each marketing asset's reuse permission remain unverified. |

The customer frontend is the actual upstream application with 28 route definitions recorded in [`KARVEN_ROUTE_INVENTORY.md`](KARVEN_ROUTE_INVENTORY.md). A centralized Karven brand config now supplies the browser title and desktop product metadata, and the customer build disables analytics by default. Karven identity, tenant isolation, service adapters, approved visual assets, and production deployment have not yet been integrated.

## Component and dependency map

| Surface | Existing upstream component | Karven ownership work still required |
|---|---|---|
| Customer web app | Agent Canvas React Router app in this repository | Karven identity/API, tenant-aware authorization, branded runtime config, approved Karven assets, domain/cookie integration, safe endpoint/telemetry policy |
| Agent execution | Software Agent SDK and Agent Server | Tenant-scoped runtime orchestration, resource/network policies, Karven identity and authorization adapter, metering/audit/trace integration |
| Workspace | Agent Server workspace and current Canvas file/terminal/diff UI | Isolated per-tenant lifecycle and production storage/runtime controls |
| Conversation and streaming | Agent Server REST/WebSocket plus TypeScript client | Persisted Karven conversation ownership and authenticated stream proxy/handoff |
| Repository access | Existing source-control capabilities in agent/backend stack | Karven-owned OAuth/GitHub App/GitLab application credentials, policy, token custody, webhook validation, audit |
| Automations | Separate OpenHands Automation service and Canvas pages | Tenant-scoped identity, permissions, secrets, durable jobs, operational health, usage and billing |
| Desktop | Electron implementation in `electron/` with upstream product IDs/feed settings | Karven bundle/application ID, brand assets, controlled updater, signature credentials, verified distribution |
| CLI | Current Agent Canvas executable launcher; separate old CLI is unmaintained | New `karven` CLI against Karven API and current supported SDK contracts |
| Admin control plane | Separate `karven-admin/` Payload 3.90.2 application | Live Karven Core Admin API; MFA/SSO; separate production identity policy, deployment and operator services |
| Marketing | No implementation in acquired code | Obtain eligible source/assets or build a legally distinct site after documenting the missing source; do not claim visual parity yet |

### Trust boundaries

- Agent Canvas is a browser UI and must not become the authorization source.
- Agent Server is an execution/API boundary and is currently a single-user/self-host oriented component; multi-tenant SaaS deployment needs Karven services and isolated runtimes around it.
- The Payload application stores only operator identities and its own audit metadata. Customer data must remain in canonical Karven services.
- `karven-admin/src/core/admin-service.ts` is a typed, short-lived assertion adapter. It calls `GET /v1/admin/overview` on the configured Karven Core Admin API; that service does not exist in this workspace, so live operational data remains unavailable.
- Marketing, customer app, Chat, API, auth, admin, runtime and provider services have not been deployed or externally probed.

## Network and identity findings

- Upstream Canvas and local-stack launchers previously inherited OpenHands telemetry defaults. Karven's Canvas build and local launcher paths now set the telemetry opt-out, config defaults are empty, and the product config accepts only explicitly configured Karven analytics. Mock handlers no longer embed an analytics vendor host. The post-build scan passed over 293 production artifacts with no OpenHands telemetry proxy/project key or Payload admin markers. OpenHands docs URLs and other customer-facing upstream branding still remain elsewhere in the bundle and are a release blocker.
- Electron metadata, visible startup labels, app ID, and artifact names now use Karven configuration. Existing upstream icon assets remain, so desktop distribution is not cleared for release. No Karven update feed, signing credentials, or distribution infrastructure is configured.
- Internal package namespaces such as `@openhands/typescript-client`, protocol/model identifiers, and type names should remain when they do not appear to customers and preserve updateability.
- No Karven-owned DNS, TLS, core API, database, payment account, OAuth app, signing identity, or production deployment credentials were found in this new workspace.

## Validation recorded

- Fresh clone baseline: `da8f701e0e8e9c25cf2a8065a0debd930107a765`.
- `npm ci`: completed for Agent Canvas.
- Agent Canvas `npm run typecheck`: passed.
- Agent Canvas `npm run build`: passed, including the post-build scan over 293 production artifacts. This validates bundle compilation and the listed leak checks only, not product behavior against an Agent Server.
- Agent Canvas focused ESLint on changed source/config files: passed with three existing unused-disable warnings in `electron-builder.config.mjs`. The repository-wide lint baseline still has upstream errors and warnings outside these focused files.
- Agent Canvas `npm test`: not run. The execution approval reviewer rejected that command because the suite could contact an unverified external host. The rejection is not treated as a passing test.
- Payload admin source baseline: `3.90.2`; typecheck, lint, and five local unit tests passed. The production build remains unverified because this execution environment's Node `process.memoryUsage()` fails with `uv_resident_set_memory` when `/proc` is unavailable; this is a local runtime limitation, not a passing production build.

## Current state

The acquired workspace contains the actual reusable Agent Canvas source, the separate Payload admin application, and this upstream inventory. It is not a complete Karven Cloud deployment. Implementing and validating the missing Karven identity, tenancy, billing, runtime and production services requires service source, infrastructure access, credentials, and a Karven-owned deployment target not available here.
