Warning: truncated output (original token count: 6974)
Total output lines: 531

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# agent-canvas all-in-one entrypoint
#
# Starts three services (plus an optional fourth):
#   1. Agent Server   on port $AGENT_SERVER_PORT  (default 18000)
#   2. Automation     on port $AUTOMATION_PORT     (default 18001)
#   3. Static server  on port $PORT               (default 8000)
#      Routes /api/automation/* → automation, /api/* → agent-server,
#      and serves the frontend static build for everything else. Public
#      deployments require the visitor to enter a session key; the key is
#      never embedded into the page by default.
#   4. (Optional) Public-mode static server on $PUBLIC_MODE_PORT
#      Same frontend, but with --auth-required (no baked session key).
#      Used by auth-mode E2E tests. Only started when PUBLIC_MODE_PORT is set.
#
# Environment variables:
#   PORT                 – Unified entry point port (default: 8000)
#   AGENT_SERVER_PORT    – Internal agent-server port (default: 18000)
#   AUTOMATION_PORT      – Internal automation port (default: 18001)
#   AGENT_CANVAS_BASE_PATH – Static frontend mount path (default: /canvas)
#   VSCODE_PORT          – Internal editor port (default: 8001). The image does
#                          not EXPOSE it and the editor is reached through
#                          VSCODE_BASE_PATH on $PORT, but openvscode-server
#                          binds 0.0.0.0, so `docker run --network host` does
#                          leave it directly reachable with only its connection
#                          token in front of it.
#   VSCODE_BASE_PATH     – Path prefix the editor is served under on $PORT
#                          (default: /vscode). Exported to agent-server as
#                          OH_VSCODE_BASE_PATH and routed by the static server.
#                          agent-server's own OH_VSCODE_PORT / OH_VSCODE_BASE_PATH
#                          take precedence over these aliases; whichever is set,
#                          one effective pair drives both the editor process and
#                          the proxy route.
#   PUBLIC_MODE_PORT     – Optional additional static server on this port
#                          with --auth-required (no session key injected).
#                          The main public entry point already requires auth.
#   AGENT_CANVAS_ALLOW_LAN_SESSION_KEY – Set to true only when the published
#                          host port is restricted to loopback and you accept
#                          embedding the session key in the served HTML
#   OH_SECRET_KEY        – Secret key for settings encryption (auto-generated
#                          and persisted if not provided)
#   OPENHANDS_AUTOMATION_API_KEY – Override automation backend auth key
#                          (defaults to session API key — both backends
#                          use the same `X-Session-API-Key` header)
#   AUTOMATION_AGENT_SERVER_URL  – URL the automation service uses to reach the
#                          agent-server (default: http://127.0.0.1:AGENT_SERVER_PORT).
#                          Setting this enables local-mode auth so the session
#                          API key is validated internally instead of against the
#                          OpenHands cloud API.
#   AUTOMATION_KV_SECRET  – Signing key for scoped automation KV tokens
#                          (defaults to the shared session API key).
#   FILE_STORE             – Storage backend for automation tarballs (default: local).
#                          Without this the automation backend may fall back to
#                          S3/GCS which fails without cloud credentials.
#   LOCAL_STORAGE_PATH     – Directory for local file storage (default: ~/.karven/storage)
#   AUTOMATION_BASE_URL    – Publicly-reachable base URL for the automation
#                          service, used in callback URLs and injected into
#                          sandboxes (default: http://127.0.0.1:$PORT).
#                          Override in production when the external URL differs.
#   AUTOMATION_WORKSPACE_BASE – Directory for automation run workspaces
#                          (default: ~/.karven/workspaces)
#   Any agent-server or automation env vars are passed through.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

log() { printf '[agent-canvas] %s\n' "$*"; }
log_error() { printf '[agent-canvas] ERROR: %s\n' "$*" >&2; }

