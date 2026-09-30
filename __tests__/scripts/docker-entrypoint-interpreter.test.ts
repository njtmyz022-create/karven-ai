import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const dockerfile = readFileSync(join(repoRoot, "docker/Dockerfile"), "utf8");
const entrypoint = readFileSync(join(repoRoot, "docker/entrypoint.sh"), "utf8");

describe("Docker entrypoint interpreter", () => {
  it("runs the entrypoint with Bash in the container", () => {
    expect(dockerfile).toMatch(
      /^ENTRYPOINT \["tini", "--", "\/bin\/bash", "\/opt\/agent-canvas\/entrypoint\.sh"\]$/m,
    );
  });

  it("preserves Bash when dropping from root to the app user", () => {
    expect(entrypoint).toContain(
      'exec gosu openhands:openhands /bin/bash "$0" "$@"',
    );
  });
});
