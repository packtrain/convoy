import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { connections } from "./resolution.js";
import { EnvironmentController } from "../environment/workflow.js";
import { ServiceClient } from "../service/client.js";
import { targetCommands } from "../environment/index.js";
import { withEnvironmentLock, environmentDirectory } from "../environment/paths.js";
import { bridge, docker } from "../environment/docker.js";
vi.mock("../environment/docker.js", async importOriginal => ({ ...await importOriginal<typeof import("../environment/docker.js")>(), docker: vi.fn(), bridge: vi.fn(() => "/fixture") }));
const homes: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const home of homes) rmSync(home, { recursive: true, force: true }); homes.length = 0; });
function home() { const value = mkdtempSync(join(tmpdir(), "tui-discovery-")); homes.push(value); return value; }
function saved(root: string, name: string, content?: string) {
  for (const path of [".convoy", ".convoy/environments", `.convoy/environments/${name}`]) mkdirSync(join(root, path), { recursive: true, mode: 0o700 });
  const value = { schema: 1 as const, name, owner: "12345678-1234-4234-8234-123456789012", daemon: "test", version: "1.0.0", deployment: "", domains: "" };
  writeFileSync(join(root, ".convoy/environments", name, "environment.json"), content ?? JSON.stringify(value), { mode: 0o600 });
  return value;
}
it("discovers without creating state directories", () => {
  const root = home(); expect(connections(undefined, root).targets.map(t => t.id)).toEqual(["local"]);
  expect(existsSync(join(root, ".convoy"))).toBe(false);
});
it("isolates corrupt saved targets and reports a safe diagnostic", () => {
  const root = home(); saved(root, "broken", "secret-invalid-json"); saved(root, "good");
  const result = connections(undefined, root);
  expect(result.targets.map(t => t.id)).toEqual(["local", "good"]);
  expect(result.warnings).toEqual(["Cannot read managed environment broken. Check its private environment.json."]);
  expect(() => connections("broken", root)).toThrow("Cannot read managed environment broken");
});
it("rejects symlink directories without blocking local discovery", () => {
  const root = home(); saved(root, "good");
  symlinkSync(join(root, ".convoy/environments/good"), join(root, ".convoy/environments/bad"));
  expect(connections(undefined, root).warnings).toHaveLength(1);
});
it("opens the validated target in the same custom home used for discovery", async () => {
  const root = home(); const environment = saved(root, "unique-tui-home");
  const container = vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  vi.spyOn(ServiceClient, "open").mockRejectedValue(new Error("fixture reached"));
  const target = connections("unique-tui-home", root).targets[1];
  await expect(target.open(new AbortController().signal)).rejects.toThrow("fixture reached");
  expect(container).toHaveBeenCalledWith(environment); expect(bridge).toHaveBeenCalledWith(environment);
});

it("reads retained local logs after shutdown without creating missing storage", async () => {
  const root = home(); const target = connections(undefined, root).targets[0];
  expect(await target.savedLogs!(0)).toEqual({ entries: [], cursor: 0, gap: false });
  expect(existsSync(join(root, ".convoy"))).toBe(false);
  mkdirSync(join(root, ".convoy/service"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, ".convoy/service/operations.ndjson"), JSON.stringify({ seq: 1, ts: 1, profile: "a", message: "stopped" }) + "\n", { mode: 0o600 });
  expect((await target.savedLogs!(0)).entries[0].message).toBe("stopped");
  expect(target.start).toBeUndefined();
});

it("distinguishes a stopped container from service failure for saved logs and start", async () => {
  const root = home(); saved(root, "offline");
  vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: false }, Config: {} });
  const target = connections("offline", root).targets[1];
  await expect(target.savedLogs!(0)).rejects.toThrow("Container unavailable");
  await expect(target.start!()).rejects.toThrow("Container unavailable");
});


it("shares the quiet Docker operational-log reader", async () => {
  const root = home(); const environment = saved(root, "logs");
  vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  vi.mocked(docker).mockResolvedValue("");
  const reader = vi.spyOn(targetCommands, "operationalLogs").mockResolvedValue([{ seq: 2, ts: 1, profile: "project", message: "retained" }]);
  const result = await connections("logs", root).targets[1].savedLogs!(1, "project");
  expect(reader).toHaveBeenCalledWith(environment, "project", false);
  expect(result.entries[0].seq).toBe(2);
});

it.each(["not-json-private-detail", '{"wrong":"private-detail"}'])("maps malformed Docker logs to controlled guidance: %s", async output => {
  const root = home(); saved(root, "logs");
  vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  vi.mocked(docker).mockResolvedValue(output);
  await expect(connections("logs", root).targets[1].savedLogs!(0)).rejects.toThrow("Saved service logs unavailable in the running container. Check CLI compatibility and file permissions.");
});

it("waits for the environment lock before rereading and starting", async () => {
  const root = home(); saved(root, "locked");
  const container = vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  vi.mocked(docker).mockResolvedValue("");
  const directory = environmentDirectory("locked", root, false);
  const target = connections("locked", root).targets[1];
  let release!: () => void;
  const holder = withEnvironmentLock(directory, () => new Promise<void>(resolve => { release = resolve; }));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const starting = target.start!();
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container).not.toHaveBeenCalled();
    const changed = saved(root, "locked"); changed.version = "2.0.0";
    saved(root, "locked", JSON.stringify(changed));
  } finally { release(); await holder; await starting; }
  expect(container.mock.calls[0][0].version).toBe("2.0.0");
});

