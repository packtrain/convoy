import * as paths from "./paths.js";
import { getCliVersion } from "../../lib/version.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY_BUILD, CURSOR_BUILD } from "../project/formatters.js";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnvironment, prepareEnvironment, provisionEnvironment, environmentMaintenance, EnvironmentController } from "./workflow.js";
import { containerName, LABEL, OWNER, type Environment } from "./validators.js";
import { environmentDirectory, readEnvironment, saveEnvironment, withEnvironmentLock } from "./paths.js";
import { saveRemotes } from "../remote/paths.js";

const environment: Environment = { schema: 1, name: "test", owner: "00000000-0000-4000-8000-000000000000", daemon: "engine", version: "0.75.0", deployment: "example", domains: "" };
afterEach(() => vi.restoreAllMocks());
function fixture() {
  let exists = false, running = false, creates = 0;
  const commands: string[][] = [];
  const volumes = new Map<string, Record<string, string>>();
  const execute = vi.fn(async (args: string[]) => {
    commands.push(args);
    if (args[0] === "info") return JSON.stringify({ ID: "engine", OSType: "linux" });
    if (args[0] === "container" && args[1] === "ls") return exists ? "id" : "";
    if (args[0] === "container" && args[1] === "inspect") return JSON.stringify([{ Id: "id", State: { Running: running }, Config: { Labels: { [OWNER]: environment.owner, [LABEL]: environment.name } } }]);
    if (args[0] === "volume") {
      const name = args.at(-1)!;
      if (args[1] === "ls") return volumes.has(name.replace('name=^', '').replace('$', '')) ? "volume" : "";
      if (args[1] === "create") volumes.set(name, { [OWNER]: environment.owner, [LABEL]: environment.name });
      if (args[1] === "inspect") return JSON.stringify([{ Labels: volumes.get(name) }]);
    }
    if (args[0] === "create") { creates++; exists = true; }
    if (args[0] === "start") running = true;
    if (args[0] === "stop") running = false;
    if (args[0] === "exec" && args.at(-1) === "status") return JSON.stringify({ serviceVersion: "0.75.0", serviceRunning: true, recoveryPending: false, runtimes: [] });
    return "";
  });
  return { controller: new EnvironmentController(execute), execute, commands, volumes, creates: () => creates };
}
it("reuses an owned container, persists Linux volumes and never mounts the host socket", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
  await f.controller.start(environment); await f.controller.start(environment);
  expect(f.creates()).toBe(1);
  const create = f.commands.find(c => c[0] === "create")!;
  expect(create.join(" ")).not.toMatch(/docker.sock|--privileged|type=bind/);
  expect(create.join(" ")).toContain("--restart unless-stopped");
  expect(create.filter(c => c === "--mount")).toHaveLength(5);
  expect(create).toContain("target=/workspace".replace("target=", `type=volume,source=${containerName(environment)}-workspace,target=`));
});
it("rejects a different Docker daemon before changing containers", async () => {
  const f = fixture(); await expect(f.controller.start({ ...environment, daemon: "other" })).rejects.toThrow("different Docker daemon");
  expect(f.commands).toHaveLength(1);
});
it("refuses an unrelated container without stopping it", async () => {
  const f = fixture(); f.execute.mockImplementation(async args => args[0] === "info" ? JSON.stringify({ ID: "engine", OSType: "linux" }) : args[1] === "ls" ? "id" : JSON.stringify([{ Id: "id", Config: { Labels: {} }, State: { Running: true } }]));
  await expect(f.controller.operation(environment, "stop")).rejects.toThrow("ownership");
  expect(f.execute.mock.calls.some(([args]) => args[0] === "stop")).toBe(false);
});
it("refuses an unrelated volume instead of adopting private data", async () => {
  const f = fixture(); f.volumes.set(`${containerName(environment)}-workspace`, { [OWNER]: "other" });
  await expect(f.controller.volumes(environment)).rejects.toThrow("ownership");
});
it("never stops a container when graceful service cleanup fails", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async args => { if (args[0] === "exec" && args.at(-1) === "stop") throw new Error("cleanup"); return original(args); });
  await expect(f.controller.operation(environment, "stop")).rejects.toThrow("cleanup");
  expect(f.commands.some(c => c[0] === "stop")).toBe(false);
});
it("requires explicit interruption for restart/update/rebuild", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  for (const operation of ["restart", "update", "rebuild"] as const) await expect(f.controller.operation(environment, operation)).rejects.toThrow("--interrupt");
});
it("serializes concurrent host lifecycles and keeps spaces in private state paths", async () => {
  const directory = mkdtempSync(join(tmpdir(), "convoy state "));
  const order: number[] = [];
  try {
    saveEnvironment(directory, environment);
    expect(readEnvironment(directory)).toEqual(environment);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const first = withEnvironmentLock(directory, async () => { order.push(1); await ready; order.push(2); });
    const second = withEnvironmentLock(directory, async () => { order.push(3); });
    release(); await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    expect(readFileSync(join(directory, "environment.json"), "utf8")).not.toContain("api_key");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("retains the selected version after a failed update", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async args => { if (args.includes("update")) throw new Error("Recovered previous installation"); return original(args); });
  const target = { ...environment };
  await expect(f.controller.operation(target, "update", { version: "0.76.0", interrupt: true })).rejects.toThrow("Recovered");
  expect(target.version).toBe(environment.version);
});

it("service stop leaves the container running", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  await f.controller.operation(environment, "service-stop");
  expect(f.commands.some(c => c[0] === "exec" && c.at(-1) === "stop")).toBe(true);
  expect(f.commands.some(c => c[0] === "stop")).toBe(false);
});

