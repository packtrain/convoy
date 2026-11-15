import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../agent/sdk/versioning/provider-version.js";

const NPM_LATEST_URL = "https://registry.npmjs.org/@useconvoy/cli/latest";

function readPackageVersion(packageJsonPath: string): string | null {
  let packageJson: unknown;

  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  } catch {
    return null;
  }

  if (!packageJson || typeof packageJson !== "object") {
    return null;
  }

  const { name, version } = packageJson as { name?: unknown; version?: unknown };
  if (name !== "@useconvoy/cli" || typeof version !== "string") {
    return null;
  }

  return version;
}

/** The @useconvoy/cli package folder, walking up from this module. */
export function cliPackageRoot(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 5; depth += 1) {
    if (readPackageVersion(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

/** The @useconvoy/cli package version. */
export function getCliVersion(): string {
  const root = cliPackageRoot();
  return (root && readPackageVersion(path.join(root, "package.json"))) || "0.0.0";
}

/**
 * The npm `latest` version if it is newer than the running one, else null.
 * Never throws — offline, self-hosted, and air-gapped installs get null.
 * See docs/specs/cli-update-notice.md.
 */
export async function checkForNewerVersion(
  timeoutMs = 1500
): Promise<string | null> {
  // AbortSignal.timeout does not keep the process alive; a stalled fetch would exit it (code 13).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(NPM_LATEST_URL, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const { version } = (await response.json()) as { version?: unknown };
    if (typeof version !== "string") {
      return null;
    }
    return compareVersions(version, getCliVersion()) > 0 ? version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