# Railway mounts persistent volumes as root. Start the entrypoint as root only
# long enough to prepare the writable mounts, then drop back to the existing
# unprivileged `openhands` account before starting any application services.
# The marker lives on the volume so existing trees are not recursively re-owned
# on every container restart.
if [ "$(id -u)" -eq 0 ]; then
  if ! command -v gosu >/dev/null 2>&1; then
    log_error "gosu is required to prepare Railway volume permissions safely."
    exit 1
  fi
  export HOME=/home/openhands
  for mount_path in /home/openhands/.karven /projects; do
    mkdir -p "$mount_path"
    ownership_marker="${mount_path}/.karven-volume-owner-v1"
    if [ ! -f "$ownership_marker" ]; then
      chown -R openhands:openhands "$mount_path"
      touch "$ownership_marker"
      chown openhands:openhands "$ownership_marker"
    fi
  done
  exec gosu openhands:openhands "$0" "$@"
fi

# ── Load centralized defaults (generated from config/defaults.json at build) ─
# shellcheck source=/dev/null
if [ -f /opt/agent-canvas/defaults.env ]; then
  # shellcheck disable=SC1091
  . /opt/agent-canvas/defaults.env
fi

PORT="${PORT:-${CONFIG_PROXY_PORT:-8000}}"
AGENT_SERVER_PORT="${AGENT_SERVER_PORT:-${CONFIG_AGENT_SERVER_PORT:-18000}}"
AUTOMATION_PORT="${AUTOMATION_PORT:-${CONFIG_AUTOMATION_PORT:-18001}}"

# The bundled editor is reached through a path prefix on the proxy port rather
# than a published port of its own. The same prefix has to reach agent-server
# (it launches openvscode-server with --server-base-path and advertises the
# prefix from /api/vscode/url) and the static-server route table below, or the
# advertised URL and the route serving it disagree.
#
# Two env var names reach the same setting: OH_VSCODE_PORT / OH_VSCODE_BASE_PATH
# are agent-server's own documented variables, which a deployment may already
# set and which this entrypoint passes through like any other OH_* var, while
# VSCODE_PORT / VSCODE_BASE_PATH are this image's aliases. They collapse to one
# effective pair here, before anything reads them — resolving them
# independently would let `OH_VSCODE_BASE_PATH=/editor` move the editor without
# moving the route, leaving the button pointing at a path the proxy never
# serves.
# >>> vscode-config: this block is extracted and executed by
# >>> __tests__/scripts/docker-vscode-route-sync.test.ts — keep the markers.
# The canvas mount is resolved here rather than alongside the ports above
# because the collision guard below compares the two prefixes: keeping both
# inside the extracted block is what lets that comparison be tested against the
# real defaults instead of only against values a test injects.
AGENT_CANVAS_BASE_PATH="${AGENT_CANVAS_BASE_PATH:-${CONFIG_CANVAS_BASE_PATH:-/canvas}}"
VSCODE_PORT="${OH_VSCODE_PORT:-${VSCODE_PORT:-${CONFIG_VSCODE_PORT:-8001}}}"
VSCODE_BASE_PATH="${OH_VSCODE_BASE_PATH:-${VSCODE_BASE_PATH:-${CONFIG_VSCODE_BASE_PATH:-/vscode}}}"