it("records the actual retained installation version after recovery", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  const target = { ...environment, version: "0.76.0" };
  await f.controller.operation(target, "status");
  expect(target.version).toBe("0.75.0");
});
it("explains when Docker is in Windows container mode", async () => {
  const controller = new EnvironmentController(async () => JSON.stringify({ ID: "engine", OSType: "windows" }));
  await expect(controller.daemon()).rejects.toThrow("Linux Docker engine");
});

it("allows nested proc mounts on creation and rebuild while retaining project volumes", async () => {
  const f = fixture();
  vi.spyOn(f.controller, "build").mockResolvedValue();
  await f.controller.start(environment);
  await f.controller.operation(environment, "rebuild", { interrupt: true });
  const creates = f.commands.filter(c => c[0] === "create");
  expect(creates).toHaveLength(2);
  for (const create of creates) {
    const securityOptions = create.flatMap((arg, i) => arg === "--security-opt" ? [create[i + 1]] : []);
    expect(securityOptions).toContain("systempaths=unconfined");
    expect(securityOptions.some(option => option.startsWith("seccomp=") && option !== "seccomp=unconfined")).toBe(true);
    expect(create.join(" ")).not.toMatch(/--privileged|SYS_ADMIN|--pid[= ]host|type=bind/);
  }
  const mounts = (args: string[]) => args.flatMap((arg, i) => arg === "--mount" ? [args[i + 1]] : []);
  expect(mounts(creates[1])).toEqual(mounts(creates[0]));
  expect(f.commands.filter(c => c[0] === "volume" && c[1] === "create")).toHaveLength(5);
  expect(f.commands.some(c => c[0] === "volume" && c[1] === "rm")).toBe(false);
});

it.each([false, true])("uploads a local package and cleans it up, update failure=%s", async failure => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  const directory = mkdtempSync(join(tmpdir(), "convoy package "));
  const localPackage = join(directory, "local.tgz");
  writeFileSync(localPackage, "fixture");
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(async args => {
    if (failure && args.includes("update-package")) throw new Error("update failed");
    if (args[0] === "exec" && args.at(-1) === "status") return JSON.stringify({ serviceVersion: "0.97.0", serviceRunning: true, recoveryPending: false, runtimes: [] });
    return original(args);
  });
  const target = { ...environment };
  try {
    const result = f.controller.operation(target, "update", { localPackage, interrupt: true });
    if (failure) await expect(result).rejects.toThrow("update failed");
    else { await result; expect(target.version).toBe("0.97.0"); }
    const copy = f.execute.mock.calls.find(([args]) => args[0] === "cp")![0];
    expect(copy[1]).toBe(localPackage);
    const remote = copy[2].slice(copy[2].indexOf(":") + 1);
    expect(f.execute.mock.calls.some(([args]) => args.includes("update-package") && args.at(-1) === remote)).toBe(true);
    expect(f.execute.mock.calls.some(([args]) => args.includes("rm") && args.at(-1) === remote)).toBe(true);
    if (failure) expect(target.version).toBe(environment.version);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each([{}, { version: "0.97.0", localPackage: "/tmp/package.tgz" }])("requires exactly one update source: %j", async options => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  await expect(f.controller.operation(environment, "update", { ...options, interrupt: true })).rejects.toThrow("exactly one");
});

it("TUI update rechecks npm before executing and saves the observed target version", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-tui-env-"));
  const directory = environmentDirectory("test", home);
  saveEnvironment(directory, environment);
  const version = getCliVersion();
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ name: "@useconvoy/cli", version })));
  const operation = vi.spyOn(EnvironmentController.prototype, "operation").mockImplementation(async (_env, op) =>
    op === "status" ? { serviceVersion: "0.75.0", serviceRunning: true } : { serviceVersion: version, serviceRunning: true });
  try {
    const adapter = environmentMaintenance(environment, home);
    const release = await adapter.release();
    expect(release).toEqual({ installed: "0.75.0", proposed: version });
    expect(operation.mock.calls.map(call => call[1])).toEqual(["status"]);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ name: "@useconvoy/cli", version })));
    await adapter.execute("update", () => {}, { version: release.proposed });
    expect(request).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls.map(call => call[1])).toEqual(["status", "status", "update"]);
    expect(readEnvironment(directory)?.version).toBe(version);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("TUI update installs the --package build without npm", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-tui-env-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  const operation = vi.spyOn(EnvironmentController.prototype, "operation").mockImplementation(async (_env, op) =>
    op === "status" ? { serviceVersion: "0.75.0", serviceRunning: true } : { serviceVersion: getCliVersion(), serviceRunning: true });
  try {
    const adapter = environmentMaintenance(environment, home);
    const release = await adapter.release("/tmp/convoy.tgz");
    expect(release).toEqual({ installed: "0.75.0", proposed: getCliVersion(), localPackage: "/tmp/convoy.tgz" });
    await adapter.execute("update", () => {}, { version: release.proposed, localPackage: release.localPackage });
    expect(request).not.toHaveBeenCalled();
    expect(operation.mock.calls.at(-1)?.[2]).toEqual({ localPackage: "/tmp/convoy.tgz", interrupt: true });
    expect(readEnvironment(directory)?.version).toBe(getCliVersion());
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("TUI update rejects false success when target still reports the old installation", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-tui-env-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: getCliVersion() })));
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ serviceVersion: "0.75.0", serviceRunning: true });
  try { await expect(environmentMaintenance(environment, home).execute("update", () => {}, { version: getCliVersion() })).rejects.toThrow("installed version"); }
  finally { rmSync(home, { recursive: true, force: true }); }
});
it("TUI maintenance rejects changed target identity before controller execution", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-tui-env-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, { ...environment, owner: "11111111-1111-4111-8111-111111111111" });
  const operation = vi.spyOn(EnvironmentController.prototype, "operation");
  try {
    await expect(environmentMaintenance(environment, home).execute("restart", () => {})).rejects.toThrow("identity changed");
    expect(operation).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("npm failure at confirmation does not invoke update", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-tui-env-"));
  saveEnvironment(environmentDirectory("test", home), environment);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const operation = vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ serviceVersion: "0.75.0", serviceRunning: true });
  try {
    await expect(environmentMaintenance(environment, home).execute("update", () => {}, { version: getCliVersion() })).rejects.toThrow("network and retry");
    expect(operation.mock.calls.map(call => call[1])).toEqual(["status"]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it("resumes saved network settings when optional TUI fields are blank", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-resume-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: getCliVersion() })));
  const start = vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running", serviceVersion: environment.version, serviceRunning: true });
  try {
    await expect(provisionEnvironment({ name: "test", deployment: "", domains: "" }, () => {})).resolves.toMatchObject({ deployment: "example", version: environment.version });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ deployment: "example" }), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("resuming an existing container does not require the host release on npm", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-resume-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running", serviceVersion: environment.version, serviceRunning: true });
  try {
    await expect(provisionEnvironment({ name: "test", deployment: "example", domains: "" }, () => {})).resolves.toMatchObject({ version: environment.version });
    expect(request).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("returns the inspected installed version with the update proposal", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-proposal-"));
  saveEnvironment(environmentDirectory("test", home), environment);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: getCliVersion() })));
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ serviceVersion: environment.version, serviceRunning: true });
  try { await expect(environmentMaintenance(environment, home).release()).resolves.toEqual({ installed: environment.version, proposed: getCliVersion() }); }
  finally { rmSync(home, { recursive: true, force: true }); }
});

