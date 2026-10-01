# KARVIN IDE — current execution state, 2026-10-01

## Running GitHub Codespace
- Name: miniature-winner-r4vw67p6jqqjh5995.
- Workspace: https://miniature-winner-r4vw67p6jqqjh5995.github.dev/
- App: https://miniature-winner-r4vw67p6jqqjh5995-3000.app.github.dev/
- Repository: njtmyz022-create/karven-ai; branch karvin-ide-live; app directory karvin-ide.
- Container creation and post-start completed successfully. Port 3000 is private and the application is running.
- /healthz confirmed {editor:true,missions:true} and HTTP 200.
- Docker build passed all 17 core tests and installed code-server 4.139.1 (checksum verified) and Cline 4.1.22.
- npm run test:browser on the actual Codespace passed all 3 real Chromium tests: fill/click/evidence; repeated-action loop prevention; cancellation. These browser tests use deterministic model fixtures.
- Public browser navigation reached KARVIN IDE Mission Control's access-token screen. Authenticated editor UI and live model execution are not claimed as verified.
- Workspace access token and editor password are WEB_AGENT_TOKEN in karvin-ide/.env. Never commit or print the token. User can retrieve it in their private Codespace.
- Model credentials have not been configured. Existing model connection UI and Cline settings are available after owner login.
- Codespaces is a development runtime: stopping/suspending it stops the application. Workspace files persist until deletion; it is not permanent hosting.

## Resume
Use this existing Codespace rather than creating another one. The post-start launcher in .devcontainer/start-karvin.mjs restarts Karvin after a Codespace restart. See karvin-ide/data/ide.log for startup diagnostics. Complete owner login and actual model verification securely before claiming full AI functionality.

## Previous Railway blocker
Railway provisioning remains blocked by free-plan resource limits. Authorized cleanup failed because Railway Agent usage limit was reached. No old Railway services or volumes were deleted. The earlier browser-fallback approval request was superseded by the user's instruction to run this in GitHub Codespaces; do not resume deletion as part of the GitHub task.
