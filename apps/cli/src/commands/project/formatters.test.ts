import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_BUILD, guidance, installCommand, projectChecks, repoLines, runtimeInstall, sharedProjectChecks } from "./formatters.js";
import type { LauncherCheck } from "./validators.js";

const facts = (patch: Partial<LauncherCheck> = {}): LauncherCheck => ({ sandbox: null, holder: null, runtimes: {
  codex: { state: "ready", home: true, loggedIn: true }, "claude-code": { state: "missing", home: false, loggedIn: false } }, ...patch });
const native = { codex: true, "claude-code": true, cursor: true, opencode: true, antigravity: true };
const status = (checks: ReturnType<typeof projectChecks>) => Object.fromEntries(checks.map(check => [check.id, check.status]));

it("passes a ready project and skips a runtime that is not installed", () => {
  expect(status(projectChecks("a", facts({ holder: "service" }), "ok", native))).toEqual({
    sandbox: "pass", "codex-installed": "pass", "codex-home": "pass", "codex-login": "pass",
    "claude-code-installed": "skip", lease: "pass", backend: "pass" });
});

it("gives each failure its fix", () => {
  const checks = projectChecks("a", facts({ sandbox: "Sandbox check failed: bwrap: denied.", holder: "shell", runtimes: {
    codex: { state: "ready", home: false, loggedIn: false }, "claude-code": { state: "untrusted", home: false, loggedIn: false } } }), "rejected", native);
  const fix = Object.fromEntries(checks.map(check => [check.id, check.fix]));
  expect(fix.sandbox).toBe("Sandbox check failed: bwrap: denied.");
  expect(fix["codex-home"]).toMatch(/^Reload the project once/);
  expect(fix["codex-login"]).toBe("Run project login a --runtime codex.");
  expect(fix["claude-code-installed"]).toMatch(/^Claude Code is installed but not root-owned.*umask 022/);
  expect(checks.find(check => check.id === "lease")).toMatchObject({ status: "fail", label: "Project lease: held by a private project shell" });
  expect(fix.backend).toMatch(/^Convoy rejected this project's API key/);
});

it("fails missing runtimes with their install commands when none is ready", () => {
  const checks = projectChecks("a", facts({ runtimes: { codex: { state: "missing", home: false, loggedIn: false }, "claude-code": { state: "missing", home: false, loggedIn: false } } }), "unreachable", native);
  expect(checks.filter(check => check.id.endsWith("-installed")).map(check => [check.status, check.fix])).toEqual([
    ["fail", "Install it as root: sudo sh -c 'umask 022 && npm install -g --prefix /usr/local @openai/codex'."],
    ["fail", "Install it as root: sudo sh -c 'umask 022 && npm install -g --prefix /usr/local @anthropic-ai/claude-code'."]]);
  expect(checks.find(check => check.id === "backend")?.fix).toMatch(/network, DNS and proxy/);
});

it("skips the login check for managed credentials", () => {
  const checks = projectChecks("a", facts({ runtimes: { codex: { state: "ready", home: true, loggedIn: false }, "claude-code": { state: "missing", home: false, loggedIn: false } } }), "ok", { codex: false, "claude-code": true, cursor: true, opencode: true, antigravity: true });
  expect(checks.find(check => check.id === "codex-login")).toMatchObject({ status: "skip", label: "Codex uses managed credentials" });
});

it("checks Cursor when the launcher reports it, with its own install command (OS-2017)", () => {
  const missing = { state: "missing" as const, home: false, loggedIn: false };
  const none = facts({ runtimes: { codex: missing, "claude-code": missing, cursor: missing } });
  const install = projectChecks("a", none, "ok", { ...native, cursor: true }).find(check => check.id === "cursor-installed");
  expect(install).toMatchObject({ status: "fail", label: "Cursor installed" });
  expect(install?.fix).toContain("https://downloads.cursor.com/lab/2026.10.22-27dcf5f/linux/");
  expect(install?.fix).toContain("tar --no-same-owner");
  const ready = facts({ runtimes: { ...facts().runtimes, cursor: { state: "ready", home: true, loggedIn: false } } });
  expect(projectChecks("a", ready, "ok", { ...native, cursor: true }).find(check => check.id === "cursor-login")?.fix).toBe("Run project login a --runtime cursor.");
  expect(projectChecks("a", ready, "ok", { ...native, cursor: false }).find(check => check.id === "cursor-login")).toMatchObject({ status: "skip" });
  // A launcher older than CLI 0.117.0 reports no Cursor facts.
  expect(projectChecks("a", facts(), "ok", native).some(check => check.id.startsWith("cursor-"))).toBe(false);
});

it("names the install command for a missing runtime even when another one is ready (OS-2017)", () => {
  const missing = { state: "missing" as const, home: false, loggedIn: false };
  const checks = projectChecks("a", facts({ runtimes: { ...facts().runtimes, cursor: missing } }), "ok", native);
  const cursor = checks.find(check => check.id === "cursor-installed");
  expect(cursor).toMatchObject({ status: "skip", label: "Cursor not installed" });
  expect(cursor?.fix).toMatch(/^To use it, install it as root: sudo sh -c '.*downloads\.cursor\.com\/lab\/2026\.10\.22-27dcf5f/);
});

it("checks OpenCode when the launcher reports it, with its npm install (OS-2018)", () => {
  const missing = { state: "missing" as const, home: false, loggedIn: false };
  const none = facts({ runtimes: { codex: missing, "claude-code": missing, opencode: missing } });
  const install = projectChecks("a", none, "ok", { ...native, opencode: true }).find(check => check.id === "opencode-installed");
  expect(install).toMatchObject({ status: "fail", label: "OpenCode installed" });
  expect(install?.fix).toContain("npm install -g --prefix /usr/local opencode-ai@1.19.5");
  const ready = facts({ runtimes: { ...facts().runtimes, opencode: { state: "ready", home: true, loggedIn: false } } });
  expect(projectChecks("a", ready, "ok", { ...native, opencode: true }).find(check => check.id === "opencode-login")?.fix).toBe("Run project login a --runtime opencode.");
  expect(projectChecks("a", ready, "ok", { ...native, opencode: false }).find(check => check.id === "opencode-login")).toMatchObject({ status: "skip" });
});

it("checks a shared project without a sandbox row or sudo, and never fails an unknown login (OS-2247)", () => {
  const checks = sharedProjectChecks("a", { holder: "service", runtimes: {
    codex: { installed: true, login: "signed-out" }, "claude-code": { installed: true, login: "unknown" },
    cursor: { installed: false, login: "unknown" }, opencode: { installed: true, login: "signed-in" }, antigravity: { installed: false, login: "unknown" } } }, "ok");
  expect(status(checks)).toEqual({ "codex-installed": "pass", "codex-login": "fail", "claude-code-installed": "pass", "claude-code-login": "skip",
    "cursor-installed": "skip", "opencode-installed": "pass", "opencode-login": "pass", "antigravity-installed": "skip", lease: "pass", backend: "pass" });
  expect(checks.find(check => check.id === "codex-login")?.fix).toBe("Run codex login --device-auth once for all projects.");
  expect(checks.find(check => check.id === "claude-code-login")?.label).toBe("Claude Code login status unknown");
  expect(JSON.stringify(checks)).not.toMatch(/sudo|root|sandbox/i);
});

it("names a user npm install for each missing runtime in a shared project (OS-2247)", () => {
  const missing = { installed: false, login: "unknown" as const };
  const checks = sharedProjectChecks("a", { holder: null, runtimes: { codex: missing, "claude-code": missing, cursor: missing, opencode: missing, antigravity: missing } }, "ok");
  expect(checks.filter(check => check.id.endsWith("-installed")).map(check => [check.status, check.fix])).toEqual([
    ["fail", "Install it: npm install -g @openai/codex."], ["fail", "Install it: npm install -g @anthropic-ai/claude-code."],
    ["fail", "Install it: curl https://cursor.com/install -fsS | bash."], ["fail", "Install it: curl -fsSL https://antigravity.google/cli/install.sh | bash."],
    ["fail", "Install it: npm install -g opencode-ai@1.19.5."]]);
  expect(checks.some(check => check.id.endsWith("-login"))).toBe(false);
});

it("checks Antigravity in a shared project: unknown login, and an agy below the floor needs an update (OS-2474)", () => {
  const missing = { installed: false, login: "unknown" as const }, codex = { installed: true, login: "signed-in" as const };
  const runtimes = { codex, "claude-code": missing, cursor: missing, opencode: missing };
  const ready = sharedProjectChecks("a", { holder: null, runtimes: { ...runtimes, antigravity: { installed: true, login: "unknown" } } }, "ok");
  expect(ready.filter(check => check.id.startsWith("antigravity-"))).toEqual([
    { id: "antigravity-installed", status: "pass", label: "Antigravity installed" },
    { id: "antigravity-login", status: "skip", label: "Antigravity login status unknown" }]);
  const unusable = { installed: true, login: "unknown" as const, unusable: "1.5.11 is older than Convoy supports" };
  const old = sharedProjectChecks("a", { holder: null, runtimes: { ...runtimes, antigravity: unusable } }, "ok");
  expect(old.filter(check => check.id.startsWith("antigravity-"))).toEqual([{ id: "antigravity-installed", status: "skip",
    label: "Antigravity 1.5.11 is older than Convoy supports", fix: "To use it, update it with agy update or reinstall it: curl -fsSL https://antigravity.google/cli/install.sh | bash." }]);
  const only = sharedProjectChecks("a", { holder: null, runtimes: { ...runtimes, codex: missing, antigravity: unusable } }, "ok");
  expect(only.find(check => check.id === "antigravity-installed")).toMatchObject({ status: "fail",
    fix: "Update it with agy update or reinstall it: curl -fsSL https://antigravity.google/cli/install.sh | bash." });
});

it("logs Antigravity in with its own Google sign-in (OS-2474)", () => {
  expect(guidance.sharedLogin("antigravity")).toBe("Run agy acp --login once for all projects.");
  expect(runtimeInstall("antigravity", ANTIGRAVITY_BUILD)).toMatch(/sha512sum -c/);
});

it("pins the same agy build in the project-isolation image as the managed install (OS-2475)", () => {
  const dockerfile = readFileSync(new URL("../../../../../templates/project-isolation/Dockerfile", import.meta.url), "utf8");
  const install = installCommand("antigravity");
  const sums = install.match(/[a-f0-9]{128}/g) ?? [];
  expect(sums).toHaveLength(2);
  for (const sum of sums) expect(dockerfile).toContain(sum);
  expect(dockerfile).toContain(/https:\/\/storage\.googleapis\.com\/[^"$]+/.exec(install)?.[0]);
  expect(dockerfile).toContain("ln -s antigravity /usr/local/bin/agy");
});

it("checks Antigravity in an isolated project with its project login (OS-2475)", () => {
  const ready = facts({ runtimes: { ...facts().runtimes, antigravity: { state: "ready", home: true, loggedIn: false } } });
  expect(projectChecks("a", ready, "ok", native).filter(check => check.id.startsWith("antigravity-"))).toEqual([
    { id: "antigravity-installed", status: "pass", label: "Antigravity installed root-owned" },
    { id: "antigravity-home", status: "pass", label: "Antigravity config folder" },
    { id: "antigravity-login", status: "fail", label: "Antigravity logged in", fix: "Run project login a --runtime antigravity." }]);
});

describe("repoLines (OS-2521)", () => {
  it("lists a multi-repo folder, names a single repo's remote, and warns about none", () => {
    expect(repoLines([
      { path: "/c/a/old-app", relativePath: "old-app", gitRemoteUrl: "git@github.com:acme/old-app.git" },
      { path: "/c/a/packages/api", relativePath: "packages/api" },
    ])).toEqual(["Git repositories (2):", "  old-app  git@github.com:acme/old-app.git", "  packages/api"]);
    expect(repoLines([{ path: "/c/a", relativePath: "." }])).toEqual(["Git repository: no remote"]);
    expect(repoLines([])[0]).toMatch(/^No git repositories found\. Changes, History/);
  });
});
