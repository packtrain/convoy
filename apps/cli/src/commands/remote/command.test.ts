import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ forward: vi.fn(), version: vi.fn(), transport: vi.fn() }));
vi.mock("./ssh.js", () => ({ sshForward: mocks.forward, remoteVersion: mocks.version, sshBridge: vi.fn() }));
vi.mock("../service/client.js", () => ({ configureServiceTransport: mocks.transport }));
import { registerRemoteCommands } from "./command.js";
import { readRemotes, saveRemotes } from "./paths.js";
import { setTargetRemote, targetRemote } from "./resolution.js";
import { environmentDirectory, saveEnvironment } from "../environment/paths.js";

let home: string, previous: string | undefined;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "cv-remote-")); previous = process.env.HOME; process.env.HOME = home; vi.clearAllMocks(); process.exitCode = undefined; });
afterEach(() => { setTargetRemote(); process.env.HOME = previous; rmSync(home, { recursive: true, force: true }); process.exitCode = undefined; });

function program() {
  const root = new Command().exitOverride().option("--project <id>");
  const add = vi.fn(), status = vi.fn(), keys = vi.fn();
  root.command("project").command("add <path>").option("--profile-key <key>").option("--reuse").option("--env, --environment <name>").action(add);
  const service = root.command("service");
  service.command("status").option("--json").action(status);
  service.command("statusline").action(vi.fn());
  root.command("attach").action(vi.fn());
  root.command("keys").command("rotate <name>").option("--stdin").action(keys);
  registerRemoteCommands(root);
  return { root, add, status, keys };
}

it("checks the installation before saving a private target", async () => {
  mocks.version.mockResolvedValue({ version: "0.108.0" });
  await program().root.parseAsync(["remote", "add", "vm", "--host", "dev@vm", "--command", "/opt/my convoy"], { from: "user" });
  expect(readRemotes(home)).toEqual([{ name: "vm", host: "dev@vm", command: "/opt/my convoy" }]);
  expect(statSync(join(home, ".convoy", "remotes.json")).mode & 0o777).toBe(0o600);
});

it("saves the install path the version check found", async () => {
  mocks.version.mockResolvedValue({ version: "0.112.0", command: "/opt/convoy/node_modules/.bin/convoy" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm"], { from: "user" });
  expect(readRemotes(home)).toEqual([{ name: "vm", host: "vm", command: "/opt/convoy/node_modules/.bin/convoy" }]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("at /opt/convoy/node_modules/.bin/convoy")); log.mockRestore();
});

it("does not save a target it cannot reach", async () => {
  mocks.version.mockRejectedValue(new Error("SSH to vm failed: Permission denied (publickey)."));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm"], { from: "user" });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("Permission denied")); error.mockRestore();
  expect(readRemotes(home)).toEqual([]); expect(process.exitCode).toBe(1);
});

it("forwards non-protocol commands with their exact arguments", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  mocks.forward.mockResolvedValue(3);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exited"); });
  const { root, add } = program();
  await expect(root.parseAsync(["project", "add", "/srv/my repo", "--remote", "vm", "--reuse", "--profile-key", "a"], { from: "user" })).rejects.toThrow("exited");
  expect(mocks.forward).toHaveBeenCalledWith({ name: "vm", host: "vm" }, ["project", "add", "--profile-key", "a", "--reuse", "--", "/srv/my repo"]);
  expect(exit).toHaveBeenCalledWith(3); expect(add).not.toHaveBeenCalled(); exit.mockRestore();
});

it("runs protocol commands locally through the SSH bridge", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  const { root, status } = program();
  await root.parseAsync(["service", "status", "--remote", "vm", "--json"], { from: "user" });
  expect(mocks.transport).toHaveBeenCalledOnce(); expect(status).toHaveBeenCalledOnce(); expect(mocks.forward).not.toHaveBeenCalled();
});

it("rejects combining a remote with a managed environment", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  await expect(program().root.parseAsync(["project", "add", "x", "--remote", "vm", "--env", "demo"], { from: "user" })).rejects.toThrow("either --remote or --environment");
});

it("forwards root options given before the command", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  mocks.forward.mockResolvedValue(0);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exited"); });
  await expect(program().root.parseAsync(["--project", "intended", "project", "add", "/srv/repo", "--remote", "vm"], { from: "user" })).rejects.toThrow("exited");
  expect(mocks.forward).toHaveBeenCalledWith({ name: "vm", host: "vm" }, ["--project", "intended", "project", "add", "--", "/srv/repo"]);
  exit.mockRestore();
});

it("matches protocol commands by whole names", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  mocks.forward.mockResolvedValue(0);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exited"); });
  await expect(program().root.parseAsync(["service", "statusline", "--remote", "vm"], { from: "user" })).rejects.toThrow("exited");
  expect(mocks.forward).toHaveBeenCalledOnce(); expect(mocks.transport).not.toHaveBeenCalled();
  exit.mockRestore();
});

it("keeps a target saved by another command during the SSH check", async () => {
  mocks.version.mockImplementation(async () => { saveRemotes([{ name: "other", host: "other" }], home); return { version: "0.108.0" }; });
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm"], { from: "user" });
  expect(readRemotes(home).map(remote => remote.name)).toEqual(["other", "vm"]);
});

