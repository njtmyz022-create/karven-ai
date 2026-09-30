// @vitest-environment node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const entrypoint = readFileSync(
  path.join(repoRoot, "docker/entrypoint.sh"),
  "utf-8",
);
const blockStart = "# >>> docker-session-key-policy";
const blockEnd = "# <<< docker-session-key-policy";

function sessionKeyPolicyBlock(): string {
  const start = entrypoint.indexOf(blockStart);
  const end = entrypoint.indexOf(blockEnd);
  if (start === -1 || end === -1) {
    throw new Error("Docker session-key policy markers are missing");
  }
  return entrypoint.slice(start, end);
}

function resolveStaticServerArgs(allowLanSessionKey: string | undefined): {
  authArgs: string[];
  sessionArgs: string[];
  stderr: string;
} {
  const script = [
    "set -uo pipefail",
    "PORT=8000",
    "EFFECTIVE_SESSION_KEY=test-session-key",
    "log() { printf '%s\\n' \"$*\" >&2; }",
    sessionKeyPolicyBlock(),
    "printf 'auth:%s\\n' \"${STATIC_SERVER_AUTH_ARGS[*]}\"",
    "printf 'session:%s\\n' \"${STATIC_SERVER_SESSION_KEY_ARGS[*]}\"",
  ].join("\n");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (allowLanSessionKey !== undefined) {
    env.AGENT_CANVAS_ALLOW_LAN_SESSION_KEY = allowLanSessionKey;
  }
  const result = spawnSync("bash", ["-c", script], {
    encoding: "utf-8",
    env,
  });
  expect(result.status).toBe(0);
  const lines = result.stdout.trim().split("\n");
  return {
    authArgs: lines[0]?.startsWith("auth:")
      ? lines[0].slice("auth:".length).split(" ").filter(Boolean)
      : [],
    sessionArgs: lines[1]?.startsWith("session:")
      ? lines[1].slice("session:".length).split(" ").filter(Boolean)
      : [],
    stderr: result.stderr,
  };
}

describe("Docker session-key injection policy", () => {
  it("requires a session key without injecting it into public HTML by default", () => {
    const policy = resolveStaticServerArgs(undefined);
    expect(policy.authArgs).toEqual(["--auth-required"]);
    expect(policy.sessionArgs).toEqual([]);
  });

  it("requires an explicit true value before allowing trusted LAN key injection", () => {
    const disabled = resolveStaticServerArgs("1");
    expect(disabled.authArgs).toEqual(["--auth-required"]);
    expect(disabled.sessionArgs).toEqual([]);

    const enabled = resolveStaticServerArgs("true");
    expect(enabled.authArgs).toEqual([]);
    expect(enabled.sessionArgs).toEqual([
      "--allow-lan-session-key",
      "--session-api-key",
      "test-session-key",
    ]);
    expect(enabled.stderr).toContain("WARNING");
    expect(enabled.stderr).toContain("host loopback only");
  });
});
