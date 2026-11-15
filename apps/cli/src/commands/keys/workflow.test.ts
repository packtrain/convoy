import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), inspect: vi.fn(), mutate: vi.fn(), allow: vi.fn(), projectEnvironment: true, mode: "isolated" as "shared" | "isolated", target: undefined as { name: string } | undefined }));
vi.mock("../environment/index.js", () => ({
  targetEnvironment: () => mocks.target,
  targetCommands: { allowDomain: mocks.allow, credentialStatus: vi.fn() },
}));
vi.mock("../../lib/config/credentials/store.js", () => ({
  CredentialStore: class {
    read() {
      return { entries: {}, bindings: { a: { mode: "native" } }, claudeBindings: { a: { mode: "native" }, b: { mode: "disabled" } } };
    }
  },
}));
vi.mock("../../lib/config/index.js", () => ({
  readConfig: () => ({ profiles: {} }),
  resolveProfile: () => ({ key: "a" }),
}));
vi.mock("../service/paths.js", () => ({ servicePaths: () => ({ socket: "/fixture.sock" }) }));
vi.mock("../service/client.js", () => ({ serviceRequest: mocks.request, serviceEndpoint: () => "/target.sock" }));
vi.mock("../environment/resolution.js", () => ({ environmentMode: () => mocks.mode }));
vi.mock("../project/launcher.js", () => ({ isProjectEnvironment: () => mocks.projectEnvironment, inspectProjectEnvironmentAsync: mocks.inspect }));
vi.mock("../../lib/config/credentials/resolution.js", () => ({
  mutateCredentials: mocks.mutate,
  assertCredentialNames: vi.fn(),
  authDescriptor: vi.fn(),
}));
import { changeCredentials, inputSecret, printManagedStatus, managedStatus } from "./workflow.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { ServiceUnavailableError } from "../service/errors.js";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.target = undefined;
  mocks.projectEnvironment = true;
  mocks.mode = "isolated";
  mocks.inspect.mockResolvedValue({ capabilities: ["credentials-v1"], workspace: "/workspace", registrations: [] });
});
describe("managed credential commands", () => {
  it("writes offline only when service is unavailable before a mutation", async () => {
    mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
    expect(await changeCredentials({ action: "disable", name: "work" })).toMatchObject({ offline: true, applied: false });
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });
  it("does not send a secret to an old service or silently write offline", async () => {
    mocks.request.mockResolvedValueOnce({ profiles: [] });
    await expect(changeCredentials({ action: "add", name: "work", secret: "sentinel" })).rejects.toThrow("updated service");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("never replays a mutation whose service response was lost", async () => {
    mocks.request.mockResolvedValueOnce({ capabilities: ["credentials-v1"] }).mockRejectedValueOnce(new Error("outcome unknown"));
    await expect(changeCredentials({ action: "rotate", name: "work", secret: "sentinel" })).rejects.toThrow("outcome unknown");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("refuses old launchers before sending credentials", async () => {
    mocks.inspect.mockResolvedValueOnce({ capabilities: [] });
    await expect(changeCredentials({ action: "add", name: "work", secret: "sentinel" })).rejects.toThrow("updated launcher");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("imports a named variable and rejects ambiguous or argument input", async () => {
    vi.stubEnv("CONVOY_TEST_MANAGED_SECRET", "sentinel");
    try {
      expect(await inputSecret({ fromEnv: "CONVOY_TEST_MANAGED_SECRET" })).toBe("sentinel");
      await expect(inputSecret({ token: "sentinel" })).rejects.toThrow("token arguments");
      await expect(inputSecret({ fromEnv: "CONVOY_TEST_MANAGED_SECRET", stdin: true })).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

it("reports an unobserved applied state without claiming a pending change", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  printManagedStatus({
    service: false,
    compatible: true,
    configurationError: false,
    entries: [],
    projects: [
      {
        identity: "a",
        profiles: ["a"],
        desired: { mode: "native" },
        state: "direct/unknown",
        pending: undefined,
        applied: undefined,
        authResult: undefined,
        verified: false,
      },
    ],
  });
  expect(log.mock.calls.flat().join("\n")).toContain("applied unknown");
  log.mockRestore();
});

it.each([false, true])("leaves applied state unknown for an unobserved direct worker: %s", async (active) => {
  mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
  mocks.inspect.mockResolvedValueOnce({ registrations: [{ identity: "a", active }] });
  const status = await managedStatus();
  expect(status.projects[0].pending).toBeUndefined();
  expect(status.projects[0].applied).toBeUndefined();
  expect(status.projects[0].state).toBe(active ? "direct/unknown" : "offline");
});

it.each([
  ["mantle", "eu-west-1", "bedrock-mantle.eu-west-1.api.aws"],
  ["bedrock", "us-west-2", "bedrock-runtime.us-west-2.amazonaws.com"],
] as const)("opens the %s endpoint in a target environment before adding the key (OS-2107)", async (provider, region, host) => {
  mocks.target = { name: "env" };
  mocks.request.mockImplementationOnce(async () => {
    expect(mocks.allow).toHaveBeenCalledWith(mocks.target, host);
    return { registered: true, applied: true };
  });
  await changeCredentials({ action: "add", name: "work", secret: "sentinel", aws: { provider, region } });
  expect(mocks.request).toHaveBeenCalledOnce();
});

it("labels a managed AWS entry with its provider and region (OS-2107)", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  printManagedStatus({
    service: false, compatible: true, configurationError: false, projects: [],
    entries: [{ name: "work", provider: "mantle", region: "eu-west-1", auth: "api-key", billing: "AWS", enabled: true, revision: 1, retainedRevisions: [1] }],
  });
  expect(log.mock.calls.flat().join("\n")).toContain("work: AWS Bedrock (Mantle), eu-west-1, enabled, revision 1");
  log.mockRestore();
});

it("labels managed Anthropic and OpenAI entries by billing (OS-2016)", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const entry = { auth: "api-key", billing: "API usage", enabled: true, revision: 1, retainedRevisions: [1] };
  printManagedStatus({
    service: false, compatible: true, configurationError: false, projects: [],
    entries: [{ name: "claude", provider: "anthropic", ...entry }, { name: "codex", provider: "openai", ...entry }],
  });
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain("claude: Anthropic API usage, enabled, revision 1");
  expect(output).toContain("codex: OpenAI API usage, enabled, revision 1");
  log.mockRestore();
});

it("refuses outside a project environment before asking for the key, and names --env", async () => {
  mocks.projectEnvironment = false;
  vi.stubEnv("CONVOY_TEST_MANAGED_SECRET", "sentinel");
  try {
    await expect(inputSecret({ fromEnv: "CONVOY_TEST_MANAGED_SECRET" })).rejects.toThrow("--env <name>");
  } finally {
    vi.unstubAllEnvs();
  }
});

describe("shared environment (OS-2248)", () => {
  beforeEach(() => { mocks.mode = "shared"; mocks.projectEnvironment = false; });
  it("manages keys without the launcher: offline writes the store, a running service applies them", async () => {
    vi.stubEnv("CONVOY_TEST_MANAGED_SECRET", "sentinel");
    try { await expect(inputSecret({ fromEnv: "CONVOY_TEST_MANAGED_SECRET" })).resolves.toBe("sentinel"); }
    finally { vi.unstubAllEnvs(); }
    mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
    expect(await changeCredentials({ action: "disable", name: "work" })).toMatchObject({ offline: true, applied: false });
    expect(mocks.mutate).toHaveBeenCalledWith({ action: "disable", name: "work" }, "shared");
    mocks.request.mockResolvedValueOnce({ capabilities: ["credentials-v1", "credentials-shared-v1"] }).mockResolvedValueOnce({ registered: true, applied: true });
    expect(await changeCredentials({ action: "disable", name: "work" })).toMatchObject({ applied: true, offline: false });
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("names a restart when the running service predates shared credentials", async () => {
    mocks.request.mockResolvedValue({ capabilities: ["credentials-v1"] });
    await expect(changeCredentials({ action: "disable", name: "work" })).rejects.toThrow("This service predates shared-environment credentials. Restart it: convoy service stop, then convoy service start.");
    expect((await managedStatus()).compatible).toBe(false);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("reports status without the launcher registry", async () => {
    mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
    const status = await managedStatus();
    expect(status.projects.map(project => project.identity)).toEqual(["a", "b"]);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});

it("lists Claude Code bindings beside Codex's (OS-2108)", async () => {
  mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
  mocks.inspect.mockResolvedValueOnce({ registrations: [] });
  expect((await managedStatus()).projects.map((p) => p.identity)).toEqual(["a", "b"]);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  printManagedStatus({
    service: false, compatible: true, configurationError: false, entries: [],
    projects: [{ identity: "a", profiles: ["a"], desired: { mode: "native", claude: { mode: "managed", name: "work", revision: 2 } },
      state: "offline", pending: undefined, applied: undefined, authResult: undefined, verified: false }],
  });
  expect(log.mock.calls.flat().join("\n")).toContain("; Claude Code managed, desired 2, applied unknown");
  log.mockRestore();
});

it("lists Cursor bindings and labels a Cursor key by its account billing (OS-2017)", async () => {
  mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
  mocks.inspect.mockResolvedValueOnce({ registrations: [] });
  vi.spyOn(CredentialStore.prototype, "read").mockReturnValueOnce({
    version: 1, generation: 1, bindings: {}, cursorBindings: { c: { mode: "managed", name: "cursor" } },
    entries: { cursor: { id: "id", enabled: true, current: 1, provider: "cursor", revisions: [{ revision: 1, secret: "s", createdAt: 1 }] } },
  });
  const status = await managedStatus();
  expect(status.projects.map((p) => p.identity)).toEqual(["c"]);
  expect(status.entries[0]).toMatchObject({ provider: "cursor", billing: "Cursor account" });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  printManagedStatus({
    ...status,
    projects: [{ identity: "c", profiles: ["c"], desired: { mode: "native", cursor: { mode: "managed", name: "cursor", revision: 1 } },
      state: "online", pending: false, applied: { mode: "native", cursor: { mode: "managed", name: "cursor", revision: 1 } }, authResult: undefined, verified: false }],
  });
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain("cursor: Cursor account key, billed to its Cursor account, enabled, revision 1");
  expect(output).toContain("; Cursor managed, desired 1, applied 1");
  log.mockRestore();
});

it("lists OpenCode slots, and a project with only OpenCode bound (OS-2018)", async () => {
  mocks.request.mockRejectedValueOnce(new ServiceUnavailableError("offline"));
  mocks.inspect.mockResolvedValueOnce({ registrations: [] });
  vi.spyOn(CredentialStore.prototype, "read").mockReturnValueOnce({
    version: 1, generation: 1, bindings: {}, opencodeBindings: { o: { openai: "work" } },
    entries: { work: { id: "id", enabled: true, current: 1, revisions: [{ revision: 1, secret: "s", createdAt: 1 }] } },
  });
  expect((await managedStatus()).projects.map((p) => p.identity)).toEqual(["o"]);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const slot = (revision: number) => ({ mode: "managed" as const, name: "work", revision });
  const project = { identity: "o", profiles: ["o"], state: "online", pending: true, authResult: undefined, verified: false };
  printManagedStatus({ service: true, compatible: true, configurationError: false, entries: [], projects: [
    { ...project, desired: { mode: "native", opencode: { openai: slot(2), anthropic: slot(1) } }, applied: { mode: "native", opencode: { openai: slot(1) } } },
    { ...project, profiles: ["d"], desired: { mode: "native", opencode: {} }, applied: { mode: "native", opencode: {} }, pending: false },
  ] });
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain("; OpenCode OpenAI managed, desired 2, applied 1; OpenCode Anthropic managed, desired 1, applied none");
  expect(output).toContain("; OpenCode disabled");
  log.mockRestore();
});
