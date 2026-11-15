import { Command } from "commander";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), load: vi.fn(), run: vi.fn(), operation: vi.fn(), save: vi.fn() }));
vi.mock("../service/client.js", () => ({ configureServiceTransport: vi.fn(), ServiceClient: { open: mocks.open } }));
vi.mock("./docker.js", () => ({ bridge: vi.fn() }));
vi.mock("./workflow.js", () => ({ loadEnvironment: mocks.load, runEnvironment: mocks.run, EnvironmentController: class { operation = mocks.operation; } }));
vi.mock("./paths.js", () => ({ environmentDirectory: () => "/state", readEnvironment: () => ({ name: "demo" }), saveEnvironment: mocks.save, withEnvironmentLock: (_: string, action: () => Promise<unknown>) => action() }));
import { registerEnvironmentCommands } from "./command.js";
it("does not require a live service handshake to inspect retained operational logs", async () => {
  mocks.load.mockResolvedValue({ name: "demo" }); mocks.open.mockRejectedValue(new Error("Service unavailable"));
  const command = new Command(); const logs = vi.fn();
  command.command("service").command("logs").action(logs);
  registerEnvironmentCommands(command);
  await command.parseAsync(["service", "logs", "--environment", "demo"], { from: "user" });
  expect(logs).toHaveBeenCalledOnce(); expect(mocks.open).not.toHaveBeenCalled();
});

it.each(["environment", "env"])("accepts %s status with --env as the required environment", async (name) => {
  const program = new Command().exitOverride();
  registerEnvironmentCommands(program);
  const status = program.commands.find(c => c.name() === "environment")!.commands.find(c => c.name() === "status")!;
  const action = vi.fn();
  status.action(action);
  await program.parseAsync([name, "status", "--env", "demo"], { from: "user" });
  expect(action.mock.calls[0][0].environment).toBe("demo");
});

it("accepts both option spellings on run and every target command", () => {
  for (const flag of ["--environment", "--env"]) {
    const program = new Command();
    for (const name of ["attach", "service", "project", "keys"]) {
      program.command(name).command("child").command("nested");
    }
    registerEnvironmentCommands(program);
    const visit = (command: Command) => {
      if (command.name() !== "environment") {
        expect(command.parseOptions([flag, "demo"]).unknown).toEqual([]);
        expect(command.opts().environment).toBe("demo");
        expect(command.opts()).not.toHaveProperty("env");
      }
      command.commands.forEach(visit);
    };
    program.commands.forEach(visit);
  }
});

it("accepts a local package without a published version", async () => {
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerEnvironmentCommands(program);
  const update = program.commands.find(c => c.name() === "environment")!.commands.find(c => c.name() === "update")!;
  const action = vi.fn(); update.action(action);
  await program.parseAsync(["env", "update", "--env", "test", "--package", "/tmp/local package.tgz", "--interrupt"], { from: "user" });
  expect(action.mock.calls[0][0]).toMatchObject({ package: "/tmp/local package.tgz", interrupt: true });
});

it("leaves targeted keys rules to the keys command, so --env accepts an Anthropic key like --remote (OS-2020)", async () => {
  mocks.load.mockResolvedValue({ name: "demo" });
  mocks.open.mockResolvedValue({ hello: { capabilities: ["host-cli-v1"] }, close: vi.fn() });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const command = new Command(); const add = vi.fn();
  command.command("keys").command("add <name>").option("--provider <provider>").option("--auth <mode>").action(add);
  registerEnvironmentCommands(command);
  await command.parseAsync(["keys", "add", "work", "--provider", "anthropic", "--auth", "api-key", "--env", "demo"], { from: "user" });
  expect(add).toHaveBeenCalledOnce(); error.mockRestore();
});

it("passes --mode and repeated --mount to run", async () => {
  mocks.run.mockResolvedValue({ name: "demo" }); mocks.operation.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  const program = new Command().exitOverride().configureOutput({ writeErr: () => {} });
  registerEnvironmentCommands(program);
  await program.parseAsync(["run", "--env", "demo", "--mode", "shared", "--mount", "/a", "--mount", "/b", "--no-attach"], { from: "user" });
  expect(mocks.run).toHaveBeenCalledWith("demo", expect.objectContaining({ mode: "shared", mounts: ["/a", "/b"] }));
});

it.each([[["--mount", "/a", "--mount", "/b"], ["/a", "/b"]], [["--no-mounts"], []], [[], undefined]])("rebuild %j replaces, clears or keeps the mounts", async (flags, mounts) => {
  mocks.operation.mockReset().mockResolvedValue({}); vi.spyOn(console, "log").mockImplementation(() => {});
  const program = new Command().exitOverride();
  registerEnvironmentCommands(program);
  await program.parseAsync(["env", "rebuild", "--env", "demo", "--interrupt", ...flags], { from: "user" });
  expect(mocks.operation.mock.calls[0][2].mounts).toEqual(mounts);
});

it("rebuild refuses --mount with --no-mounts", async () => {
  mocks.operation.mockReset(); const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const program = new Command().exitOverride();
  registerEnvironmentCommands(program);
  await program.parseAsync(["env", "rebuild", "--env", "demo", "--interrupt", "--mount", "/a", "--no-mounts"], { from: "user" });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("--no-mounts"));
  expect(mocks.operation).not.toHaveBeenCalled();
  process.exitCode = 0;
});

it("saves the record after a failed rebuild, so it describes the container that now exists (round 1 #3)", async () => {
  mocks.save.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.operation.mockReset().mockImplementation(async (environment: { mounts?: string[] }) => { environment.mounts = ["/b"]; throw new Error("start failed"); });
  const program = new Command().exitOverride();
  registerEnvironmentCommands(program);
  await program.parseAsync(["env", "rebuild", "--env", "demo", "--interrupt", "--mount", "/b"], { from: "user" });
  expect(mocks.save).toHaveBeenCalledWith("/state", expect.objectContaining({ mounts: ["/b"] }));
  process.exitCode = 0;
});