it("rejects a relative remote command", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm", "--command", "bin/convoy"], { from: "user" });
  error.mockRestore();
  expect(process.exitCode).toBe(1); expect(mocks.version).not.toHaveBeenCalled();
});

it("runs keys on the host against the remote's service, never forwarding the secret input (OS-2020)", async () => {
  saveRemotes([{ name: "vm", host: "dev@vm" }], home);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { root, keys } = program();
  await root.parseAsync(["keys", "rotate", "work", "--stdin", "--remote", "vm"], { from: "user" });
  expect(keys).toHaveBeenCalledOnce(); expect(mocks.forward).not.toHaveBeenCalled(); expect(mocks.transport).toHaveBeenCalledOnce();
  expect(targetRemote()).toEqual({ name: "vm", host: "dev@vm" });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("dev@vm")); error.mockRestore();
});

function saveEnvironmentNamed(name: string) {
  saveEnvironment(environmentDirectory(name, home), { schema: 1, name, owner: "00000000-0000-4000-8000-000000000000", daemon: "engine", version: "0.119.0", deployment: "", domains: "" });
}

it("routes --target to a saved remote and does not forward it (OS-2215)", async () => {
  saveRemotes([{ name: "vm", host: "vm" }], home);
  mocks.forward.mockResolvedValue(0);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exited"); });
  await expect(program().root.parseAsync(["project", "add", "/srv/repo", "--target", "vm"], { from: "user" })).rejects.toThrow("exited");
  expect(mocks.forward).toHaveBeenCalledWith({ name: "vm", host: "vm" }, ["project", "add", "--", "/srv/repo"]);
  exit.mockRestore();
});

it("routes --target to a managed environment as --environment (OS-2215)", async () => {
  saveEnvironmentNamed("demo");
  const { root, status } = program();
  await root.parseAsync(["service", "status", "--target", "demo"], { from: "user" });
  expect(status.mock.calls[0][0]).toMatchObject({ environment: "demo" });
  expect(mocks.transport).not.toHaveBeenCalled(); expect(mocks.forward).not.toHaveBeenCalled();
});

it("rejects a --target name used by both lists, naming the explicit flags (OS-2215)", async () => {
  saveRemotes([{ name: "demo", host: "vm" }], home); saveEnvironmentNamed("demo");
  await expect(program().root.parseAsync(["service", "status", "--target", "demo"], { from: "user" })).rejects.toThrow("Use --env demo or --remote demo");
});

it("rejects an unknown --target and --target with another target flag (OS-2215)", async () => {
  await expect(program().root.parseAsync(["service", "status", "--target", "nope"], { from: "user" })).rejects.toThrow("No environment or remote named nope");
  saveRemotes([{ name: "vm", host: "vm" }], home);
  await expect(program().root.parseAsync(["project", "add", "x", "--target", "vm", "--remote", "vm"], { from: "user" })).rejects.toThrow("one of --target");
});

it("refuses a remote name already used by a managed environment (OS-2215)", async () => {
  saveEnvironmentNamed("demo");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "demo", "--host", "vm"], { from: "user" });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("Environment demo already uses this name")); error.mockRestore();
  expect(readRemotes(home)).toEqual([]); expect(mocks.version).not.toHaveBeenCalled();
});

it("sets the mode on the remote over ssh after saving it", async () => {
  mocks.version.mockResolvedValue({ version: "0.140.0", command: "/opt/convoy/node_modules/.bin/convoy" });
  mocks.forward.mockResolvedValue(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm", "--mode", "isolated"], { from: "user" });
  const saved = { name: "vm", host: "vm", command: "/opt/convoy/node_modules/.bin/convoy" };
  expect(readRemotes(home)).toEqual([saved]);
  expect(mocks.forward).toHaveBeenCalledWith(saved, ["service", "mode", "--mode", "isolated"]);
  vi.mocked(console.log).mockRestore();
});

it("keeps the remote and fails when its mode setup fails", async () => {
  mocks.version.mockResolvedValue({ version: "0.140.0" });
  mocks.forward.mockResolvedValue(1);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm", "--mode", "isolated"], { from: "user" });
  expect(readRemotes(home)).toEqual([{ name: "vm", host: "vm" }]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("convoy service mode --remote vm")); expect(process.exitCode).toBe(1);
  error.mockRestore(); vi.mocked(console.log).mockRestore();
});

it("skips the mode without a terminal or --mode, and fails an explicit --mode on a remote CLI that predates it", async () => {
  mocks.version.mockResolvedValue({ version: "0.140.0" });
  await program().root.parseAsync(["remote", "add", "vm", "--host", "vm"], { from: "user" });
  expect(mocks.forward).not.toHaveBeenCalled();
  mocks.version.mockResolvedValue({ version: "0.139.0" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await program().root.parseAsync(["remote", "add", "old", "--host", "old", "--mode", "isolated"], { from: "user" });
  expect(mocks.forward).not.toHaveBeenCalled();
  expect(readRemotes(home).map(remote => remote.name)).toEqual(["vm", "old"]);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("predates --mode")); expect(process.exitCode).toBe(1);
  error.mockRestore(); vi.mocked(console.log).mockRestore();
});
