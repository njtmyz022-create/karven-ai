# Agent Canvas route inventory

This records the route tree in `src/routes.ts` at the acquired OpenHands baseline. Each app route remains in the existing Agent Canvas implementation; the Karven target is the same path under the future Karven customer app origin. There is no admin route in this tree. `Reuse` means the upstream route implementation exists in this checkout; it does not mean Karven auth, tenancy, domain integration, or production acceptance has passed.

| # | Upstream route | Karven route | Source module | Reuse / status |
|---:|---|---|---|---|
| 1 | `/` | `/` | `src/routes/index-home.tsx` | Reused upstream; Karven integration pending |
| 2 | `/conversations` | `/conversations` | `src/routes/home.tsx` | Reused upstream; Karven integration pending |
| 3 | `/conversations/:conversationId/panel` | same | `src/routes/conversation-panel.tsx` | Reused upstream; Karven integration pending |
| 4 | `/conversations/:conversationId` | same | `src/routes/conversation.tsx` | Reused upstream; persistence/auth integration pending |
| 5 | `/launch` | same | `src/routes/launch.tsx` | Reused upstream; Karven onboarding integration pending |
| 6 | `/customize` | same | `src/routes/extensions-hub.tsx` | Reused upstream; extension license review pending |
| 7 | `/skills` | same | `src/routes/skills-settings.tsx` | Reused upstream; extension catalog license review pending |
| 8 | `/plugins` | same | `src/routes/skills-plugins.tsx` | Reused upstream; extension catalog license review pending |
| 9 | `/apps` | same | `src/routes/canvas-extensions.tsx` | Reused upstream; extension license review pending |
| 10 | `/extensions/:extensionName/*` | same | `src/routes/canvas-extension-page.tsx` | Reused upstream; extension license review pending |
| 11 | `/mcp` | same | `src/routes/mcp.tsx` | Reused upstream; tenant/secrets policies pending |
| 12 | `/settings` | same | `src/routes/settings.tsx` + `settings-index.tsx` | Reused upstream; Karven account/settings integration pending |
| 13 | `/settings/llm` | same | `src/routes/llm-settings.tsx` | Reused upstream; provider policy and metering pending |
| 14 | `/settings/meta-llm` | same | `src/routes/meta-llm-settings.tsx` | Reused upstream; provider policy and metering pending |
| 15 | `/settings/agent` | same | `src/routes/agent-settings.tsx` | Reused upstream; Karven policy integration pending |
| 16 | `/settings/agents` | same | `src/routes/agent-profiles-settings.tsx` | Reused upstream; tenant ownership pending |
| 17 | `/settings/condenser` | same | `src/routes/condenser-settings.tsx` | Reused upstream; Karven account integration pending |
| 18 | `/settings/agent-context` | same | `src/routes/agent-context-settings.tsx` | Reused upstream; tenant ownership pending |
| 19 | `/settings/verification` | same | `src/routes/verification-settings.tsx` | Reused upstream; provider policy pending |
| 20 | `/settings/app` | same | `src/routes/app-settings.tsx` | Reused upstream; telemetry is disabled in Karven builds; identity integration remains pending |
| 21 | `/settings/secrets` | same | `src/routes/secrets-settings.tsx` | Reused upstream; Karven secret store/tenant isolation pending |
| 22 | `/oauth/device/verify` | same | `src/routes/device-verify.tsx` | Reused upstream; replace upstream OAuth ownership before release |
| 23 | `/automations` | same | `src/routes/automations-list.tsx` | Reused upstream; Karven automation service/authorization pending |
| 24 | `/automations/git-sync` | same | `src/routes/automation-git-sync.tsx` | Reused upstream; Karven OAuth/source-control integration pending |
| 25 | `/automations/templates` | same | `src/routes/automation-templates.tsx` | Reused upstream; template licenses/tenant policy pending |
| 26 | `/automations/new/:automationId` | same | `src/routes/automation-setup-route.tsx` | Reused upstream; Karven automation backend pending |
| 27 | `/automations/:automationId` | same | `src/routes/automation-detail.tsx` | Reused upstream; Karven automation backend pending |
| 28 | `/shared/conversations/:conversationId` | same | `src/routes/shared-conversation.tsx` | Reused upstream; sharing policy and brand treatment pending |

The inventory includes all 28 route definitions in the route tree. Tab-level routes such as files, browser, planner, commits, usage, terminal, and task list are rendered inside the conversation/workspace view and are not separate top-level route definitions.

The marketing website route inventory cannot be produced from this checkout: no OpenHands.dev source repository, route manifest, or item-level asset license data was present. No marketing site was fabricated as a substitute.