# Accept "editor", "/editor" and "/editor/" alike: agent-server strips the
# slashes when it builds the advertised URL, the static-server route table
# needs the leading one, so settle on one spelling rather than one per use site.
normalize_base_path() {
  local p="$1"
  while [ "${p#/}" != "$p" ]; do p="${p#/}"; done
  while [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  printf '/%s' "$p"
}
VSCODE_BASE_PATH="$(normalize_base_path "$VSCODE_BASE_PATH")"
if [ "$VSCODE_BASE_PATH" = "/" ]; then
  log_error "VSCODE_BASE_PATH resolved to the site root — that would route the whole origin to the editor instead of the canvas. Set a prefix such as /vscode."
  exit 1
fi

# The canvas mount gets the same treatment, for the same reason and with the
# same function. static-server normalizes whatever `--base-path` it is handed
# (`canvas` and `/canvas/` both mount at `/canvas`), so comparing a normalized
# editor prefix against a raw canvas one below would let `AGENT_CANVAS_BASE_PATH=canvas`
# with `OH_VSCODE_BASE_PATH=/canvas` past the collision guard and then land both
# on `/canvas` — where the editor route, registered after the SPA mount, takes
# the application over. Normalizing here rather than at the comparison keeps the
# value passed to `--base-path` further down identical to the one guarded.
AGENT_CANVAS_BASE_PATH="$(normalize_base_path "$AGENT_CANVAS_BASE_PATH")"

# static-server keys its route table by prefix and the editor route is
# registered last, so a prefix that collides with an earlier route silently
# replaces it rather than failing: OH_VSCODE_BASE_PATH=/api would send every
# API call to the editor port. Reject collisions and anything that is not a
# plain single-segment path — '=' would be mis-split by the --route parser
# (it cuts at the first '='), and whitespace, '?', '#' or '..' have no
# meaningful reading as a route prefix.
VSCODE_PATH_SEGMENT="${VSCODE_BASE_PATH#/}"
case "$VSCODE_PATH_SEGMENT" in
  */*)
    log_error "VSCODE_BASE_PATH must be a single path segment (got '$VSCODE_BASE_PATH'). Use a prefix such as /vscode."
    exit 1
    ;;
  .|..)
    log_error "VSCODE_BASE_PATH must not be a relative path segment (got '$VSCODE_BASE_PAT…1974 tokens truncated…hon -m openhands.agent_server --port "$AGENT_SERVER_PORT" \
    --import-modules "$AGENT_SERVER_IMPORT_MODULES" &
else
  log_error "Cannot find agent-server binary or source venv."
  exit 1
fi
PIDS+=($!)

# ── 2. Start Automation Server ───────────────────────────────────────────────
log "Starting automation server on port $AUTOMATION_PORT..."

# File storage — use local filesystem unless the user has configured cloud
# storage.  Without FILE_STORE=local the automation backend may fall back
# to a cloud provider (S3/GCS) which will fail without credentials, causing
# tarball-based presets (preset/prompt, preset/plugin) to silently error.
export FILE_STORE="${FILE_STORE:-local}"
export LOCAL_STORAGE_PATH="${LOCAL_STORAGE_PATH:-${KARVEN_STATE_ROOT}/storage}"
mkdir -p "$LOCAL_STORAGE_PATH"

# AUTOMATION_BASE_URL — the publicly-reachable base URL for the automation
# service.  Appended to callback URLs and injected into each sandbox as
# AUTOMATION_API_URL.  Defaults to the unified ingress.
export AUTOMATION_BASE_URL="${AUTOMATION_BASE_URL:-http://127.0.0.1:${PORT}}"

# AUTOMATION_WORKSPACE_BASE — where automation runs unpack tarballs.
export AUTOMATION_WORKSPACE_BASE="${AUTOMATION_WORKSPACE_BASE:-${KARVEN_STATE_ROOT}/workspaces}"
mkdir -p "$AUTOMATION_WORKSPACE_BASE"

# Default to SQLite so the automation server works out of the box without
# an external PostgreSQL instance. Users can override AUTOMATION_DB_URL to
# point at a real Postgres for production deployments.
if [ -z "${AUTOMATION_DB_URL:-}" ]; then
  AUTOMATION_DB_FILE="${KARVEN_STATE_ROOT}/${CONFIG_AUTOMATION_DB:-automation/automations.db}"
  mkdir -p "$(dirname "$AUTOMATION_DB_FILE")"
  export AUTOMATION_DB_URL="sqlite+aiosqlite:///${AUTOMATION_DB_FILE}"
  log "Using SQLite database: $AUTOMATION_DB_URL"
fi

# The automation server uses uvicorn. Set AUTOMATION_PORT via its CLI.
if command -v uvicorn >/dev/null 2>&1; then
  uvicorn openhands.automation.app:app \
    --host 0.0.0.0 \
    --port "$AUTOMATION_PORT" &
  PIDS+=($!)
elif python -c "import openhands.automation" 2>/dev/null; then
  python -m uvicorn openhands.automation.app:app \
    --host 0.0.0.0 \
    --port "$AUTOMATION_PORT" &
  PIDS+=($!)
else
  log "WARNING: Automation server not found, skipping."
fi

# ── 3. Wait for backends to be ready ─────────────────────────────────────────
wait_for_port() {
  local port=$1 name=$2 max_wait=${3:-30}
  local elapsed=0
  while ! (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$max_wait" ]; then
      log "WARNING: $name on port $port did not become ready within ${max_wait}s"
      return 1
    fi
  done
  log "$name is ready on port $port"
}

wait_for_port "$AGENT_SERVER_PORT" "Agent Server" 60 &
WAIT_PID1=$!
wait_for_port "$AUTOMATION_PORT" "Automation Server" 60 &
WAIT_PID2=$!
wait "$WAIT_PID1" "$WAIT_PID2"

# ── 4. Start static server (frontend + proxy) ────────────────────────────────
log "Starting frontend + proxy on port $PORT..."

# Describe the local runtime services so the frontend can populate the agent's
# <RUNTIME_SERVICES> system-prompt block (without it the agent does not know how
# to reach the local automation backend and falls back to the cloud API). These
# URLs are runtime config (overridable at `docker run`), so build the JSON here
# from the sandbox-facing URLs the entrypoint already exports. static-server.mjs
# appends it to /server_info as runtime_services and also injects the legacy
# window global for older frontend bundles.
RUNTIME_SERVICES_INFO="$(node /opt/agent-canvas/runtime-services-info.mjs \
  --mode docker \
  --agent-host-alias 127.0.0.1 \
  --agent-server-url "$AGENT_SERVER_URL" \
  --automation-url "$AUTOMATION_BASE_URL")"

# EFFECTIVE_SESSION_KEY is set above from LOCAL_BACKEND_API_KEY or the persisted api-key.txt.
# --host :: is required so Docker published ports can reach the process. Because
# the container cannot tell whether the host published that port on loopback or
# every interface, session-key injection stays disabled unless the operator
# explicitly opts in.
# >>> docker-session-key-policy: extracted by the regression test below.
# The Docker image binds the main entry point to all interfaces, and Railway
# publishes it publicly. Require a session key in the browser by default. Do
# not pass the key to the static server in this mode: it only needs to be
# validated by the agent server. The explicit LAN override is for a trusted,
# loopback-only deployment and must never be enabled on a public host.
STATIC_SERVER_AUTH_ARGS=(--auth-required)
STATIC_SERVER_SESSION_KEY_ARGS=()
if [ "${AGENT_CANVAS_ALLOW_LAN_SESSION_KEY:-false}" = "true" ]; then
  log "WARNING: Embedding the session API key in frontend HTML; publish port $PORT on host loopback only."
  STATIC_SERVER_AUTH_ARGS=()
  STATIC_SERVER_SESSION_KEY_ARGS=(--allow-lan-session-key --session-api-key "$EFFECTIVE_SESSION_KEY")
fi
# <<< docker-session-key-policy
node /opt/agent-canvas/static-server.mjs \
  --port "$PORT" \
  --host :: \
  "${STATIC_SERVER_AUTH_ARGS[@]}" \
  "${STATIC_SERVER_SESSION_KEY_ARGS[@]}" \
  --dir /opt/agent-canvas/frontend \
  --base-path "$AGENT_CANVAS_BASE_PATH" \
  --runtime-services-info "$RUNTIME_SERVICES_INFO" \
  --route "/api/automation=http://127.0.0.1:${AUTOMATION_PORT}" \
  --route "/api=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/server_info=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/sockets=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/alive=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/health=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/ready=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/docs=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/redoc=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "/openapi.json=http://127.0.0.1:${AGENT_SERVER_PORT}" \
  --route "$VSCODE_ROUTE" \
  --vscode-base-path "$VSCODE_BASE_PATH" \
  --no-referrer-prefix "$VSCODE_BASE_PATH" &
STATIC_PID=$!
PIDS+=("$STATIC_PID")

# ── 5. (Optional) Public-mode static server ─────────────────────────────────
# When PUBLIC_MODE_PORT is set, start a second static-server instance that
# serves the same frontend WITHOUT injecting the session key into the HTML
# (--auth-required). This is used by auth-mode E2E tests to verify the
# ApiKeyEntryScreen gate, key rotation recovery, etc.
#
# Neither the editor route nor --vscode-base-path is registered here, and the
# pair is deliberate: the route is what would serve the editor, and the flag is
# what tells the frontend this origin can. Omitting only the route would leave
# the control rendering and falling through to the SPA, because the agent-server
# it shares with the main instance still reports the editor as available.
#
# --auth-required only
# controls whether the session key is injected into the served HTML; the
# dispatcher matches routes before it reaches that flag, so proxied paths are
# not gated by it. The routes above are safe on that footing because
# agent-server enforces the session key itself, but the editor's own
# credential is the connection token agent-server puts in the query string —
# and agent-server derives that token from session_api_keys[0], so it is the
# same secret that authenticates /api. Registering the route here would put
# that secret in a browser-navigable URL on the origin that exists precisely
# to test the unauthenticated case, where it would persist in history and
# leak by Referer from the workbench's own subresources.
#
# The token's scope is upstream's to fix and is tracked in
# OpenHands/software-agent-sdk#4317; if the editor gets a credential of its own,
# this exclusion and the --no-referrer-prefix below can both be revisited.
if [ -n "${PUBLIC_MODE_PORT:-}" ]; then
  log "Starting public-mode frontend on port $PUBLIC_MODE_PORT (--auth-required)..."
  node /opt/agent-canvas/static-server.mjs \
    --port "$PUBLIC_MODE_PORT" \
    --host :: \
    --dir /opt/agent-canvas/frontend \
    --base-path "$AGENT_CANVAS_BASE_PATH" \
    --auth-required \
    --runtime-services-info "$RUNTIME_SERVICES_INFO" \
    --route "/api/automation=http://127.0.0.1:${AUTOMATION_PORT}" \
    --route "/api=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/server_info=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/sockets=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/alive=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/health=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/ready=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/docs=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/redoc=http://127.0.0.1:${AGENT_SERVER_PORT}" \
    --route "/openapi.json=http://127.0.0.1:${AGENT_SERVER_PORT}" &
  PIDS+=($!)
fi

log "All services started. Unified entry point: http://0.0.0.0:${PORT}/"

# Keep the container alive while the static-server (ingress) is running.
# Backend crashes (agent-server, automation) are tolerated — the proxy
# returns 502 for downed routes, matching the non-Docker path where each
# service is an independent host process.
#
# Pattern: `sleep & wait $!` makes `wait` (a bash builtin) the foreground
# operation.  Unlike a bare `sleep`, the builtin `wait` is interrupted
# immediately when a trapped signal (SIGTERM/SIGINT) arrives, so cleanup()
# fires without delay.  cleanup() calls `exit 0` to terminate after the
# trap returns.  The loop re-checks the static-server PID every 10 s so the
# container exits promptly if the ingress process dies on its own.
while kill -0 "$STATIC_PID" 2>/dev/null; do
  sleep 10 & wait $!
done
log_error "Static server (PID $STATIC_PID) exited"
exit 1
