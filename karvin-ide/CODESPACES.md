# KARVIN in GitHub Codespaces

[Open the full KARVIN workspace in GitHub Codespaces](https://codespaces.new/njtmyz022-create/karven-ai/tree/karvin-full-ide). Create the Codespace from the linked branch; its container build starts the platform and opens private port 3000 when ready.

Karvin opens on port 3000. The launcher detects Codespaces, verifies the forwarded port remains private, and fails closed if verification is unavailable. Keep the port private and do not forward the internal agent service or an editor worker port directly.

The first account becomes the owner through the verified private Codespaces gateway; no owner email or deployment token needs to be copied into a configuration file. Registration is invitation-only after the owner is created. The owner can create seven-day invitation links from the KARVIN account service. Users create their own account passwords in Karvin.

The Codespaces container needs to permit Linux file ownership changes and per-user process IDs for isolated workspaces. KARVIN starts a separate original browser workspace and IDE process under each user's Linux ID and private home directory. Provider settings, chat sessions, and project files stay within that user's data directory. Keep `/data` persistent across restarts.

To build or refresh the workspace runtime, run `bash scripts/build-ide.sh`, then start the platform with `npm run start:ide`. Sign in at `/login`; `/` opens the integrated original browser workspace, `/workspace` redirects there, and `/ide/` opens the separate KARVIN editor.
