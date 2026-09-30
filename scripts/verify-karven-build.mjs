import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const publicBuild = join(process.cwd(), "build");
const buildEntry = join(publicBuild, "index.html");
const buildWaitDeadline = Date.now() + 10_000;
const disallowed = [
  "z.openhands.dev",
  "phc_kBtz5nKmxVRRQ7HtPwr2QX9eMC5j65zE86QKocVNwb4U",
  "admin-operators",
  "AdminOperators",
  "/v1/admin/overview",
];

async function* filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== ".rsync-tmp")
      yield* filesUnder(path);
    else if (entry.isFile() && /\.(html|js|mjs|css|json)$/.test(entry.name))
      yield path;
  }
}

let buildDirectoryReady = false;
do {
  const [directory, entry] = await Promise.all([
    stat(publicBuild).catch(() => null),
    stat(buildEntry).catch(() => null),
  ]);
  buildDirectoryReady = Boolean(directory?.isDirectory() && entry?.isFile());
  if (!buildDirectoryReady) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} while (!buildDirectoryReady && Date.now() < buildWaitDeadline);

if (!buildDirectoryReady) {
  throw new Error(
    `Karven build verification failed: completed client output ${buildEntry} is missing.`,
  );
}

const checked = [];
for await (const path of filesUnder(publicBuild)) {
  const content = await readFile(path, "utf8");
  checked.push(path);
  for (const needle of disallowed) {
    if (content.includes(needle)) {
      throw new Error(
        `Karven public bundle contains a forbidden product surface or upstream analytics reference: ${needle}`,
      );
    }
  }
}

if (checked.length === 0) {
  throw new Error(
    "Karven build verification failed: no client assets were found.",
  );
}

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    event: "karven.public_bundle_scan_passed",
    files_checked: checked.length,
    admin_application_in_customer_bundle: false,
    upstream_telemetry_endpoint_present: false,
  })}\n`,
);
