import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectIdentity } from "./validators.js";
const mocks = vi.hoisted(() => ({ runtimes: vi.fn(), launch: vi.fn(), profile: vi.fn(), runner: vi.fn(), configured: vi.fn() }));
vi.mock("./launcher.js", () => ({ launchProject: mocks.launch, isProjectEnvironment: mocks.configured, sharedRuntimeStates: mocks.runtimes }));
vi.mock("../../lib/config/index.js", async () => ({
  ...await vi.importActual("../../lib/config/index.js"), getProfileByKey: mocks.profile,
}));
vi.mock("../../agent/app/runner.js", () => ({ createAgentRunner: mocks.runner, SessionConflictError: class extends Error {} }));
import { runConnect, connectUsingProfile } from "../connect/workflow.js";
import { acquireLock, leasePath } from "../service/paths.js";
import { disableConnectEvents } from "../../lib/connect-events.js";

const config = { convexUrl: "https://example.com", apiKey: "secret", projectId: "a", profileKey: "a", paths: ["/workspace/a"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.profile.mockReturnValue({
    name: "A", url: config.convexUrl, api_key: config.apiKey, project_id: config.projectId, paths: config.paths,
    project_isolation: { identity: projectIdentity(config.convexUrl, "org", "a"), organization_id: "org" },
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("isolated direct connect", () => {
  it("forwards an explicit name and force decision", async () => {
    await connectUsingProfile({ ...config, profileName: "A", connectionName: "vm-a", force: true });
    expect(mocks.launch).toHaveBeenCalledWith(expect.any(String), { config: expect.objectContaining({ connectionName: "vm-a", force: true }) });
  });
  it("rejects an unregistered worker in a managed project environment", async () => {
    mocks.profile.mockReturnValue(undefined);
    mocks.runner.mockResolvedValue({ run: async () => {}, stop: async () => {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    try {
      await expect(runConnect(config)).rejects.toThrow(/project add/);
      expect(mocks.runner).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("launches the project worker instead of starting agents under the control identity", async () => {
    await runConnect(config);
    expect(mocks.launch).toHaveBeenCalledWith(projectIdentity(config.convexUrl, "org", "a"), { config: expect.objectContaining({ organizationId: "org", apiKey: "secret" }) });
    expect(mocks.runner).not.toHaveBeenCalled();
  });
  it.each([
    { projectId: "b" }, { convexUrl: "https://other.com" }, { apiKey: "other" },
    { paths: ["/workspace/b"] }, { streamFile: "/tmp/fixture" },
  ])("rejects overrides that could change the registration boundary", async (override) => {
    await expect(runConnect({ ...config, ...override })).rejects.toThrow(/cannot override/);
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.runner).not.toHaveBeenCalled();
  });
  it("refuses host provider overrides instead of silently ignoring them", async () => {
    await expect(connectUsingProfile({ ...config, profileName: "A", providerKey: { name: "host", key: { provider: "anthropic" } } })).rejects.toThrow(/provider/i);
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});

describe("shared direct connect", () => {
  const shared = { name: "A", url: config.convexUrl, api_key: config.apiKey, project_id: config.projectId, paths: config.paths,
    project_mode: "shared" as const, project_organization: "org" };
  const identity = projectIdentity(config.convexUrl, "org", "a");
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cv-shared-connect-"));
    vi.stubEnv("HOME", home);
    mocks.configured.mockReturnValue(false);
    mocks.profile.mockReturnValue(shared);
    mocks.runner.mockResolvedValue({ run: async () => {}, stop: async () => {} });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(home, { recursive: true, force: true }); });

  it("takes the project lease for the run and releases it", async () => {
    await runConnect(config);
    expect(mocks.runner).toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(existsSync(leasePath(identity, home))).toBe(false);
  });
  it("fails with project-active while the service holds the lease", async () => {
    const release = acquireLock(leasePath(identity, home), "service");
    const events: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((line) => { events.push(String(line)); return true; });
    try {
      await expect(runConnect({ ...config, jsonEvents: true })).rejects.toThrow("Project is in use by the project service.");
      expect(JSON.parse(events.at(-1)!)).toMatchObject({ event: "status", status: "failed", reason: "project-active", holder: "service" });
      expect(mocks.runner).not.toHaveBeenCalled();
    } finally { release(); write.mockRestore(); disableConnectEvents(); }
  });
  it("reports detected and logged-out runtimes to the service, never an unknown login (OS-2247)", async () => {
    const missing = { installed: false, login: "unknown" };
    mocks.runtimes.mockResolvedValue({ codex: { installed: true, login: "signed-out" }, "claude-code": { installed: true, login: "unknown" }, cursor: missing, opencode: missing });
    const events: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((line) => { events.push(String(line)); return true; });
    try { await runConnect({ ...config, jsonEvents: true }); }
    finally { write.mockRestore(); disableConnectEvents(); }
    expect(events.map(line => JSON.parse(line)).find(event => event.status === "connecting"))
      .toMatchObject({ runtimes: ["codex", "claude-code"], loggedOut: ["codex"] });
  });
  it("skips the status commands for a foreground connection", async () => {
    await runConnect(config);
    expect(mocks.runtimes).not.toHaveBeenCalled();
  });
  it("refuses an isolated registration when the environment is shared", async () => {
    mocks.profile.mockReturnValue({ ...shared, project_mode: undefined, project_organization: undefined, project_isolation: { identity, organization_id: "org" } });
    await expect(runConnect(config)).rejects.toThrow("isolated registrations");
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});
