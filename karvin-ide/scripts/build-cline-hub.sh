#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$APP_ROOT/.runtime"
CLINE_DIR="$RUNTIME_DIR/cline-source"
CLINE_COMMIT="a7ad50bae34c43823facf2c2ee726b45dc7c0145"
BUN_VERSION="1.4.2"
BUN_BIN="$RUNTIME_DIR/bun/bin/bun"
mkdir -p "$RUNTIME_DIR/bun/bin"

if [ ! -x "$BUN_BIN" ]; then
  rm -f "$BUN_BIN"
  if command -v bun >/dev/null 2>&1 && [ "$(bun --version)" = "$BUN_VERSION" ]; then
    ln -s "$(command -v bun)" "$BUN_BIN"
  else
    case "$(uname -m)" in
      x86_64) BUN_ARCHIVE="bun-linux-x64-baseline.zip" ;;
      aarch64|arm64) BUN_ARCHIVE="bun-linux-aarch64.zip" ;;
      *) echo "Unsupported Bun architecture: $(uname -m)" >&2; exit 1 ;;
    esac
    DOWNLOAD_DIR="$(mktemp -d)"
    trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
    RELEASE_URL="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
    curl --fail --location --retry 3 "$RELEASE_URL/$BUN_ARCHIVE" -o "$DOWNLOAD_DIR/bun.zip"
    curl --fail --location --retry 3 "$RELEASE_URL/SHASUMS256.txt" -o "$DOWNLOAD_DIR/SHA256SUMS"
    grep -E "^[0-9a-f]{64}[[:space:]]+$BUN_ARCHIVE$" "$DOWNLOAD_DIR/SHA256SUMS" > "$DOWNLOAD_DIR/checksum"
    test -s "$DOWNLOAD_DIR/checksum"
    (cd "$DOWNLOAD_DIR" && sha256sum --check checksum)
    unzip -q -j "$DOWNLOAD_DIR/bun.zip" bun -d "$RUNTIME_DIR/bun/bin"
    chmod 0755 "$BUN_BIN"
    rm -rf "$DOWNLOAD_DIR"
    trap - EXIT
  fi
fi
if [ "$("$BUN_BIN" --version)" != "$BUN_VERSION" ]; then
  echo "Expected Bun $BUN_VERSION at $BUN_BIN" >&2
  exit 1
fi

if [ ! -f "$CLINE_DIR/.karvin-source-commit" ] || [ "$(cat "$CLINE_DIR/.karvin-source-commit")" != "$CLINE_COMMIT" ]; then
  rm -rf "$CLINE_DIR"
  mkdir -p "$CLINE_DIR"
  git -C "$CLINE_DIR" init --quiet
  git -C "$CLINE_DIR" remote add origin https://github.com/cline/cline.git
  git -C "$CLINE_DIR" fetch --quiet --depth 1 origin "$CLINE_COMMIT"
  git -C "$CLINE_DIR" checkout --quiet --detach FETCH_HEAD
  printf '%s\n' "$CLINE_COMMIT" > "$CLINE_DIR/.karvin-source-commit"
fi

if [ ! -f "$CLINE_DIR/.karvin-brand-patched" ]; then
  "$BUN_BIN" "$APP_ROOT/scripts/rebrand-cline-hub.mjs" "$CLINE_DIR"
  printf '%s\n' 'KARVIN AI' > "$CLINE_DIR/.karvin-brand-patched"
fi

cd "$CLINE_DIR"
"$BUN_BIN" install --frozen-lockfile
"$BUN_BIN" run build:sdk
"$BUN_BIN" -F @cline/cline-hub build:webview
rm -rf node_modules
"$BUN_BIN" install --filter @cline/cline-hub --production --frozen-lockfile

printf 'KARVIN AI browser workspace built from upstream commit %s\n' "$CLINE_COMMIT"
