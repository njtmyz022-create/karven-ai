FROM oven/bun:1.4.2 AS cline-builder
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/karvin-ide
COPY scripts ./scripts
RUN bash scripts/build-cline-hub.sh && rm -rf .runtime/cline-source/.git && if [ "$(command -v bun)" != "/usr/local/bin/bun" ]; then cp "$(command -v bun)" /usr/local/bin/bun; fi


FROM mcr.microsoft.com/playwright:v1.58.2-noble-amd64
RUN apt-get update && apt-get install -y --no-install-recommends gh git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY *.mjs ./
COPY public ./public
COPY test ./test
COPY scripts ./scripts
COPY CLINE-LICENSE LICENSE ./
RUN npm test && npm prune --omit=dev && rm -rf test
RUN mkdir -p .runtime/code-server && curl -fL --retry 3 https://github.com/coder/code-server/releases/download/v4.139.1/code-server-4.139.1-linux-amd64.tar.gz -o .runtime/code-server.tar.gz && echo '53029be6c5781b7bca49b815fcc9a2a3fc111813ad8c9965b2c0f0d2985a0674  .runtime/code-server.tar.gz' | sha256sum --check && tar -xzf .runtime/code-server.tar.gz -C .runtime/code-server --strip-components=1 && rm .runtime/code-server.tar.gz
COPY --from=cline-builder /usr/local/bin/bun /usr/local/bin/bun
COPY --from=cline-builder /workspace/karvin-ide/.runtime/cline-source /opt/cline
RUN mkdir -p .runtime/extensions
ENV NODE_ENV=production DATA_DIR=/data MAX_CONCURRENCY=1 ENABLE_PROJECT_COMMANDS=false CLINE_HUB_SOURCE_DIR=/opt/cline CLINE_HUB_BUN_BIN=/usr/local/bin/bun
EXPOSE 3000
CMD ["node", "ide.mjs"]

