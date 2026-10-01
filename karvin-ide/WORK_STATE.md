# KARVIN IDE current state

Repository: njtmyz022-create/karven-ai, branch karvin-ide-live. Codespaces workspace: miniature-winner-r4vw67p6jqqjh5995. Forwarded app and editor ports must remain private.

The complete Karvin-branded landing page is live at /. It includes navigation, interactive IDE/Missions/Terminal/Cline workspace tabs, workflow demos, eight feature cards, model-provider section, CTA, and footer. Mission Control is at /workspace; the browser IDE with Cline installed is at /ide/.

The private GitHub gateway checks Codespaces port visibility before HTTP and WebSocket requests. The server keeps the API token and editor password internal and opens the IDE session after that check. Workspace access does not require a second token or password prompt. Other hosts retain their normal token/password authentication. Do not print .env or credentials.

Verification: 21/21 local tests pass. In the live Codespace, the landing page and all sections render; Mission Control health loads, its access-token control stays hidden, and the IDE opens in the browser. Ports 3000 and 8081 were confirmed private before the latest restart; recheck port visibility if forwarding settings change. The dashboard and Cline agents need a model-provider connection before AI tasks can run. No model credentials were supplied.

The broken dashboard script was repaired in commit 62668208f33785c83aa74a5f40c8002b76a7b852 and pulled into the Codespace. The IDE launcher is running from .devcontainer/start-karvin.mjs.

Codespaces can suspend after inactivity. Commit source changes to Git or export mission projects before closing; temporary workspace data is not durable.
