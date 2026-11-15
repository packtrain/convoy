import { TESTED_OPENCODE_PACKAGE } from "../../agent/runtimes/opencode/server.js";
import { LOGIN_COMMANDS, loginRuntimeLabels, loginRuntimeSchema, type LauncherCheck, type LoginRuntime, type ProjectCheck, type SharedCheck } from "./validators.js";

// One wording for service warnings and project check fixes. Spec: docs/specs/cli-service.md#worker-failure-reasons
const LABELS: Record<string, string> = { codex: "Codex", "claude-code": "Claude Code", opencode: "OpenCode", cursor: "Cursor" };
const npm = (pkg: string) => `npm install -g --prefix /usr/local ${pkg}`;
/** The Cursor Agent build the project-isolation Dockerfile installs (OS-2017). */
export const CURSOR_BUILD = "2026.10.22-27dcf5f";
/** npm package per runtime; Cursor ships as a tarball instead. */
export const RUNTIME_PACKAGES: Record<Exclude<LoginRuntime, "cursor">, string> = { codex: "@openai/codex", "claude-code": "@anthropic-ai/claude-code", opencode: "opencode-ai" };
/** Root-owned install per runtime; Cursor's and OpenCode's are the tested builds the project-isolation Dockerfile installs (OS-2017, OS-2018). */
const INSTALLS: Record<LoginRuntime, string> = {
  codex: npm("@openai/codex"), "claude-code": npm("@anthropic-ai/claude-code"),
  cursor: `mkdir -p /usr/local/lib/cursor-agent && curl -fsSL https://downloads.cursor.com/lab/${CURSOR_BUILD}/linux/`
    + "$(uname -m | sed s/x86_64/x64/\\;s/aarch64/arm64/)/agent-cli-package.tar.gz"
  + " | tar --no-same-owner --strip-components=1 -xzf - -C /usr/local/lib/cursor-agent && chmod -R go-w /usr/local/lib/cursor-agent"
  + " && ln -sf /usr/local/lib/cursor-agent/cursor-agent /usr/local/bin/cursor-agent",
  opencode: npm(TESTED_OPENCODE_PACKAGE),
};
/** Install as this account, for a shared environment. */
const USER_INSTALLS: Record<LoginRuntime, string> = {
  codex: "npm install -g @openai/codex", "claude-code": "npm install -g @anthropic-ai/claude-code",
  cursor: "curl https://cursor.com/install -fsS | bash", opencode: `npm install -g ${TESTED_OPENCODE_PACKAGE}`,
};
export const HOLDERS: Record<string, string> = {
  service: "the project service", connect: "a foreground connection", shell: "a private project shell",
  login: "a runtime login", registration: "a registration", unknown: "another connection or shell",
};

const names = (keys: string[]) => keys.map(key => LABELS[key] ?? key).join(" and ");
export const runtimeLabel = (key: string) => LABELS[key] ?? key;
export const installCommand = (runtime: LoginRuntime) => `sudo sh -c 'umask 022 && ${INSTALLS[runtime]}'`;
/** Root install of an exact version, run by the host in a managed container. Cursor only has its tested build. */
export const runtimeInstall = (runtime: LoginRuntime, version: string) => `umask 022 && ${runtime === "cursor" ? INSTALLS.cursor : npm(`${RUNTIME_PACKAGES[runtime]}@${version}`)}`;

export const guidance = {
  untrusted: (keys: string[]) => `${names(keys)} ${keys.length > 1 ? "are" : "is"} installed but not root-owned, or is group/world-writable, so projects ignore it. Reinstall it as root with umask 022.`,
  missing: () => `No supported runtime is installed system-wide. Install one as root: ${installCommand("codex")}.`,
  notStarted: (keys: string[], profile: string) => `${names(keys)} was detected but did not start. Run project check ${profile} for details.`,
  holder: (holder: string) => Object.hasOwn(HOLDERS, holder) ? HOLDERS[holder] : HOLDERS.unknown,
  sandbox: (profile: string) => `The Linux sandbox did not start for this project. Run project check ${profile} for the cause and fix.`,
  authRejected: (profile: string) => `Convoy rejected this project's API key. It may be revoked or expired. Renew it with project add <folder> --profile-key ${profile}.`,
  unreachable: () => "Cannot reach the Convoy backend from this host. Check its network, DNS and proxy.",
  login: (key: string, profile: string) => `Run project login ${profile} --runtime ${key}.`,
  sharedLogin: (key: LoginRuntime) => `Run ${LOGIN_COMMANDS[key]} once for all projects.`,
};

/** Service warning for a worker's fixed failure code; undefined for an unknown code. */
export function failureWarning(event: { reason: unknown; holder?: unknown; runtimes: string[]; untrusted: string[] }, profile: string): string | undefined {
  const reload = `service reload --profile ${profile}.`;
  switch (event.reason) {
    case "runtime-missing": return `${event.untrusted.length ? guidance.untrusted(event.untrusted)
      : event.runtimes.length ? guidance.notStarted(event.runtimes, profile) : guidance.missing()} Then run ${reload}`;
    case "project-active": return `Project is in use by ${guidance.holder(typeof event.holder === "string" ? event.holder : "unknown")}. Stop it, then run ${reload}`;
    case "sandbox-failed": return `${guidance.sandbox(profile)} Then run ${reload}`;
    case "auth-rejected": return `${guidance.authRejected(profile)} Then run ${reload}`;
    case "backend-unreachable": return `${guidance.unreachable()} Then run ${reload}`;
  }
}