it.each([false, true])("keeps shared log reader diagnostics=%s", async diagnostics => {
  const root = home(); const environment = saved(root, "reader");
  const entry = { seq: 1, ts: 1, profile: "project", message: "retained" };
  vi.mocked(docker).mockResolvedValue(JSON.stringify(entry));
  expect(await targetCommands.operationalLogs(environment, "project", diagnostics)).toEqual([entry]);
  expect(docker).toHaveBeenLastCalledWith(expect.arrayContaining(["logs", "--json", "--profile", "project"]), { diagnostics });
});

it.each(["stopped", "changed", "unreachable"])("retains input after safe registration preflight failure: %s", async scenario => {
  const root = home(); const original = saved(root, "add");
  const target = connections("add", root).targets[1];
  if (scenario === "changed") saved(root, "add", JSON.stringify({ ...original, daemon: "other" }));
  const inspect = vi.spyOn(EnvironmentController.prototype, "container");
  if (scenario === "unreachable") inspect.mockRejectedValue(new Error("private diagnostic"));
  else inspect.mockResolvedValue({ Id: "id", State: { Running: scenario !== "stopped" }, Config: {} });
  vi.mocked(docker).mockClear();
  await expect(target.addProject!("a", {})).resolves.toMatchObject({ ok: false, retrySafe: true, registered: false, reason: "environment-unavailable" });
  expect(docker).not.toHaveBeenCalled();
});

it("ignores empty environment directories after preflight failure or deletion", () => {
  const root = home(); environmentDirectory("empty", root);
  const result = connections(undefined, root);
  expect(result.targets.map(target => target.id)).toEqual(["local"]);
  expect(result.warnings).toEqual([]);
});

it("opens an AWS endpoint without streaming helper output over the TUI", async () => {
  const root = home(); saved(root, "aws");
  vi.spyOn(EnvironmentController.prototype, "container").mockResolvedValue({ Id: "id", State: { Running: true }, Config: {} });
  vi.mocked(docker).mockResolvedValue("Adding GitHub range 4.208.26.193/32");
  await connections("aws", root).targets[1].credentials!.allowDomain!("bedrock-mantle.us-east-1.api.aws");
  const [args, options] = vi.mocked(docker).mock.lastCall!;
  expect(args).toEqual(expect.arrayContaining(["allow-domain", "bedrock-mantle.us-east-1.api.aws"]));
  expect(options?.progress).toBeFalsy();
});

it("lists saved SSH remotes after managed environments", async () => {
  const root = home(); saved(root, "good");
  writeFileSync(join(root, ".convoy/remotes.json"), JSON.stringify({ schema: 1, remotes: [{ name: "vm", host: "dev@vm", container: "box" }] }), { mode: 0o600 });
  const result = connections(undefined, root);
  expect(result.targets.map(t => [t.id, t.transport, t.endpoint])).toEqual([["local", "unix", join(root, ".convoy/service/control.sock")],
    ["good", "docker", expect.any(String)], ["vm", "ssh", "ssh dev@vm docker exec box"]]);
  expect([typeof result.targets[2].start, typeof result.targets[2].savedLogs, typeof result.targets[2].shell]).toEqual(["function", "function", "function"]);
  expect(result.targets[2].addProjectUnavailable).toBe("Update the CLI on vm, restart its service, then retry. Or add projects from a terminal: convoy project add <path> --remote vm.");
  expect([result.targets[2].addProject, result.targets[2].checkProject, result.targets[2].credentials?.status]).toEqual([expect.any(Function), expect.any(Function), expect.any(Function)]);
});

it("explains why saved remotes cannot be read", () => {
  const root = home(); mkdirSync(join(root, ".convoy"), { mode: 0o700 });
  writeFileSync(join(root, ".convoy/remotes.json"), JSON.stringify({ schema: 1, remotes: [] }), { mode: 0o644 });
  expect(connections(undefined, root).warnings).toEqual([expect.stringContaining("Unsafe remote targets file")]);
});
it("reads a managed Docker record without mode as isolated (OS-2249)", () => {
  const root = home(); const legacy = saved(root, "legacy");
  saved(root, "recorded", JSON.stringify({ ...legacy, name: "recorded", mode: "shared" }));
  expect(connections(undefined, root).targets.slice(1).map(target => [target.id, target.mode])).toEqual([["legacy", "isolated"], ["recorded", "shared"]]);
});
it("offers Add project, Start, Check, shell, account and credentials on a shared Local target (OS-2248)", () => {
  const root = home(); vi.stubEnv("HOME", root);
  try {
    const local = connections(undefined, root).targets[0];
    expect(local.addProject).toBeDefined();
    expect(Boolean(local.start)).toBe(Boolean(process.getuid?.()));
    expect(local.check).toBeDefined();
    expect(local.mode).toBe("shared");
    expect([local.shell, local.account, local.credentials].every(Boolean)).toBe(true);
  } finally { vi.unstubAllEnvs(); }
});
