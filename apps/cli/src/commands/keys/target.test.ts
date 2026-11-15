import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), config: vi.fn(), local: vi.fn(), ssh: vi.fn() }));
vi.mock("../service/client.js", () => ({ serviceRequest: mocks.request, serviceEndpoint: () => "target-bridge" }));
vi.mock("../remote/ssh.js", () => ({ sshRun: mocks.ssh, sshBridge: vi.fn(), sshForward: vi.fn(), remoteVersion: vi.fn() }));
vi.mock("../environment/resolution.js", async (actual) => ({ ...await actual<object>(), environmentMode: () => "isolated" }));
vi.mock("../project/launcher.js", () => ({ isProjectEnvironment: () => false, inspectProjectEnvironmentAsync: vi.fn() }));
vi.mock("../../lib/config/index.js", () => ({ readConfig: mocks.config, resolveProfile: mocks.config }));
vi.mock("../../lib/config/credentials/resolution.js", () => ({ mutateCredentials: mocks.local, assertCredentialNames: vi.fn(), authDescriptor: vi.fn() }));
import { setTargetEnvironment } from "../environment/resolution.js";
import { setTargetRemote } from "../remote/resolution.js";
import { changeCredentials, managedProfile, managedStatus, runManagedCommand } from "./workflow.js";
afterEach(() => { setTargetEnvironment(); setTargetRemote(); vi.clearAllMocks(); });
const target = { schema: 1 as const, name: "demo", owner: "00000000-0000-4000-8000-000000000000", daemon: "engine", version: "0.75.0", deployment: "demo", domains: "" };
it("mutates credentials through the selected service without reading or writing host profiles", async () => {
  setTargetEnvironment(target); mocks.config.mockReturnValue({ key: "host-profile" }); mocks.request.mockResolvedValue({ registered: true, applied: false });
  expect(managedProfile("a")).toBe("a");
  await expect(changeCredentials({ action: "add", name: "work", secret: "private-fixture-key" })).resolves.toMatchObject({ registered: true });
  expect(mocks.request).toHaveBeenCalledWith("target-bridge", { op: "credentials.mutate", credentials: { action: "add", name: "work", secret: "private-fixture-key" } });
  expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
});
it("does not fall back to host credential writes after a lost target reply", async () => {
  setTargetEnvironment(target); mocks.request.mockRejectedValue(new Error("outcome unknown"));
  await expect(changeCredentials({ action: "disable", name: "work" })).rejects.toThrow("outcome unknown");
  expect(mocks.local).not.toHaveBeenCalled();
});
const remote = { name: "vm", host: "dev@vm" };
it("mutates a remote's credentials over its SSH bridge, never host storage (OS-2020)", async () => {
  setTargetRemote(remote); mocks.request.mockResolvedValue({ registered: true, applied: false });
  expect(() => managedProfile()).toThrow("--profile");
  await expect(changeCredentials({ action: "rotate", name: "work", secret: "private-fixture-key" })).resolves.toMatchObject({ registered: true, offline: false });
  expect(mocks.request).toHaveBeenCalledWith("target-bridge", { op: "credentials.mutate", credentials: { action: "rotate", name: "work", secret: "private-fixture-key" } });
  expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
});
it("does not replay a remote mutation locally after a lost reply (OS-2020)", async () => {
  setTargetRemote(remote); mocks.request.mockRejectedValue(new Error("outcome unknown"));
  await expect(changeCredentials({ action: "disable", name: "work" })).rejects.toThrow("outcome unknown");
  expect(mocks.local).not.toHaveBeenCalled();
});
it("reads remote status with the remote's own keys status (OS-2020)", async () => {
  setTargetRemote(remote);
  mocks.ssh.mockResolvedValue(JSON.stringify({ service: true, compatible: true, configurationError: false, entries: [], projects: [] }));
  await expect(managedStatus()).resolves.toMatchObject({ service: true });
  expect(mocks.ssh).toHaveBeenCalledWith(remote, ["keys", "status", "--json"]);
  expect(mocks.config).not.toHaveBeenCalled();
});
it("names the remote in follow-up hints and the AWS endpoint note (OS-2020)", async () => {
  setTargetRemote(remote); mocks.request.mockResolvedValue({ registered: true, applied: false });
  const log = vi.spyOn(console, "log").mockImplementation(() => {}), error = vi.spyOn(console, "error").mockImplementation(() => {});
  await runManagedCommand(() => changeCredentials({ action: "add", name: "aws", secret: "private-fixture-key", aws: { provider: "mantle", region: "us-east-1" } }));
  expect(error).toHaveBeenCalledWith("If outbound access is restricted, allow bedrock-mantle.us-east-1.api.aws on vm.");
  expect(log).toHaveBeenCalledWith(expect.stringContaining("convoy keys status --remote vm,"));
  log.mockRestore(); error.mockRestore();
});
it("prints the AWS endpoint note only after the remote stored the key (OS-2020)", async () => {
  setTargetRemote(remote); mocks.request.mockRejectedValue(new Error("Service unavailable."));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await runManagedCommand(() => changeCredentials({ action: "add", name: "aws", secret: "private-fixture-key", aws: { provider: "mantle", region: "us-east-1" } }));
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining("If outbound access is restricted"));
  error.mockRestore(); process.exitCode = undefined;
});
it("points an isolated host outside its launcher at --env and --remote (OS-2020)", async () => {
  await expect(changeCredentials({ action: "disable", name: "work" })).rejects.toThrow("add --env <name> or --remote <name>");
});
