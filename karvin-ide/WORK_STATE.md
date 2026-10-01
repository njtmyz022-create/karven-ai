# KARVIN IDE execution state — 2026-10-01

Source: njtmyz022-create/karven-ai, branch karvin-ide-live, application directory karvin-ide. Keep this separate from the OpenHands application at repository root.

## Completed this session
- Recovered source from GitHub.
- Installed dependencies with npm ci --ignore-scripts.
- Corrected /healthz so it checks the editor and Mission Control, returning HTTP 503 when either upstream is unavailable, with a two-second probe timeout.
- Reproduced the previous always-200 failure with a regression test; the correction passes.
- npm test: 17 passed, 0 failed. Cline executions use deterministic model fixtures; no live model run is claimed.

## Deployment blockers (observed)
- Railway create_project and create_deployment both rejected with: Free plan resource provision limit exceeded. Please upgrade to provision more resources!
- User previously authorized deleting previous Railway work to free capacity.
- Railway Agent cleanup attempt rejected: Agent usage limit reached. Update your limit in usage settings.
- No old services were deleted and no new project/service was created. No live KARVIN IDE URL exists from this session.
- Browser UI fallback requires user approval per browser tool guidance after an insufficient plugin.
- Native browser tests could not launch: missing Playwright Chromium. Browser download returned an invalid archive. No visual or browser-agent verification is claimed.

## Next execution
1. With browser fallback permission, use Railway dashboard to remove the authorized obsolete services/volumes, then deploy this branch using railway.toml and karvin-ide/Dockerfile.ide.
2. Set a random WEB_AGENT_TOKEN of at least 24 characters before deployment. Do not disable IDE authentication. Set DATA_DIR and durable storage as supported by the account.
3. Generate the Railway domain and verify /healthz, Mission Control, editor login, terminal, Git, project files, WebSocket connection, preview proxy, Cline extension and Chromium tasks on the actual host.
4. Configure the owner's model connection securely and test an actual approved Cline edit before claiming AI functionality.

Old project: KARVEN 389255a3-8efa-426e-b963-52437949eb88, production f96d1cd6-2697-4745-a062-465321841ec0. Services: karven-backend e3c0b3f8-f71f-4d77-bd41-0211ff69acc3; karven-marketing 1405c38d-4d89-4593-b7e7-779e69e8c18b; twenty-server caf97313-e41c-4192-a3d7-bcef98f4f5ef; Redis fb47f49c-81d1-4dfe-a770-bac451236d4a; Postgres 7c958ad6-f2c3-41f0-91e1-182b393f0f0b. Associated old volumes: postgres-volume ad8982e4-68a6-43c9-9987-a51221ed8488; redis-volume 045a63e1-c24b-42f2-b58d-9da0640cd4c7. Stale staged patch 5eb282d3-a9c1-46bf-a4de-9298c579f808 must not recreate removed services.

Empty old project: KARVEN Admin b6b58566-0e4c-4592-a617-27742c9b05c3, production 73404347-a1e3-4008-a2bd-c6a6c03f3c88.
