# KARVIN IDE on GitHub Codespaces

Open the `karvin-ide-live` branch in GitHub Codespaces. The devcontainer installs the editor, Cline extension, Chromium, dependencies, and GitHub CLI. Port 3000 opens the full Karvin landing page. `/ide/` opens the editor and `/workspace` opens Mission Control.

The Codespaces launcher uses your existing private GitHub gateway instead of asking for a second workspace password. The application verifies port 3000 is private with the GitHub CLI before allowing each request; a failed verification refuses access. Any forwarded editor port must also remain private. Non-Codespaces deployments retain token and code-server password authentication. Do not publish the editor port.

Model access is separate: connect your preferred provider in Cline or Mission Control. No model is configured by default.

To restart after a source update, stop the process referenced by `data/ide-launcher.pid`, then run `node ../.devcontainer/start-karvin.mjs`. Never display `.env` or share its values.

Codespaces stops after inactivity and is subject to your account quota. Open the Codespace again to resume the app. Commit or export work you want to keep.
