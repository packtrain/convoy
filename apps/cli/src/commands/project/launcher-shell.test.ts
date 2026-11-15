import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, spawnSync: vi.fn() }));
import { checkLauncher, projectShell, sharedShell, spawnProjectLauncher } from "./launcher.js";
it("forwards abort to the local launcher and waits for its close", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const abort = new AbortController();
  let finished = false;
  const result = projectShell("identity", abort.signal).finally(() => { finished = true; });
  const rejection = expect(result).rejects.toThrow();
  abort.abort();
  try { expect(child.kill).toHaveBeenCalledWith("SIGTERM"); expect(finished).toBe(false); }
  finally { child.emit("exit", 1); child.emit("close", 1); await rejection; }
});

it("runs only the runtime login through the launcher's login mode", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const result = projectShell("identity", undefined, "codex");
  child.emit("close", 0);
  await result;
  expect(mocks.spawn.mock.calls.at(-1)?.[1]).toEqual(["-n", expect.any(String), "login", "identity", "codex"]);
});

it("tells the launcher whether the service or a foreground connect holds the lease", () => {
  const write = vi.fn();
  mocks.spawn.mockReturnValue({ stdin: { on: vi.fn(), write } });
  const config = { convexUrl: "https://example.convex.cloud", apiKey: "k", projectId: "p", organizationId: "o", profileKey: "a" };
  spawnProjectLauncher("identity", config, "pipe", true);
  spawnProjectLauncher("identity", config, "inherit", true);
  expect(write.mock.calls.map(([line]) => JSON.parse(String(line)).holder)).toEqual(["service", "connect"]);
});

function launcherReply(code: number, stdout: string, stderr = "") {
  const child = Object.assign(new EventEmitter(), {
    stdin: { on: vi.fn(), end: vi.fn() }, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  });
  mocks.spawn.mockReturnValue(child);
  queueMicrotask(() => { child.stdout.emit("data", Buffer.from(stdout)); child.stderr.emit("data", Buffer.from(stderr)); child.emit("close", code); });
  return child;
}

it("asks the launcher for a read-only check and says to update an old launcher", async () => {
  const facts = { sandbox: null, holder: null, runtimes: { codex: { state: "ready", home: true, loggedIn: true }, "claude-code": { state: "missing", home: false, loggedIn: false } } };
  const child = launcherReply(0, JSON.stringify(facts));
  await expect(checkLauncher("identity")).resolves.toEqual(facts);
  expect(JSON.parse(String(child.stdin.end.mock.calls[0][0]))).toEqual({ action: "check", identity: "identity" });
  launcherReply(1, "", "Unsupported operation\n");
  await expect(checkLauncher("identity")).rejects.toThrow("Rerun install.py");
});

it("opens $SHELL in a shared project's folder with inherited stdio, whatever its exit status (OS-2248)", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  vi.stubEnv("SHELL", "/bin/zsh");
  try {
    const result = sharedShell(tmpdir());
    child.emit("close", 3);
    await result;
  } finally { vi.unstubAllEnvs(); }
  expect(mocks.spawn.mock.calls.at(-1)).toEqual(["/bin/zsh", [], { cwd: tmpdir(), stdio: "inherit" }]);
  await expect(sharedShell("/nonexistent/convoy-project")).rejects.toThrow("Project folder /nonexistent/convoy-project is missing.");
});

it("runs a shared runtime's own login in HOME with inherited stdio (OS-2248)", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const result = sharedShell(tmpdir(), undefined, "codex");
  child.emit("close", 0);
  await result;
  expect(mocks.spawn.mock.calls.at(-1)).toEqual(["/bin/sh", ["-c", "exec /usr/bin/env codex login --device-auth"], { cwd: homedir(), stdio: "inherit" }]);
  const failed = sharedShell(tmpdir(), undefined, "claude-code");
  child.emit("close", 1);
  await expect(failed).rejects.toThrow("Runtime login exited with status 1.");
});
