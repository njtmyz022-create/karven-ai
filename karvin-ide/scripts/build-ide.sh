#!/usr/bin/env bash
set -euo pipefail
npm ci
npm test
mkdir -p .runtime
curl --fail --location --retry 3 --max-time 300 https://github.com/coder/code-server/releases/download/v4.139.1/code-server-4.139.1-linux-amd64.tar.gz -o .runtime/code-server.tar.gz
printf '%s\n' '53029be6c5781b7bca49b815fcc9a2a3fc111813ad8c9965b2c0f0d2985a0674  .runtime/code-server.tar.gz' | sha256sum --check
mkdir -p .runtime/code-server
tar -xzf .runtime/code-server.tar.gz -C .runtime/code-server --strip-components=1
rm .runtime/code-server.tar.gz
curl --fail --location --retry 3 --max-time 180 https://open-vsx.org/api/saoudrizwan/claude-dev/4.1.22/file/saoudrizwan.claude-dev-4.1.22.vsix -o .runtime/cline.vsix
.runtime/code-server/bin/code-server --extensions-dir .runtime/extensions --install-extension .runtime/cline.vsix
rm .runtime/cline.vsix
PLAYWRIGHT_BROWSERS_PATH=.runtime/browsers npx playwright install chromium
