# Run KARVIN IDE in GitHub Codespaces

Create a Codespace from the karvin-ide-live branch of njtmyz022-create/karven-ai. The dev container builds the existing IDE image, runs its tests, installs code-server and Cline, and starts Karvin automatically. Open forwarded port 3000 for Mission Control; /ide/ opens the editor. The port defaults to private. Use WEB_AGENT_TOKEN from the workspace .env for both dashboard access and the IDE password. Configure your model through Connections or Cline settings.

Projects, settings and task history are stored in karvin-ide/data on the Codespace workspace volume. Commit project code or export ZIPs before deleting the Codespace. A Codespace is a development environment: stopping it stops the application. Existing GitHub Codespaces quotas and charges apply; no paid upgrade is configured by this setup.

After restarting the Codespace, the post-start command starts the server again. Troubleshoot with data/ide.log. To restart manually, stop the existing launcher process and run node ../.devcontainer/start-karvin.mjs from karvin-ide.

Status: configuration prepared; live Codespace creation and browser/editor verification must be checked separately. Model credentials are not included.
