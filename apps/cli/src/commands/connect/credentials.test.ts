import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ directory: "", launch: vi.fn(), runner: vi.fn(), states: vi.fn(), mode: "isolated", profile: {} as Record<string, unknown> }));
vi.mock("../project/launcher.js", () => ({ isProjectEnvironment: () => true, launchProject: mocks.launch, sharedRuntimeStates: mocks.states }));
vi.mock("../environment/resolution.js", () => ({ environmentMode: () => mocks.mode }));
vi.mock("../service/paths.js", async (actual) => ({ ...await actual<object>(), leasePath: (identity: string) => join(mocks.directory, `${identity}.lease`) }));
vi.mock("../../agent/app/runner.js", () => ({
  createAgentRunner: mocks.runner, ConnectDiagnosticError: class extends Error {}, SessionConflictError: class extends Error {},
}));
vi.mock("../../lib/config/index.js", () => ({ getProfileByKey: () => mocks.profile }));
vi.mock("../../lib/config/toml.js", () => ({
  getConfigPath: () => join(mocks.directory, "config.toml"),
  readConfig: () => ({ keys: {} }),
}));
import { runConnect } from "./workflow.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";
import { projectIdentity } from "../project/validators.js";
const identity = projectIdentity("https://example.convex.cloud", "org", "a");
const config = { profileKey: "a", convexUrl: "https://example.convex.cloud", apiKey: "convoy-key", projectId: "a", paths: ["/work/a"] };
beforeEach(() => {
  mocks.directory = mkdtempSync(join(tmpdir(), "direct-auth-"));
  mocks.launch.mockReset();
  mocks.mode = "isolated";
  mocks.profile = {
    name: "A",
    url: config.convexUrl,
    api_key: config.apiKey,
    project_id: "a",
    paths: config.paths,
    project_isolation: { identity, organization_id: "org" },
  };
});
afterEach(() => rmSync(mocks.directory, { recursive: true, force: true }));
it("permits exec mode after explicit native restoration", async () => {
  new CredentialStore().mutate((data) => {
    data.bindings[identity] = { mode: "native" };
  });
  await runConnect({ ...config, codexAppServer: false });
  expect(mocks.launch).toHaveBeenCalledWith(identity, { config: expect.objectContaining({ codexAppServer: false }) });
  expect(mocks.launch.mock.calls[0][1].config).not.toHaveProperty("codexAuth");
});
it.each(["disabled", "managed"] as const)("rejects exec-mode bypass for %s auth", async (mode) => {
  new CredentialStore().mutate((data) => {
    data.entries.work = { id: "entry", current: 1, enabled: true, revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
    data.bindings[identity] = mode === "managed" ? { mode, name: "work" } : { mode };
  });
  await expect(runConnect({ ...config, codexAppServer: false })).rejects.toThrow("app-server");
  expect(mocks.launch).not.toHaveBeenCalled();
});
it("delivers only the assigned key to a direct app-server worker", async () => {
  new CredentialStore().mutate((data) => {
    data.entries.work = { id: "entry", current: 1, enabled: true, revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
    data.bindings[identity] = { mode: "managed", name: "work" };
  });
  await runConnect({ ...config, codexAppServer: true });
  expect(mocks.launch).toHaveBeenCalledWith(identity, {
    config: expect.objectContaining({ codexAuth: { mode: "managed", secret: "dummy" } }),
  });
});
it("delivers a Claude Code key to a direct worker, exec mode or not (OS-2108)", async () => {
  new CredentialStore().mutate((data) => {
    data.entries.work = { id: "entry", current: 1, enabled: true, aws: { provider: "mantle", region: "us-east-1" },
      revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
    data.claudeBindings = { [identity]: { mode: "managed", name: "work" } };
  });
  await runConnect({ ...config, codexAppServer: false });
  expect(mocks.launch.mock.calls[0][1].config).toMatchObject({ claudeAuth: { mode: "mantle", secret: "dummy", region: "us-east-1" } });
  expect(mocks.launch.mock.calls[0][1].config).not.toHaveProperty("codexAuth");
});
it("delivers a Cursor key to a direct worker, exec mode or not (OS-2017)", async () => {
  new CredentialStore().mutate((data) => {
    data.entries.work = { id: "entry", current: 1, enabled: true, provider: "cursor", revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
    data.cursorBindings = { [identity]: { mode: "managed", name: "work" } };
  });
  await runConnect({ ...config, codexAppServer: false });
  expect(mocks.launch.mock.calls[0][1].config).toMatchObject({ cursorAuth: { mode: "managed", secret: "dummy" } });
  expect(mocks.launch.mock.calls[0][1].config).not.toHaveProperty("codexAuth");
});
it("delivers OpenCode keys to a direct worker (OS-2018)", async () => {
  new CredentialStore().mutate((data) => {
    data.entries.work = { id: "entry", current: 1, enabled: true, revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
    data.opencodeBindings = { [identity]: { openai: "work" } };
  });
  await runConnect({ ...config, codexAppServer: false });
  expect(mocks.launch.mock.calls[0][1].config).toMatchObject({ opencodeAuth: { mode: "managed", keys: { openai: "dummy" } } });
  expect(mocks.launch.mock.calls[0][1].config).not.toHaveProperty("codexAuth");
});
describe("shared registrations (OS-2248)", () => {
  const shared = projectIdentity("https://example.convex.cloud", "org", "a");
  beforeEach(() => {
    mocks.mode = "shared";
    mocks.profile = { name: "A", url: config.convexUrl, api_key: config.apiKey, project_id: "a", paths: config.paths, project_mode: "shared", project_organization: "org" };
    mocks.runner.mockReset().mockResolvedValue({ run: vi.fn().mockRejectedValue(new Error("stop")), stop: vi.fn() });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  it("delivers the assigned keys to a foreground connect, AWS Codex through the provider path", async () => {
    new CredentialStore().mutate((data) => {
      data.entries.work = { id: "entry", current: 1, enabled: true, aws: { provider: "bedrock", region: "us-east-1" },
        revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
      data.bindings[shared] = { mode: "managed", name: "work" };
      data.claudeBindings = { [shared]: { mode: "managed", name: "work" } };
    });
    await runConnect({ ...config, nonInteractive: true }).catch(() => {});
    expect(mocks.runner.mock.calls[0][0]).toMatchObject({
      claudeAuth: { mode: "bedrock", secret: "dummy", region: "us-east-1" },
      codexProvider: { provider: "bedrock", token: "dummy", region: "us-east-1" },
    });
    expect(mocks.runner.mock.calls[0][0].codexAuth).toBeUndefined();
  });
  it("rejects exec mode with a managed Codex key", async () => {
    new CredentialStore().mutate((data) => {
      data.entries.work = { id: "entry", current: 1, enabled: true, revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
      data.bindings[shared] = { mode: "managed", name: "work" };
    });
    await expect(runConnect({ ...config, nonInteractive: true, codexAppServer: false })).rejects.toThrow("app-server");
    expect(mocks.runner).not.toHaveBeenCalled();
  });
  it("warns only about logged-out runtimes that use their own login", async () => {
    const { disableConnectEvents } = await import("../../lib/connect-events.js");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const out = { installed: true, login: "signed-out" };
    mocks.states.mockResolvedValue({ codex: out, "claude-code": out, cursor: out, opencode: out, antigravity: out });
    try {
      await runConnect({ ...config, nonInteractive: true, jsonEvents: true, leaseHolder: "service",
        claudeAuth: { mode: "bedrock", secret: "s", region: "us-east-1" }, codexProvider: { provider: "bedrock", token: "s", region: "us-east-1" } }).catch(() => {});
      const events = write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events).toContainEqual(expect.objectContaining({ status: "connecting", loggedOut: ["cursor", "opencode", "antigravity"] }));
    } finally { disableConnectEvents(); }
  });
  it("leaves an agy below the floor out of the runtimes it reports (OS-2474)", async () => {
    const { disableConnectEvents } = await import("../../lib/connect-events.js");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const none = { installed: false, login: "unknown" };
    mocks.states.mockResolvedValue({ codex: { installed: true, login: "signed-in" }, "claude-code": none, cursor: none, opencode: none,
      antigravity: { installed: true, login: "unknown", unusable: "1.5.11 is older than Convoy supports" } });
    try {
      await runConnect({ ...config, nonInteractive: true, jsonEvents: true, leaseHolder: "service" }).catch(() => {});
      const events = write.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(events).toContainEqual(expect.objectContaining({ status: "connecting", runtimes: ["codex"] }));
    } finally { disableConnectEvents(); }
  });
  it("leaves a service worker's frame credentials as sent", async () => {
    new CredentialStore().mutate((data) => {
      data.entries.work = { id: "entry", current: 1, enabled: true, revisions: [{ revision: 1, secret: "dummy", createdAt: 1 }] };
      data.cursorBindings = { [shared]: { mode: "managed", name: "work" } };
    });
    await runConnect({ ...config, nonInteractive: true, leaseHolder: "service" }).catch(() => {});
    expect(mocks.runner.mock.calls[0][0].cursorAuth).toBeUndefined();
  });
});
