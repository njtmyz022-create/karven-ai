# KARVIN IDE current state

Repository: njtmyz022-create/karven-ai, branch karvin-ide-live. Existing Codespace: miniature-winner-r4vw67p6jqqjh5995. App port 3000 must remain private.

Full Karvin-branded Cline-style landing page (navigation, hero, interactive workspace tabs, workflow demo, eight features, models, CTA, footer) committed. Landing at /, missions at /workspace, editor at /ide/.

Private GitHub gateway verifies port privacy with gh before each HTTP/WebSocket request. Server retains API token and code-server password internally; proxy opens editor session automatically after gateway verification. Normal hosts retain manual token/password auth. Never print .env or credentials. No model connection supplied.

21 local core/UI/auth checks passed. Earlier actual Codespace Chromium suite passed 3 fixture-model tests. New live browser verification is pending.

Codespace pulled e7838c8bd3d7136ea1f4423df9457c40a3f92bff and old launcher stopped. gh installed via apt and private ports verified. Landing HTML/CSS were published next in b7854b6e3998586819a2780e6d1a08526ef07355; Codespace still needs git pull --ff-only and launcher start. Current fresh browser tab displays VS Code Trust folder and continue prompt; requires user confirmation to enable terminal execution. Do not claim deployed or verified yet. User requested no extra token/password dialog.

After confirmation: trust this repository folder only, terminal git pull --ff-only, node ../.devcontainer/start-karvin.mjs. Verify health, landing interaction/layout, /workspace no token prompt, /ide/ no password prompt, terminal/Cline visibility. Update this state and provide working URL.

Codespaces suspends after inactivity. Prior Railway resource-limit blocker remains; no previous Railway services deleted. Do not resume Railway deletion for this task.
