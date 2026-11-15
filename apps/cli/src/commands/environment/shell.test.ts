import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: mocks.spawn }));
import { targetShell } from "./command.js";
const environment = { schema: 1 as const, name: "demo", owner: "12345678-1234-4234-8234-123456789012", daemon: "test", version: "1.0.0", deployment: "", domains: "" };
it("passes the confirmed identity into the target and reports the actual exit code", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child);
  const result = targetShell(environment, "a", undefined, { expectedIdentity: "confirmed" });
  const rejection = expect(result).rejects.toThrow("status 7");
  expect.soft(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--expected-identity", "confirmed"]));
  child.emit("close", 7);
  await rejection;
  expect(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--expected-identity", "confirmed"]));
});
it("runs only the runtime login in the target project shell", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child);
  const result = targetShell(environment, "a", undefined, { login: "claude-code" });
  child.emit("close", 0);
  await result;
  expect(mocks.spawn.mock.calls.at(-1)![1]).toEqual(expect.arrayContaining(["project", "shell", "a", "--login", "claude-code"]));
});
it("cancels a running Docker shell and waits for close", async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReturnValue(child);
  const abort = new AbortController();
  const result = targetShell(environment, "a", undefined, { signal: abort.signal });
  const rejection = expect(result).rejects.toThrow();
  abort.abort();
  try { expect(child.kill).toHaveBeenCalledWith("SIGTERM"); }
  finally { child.emit("close", 1); await rejection; }
});

it("rereads the environment after its lock and preserves the confirmed project identity", async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { environmentDirectory, saveEnvironment } = await import("./paths.js");
  const { EnvironmentController } = await import("./workflow.js");
  const { targetCommands } = await import("./index.js");
  const home = mkdtempSync(join(tmpdir(), "convoy-shell-lock-"));
  const directory = environmentDirectory(environment.name, home);
  saveEnvironment(directory, environment); mkdirSync(join(directory, "lock"));
  const container = vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); mocks.spawn.mockReset().mockReturnValue(child);
  const running = targetCommands.shell(environment, "a", { expectedIdentity: "confirmed", home });
  try {
    expect(container).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled();
    saveEnvironment(directory, { ...environment, version: "2.0.0" });
    rmSync(join(directory, "lock"), { recursive: true });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.emit("close", 0); await running;
    expect(container.mock.calls[0][0].version).toBe("2.0.0");
    expect(mocks.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(["--expected-identity", "confirmed"]));
  } finally { child.emit("close", 0); await running.catch(() => {}); container.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});