/** Warning kept while online: a runtime the project ignores or one not logged in. */
export function runtimeNotice(untrusted: string[], loggedOut: string[], profile: string, shared = false): string | undefined {
  const parts = [
    ...(untrusted.length ? [`${guidance.untrusted(untrusted)} Then run service reload --profile ${profile}.`] : []),
    ...loggedOut.map(key => shared ? `${runtimeLabel(key)} is not logged in on this account. ${guidance.sharedLogin(key as LoginRuntime)}`
      : `${runtimeLabel(key)} is not logged in for this project. ${guidance.login(key, profile)}`),
  ];
  return parts.length ? parts.join(" ") : undefined;
}

export function checkLines(check: ProjectCheck): string[] {
  return [`Project ${check.profile}`, ...check.checks.map(item =>
    `${item.status === "pass" ? "✓" : item.status === "fail" ? "✗" : "-"} ${item.label}${item.fix ? `. ${item.fix}` : ""}`)];
}

/** How the backend answered a session-less heartbeat with the project key. */
export type BackendProbe = "ok" | "rejected" | "unreachable" | { status: number };

type Check = ProjectCheck["checks"][number];
const pass = (id: string, label: string): Check => ({ id, status: "pass", label });
const fail = (id: string, label: string, fix: string): Check => ({ id, status: "fail", label, fix });
const skip = (id: string, label: string, fix?: string): Check => ({ id, status: "skip", label, ...(fix ? { fix } : {}) });

/** The `project check` list. Spec: docs/specs/cli-project-isolation.md#failure-reasons-and-project-check-cli-01110-os-2161-os-2162 */
export function projectChecks(profile: string, facts: LauncherCheck, backend: BackendProbe, native: Record<LoginRuntime, boolean>): ProjectCheck["checks"] {
  const checks = [facts.sandbox ? fail("sandbox", "Sandbox boundary", facts.sandbox) : pass("sandbox", "Sandbox boundary")];
  const ready = Object.values(facts.runtimes).some(runtime => runtime.state === "ready");
  for (const key of loginRuntimeSchema.options) {
    const runtime = facts.runtimes[key], label = loginRuntimeLabels[key], id = (check: string) => `${key}-${check}`;
    if (!runtime) continue;
    if (runtime.state === "untrusted") { checks.push(fail(id("installed"), `${label} installed root-owned`, guidance.untrusted([key]))); continue; }
    if (runtime.state === "missing") {
      checks.push(ready ? skip(id("installed"), `${label} not installed`, `To use it, install it as root: ${installCommand(key)}.`) : fail(id("installed"), `${label} installed`, `Install it as root: ${installCommand(key)}.`));
      continue;
    }
    checks.push(pass(id("installed"), `${label} installed root-owned`));
    checks.push(runtime.home ? pass(id("home"), `${label} config folder`)
      : fail(id("home"), `${label} config folder`, "Reload the project once; the launcher creates it at start."));
    checks.push(!native[key] ? skip(id("login"), `${label} uses managed credentials`)
      : runtime.loggedIn ? pass(id("login"), `${label} logged in`) : fail(id("login"), `${label} logged in`, guidance.login(key, profile)));
  }
  return [...checks, ...leaseAndBackend(profile, facts.holder, backend)];
}

/** The shared `project check` list: no sandbox row, user installs, and an unknown login is never a failure. Spec: docs/specs/cli-shared-environments.md#runtimes-and-logins */
export function sharedProjectChecks(profile: string, facts: SharedCheck, backend: BackendProbe): ProjectCheck["checks"] {
  const checks: Check[] = [];
  const ready = Object.values(facts.runtimes).some(runtime => runtime.installed);
  for (const key of loginRuntimeSchema.options) {
    const { installed, login } = facts.runtimes[key], label = loginRuntimeLabels[key], id = (check: string) => `${key}-${check}`;
    if (!installed) {
      checks.push(ready ? skip(id("installed"), `${label} not installed`, `To use it, install it: ${USER_INSTALLS[key]}.`) : fail(id("installed"), `${label} installed`, `Install it: ${USER_INSTALLS[key]}.`));
      continue;
    }
    checks.push(pass(id("installed"), `${label} installed`));
    checks.push(login === "signed-in" ? pass(id("login"), `${label} logged in`)
      : login === "signed-out" ? fail(id("login"), `${label} logged in`, guidance.sharedLogin(key)) : skip(id("login"), `${label} login status unknown`));
  }
  return [...checks, ...leaseAndBackend(profile, facts.holder, backend)];
}

function leaseAndBackend(profile: string, holder: string | null, backend: BackendProbe): Check[] {
  return [!holder ? pass("lease", "Project lease: free")
    : holder === "service" ? pass("lease", `Project lease: held by ${HOLDERS.service}`)
      : fail("lease", `Project lease: held by ${guidance.holder(holder)}`, "Stop it, then reload the project."),
  backend === "ok" ? pass("backend", "Backend accepts the project key")
    : backend === "rejected" ? fail("backend", "Backend rejected the project key", guidance.authRejected(profile))
      : backend === "unreachable" ? fail("backend", "Backend unreachable", guidance.unreachable())
        : fail("backend", `Backend answered HTTP ${backend.status}`, "Check the profile's deployment URL, then retry.")];
}
