# KARVIN in GitHub Codespaces

Karvin opens on port 3000. The launcher detects Codespaces, verifies the forwarded port remains private, and fails closed if verification is unavailable. Keep the port private and do not forward the internal agent service or an editor worker port directly.

The first account becomes the owner through the verified private Codespaces gateway; no owner email or deployment token needs to be copied into a configuration file. Registration is invitation-only after the owner is created. The owner can create seven-day invitation links from **Users & access**. Users create their own account passwords in Karvin. Connect an AI provider later in **AI connections** if you want to run coding or browser missions.

The Codespaces container needs to permit Linux file ownership changes and per-user process IDs for isolated IDE workers. Karvin reports the IDE as unavailable if the Codespace cannot provide those capabilities. Keep the workspace data directory persistent; provider connections and account data are stored there.

To build or refresh the IDE runtime, run `bash scripts/build-ide.sh`, then start the platform with `npm run start:ide`. The landing page is `/`, sign-in is `/login`, mission control is `/workspace`, and the editor is `/ide/`.
