import * as os from "node:os";
import { randomUUID } from "node:crypto";
import * as TOML from "smol-toml";
import { resolveProfile } from "../../lib/config/profile.js";
import { resolveConvexSiteUrl } from "../../lib/url.js";
import { upsertCodexConvoyServer } from "../init/config/codex-mcp.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPLATE_FILES = [
  "devcontainer.json",
  "Dockerfile",
  "init-firewall.sh",
  "README.md",
] as const;

const PROJECT_TEMPLATE_FILES = ["devcontainer.json", "Dockerfile", "launcher.py", "install.py", "start.sh", "README.md"];

/**
 * Raw GitHub base URL of the template source of truth (templates/devcontainer
 * in the Convoy repo). Unreachable while the repo is private — the bundled
 * copy below is the fallback until it goes public.
 */
export const TEMPLATE_RAW_BASE_URL =
  "https://raw.githubusercontent.com/packtrain/convoy/main/templates/devcontainer";

const PROJECT_TEMPLATE_RAW_BASE_URL =
  "https://raw.githubusercontent.com/packtrain/convoy/main/templates/project-isolation";

function templateSources(projects: boolean) {
  const files: readonly string[] = projects ? [...PROJECT_TEMPLATE_FILES, "init-firewall.sh"] : TEMPLATE_FILES;
  return files.map((file) => {
    const projectFile = projects && file !== "init-firewall.sh";
    return { file, url: `${projectFile ? PROJECT_TEMPLATE_RAW_BASE_URL : TEMPLATE_RAW_BASE_URL}/${file}`,
      bundledPath: path.join(projectFile ? "../project-isolation" : ".", file) };
  });
}

/**
 * Resolve the devcontainer template bundled with the published package.
 *
 * Expected layout (mirrors getMarketplaceDir):
 *   Built (npm):  dist/src/commands/devcontainer/install.js  ->  ../../../templates/devcontainer
 *   Dev (tsx):    src/commands/devcontainer/install.ts       ->  ../../../../../templates/devcontainer
 */
export function getBundledTemplateDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.resolve(__dirname, "../../../templates/devcontainer"),
    path.resolve(__dirname, "../../../../../templates/devcontainer"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "devcontainer.json"))) {
      return candidate;
    }
  }

  throw new Error(
    `Bundled devcontainer template not found. Searched: ${candidates.join(", ")}`
  );
}

type FetchLike = typeof fetch;

async function fetchTemplateFiles(
  fetchImpl: FetchLike,
  projects = false,
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    templateSources(projects).map(async ({ file, url }) => {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${file}`);
      }
      return [file, await response.text()] as const;
    })
  );
  return new Map(entries);
}

export interface InstallDevcontainerResult {
  targetDir: string;
  source: "github" | "bundled";
  files: string[];
}

/**
 * Write the devcontainer template into <projectDir>/.devcontainer.
 * Tries the latest files from GitHub first and falls back to the copy
 * bundled with the package when GitHub is unreachable.
 */
export async function installDevcontainerTemplate(options: {
  projectDir: string;
  force?: boolean;
  projects?: boolean;
  fetchImpl?: FetchLike;
}): Promise<InstallDevcontainerResult> {
  const targetDir = path.join(options.projectDir, ".devcontainer");

  if (fs.existsSync(targetDir) && !options.force) {
    throw new Error(
      `${targetDir} already exists. Re-run with --force to overwrite it.`
    );
  }

  let contents: Map<string, string>;
  let source: InstallDevcontainerResult["source"];
  try {
    contents = await fetchTemplateFiles(options.fetchImpl ?? fetch, options.projects);
    source = "github";
  } catch {
    const bundledDir = getBundledTemplateDir();
    contents = new Map(
      templateSources(Boolean(options.projects)).map(({ file, bundledPath }) => [
        file,
        fs.readFileSync(path.join(bundledDir, bundledPath), "utf8"),
      ])
    );
    source = "bundled";
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const [file, content] of contents) {
    const filePath = path.join(targetDir, file);
    fs.writeFileSync(filePath, content);
    if (file.endsWith(".sh")) {
      fs.chmodSync(filePath, 0o755);
    }
  }

  return { targetDir, source, files: [...contents.keys()] };
}

export type ConvexFirewallHint =
  | { kind: "deployment"; value: string }
  | { kind: "domain"; value: string };

/**
 * Derive the strict-mode firewall env var for a profile's Convex backend URL:
 * a Convex cloud URL yields the CONVEX_DEPLOYMENT slug, any other remote host
 * belongs in DEVCONTAINER_EXTRA_ALLOWED_DOMAINS. Localhost needs neither
 * (the firewall always allows the host network).
 */
export function convexFirewallHint(url: string): ConvexFirewallHint | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  const cloudMatch = host.match(/^([a-z0-9-]+)\.convex\.(cloud|site)$/i);
  if (cloudMatch) {
    return { kind: "deployment", value: cloudMatch[1] };
  }
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  ) {
    return null;
  }
  return { kind: "domain", value: host };
}

/** Configure the container's Codex home without writing through the host config symlink. */
export async function configureDevcontainer(options: {
  cwd?: string;
  codexHome?: string;
  profile?: string;
} = {}): Promise<{ profile?: string; configured: boolean }> {
  const resolution = resolveProfile(options.cwd, { profile: options.profile });
  if (!resolution.profile) return { configured: false };
  const codexHome = options.codexHome ?? process.env.CODEX_HOME;
  if (!codexHome || path.resolve(codexHome) === path.join(os.homedir(), ".codex")) {
    throw new Error("Devcontainer setup requires a container-private CODEX_HOME, separate from ~/.codex.");
  }
  const file = path.join(codexHome, "config.toml");
  const hostConfig = path.join(os.homedir(), ".codex", "config.toml");
  const source = fs.existsSync(file) ? file : hostConfig;
  const existing = fs.existsSync(source) ? TOML.parse(fs.readFileSync(source, "utf8")) : {};
  const profile = resolution.profile;
  const url = `${await resolveConvexSiteUrl(profile.url)}/api/mcp?project=${encodeURIComponent(profile.project_id)}`;
  const config = upsertCodexConvoyServer(existing, {
    url,
    http_headers: { Authorization: `Bearer ${profile.api_key}` },
  });
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const temporary = path.join(codexHome, `.config-${randomUUID()}.toml`);
  try {
    fs.writeFileSync(temporary, TOML.stringify(config), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  const domains = [...new Set([new URL(profile.url).hostname, new URL(url).hostname])];
  fs.writeFileSync(path.join(codexHome, "convoy-domains"), `${domains.join("\n")}\n`, { mode: 0o600 });
  return { profile: resolution.key, configured: true };
}