it("names the local-package update when the host release is not on npm", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-proposal-"));
  saveEnvironment(environmentDirectory("test", home), environment);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ serviceVersion: environment.version, serviceRunning: true });
  try {
    await expect(environmentMaintenance(environment, home).release()).rejects.toThrow(
      /not published on npm.*pnpm pack in apps\/cli.*convoy tui --package <tgz> or convoy environment update --environment test --package <tgz> --interrupt/s);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it("prepares the installed release and saved configuration before resume confirmation", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-preview-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running", serviceVersion: "0.90.0", serviceRunning: true });
  const request = vi.spyOn(globalThis, "fetch");
  try {
    await expect(prepareEnvironment({ name: "test", deployment: "", domains: "" })).resolves.toEqual({ name: "test", mode: "isolated", deployment: "example", domains: "", owner: environment.owner, daemon: environment.daemon, version: "0.90.0", install: false });
    expect(request).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("checks the saved release only when rebuilding a missing container", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-preview-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "not-created", selectedVersion: environment.version });
  vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ name: "@useconvoy/cli", version: environment.version })));
  try {
    const proposal = await prepareEnvironment({ name: "test", deployment: "", domains: "" });
    expect(proposal.install).toBe(true); expect(request).not.toHaveBeenCalled();
    await provisionEnvironment(proposal, () => {}, proposal);
    expect(request).toHaveBeenCalledWith(`https://registry.npmjs.org/@useconvoy/cli/${environment.version}`, expect.anything());
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("rejects a changed installed version after resume confirmation before start", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-preview-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  const operation = vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running", serviceVersion: environment.version });
  const start = vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  try {
    const proposal = await prepareEnvironment({ name: "test", deployment: "", domains: "" });
    operation.mockResolvedValue({ state: "running", serviceVersion: "0.99.0" });
    await expect(provisionEnvironment(proposal, () => {}, proposal)).rejects.toThrow("Review the target again");
    expect(start).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it("previews a fresh environment without creating its private directories", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-fresh-"));
  const original = paths.environmentDirectory;
  vi.spyOn(paths, "environmentDirectory").mockImplementation(name => original(name, home, false));
  try {
    await expect(prepareEnvironment({ name: "fresh", deployment: "", domains: "" })).resolves.toEqual({ name: "fresh", mode: "shared", deployment: "", domains: "", version: getCliVersion(), install: true });
    expect(existsSync(join(home, ".convoy"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it.each([{ daemon: "other-engine" }, { domains: "changed.example" }, { networkMode: "open" as const }])("rejects changed resume target configuration before start: %j", async change => {
  const home = mkdtempSync(join(tmpdir(), "convoy-confirmation-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running", serviceVersion: environment.version });
  const start = vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  const form = { name: "test", deployment: "", domains: "" };
  try {
    const proposal = await prepareEnvironment(form);
    saveEnvironment(directory, { ...environment, ...change });
    await expect(provisionEnvironment(form, () => {}, proposal)).rejects.toThrow("Review the target again");
    expect(start).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it.each(["open", "strict"] as const)("passes the selected %s network policy to Docker", async networkMode => {
  const f = fixture();
  await f.controller.create({ ...environment, networkMode });
  expect(f.commands.find(args => args[0] === "create")).toContain(`DEVCONTAINER_NETWORK_MODE=${networkMode}`);
});

it("keeps legacy environments restricted and rejects a different resume policy", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-network-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  const status = vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ serviceVersion: environment.version });
  try {
    const form = { name: "test", deployment: "", domains: "", networkMode: "open" as const };
    await expect(prepareEnvironment(form)).rejects.toThrow(/network configuration/);
    expect(status).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it.each(["open", "strict"] as const)("persists %s policy and retains it when resumed without options", async networkMode => {
  const home = mkdtempSync(join(tmpdir(), "convoy-policy-"));
  const directory = environmentDirectory("test", home);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  const f = fixture();
  vi.spyOn(f.controller, "start").mockResolvedValue();
  vi.spyOn(f.controller, "operation").mockResolvedValue({});
  try {
    await runEnvironment("test", { networkMode }, f.controller);
    expect(readEnvironment(directory)?.networkMode).toBe(networkMode);
    expect((await runEnvironment("test", {}, f.controller)).networkMode).toBe(networkMode);
    await expect(runEnvironment("test", { networkMode: networkMode === "open" ? "strict" : "open" }, f.controller)).rejects.toThrow("network configuration");
    const proposal = await prepareEnvironment({ name: "test", deployment: "", domains: "" }, f.controller);
    expect(proposal.networkMode).toBe(networkMode);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

it("uses strict networking when a legacy record has no policy", async () => {
  const f = fixture();
  await f.controller.create(environment);
  expect(f.commands.find(args => args[0] === "create")).toContain("DEVCONTAINER_NETWORK_MODE=strict");
});

it("does not save a new environment when npm preflight fails", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-preflight-"));
  const directory = environmentDirectory("test", home);
  vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
  vi.spyOn(EnvironmentController.prototype, "daemon").mockResolvedValue("engine");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  const start = vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  try {
    await expect(provisionEnvironment({ name: "test", deployment: "", domains: "" }, () => {})).rejects.toThrow(/not published on npm.*convoy tui --package/s);
    expect(readEnvironment(directory)).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("creates from a local package without asking npm", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-local-"));
  const original = paths.environmentDirectory;
  vi.spyOn(paths, "environmentDirectory").mockImplementation(name => original(name, home, name === "fresh"));
  vi.spyOn(EnvironmentController.prototype, "daemon").mockResolvedValue("engine");
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  const start = vi.spyOn(EnvironmentController.prototype, "start").mockResolvedValue();
  vi.spyOn(EnvironmentController.prototype, "operation").mockResolvedValue({ state: "running" });
  try {
    const form = { name: "fresh", deployment: "", domains: "" };
    const proposal = await prepareEnvironment(form, undefined, "/tmp/cli.tgz");
    expect(proposal).toMatchObject({ install: true, localPackage: "/tmp/cli.tgz" });
    await provisionEnvironment(form, () => {}, proposal);
    expect(request).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ name: "fresh" }), "/tmp/cli.tgz");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("stopping an absent container is already stopped without creating anything", async () => {
  const f = fixture();
  await expect(f.controller.operation(environment, "stop")).resolves.toMatchObject({ stopped: true, state: "not-created" });
  expect(f.commands.map(args => args[0])).toEqual(["info", "container"]);
});

it("deletes an uncreated environment without creating Docker resources", async () => {
  const f = fixture();
  await expect(f.controller.operation(environment, "delete", { interrupt: true })).resolves.toMatchObject({ deleted: true });
  expect(f.commands.some(args => args[0] === "create")).toBe(false);
});
it("checks every volume owner before stopping or deleting an environment", async () => {
  const f = fixture();
  f.volumes.set(`${containerName(environment)}-workspace`, { [OWNER]: environment.owner, [LABEL]: environment.name });
  f.volumes.set(`${containerName(environment)}-projects`, { [OWNER]: "other", [LABEL]: environment.name });
  await expect(f.controller.operation(environment, "delete", { interrupt: true })).rejects.toThrow(/ownership/i);
  expect(f.commands.some(args => ["rm", "stop"].includes(args[0]) || args[0] === "volume" && args[1] === "rm")).toBe(false);
});
it("deletes owned volumes after gracefully stopping and removing the container", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
  await f.controller.start(environment);
  await expect(f.controller.operation(environment, "delete", { interrupt: true })).resolves.toMatchObject({ deleted: true });
  const removeContainer = f.commands.findIndex(args => args[0] === "rm");
  const removeVolume = f.commands.findIndex(args => args[0] === "volume" && args[1] === "rm");
  expect(removeContainer).toBeGreaterThan(f.commands.findIndex(args => args[0] === "stop"));
  expect(removeVolume).toBeGreaterThan(removeContainer);
  expect(f.commands.filter(args => args[0] === "volume" && args[1] === "rm")).toHaveLength(5);
});

it("deletes the legacy browsers volume it owns, and only that one", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
  const legacy = `${containerName(environment)}-browsers`;
  f.volumes.set(legacy, { [OWNER]: environment.owner, [LABEL]: environment.name });
  f.volumes.set(`${containerName(environment)}-other`, { [OWNER]: environment.owner, [LABEL]: environment.name });
  await f.controller.start(environment);
  await f.controller.operation(environment, "delete", { interrupt: true });
  const removed = f.commands.filter(args => args[0] === "volume" && args[1] === "rm").map(args => args[2]);
  expect(removed).toContain(legacy);
  expect(removed).toHaveLength(6);
});
it("refuses to delete a legacy browsers volume owned by someone else", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
  await f.controller.start(environment);
  f.volumes.set(`${containerName(environment)}-browsers`, { [OWNER]: "other", [LABEL]: environment.name });
  await expect(f.controller.operation(environment, "delete", { interrupt: true })).rejects.toThrow(/ownership/i);
  expect(f.commands.some(args => args[0] === "volume" && args[1] === "rm")).toBe(false);
});

it.each([false, true])("deletion removes the record only after Docker success, failure=%s", async failure => {
  const home = mkdtempSync(join(tmpdir(), "convoy-delete-record-"));
  const directory = environmentDirectory("test", home); saveEnvironment(directory, environment);
  const operation = vi.spyOn(EnvironmentController.prototype, "operation");
  if (failure) operation.mockRejectedValue(new Error("Volume in use"));
  else operation.mockResolvedValue({ deleted: true });
  try {
    const result = environmentMaintenance(environment, home).execute("delete", () => {});
    if (failure) { await expect(result).rejects.toThrow("Volume in use"); expect(readEnvironment(directory)).toEqual(environment); }
    else { await expect(result).resolves.toEqual({ deleted: true }); expect(readEnvironment(directory)).toBeUndefined(); }
    expect(operation).toHaveBeenCalledWith(environment, "delete", { interrupt: true });
  } finally { rmSync(home, { recursive: true, force: true }); }
});
it("does not delete resources if graceful stop fails", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue(); await f.controller.start(environment);
  const original = f.execute.getMockImplementation()!;
  f.execute.mockImplementation(args => args[0] === "exec" && args.at(-1) === "stop" ? Promise.reject(new Error("Active shell")) : original(args));
  await expect(f.controller.operation(environment, "delete", { interrupt: true })).rejects.toThrow("Active shell");
  expect(f.commands.some(args => args[0] === "rm" || args[0] === "volume" && args[1] === "rm")).toBe(false);
});
it("requires explicit confirmation before deleting resources", async () => {
  const f = fixture();
  await expect(f.controller.operation(environment, "delete")).rejects.toThrow("--interrupt");
  expect(f.commands.some(args => args[0] === "rm" || args[0] === "volume")).toBe(false);
});

it("refuses to create an environment named like a saved remote (OS-2215)", async () => {
  const home = mkdtempSync(join(tmpdir(), "convoy-clash-")), previous = process.env.HOME;
  process.env.HOME = home;
  try {
    saveRemotes([{ name: "test", host: "vm" }], home);
    const f = fixture();
    await expect(runEnvironment("test", {}, f.controller)).rejects.toThrow("Remote test already uses this name");
    expect(existsSync(join(home, ".convoy", "environments", "test", "environment.json"))).toBe(false);
  } finally { process.env.HOME = previous; rmSync(home, { recursive: true, force: true }); }
});

describe("agent runtimes", () => {
  const running = (versions: () => string, install: (script: string) => void = () => {}) => {
    const commands: string[][] = [];
    const execute = vi.fn(async (args: string[]) => {
      commands.push(args);
      if (args[0] === "info") return JSON.stringify({ ID: "engine", OSType: "linux" });
      if (args[0] === "container" && args[1] === "ls") return "id";
      if (args[0] === "container" && args[1] === "inspect") return JSON.stringify([{ Id: "id", State: { Running: true }, Config: { Labels: { [OWNER]: environment.owner, [LABEL]: environment.name } } }]);
      if (args[0] === "exec" && args.includes("--user") && args[args.indexOf("--user") + 1] === "node") return versions();
      if (args[0] === "exec") install(args.at(-1)!);
      return "";
    });
    return { controller: new EnvironmentController(execute), commands };
  };
  const npm = async (url: string | URL | Request) => new Response(JSON.stringify({ version: String(url).includes("claude-code") ? "2.1.9" : "0.156.1" }));
  it("lists installed and offered versions with a status per runtime", async () => {
    const { controller } = running(() => "claude\t2.1.3 (Claude Code)\ncodex\tcodex-cli 0.156.1\nopencode\t\ncursor-agent\t\n");
    const result = await controller.runtimes(environment, npm);
    expect(result.map(({ runtime, installed, offered, state }) => ({ runtime, installed, offered, state }))).toEqual([
      { runtime: "claude-code", installed: "2.1.3", offered: "2.1.9", state: "update" },
      { runtime: "codex", installed: "0.156.1", offered: "0.156.1", state: "current" },
      { runtime: "opencode", installed: undefined, offered: "1.19.5", state: "missing" },
      { runtime: "cursor", installed: undefined, offered: CURSOR_BUILD, state: "missing" },
      { runtime: "antigravity", installed: undefined, offered: ANTIGRAVITY_BUILD, state: "missing" },
    ]);
  });
  it("keeps the other runtimes when one npm lookup fails", async () => {
    const { controller } = running(() => "claude\t2.1.3\ncodex\t\nopencode\t\ncursor-agent\t\n");
    const result = await controller.runtimes(environment, async url => String(url).includes("codex") ? new Response("", { status: 503 }) : npm(url));
    expect(result.find(row => row.runtime === "codex")).toMatchObject({ state: "unknown", error: expect.stringContaining("npm lookup failed") });
    expect(result.find(row => row.runtime === "claude-code")).toMatchObject({ state: "update" });
  });
  it("installs the exact offered version as root with umask 022, then confirms it", async () => {
    let installed = "0.150.0";
    const { controller, commands } = running(() => `claude\t\ncodex\tcodex-cli ${installed}\nopencode\t\ncursor-agent\t\n`, () => { installed = "0.156.1"; });
    await expect(controller.installRuntime(environment, "codex", "0.156.1")).resolves.toBe("0.156.1");
    expect(commands).toContainEqual(["exec", "--user", "root", containerName(environment), "sh", "-c", "umask 022 && npm install -g --prefix /usr/local @openai/codex@0.156.1"]);
  });
  it("installs Antigravity's pinned build root-owned after checking its sha512 (OS-2474)", async () => {
    let installed = "";
    const { controller, commands } = running(() => `claude\t\ncodex\t\nopencode\t\ncursor-agent\t\nantigravity\t${installed}\n`, () => { installed = ANTIGRAVITY_BUILD; });
    await expect(controller.installRuntime(environment, "antigravity", ANTIGRAVITY_BUILD)).resolves.toBe(ANTIGRAVITY_BUILD);
    const script = commands.find(args => args.includes("root"))!.at(-1)!;
    expect(script).toMatch(/^umask 022 && /);
    expect(script).toContain(`antigravity-cli/${ANTIGRAVITY_BUILD}-`);
    expect(script).toMatch(/sha512sum -c/);
    expect(script).toContain("/usr/local/bin");
  });
  it("fails when the runtime reports another version after install", async () => {
    const { controller } = running(() => "claude\t2.1.3\ncodex\t\nopencode\t\ncursor-agent\t\n");
    await expect(controller.installRuntime(environment, "claude-code", "2.1.9")).rejects.toThrow("Claude Code reports 2.1.3 after install, not 2.1.9");
  });
  it("refuses a version other than the tested build and shell metacharacters", async () => {
    const { controller, commands } = running(() => "");
    await expect(controller.installRuntime(environment, "cursor", "2026.11.01-abc")).rejects.toThrow("tested build");
    await expect(controller.installRuntime(environment, "antigravity", "1.5.13")).rejects.toThrow("Antigravity installs only its tested build");
    await expect(controller.installRuntime(environment, "codex", "1.0.0;id")).rejects.toThrow();
    expect(commands.filter(args => args[0] === "exec")).toEqual([]);
  });
});

it("leaves legacy browser storage alone and uses only caller download domains", async () => {
  const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
  const legacy = `${containerName(environment)}-browsers`;
  f.volumes.set(legacy, { [OWNER]: environment.owner, [LABEL]: environment.name });
  await f.controller.start(environment);
  await f.controller.operation(environment, "rebuild", { interrupt: true });
  const creates = f.commands.filter(args => args[0] === "create");
  for (const args of creates) {
    expect(args.join(" ")).not.toMatch(/convoy-browsers|cdn.playwright|playwright.download|cdn.jsdelivr/);
    expect(args).toContain("DEVCONTAINER_EXTRA_ALLOWED_DOMAINS=");
  }
  expect(f.commands.filter(args => args[0] === "volume").flat()).not.toContain(legacy);
  expect(f.volumes.has(legacy)).toBe(true);
});

it("refuses to build an unpublished release from npm and names --package", async () => {
  const f = fixture();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
  await expect(f.controller.build({ ...environment, version: "0.139.0" })).rejects.toThrow(/not published on npm.*--package/s);
  expect(f.commands.some(args => args[0] === "build")).toBe(false);
});

describe("shared Docker environments (OS-2251)", () => {
  const shared: Environment = { ...environment, mode: "shared", mounts: ["/Users/me/code"] };
  const mountArgs = (args: string[]) => args.flatMap((arg, i) => arg === "--mount" ? [args[i + 1]] : []);
  const options = (args: string[]) => args.filter((arg, i) => arg.startsWith("--cap-add") || args[i - 1] === "--security-opt");
  const projects = (f: ReturnType<typeof fixture>, rows: { profile: string; path: string }[]) => {
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async args => args.includes("list") && args.includes("--json") ? JSON.stringify(rows) : original(args));
  };
  it("creates one home volume and mounts each host folder at its own path, with the isolated security options", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const f = fixture();
    await f.controller.create(shared);
    await f.controller.create(environment);
    const [sharedCreate, isolatedCreate] = f.commands.filter(args => args[0] === "create");
    const name = containerName(environment);
    expect(mountArgs(sharedCreate)).toEqual([`type=volume,source=${name}-workspace,target=/workspace`, `type=volume,source=${name}-home,target=/home/node`,
      `type=volume,source=${name}-installation,target=/opt/convoy`, "type=bind,source=/Users/me/code,target=/Users/me/code"]);
    expect(options(sharedCreate)).toEqual(options(isolatedCreate));
    expect(mountArgs(isolatedCreate).join(" ")).not.toContain("type=bind");
  });
  it("checks the folders again before creating the container", async () => {
    const f = fixture();
    vi.spyOn(paths, "resolveMounts").mockImplementation(() => { throw new Error("Mount folder /Users/me/code does not exist."); });
    await expect(f.controller.create(shared)).rejects.toThrow("does not exist");
    await expect(f.controller.create({ ...environment, mounts: ["/Users/me/code"] })).rejects.toThrow(/Isolated environments/);
    expect(f.commands.some(args => args[0] === "create")).toBe(false);
  });
  it.each([["linux", 1234, "usermod -o -u 1234 -g 1234 node"], ["linux", 0, undefined], ["linux", 1000, undefined], ["darwin", 501, undefined]] as const)(
    "on %s with uid %s builds the shared image for the host user", async (platform, uid, expected) => {
      const f = fixture();
      let dockerfile = "", record = "";
      const original = f.execute.getMockImplementation()!;
      f.execute.mockImplementation(async args => {
        if (args[0] === "build") { dockerfile = readFileSync(join(args.at(-1)!, "Dockerfile"), "utf8"); record = readFileSync(join(args.at(-1)!, "convoy-environment.json"), "utf8"); }
        return original(args);
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ name: "@useconvoy/cli", version: environment.version })));
      vi.spyOn(process, "getuid").mockReturnValue(uid); vi.spyOn(process, "getgid").mockReturnValue(uid);
      const previous = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", { value: platform });
      try { await f.controller.build(shared); } finally { Object.defineProperty(process, "platform", previous); }
      expect(JSON.parse(record)).toEqual({ mode: "shared", mounts: ["/Users/me/code"] });
      expect(dockerfile).toContain("COPY convoy-environment.json /etc/convoy-environment.json");
      expect(dockerfile).toContain("chown -R node:node /home/node /workspace");
      if (expected) expect(dockerfile).toContain(expected); else expect(dockerfile).not.toContain("usermod");
    });
  it("builds an isolated image for uid 1000 and records its mode", async () => {
    const f = fixture();
    let dockerfile = "", record = "";
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async args => {
      if (args[0] === "build") { dockerfile = readFileSync(join(args.at(-1)!, "Dockerfile"), "utf8"); record = readFileSync(join(args.at(-1)!, "convoy-environment.json"), "utf8"); }
      return original(args);
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ name: "@useconvoy/cli", version: environment.version })));
    vi.spyOn(process, "getuid").mockReturnValue(1234);
    await f.controller.build(environment);
    expect(JSON.parse(record)).toEqual({ mode: "isolated", mounts: [] });
    expect(dockerfile).toContain('ENTRYPOINT ["/bin/sh","-c","python3 -I /usr/local/libexec/convoy-environment start || echo');
    expect(dockerfile).toMatch(/; exec sleep infinity"\]\n$/);
    expect(dockerfile).not.toMatch(/usermod|chown -R node:node \/home\/node/);
  });
  it("rebuild replaces the mounts and refuses to drop one that holds a project", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
    await f.controller.start(shared);
    projects(f, [{ profile: "app", path: "/Users/me/code/app" }, { profile: "local", path: "/workspace/local" }]);
    const target = { ...shared };
    await expect(f.controller.operation(target, "rebuild", { interrupt: true, mounts: ["/Users/me/work"] })).rejects.toThrow(/app.*\/Users\/me\/code/);
    await expect(f.controller.operation(target, "rebuild", { interrupt: true, mounts: [] })).rejects.toThrow(/app/);
    expect(f.creates()).toBe(1);
    expect(target.mounts).toEqual(["/Users/me/code"]);
    await f.controller.operation(target, "rebuild", { interrupt: true, mounts: ["/Users/me/code", "/Users/me/work"] });
    expect(target.mounts).toEqual(["/Users/me/code", "/Users/me/work"]);
    expect(mountArgs(f.commands.filter(args => args[0] === "create").at(-1)!).filter(arg => arg.startsWith("type=bind"))).toHaveLength(2);
  });
  it("rebuild checks the saved mounts before stopping anything (round 1 #2)", async () => {
    const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
    const check = vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    await f.controller.start(shared);
    check.mockImplementation(() => { throw new Error("Mount folder /Users/me/code does not exist."); });
    const before = f.commands.length;
    await expect(f.controller.operation({ ...shared }, "rebuild", { interrupt: true })).rejects.toThrow("does not exist");
    expect(f.commands.slice(before).some(args => args[0] === "stop" || args[0] === "rm" || args.at(-1) === "stop")).toBe(false);
  });
  it("rebuild changes the mounts only once the old container is gone (round 1 #3)", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const f = fixture(); const build = vi.spyOn(f.controller, "build").mockResolvedValue();
    await f.controller.start(shared);
    build.mockRejectedValueOnce(new Error("build failed"));
    const target = { ...shared };
    await expect(f.controller.operation(target, "rebuild", { interrupt: true, mounts: ["/Users/me/code", "/Users/me/work"] })).rejects.toThrow("build failed");
    expect(target.mounts).toEqual(["/Users/me/code"]);
  });
  it("rebuild rereads projects after the build, so one registered meanwhile keeps its mount (round 2 #1)", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const f = fixture(); const build = vi.spyOn(f.controller, "build").mockResolvedValue();
    await f.controller.start(shared);
    const rows: { profile: string; path: string }[] = [];
    projects(f, rows);
    build.mockImplementation(async () => { rows.push({ profile: "late", path: "/Users/me/code/app" }); });
    const before = f.commands.length;
    await expect(f.controller.operation({ ...shared }, "rebuild", { interrupt: true, mounts: [] })).rejects.toThrow(/late/);
    expect(f.commands.slice(before).some(args => args[0] === "rm")).toBe(false);
  });
  it("rebuild keeps the saved mounts without --mount and refuses mounts on an isolated environment", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const f = fixture(); vi.spyOn(f.controller, "build").mockResolvedValue();
    await f.controller.start(shared);
    const target = { ...shared };
    await f.controller.operation(target, "rebuild", { interrupt: true });
    expect(target.mounts).toEqual(["/Users/me/code"]);
    expect(f.commands.some(args => args.includes("list"))).toBe(false);
    await expect(f.controller.operation({ ...environment }, "rebuild", { interrupt: true, mounts: ["/Users/me/code"] })).rejects.toThrow(/Isolated environments/);
  });
  it("creates shared environments by default, keeps the saved mode and refuses another", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders);
    const home = mkdtempSync(join(tmpdir(), "convoy-mode-"));
    const directory = environmentDirectory("test", home);
    vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
    const f = fixture();
    vi.spyOn(f.controller, "start").mockResolvedValue();
    vi.spyOn(f.controller, "operation").mockResolvedValue({});
    try {
      await runEnvironment("test", { mounts: ["/Users/me/code"] }, f.controller);
      expect(readEnvironment(directory)).toMatchObject({ mode: "shared", mounts: ["/Users/me/code"] });
      await expect(runEnvironment("test", {}, f.controller)).resolves.toMatchObject({ mode: "shared" });
      await expect(runEnvironment("test", { mode: "isolated" }, f.controller)).rejects.toThrow(/shared.*new environment/);
      await expect(runEnvironment("test", { mounts: ["/Users/me/work"] }, f.controller)).rejects.toThrow(/environment rebuild --env test --mount/);
      saveEnvironment(directory, environment);
      await expect(runEnvironment("test", {}, f.controller)).resolves.not.toHaveProperty("mode");
      await expect(runEnvironment("test", { mode: "shared" }, f.controller)).rejects.toThrow(/isolated.*new environment/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  it("refuses mounts for a new isolated environment before saving it", async () => {
    const home = mkdtempSync(join(tmpdir(), "convoy-mode-"));
    const directory = environmentDirectory("test", home);
    vi.spyOn(paths, "environmentDirectory").mockReturnValue(directory);
    const f = fixture();
    try {
      await expect(runEnvironment("test", { mode: "isolated", mounts: ["/Users/me/code"] }, f.controller)).rejects.toThrow(/Isolated environments/);
      expect(readEnvironment(directory)).toBeUndefined();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  it("shows the mode and resolved mounts in the TUI proposal", async () => {
    vi.spyOn(paths, "resolveMounts").mockImplementation(folders => folders.map(folder => folder.replace("~", "/Users/me")));
    const home = mkdtempSync(join(tmpdir(), "convoy-fresh-"));
    const original = paths.environmentDirectory;
    vi.spyOn(paths, "environmentDirectory").mockImplementation(name => original(name, home, false));
    try {
      await expect(prepareEnvironment({ name: "fresh", deployment: "", domains: "", mode: "shared", mounts: ["~/code"] }))
        .resolves.toMatchObject({ mode: "shared", mounts: ["/Users/me/code"], install: true });
      await expect(prepareEnvironment({ name: "fresh", deployment: "", domains: "", mode: "isolated", mounts: ["~/code"] })).rejects.toThrow(/Isolated environments/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
