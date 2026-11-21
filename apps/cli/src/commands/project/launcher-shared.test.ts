import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedRuntimeStates, sharedShell, spawnSharedWorker } from "./launcher.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("spawns the worker as this account with a trimmed environment, the runtimes' config homes, the starting PATH and one frame", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cv-shared-")); dirs.push(dir);
  const worker = join(dir, "worker.mjs");
  writeFileSync(worker, `let input = ""; process.stdin.on("data", c => { input += c; if (input.includes("\\n")) {
    console.log(JSON.stringify({ env: process.env, cwd: process.cwd(), frame: JSON.parse(input) })); process.exit(0); } });`);
  const previous = { ...process.env };
  Object.assign(process.env, { PATH: `/opt/homebrew/bin:${process.env.PATH}`, SECRET_TOKEN: "leak", TERM: "xterm",
    CODEX_HOME: "/home/node/.codex-local", CLAUDE_CONFIG_DIR: "/home/node/.claude", CONVOY_ANTIGRAVITY_EXECUTABLE: "/opt/agy/custom-agy" });
  let output = "";
  try {
    const child = spawnSharedWorker({ key: "a", identity: "a".repeat(64), path: "/code/a",
      config: { convexUrl: "https://example.convex.cloud", apiKey: "k", projectId: "p", organizationId: "o", profileKey: "a", mode: "shared" } }, worker, []);
    child.stdout!.on("data", (chunk: Buffer) => { output += chunk; });
    await new Promise(resolve => child.once("close", resolve));
  } finally { process.env = previous; }
  const result = JSON.parse(output);
  expect(Object.keys(result.env).filter(key => !key.startsWith("__CF")).sort()).toEqual(["CLAUDE_CONFIG_DIR", "CODEX_HOME", "CONVOY_ANTIGRAVITY_EXECUTABLE", "HOME", "LANG", "PATH", "TERM"].filter(key => key !== "LANG" || previous.LANG));
  expect(result.env.CODEX_HOME).toBe("/home/node/.codex-local");
  expect(result.env.PATH.startsWith("/opt/homebrew/bin:")).toBe(true);
  expect(result.cwd).toBe("/");
  expect(result.frame).toEqual({ convexUrl: "https://example.convex.cloud", apiKey: "k", projectId: "p", organizationId: "o", profileKey: "a",
    mode: "shared", paths: ["/code/a"], projectIdentity: "a".repeat(64) });
});

describe("shared runtime states (OS-2247)", () => {
  const fake = (scripts: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "cv-shared-bin-")); dirs.push(dir);
    for (const [name, body] of Object.entries(scripts)) writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    vi.stubEnv("PATH", dir);
  };
  afterEach(() => { vi.unstubAllEnvs(); });
  it("finds runtimes on PATH and asks each one's own status command", async () => {
    fake({ codex: `echo "Not logged in" >&2; exit 1`, claude: `echo '{"loggedIn":true,"email":"a@example.com"}'`, opencode: "exit 0" });
    expect(await sharedRuntimeStates()).toEqual({ codex: { installed: true, login: "signed-out" }, "claude-code": { installed: true, login: "signed-in" },
      cursor: { installed: false, login: "unknown" }, opencode: { installed: true, login: "unknown" }, antigravity: { installed: false, login: "unknown" } });
  });
  it("reads agy's version only and flags one below the floor (OS-2474)", async () => {
    fake({ antigravity: "echo 1.5.11" });
    expect((await sharedRuntimeStates()).antigravity).toEqual({ installed: true, login: "unknown", unusable: "1.5.11 is older than Convoy supports" });
    fake({ antigravity: "echo 1.5.14" });
    expect((await sharedRuntimeStates()).antigravity).toEqual({ installed: true, login: "unknown" });
  });
  it("finds agy the way the worker does: the override, then agy, then antigravity (OS-2474)", async () => {
    fake({ agy: "echo 1.5.14" });
    expect((await sharedRuntimeStates()).antigravity).toEqual({ installed: true, login: "unknown" });
    fake({ agy: "echo 1.5.14", antigravity: "echo 1.5.11" });
    expect((await sharedRuntimeStates()).antigravity).toEqual({ installed: true, login: "unknown" });
    const dir = mkdtempSync(join(tmpdir(), "cv-agy-override-")); dirs.push(dir);
    writeFileSync(join(dir, "my-agy"), "#!/bin/sh\necho 1.5.11\n", { mode: 0o755 });
    vi.stubEnv("CONVOY_ANTIGRAVITY_EXECUTABLE", join(dir, "my-agy"));
    expect((await sharedRuntimeStates()).antigravity).toMatchObject({ installed: true, unusable: "1.5.11 is older than Convoy supports" });
  });
  it.each([["exits 1", "echo boom >&2; exit 1"], ["prints no version", "echo hello"]])("flags an agy whose version probe %s as unusable (OS-2474)", async (_, body) => {
    fake({ agy: body });
    expect((await sharedRuntimeStates()).antigravity).toEqual({ installed: true, login: "unknown", unusable: "did not report its version" });
  });
  it("runs agy's sign-in with the executable the worker uses (OS-2474)", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "cv-agy-login-")), "args"); dirs.push(join(out, ".."));
    fake({ agy: `echo "$@" > ${out}` });
    await sharedShell(tmpdir(), undefined, "antigravity");
    expect(readFileSync(out, "utf8").trim()).toBe("acp --login");
  });
  it("stops the runtime itself when a shared login is aborted (OS-2248)", async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), "cv-shared-pid-")), "pid"); dirs.push(join(pidFile, ".."));
    // Cursor's login has an env prefix, so /bin/sh would otherwise fork it instead of exec'ing it.
    fake({ "cursor-agent": `[ "$NO_OPEN_BROWSER" = 1 ] && echo $$ > ${pidFile}; exec /bin/sleep 30` });
    const abort = new AbortController();
    const login = sharedShell(tmpdir(), abort.signal, "cursor");
    await vi.waitFor(() => expect(readFileSync(pidFile, "utf8")).toMatch(/\d/));
    abort.abort();
    await expect(login).rejects.toThrow();
    const pid = Number(readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  });
  it("reports unknown, never signed-out, when a status command gives no clear answer", async () => {
    fake({ codex: `echo "error: keyring unavailable" >&2; exit 1`, claude: "echo not json; exit 1" });
    expect(await sharedRuntimeStates()).toMatchObject({ codex: { installed: true, login: "unknown" }, "claude-code": { installed: true, login: "unknown" } });
  });
});
