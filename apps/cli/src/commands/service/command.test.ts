import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), request: vi.fn(), mode: vi.fn(() => "isolated"), choose: vi.fn(async () => "shared") }));
vi.mock("../environment/resolution.js", async (original) => ({ ...await original<typeof import("../environment/resolution.js")>(), recordEnvironmentMode: mocks.mode, chooseEnvironmentMode: mocks.choose }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../project/launcher.js", async (original) => ({ ...await original<typeof import("../project/launcher.js")>(), isProjectEnvironment: () => true }));
vi.mock("./client.js", () => ({ serviceEndpoint: () => "/test", serviceRequest: mocks.request }));
vi.mock("./paths.js", () => ({ servicePaths: () => ({ directory: "/private", socket: "/private/control.sock", lock: "/private/lock" }), privateFile: () => {} }));
import { serviceCommand, startService } from "./command.js";

afterEach(() => { vi.restoreAllMocks(); mocks.spawn.mockReset(); mocks.request.mockReset(); process.exitCode = undefined; });
function child() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn(),
  });
}
it("exposes the shipped service management commands", () => {
  expect(serviceCommand.commands.map((command) => command.name())).toEqual(["start", "mode", "status", "pause", "reload", "stop", "enable", "disable", "logs", "bridge", "outcome", "runs"]);
});
it("settles the mode before starting, and prints it from service mode", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await serviceCommand.parseAsync(["mode", "--mode", "isolated"], { from: "user" });
  expect(mocks.choose).toHaveBeenCalledWith("isolated", false);
  expect(log).toHaveBeenCalledWith("Mode: shared");
  mocks.spawn.mockImplementation(() => { throw new Error("spawned"); });
  await serviceCommand.parseAsync(["start", "--mode", "shared"], { from: "user" });
  expect(mocks.choose).toHaveBeenLastCalledWith("shared", false);
});
it("waits for readiness before detaching and strips provider environment", async () => {
  vi.stubEnv("CODEX_HOME", "/home/node/.codex-local");
  const worker = child(); mocks.spawn.mockReturnValue(worker); vi.spyOn(console, "log").mockImplementation(() => {});
  const started = startService(true);
  expect(worker.unref).not.toHaveBeenCalled();
  worker.stdout.write("ready\n"); await started;
  expect(worker.unref).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ detached: true, cwd: "/", env: { LANG: "C.UTF-8" } });
  expect(Object.keys(mocks.spawn.mock.calls[0][2].env).sort()).toEqual(["HOME", "LANG", "PATH"]);
  vi.unstubAllEnvs();
});
it("runs the entrypoint itself instead of /usr/bin/flock, with the fixed PATH in isolated mode", async () => {
  const worker = child(); mocks.spawn.mockReturnValue(worker); vi.spyOn(console, "log").mockImplementation(() => {});
  const started = startService(true); worker.stdout.write("ready\n"); await started;
  expect(mocks.spawn.mock.calls[0][0]).toBe(process.execPath);
  expect(mocks.spawn.mock.calls[0][2].env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
});
it("passes the starting PATH to a shared service so its workers find Homebrew and nvm runtimes", async () => {
  mocks.mode.mockReturnValueOnce("shared");
  vi.stubEnv("PATH", "/opt/homebrew/bin:/Users/me/.nvm/versions/node/v22/bin:/usr/bin:/bin");
  const worker = child(); mocks.spawn.mockReturnValue(worker); vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const started = startService(true); worker.stdout.write("ready\n"); await started;
    expect(mocks.spawn.mock.calls[0][2].env.PATH).toBe("/opt/homebrew/bin:/Users/me/.nvm/versions/node/v22/bin:/usr/bin:/bin");
  } finally { vi.unstubAllEnvs(); }
});
it("passes the runtimes' config homes to a shared service, as a foreground connect sees them (OS-2250)", async () => {
  mocks.mode.mockReturnValueOnce("shared");
  vi.stubEnv("CODEX_HOME", "/home/node/.codex-local"); vi.stubEnv("CLAUDE_CONFIG_DIR", "/home/node/.claude");
  const worker = child(); mocks.spawn.mockReturnValue(worker); vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const started = startService(true); worker.stdout.write("ready\n"); await started;
    expect(mocks.spawn.mock.calls[0][2].env).toMatchObject({ CODEX_HOME: "/home/node/.codex-local", CLAUDE_CONFIG_DIR: "/home/node/.claude" });
  } finally { vi.unstubAllEnvs(); }
});
it("cleans a background owner when readiness is invalid", async () => {
  const worker = child(); mocks.spawn.mockReturnValue(worker);
  const started = startService(true);
  worker.stdout.write("x".repeat(1025));
  await expect(started).rejects.toThrow("Invalid service readiness");
  expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
});
it("reports a duplicate owner without acknowledging readiness", async () => {
  const worker = child(); mocks.spawn.mockReturnValue(worker);
  const started = startService(true);
  worker.stdout.write(JSON.stringify({ error: "Service already running. Use convoy service status." }) + "\n"); worker.emit("exit", 1);
  await expect(started).rejects.toThrow("already running");
  expect(worker.unref).not.toHaveBeenCalled();
});

it("surfaces a bounded structured startup failure", async () => {
  const worker = child(); mocks.spawn.mockReturnValue(worker);
  const started = startService(true);
  worker.stdout.write(JSON.stringify({ error: "Invalid service registration snapshot. Check project list." }) + "\n");
  worker.emit("exit", 1);
  await expect(started).rejects.toThrow("Invalid service registration snapshot");
});

it("does not hide protocol errors behind the offline log fallback", async () => {
  mocks.request.mockRejectedValue(new Error("Invalid service response. Check versions."));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await serviceCommand.commands.find((command) => command.name() === "logs")!.parseAsync(["node", "logs"]);
  expect(error).toHaveBeenCalledWith("Invalid service response. Check versions.");
  expect(process.exitCode).toBe(1);
});

it.each([
  ["start", "-b"], ["start", "--background"], ["start", undefined],
])("starts %s with %s through the service launcher", async (name, flag) => {
  const command = serviceCommand.commands.find((entry) => entry.name() === "start");
  expect(command).toBeDefined();
  command!.exitOverride();
  command!.setOptionValue("background", false);
  const worker = child();
  mocks.spawn.mockReturnValue(worker);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const running = command!.parseAsync(["node", name!, ...(flag ? [flag] : [])]);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
  expect(mocks.spawn.mock.calls[0][2].detached).toBe(Boolean(flag));
  worker.stdout.write("ready\n");
  if (!flag) worker.emit("exit", 0);
  await running;
  expect(worker.unref).toHaveBeenCalledTimes(flag ? 1 : 0);
});

it("does not put host environment selection into a service mutation frame", async () => {
  const reload = serviceCommand.commands.find(command => command.name() === "reload")!;
  reload.option("--environment <name>");
  mocks.request.mockResolvedValue({ applied: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  await reload.parseAsync(["--environment", "demo", "--profile", "a", "--interrupt"], { from: "user" });
  expect(mocks.request).toHaveBeenCalledWith("/test", { op: "reconcile", profile: "a", interrupt: true });
});
