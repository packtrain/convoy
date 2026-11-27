import { getFunctionName } from "convex/server";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigFile } from "../../lib/config/types.js";
const mocks = vi.hoisted(() => ({
  accounts: vi.fn(), runtimes: vi.fn(), sharedShell: vi.fn(), profilePrompt: vi.fn(), projectPrompt: vi.fn(), mutation: vi.fn(), service: vi.fn(), shell: vi.fn(), inspect: vi.fn(), prepare: vi.fn(), request: vi.fn(), check: vi.fn(), query: vi.fn(), close: vi.fn(), client: vi.fn(),
  state: { locked: false, config: { profiles: {} } as ConfigFile, mode: "isolated" as "shared" | "isolated", launcher: true, managedMounts: undefined as string[] | undefined },
}));
vi.mock("../environment/resolution.js", () => ({ environmentMode: () => mocks.state.mode, recordEnvironmentMode: () => mocks.state.mode, chooseEnvironmentMode: vi.fn(async () => mocks.state.mode), managedMounts: () => mocks.state.managedMounts }));
vi.mock("../setup/prompts.js", () => ({
  promptProfileKey: mocks.profilePrompt,
  promptProjectSelect: mocks.projectPrompt,
}));
vi.mock("@inquirer/prompts", () => ({ select: vi.fn().mockResolvedValue("org"), input: vi.fn().mockResolvedValue("NEW") }));
const originalTTY = process.stdin.isTTY;
afterEach(() => { Object.defineProperty(process.stdin, "isTTY", { value: originalTTY, configurable: true }); });
vi.mock("../service/client.js", () => ({ serviceRequest: mocks.service, serviceEndpoint: () => "endpoint" }));
vi.mock("./launcher.js", () => ({ isProjectEnvironment: () => mocks.state.launcher, inspectProjectEnvironment: mocks.inspect, prepareProject: mocks.prepare, projectRequest: mocks.request, projectShell: mocks.shell, sharedShell: mocks.sharedShell, checkLauncher: mocks.check, projectAccounts: mocks.accounts, sharedRuntimeStates: mocks.runtimes }));
vi.mock("../../lib/config/toml.js", () => ({
  readConfig: () => mocks.state.config,
  mutateConfig: (fn: (config: ConfigFile) => unknown) => {
    const next = structuredClone(mocks.state.config);
    mocks.state.locked = true;
    let result;
    try { result = fn(next); } finally { mocks.state.locked = false; }
    mocks.state.config = next;
    return result;
  },
}));
vi.mock("../../lib/config/convex-client.js", () => ({ createConvexClient: mocks.client }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = async () => null; } }));
vi.mock("../../lib/config/credentials/store.js", () => ({ CredentialStore: class { read() { return { entries: {}, bindings: {} }; } } }));
import { ServiceUnavailableError } from "../service/errors.js";
import { acquireLock, leasePath } from "../service/paths.js";
import { projectIdentity } from "./validators.js";
import { chooseEnvironmentMode } from "../environment/resolution.js";
import { addProjectGuided, addProject, checkProject, readProjectAccounts, listProjects, loginProject, openProjectShell, removeProject, configureProject, setProjectConcurrency } from "./workflow.js";
import { CredentialStore } from "../../lib/config/credentials/store.js";

const options = { url: "https://example.convex.cloud", apiKey: "secret", project: "project-a", profileKey: "a", nonInteractive: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.service.mockRejectedValue(new ServiceUnavailableError("offline"));
  mocks.state.config = { profiles: {} };
  mocks.state.mode = "isolated";
  mocks.state.launcher = true;
  mocks.state.managedMounts = undefined;
  mocks.inspect.mockReturnValue({ workspace: "/workspace", registrations: [] });
  mocks.client.mockReturnValue({ query: mocks.query, mutation: mocks.mutation, close: mocks.close });
  mocks.query.mockImplementation(async (_query, _args) => {
    return mocks.query.mock.calls.length % 2 === 1
      ? [{ _id: "project-a", name: "A", alias: "A", organizationId: "org", organizationName: "Org" }]
      : { kind: "organization", organizationId: "org", projectIds: ["project-a"] };
  });
  mocks.prepare.mockImplementation((request) => {
    const entry = { ...request, uid: 20000, active: false, status: "stopped" };
    mocks.inspect.mockReturnValue({ workspace: "/workspace", registrations: [entry] });
    return entry;
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("local project workflow", () => {
  it("prepares outside the config lock and rechecks conflicting writes", async () => {
    mocks.prepare.mockImplementation((request) => {
      expect(mocks.state.locked).toBe(false);
      mocks.state.config.profiles.a = { name: "Other", url: options.url, api_key: "other", project_id: "other", paths: ["/elsewhere"] };
      const entry = { ...request, uid: 20000, active: false, status: "stopped" };
      mocks.inspect.mockReturnValue({ workspace: "/workspace", registrations: [entry] });
      return entry;
    });
    await expect(addProject("a", options)).rejects.toThrow("different registration");
    expect(mocks.state.config.profiles.a.project_id).toBe("other");
  });
  it("keeps shared identity enabled until its last profile is removed", async () => {
    await addProject("a", options);
    mocks.state.config.profiles.alias = structuredClone(mocks.state.config.profiles.a);
    await removeProject("a", true);
    expect(mocks.request).not.toHaveBeenCalled();
    await removeProject("alias", true);
    expect(mocks.request).toHaveBeenCalledOnce();
  });
  it("shows pending reservations without a saved profile", async () => {
    mocks.inspect.mockReturnValue({ workspace: "/workspace", registrations: [{ identity: "a".repeat(64), path: "/workspace/pending", uid: 20001, active: false, status: "pending" }] });
    await listProjects(true);
    expect(JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0])).toEqual([expect.objectContaining({ path: "/workspace/pending", uid: 20001, status: "pending" })]);
  });
  it("registers and repeats an identical add without changing identity", async () => {
    await addProject("a", options);
    const saved = structuredClone(mocks.state.config);
    await addProject("a", options);
    expect(mocks.state.config).toEqual(saved);
    expect(saved.profiles.a.paths).toEqual(["/workspace/a"]);
    expect(saved.profiles.a.project_isolation?.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
  it("retains connection settings when refreshing an existing registration", async () => {
    await addProject("a", options);
    mocks.state.config.profiles.a.concurrency = 7;
    mocks.state.config.profiles.a.isolated = true;
    await addProject("a", options);
    expect(mocks.state.config.profiles.a.concurrency).toBe(7);
    expect(mocks.state.config.profiles.a.isolated).toBe(true);
  });
  it("keeps configuration unchanged when clone/preparation fails", async () => {
    mocks.prepare.mockImplementation(() => { throw new Error("Clone failed"); });
    await expect(addProject("a", { ...options, clone: "https://example.com/repo.git" })).rejects.toThrow("Clone failed");
    expect(mocks.state.config.profiles).toEqual({});
    expect(mocks.close).toHaveBeenCalled();
  });
  it("rejects incomplete non-interactive input without contacting the backend", async () => {
    await expect(addProject("a", { nonInteractive: true })).rejects.toThrow("requires");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("settles the environment mode, from --mode, before reading the path", async () => {
    await expect(addProject("a", { nonInteractive: true, mode: "isolated" })).rejects.toThrow("requires");
    expect(chooseEnvironmentMode).toHaveBeenCalledWith("isolated", false);
  });
  it("rejects traversal before normalized paths can hide it", async () => {
    await expect(addProject("a/../b", options)).rejects.toThrow(/path|folder|traversal/i);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("rejects an insecure URL before sending credentials", async () => {
    await expect(addProject("a", { ...options, url: "http://example.com" })).rejects.toThrow(/HTTPS/);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not overwrite a conflicting profile", async () => {
    mocks.state.config.profiles.a = { name: "Legacy", url: options.url, api_key: "old", project_id: "other", paths: ["/other"] };
    await expect(addProject("a", options)).rejects.toThrow("different registration");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("saves and clears a profile's concurrency without a service, never on a remote target (OS-2612)", async () => {
    await addProject("a", options);
    expect(await setProjectConcurrency("a", 8, false)).toContain("next connects");
    expect(mocks.state.config.profiles.a.concurrency).toBe(8);
    await setProjectConcurrency("a", null, false);
    expect(mocks.state.config.profiles.a).not.toHaveProperty("concurrency");
    await expect(setProjectConcurrency("a", 8, false, false)).rejects.toThrow("offline");
    expect(mocks.state.config.profiles.a).not.toHaveProperty("concurrency");
    expect(() => configureProject("missing", 3)).toThrow("Unknown service profile");
  });
  it("reports a running project's saved concurrency as pending until reload (OS-2612)", async () => {
    mocks.service.mockResolvedValueOnce({ applied: false }).mockResolvedValueOnce({ applied: true });
    expect(await setProjectConcurrency("a", 8, false)).toContain("convoy service reload --profile a --interrupt");
    expect(await setProjectConcurrency("a", 8, true)).toContain("reloaded");
    expect(mocks.service).toHaveBeenLastCalledWith("endpoint", { op: "project.configure", profile: "a", concurrency: 8, interrupt: true });
  });
  it("refuses active removal without losing the profile or default", async () => {
    await addProject("a", options);
    mocks.state.config.settings = { default_profile: "a" };
    mocks.request.mockImplementationOnce(() => { throw new Error("Project is active"); });
    await expect(removeProject("a", true)).rejects.toThrow("active");
    expect(mocks.state.config.settings.default_profile).toBe("a");
    await removeProject("a", true);
    expect(mocks.state.config.profiles).toEqual({});
    expect(mocks.state.config.settings.default_profile).toBeUndefined();
  });
  it("prints no credentials in local JSON listings", async () => {
    await addProject("a", options);
    vi.mocked(console.log).mockClear();
    await listProjects(true);
    expect(vi.mocked(console.log).mock.calls.flat().join(" ")).not.toContain("secret");
  });
});

it("rejects profile keys the service cannot accept before registration", async () => {
  await expect(addProject("a", { ...options, profileKey: "a".repeat(81) })).rejects.toThrow("80");
  expect(mocks.prepare).not.toHaveBeenCalled();
});


it("routes a prepared registration to the service without a local config write", async () => {
  mocks.service.mockResolvedValue({ v: 1, id: "id", ok: true, registered: true, applied: true });
  await addProject("a", options);
  expect(mocks.state.config.profiles).toEqual({});
  expect(mocks.service).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ op: "project.add" }));
});

it("does not replay a service mutation offline after an uncertain outcome", async () => {
  mocks.service.mockRejectedValue(new Error("operation outcome is unknown"));
  await expect(addProject("a", options)).rejects.toThrow("unknown");
  expect(mocks.state.config.profiles).toEqual({});
});

it("skips lease-taking preparation for repeated live registrations", async () => {
  await addProject("a", options);
  mocks.prepare.mockClear();
  mocks.service.mockResolvedValue({ v: 1, id: "id", ok: true, registered: true, applied: true });
  await addProject("a", options);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("rejects oversized registrations before writing a service-incompatible profile", async () => {
  mocks.query.mockImplementation(async () => mocks.query.mock.calls.length % 2 === 1
    ? [{ _id: "project-a", name: "A".repeat(33000), alias: "A", organizationId: "org", organizationName: "Org" }]
    : { kind: "organization", organizationId: "org", projectIds: ["project-a"] });
  await expect(addProject("a", options)).rejects.toThrow(/large|snapshot|registration/i);
  expect(mocks.state.config.profiles).toEqual({});
});

it("repeats a live clone registration without reacquiring its execution lease", async () => {
  await addProject("a", { ...options, clone: "https://example.com/repo.git" });
  mocks.prepare.mockClear();
  await addProject("a", { ...options, clone: "https://example.com/repo.git" });
  expect(mocks.prepare).not.toHaveBeenCalled();
});


describe("create and register", () => {
  const creation = {
    url: options.url,
    apiKey: "control-secret",
    profileKey: "a",
    nonInteractive: true,
    create: true,
    org: "org",
    projectName: "New A",
    projectAlias: "NEW",
  };
  beforeEach(() => {
    mocks.query.mockImplementation(async (ref) => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible":
          return [];
        case "organizations/core:listForUser":
          return [{ _id: "org", name: "Org", slug: "org" }];
        case "apiKeys/core:currentScope":
          return { kind: "unscoped" };
      }
    });
    mocks.mutation.mockImplementation(async (ref) =>
      getFunctionName(ref) === "projects/core:create" ? "new-project" : { id: "worker-key-id", key: "worker-secret" }
    );
    mocks.client.mockImplementation(({ apiKey }) =>
      apiKey === "worker-secret"
        ? {
            query: vi.fn().mockResolvedValue({ kind: "organization", organizationId: "org", projectIds: ["new-project"] }),
            close: mocks.close,
          }
        : { query: mocks.query, mutation: mocks.mutation, close: mocks.close }
    );
  });
  it("returns the created identity on preparation failure without printing secrets", async () => {
    mocks.prepare.mockImplementation(() => { throw new Error("control-secret worker-secret"); });
    const result = await addProjectGuided("a", creation);
    expect(result).toMatchObject({ ok: false, projectId: "new-project", phase: "preparation", retrySafe: true });
    expect(console.log).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("saves a validated key before failed reconciliation and reuses it on retry", async () => {
    mocks.service.mockRejectedValue(new Error("connection lost"));
    const result = await addProjectGuided("a", creation);
    expect(result).toMatchObject({ ok: false, registered: true, phase: "registration", retrySafe: true });
    expect(mocks.state.config.profiles.a.api_key).toBe("worker-secret");
    mocks.mutation.mockClear();
    mocks.query.mockImplementation(async ref => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible": return [{ _id: "new-project", name: "New A", alias: "NEW", organizationId: "org", organizationName: "Org" }];
        case "apiKeys/core:currentScope": return { kind: "unscoped" };
        case "apiKeys/core:canReuseProjectKey": return true;
      }
    });
    mocks.service.mockResolvedValue({ applied: true });
    expect(await addProjectGuided("a", { ...options, apiKey: "control-secret", project: result.projectId })).toMatchObject({ ok: true, applied: true });
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  it("blocks blind retry when remote creation has no confirmed result", async () => {
    mocks.mutation.mockRejectedValue(new Error("control-secret"));
    expect(await addProjectGuided("a", creation)).toEqual({ ok: false, registered: false, applied: false, retrySafe: false, phase: "creation" });
    expect(console.log).not.toHaveBeenCalled();
  });
  it("blocks blind retry when worker key issuance has no confirmed result", async () => {
    mocks.mutation.mockImplementation(async ref => {
      if (getFunctionName(ref) === "projects/core:create") return "new-project";
      throw new Error("worker-secret");
    });
    expect(await addProjectGuided("a", creation)).toMatchObject({ ok: false, phase: "key", retrySafe: false, projectId: "new-project" });
    expect(mocks.state.config.profiles).toEqual({});
  });
  it("passes only the narrowed worker key to the running service", async () => {
    mocks.service.mockResolvedValue({ applied: true });
    await addProject("a", creation);
    expect(mocks.service).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        op: "project.add",
        registration: expect.objectContaining({
          profile: expect.objectContaining({ api_key: "worker-secret", project_id: "new-project" }),
        }),
      })
    );
    expect(JSON.stringify(mocks.service.mock.calls)).not.toContain("control-secret");
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("worker-secret");
  });
  it("retains and reports remote identity after clone failure", async () => {
    mocks.prepare.mockImplementation(() => {
      throw new Error("Clone failed");
    });
    await expect(addProject("a", creation)).rejects.toThrow("Clone failed");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("--project new-project"));
    expect(mocks.state.config.profiles).toEqual({});
    expect(mocks.mutation.mock.calls.length).toBe(1);
  });
  it.each([true, false])("reuses a saved worker key only when the backend confirms its source link: %s", async (reusable) => {
    await addProject("a", creation);
    mocks.mutation.mockClear();
    mocks.query.mockImplementation(async (ref) => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible":
          return [{ _id: "new-project", name: "New A", alias: "NEW", organizationId: "org", organizationName: "Org" }];
        case "apiKeys/core:currentScope":
          return { kind: "unscoped" };
        case "apiKeys/core:canReuseProjectKey":
          return reusable;
      }
    });
    await addProject("a", { url: options.url, apiKey: "control-secret", profileKey: "a", project: "new-project", nonInteractive: true });
    expect(mocks.mutation.mock.calls.length).toBe(reusable ? 0 : 1);
    expect(mocks.state.config.profiles.a.api_key).toBe("worker-secret");
  });
  it("rejects invalid local input before creating a project", async () => {
    await expect(addProject("a", { ...creation, profileKey: "INVALID" })).rejects.toThrow("Invalid profile key");
    expect(mocks.mutation.mock.calls.length).toBe(0);
  });
  it("rejects paths outside the workspace before creating a project", async () => {
    await expect(addProject("/outside/a", creation)).rejects.toThrow(/direct child/);
    expect(mocks.mutation.mock.calls.length).toBe(0);
  });
});

describe("creation local preflight", () => {
  it.each(["prompt-key", "selector", "overlap"])("rejects %s before creating remotely", async (scenario) => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mocks.profilePrompt.mockResolvedValue("a");
    mocks.projectPrompt.mockResolvedValue("__create__");
    mocks.state.config.profiles.a = {
      name: "Existing",
      url: options.url,
      api_key: "existing",
      project_id: "other",
      paths: ["/workspace/a"],
    };
    mocks.query.mockImplementation(async (ref) => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible":
          return [];
        case "apiKeys/core:currentScope":
          return { kind: "unscoped" };
        case "organizations/core:listForUser":
          return [{ _id: "org", name: "Org", slug: "org" }];
      }
    });
    mocks.mutation.mockResolvedValue("new-project");
    await expect(
      addProject("a", {
        url: options.url,
        apiKey: "setup",
        create: scenario !== "selector",
        ...(scenario === "selector" ? {} : { org: "org", projectName: "New", projectAlias: "NEW" }),
        profileKey: scenario === "prompt-key" ? undefined : scenario === "overlap" ? "new" : "a",
      })
    ).rejects.toThrow(/Profile|overlap/);
    expect(mocks.mutation.mock.calls.length).toBe(0);
  });
});

it("rejects an unsuitable source before creating a remote project", async () => {
  mocks.query.mockImplementation(async (ref) => {
    switch (getFunctionName(ref)) {
      case "projects/core:listAccessible":
        return [];
      case "apiKeys/core:currentScope":
        return { kind: "unscoped" };
      case "apiKeys/core:validateWorkerSetupKey":
        throw new Error("Use a manual setup key");
      case "organizations/core:listForUser":
        return [{ _id: "org", name: "Org", slug: "org" }];
    }
  });
  mocks.mutation.mockResolvedValue("new-project");
  mocks.prepare.mockImplementation(() => {
    throw new Error("Reached workspace preparation");
  });
  await expect(
    addProject("a", {
      url: options.url,
      apiKey: "login-key",
      profileKey: "a",
      nonInteractive: true,
      create: true,
      org: "org",
      projectName: "New",
      projectAlias: "NEW",
    })
  ).rejects.toThrow("manual setup key");
  expect(mocks.mutation.mock.calls.length).toBe(0);
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it.each(["path", "profile-conflict", "workspace-overlap", "project-unavailable", "key-scope", "clone-mismatch"])("reports a safe specific registration reason: %s", async reason => {
  let directory = "a";
  let input: Parameters<typeof addProject>[1] = { ...options };
  if (reason === "path") directory = "nested/child";
  if (reason === "profile-conflict") mocks.state.config.profiles.a = { name: "Other", url: options.url, api_key: "secret", project_id: "other", paths: ["/other"] };
  if (reason === "workspace-overlap") mocks.state.config.profiles.other = { name: "Other", url: options.url, api_key: "secret", project_id: "other", paths: ["/workspace/a"] };
  if (reason === "project-unavailable") mocks.query.mockResolvedValue([]);
  if (reason === "key-scope") mocks.query.mockImplementation(async ref => getFunctionName(ref) === "projects/core:listAccessible" ? [{ _id: "project-a", name: "A", alias: "AA", organizationId: "org", organizationName: "Org" }] : { kind: "organization", organizationId: "other", projectIds: ["project-a"] });
  if (reason === "clone-mismatch") {
    await addProject("a", { ...options, clone: "https://example.com/first.git" });
    input = { ...options, clone: "https://example.com/second.git" };
  }
  expect(await addProjectGuided(directory, input)).toMatchObject({ ok: false, reason, retrySafe: true });
});

describe("project login", () => {
  const identity = "a".repeat(64);
  const worker = (patch: object) => ({ profiles: [{ profile: "a", identity, status: "online", activeRuns: 0, ...patch }], pid: 1, stopping: false });
  beforeEach(() => { mocks.state.config = { profiles: { a: { paths: ["/workspace/a"], project_isolation: { identity } } } } as unknown as ConfigFile; });
  it("pauses a live project, runs only the login, then reloads and waits for online", async () => {
    const replies = [worker({ status: "failed", warning: "old" }), { applied: true }, { applied: true }, worker({ status: "connecting" }), worker({})];
    mocks.service.mockImplementation(async () => replies.shift());
    await loginProject("a", "codex", false, 5_000, 1);
    expect(mocks.service.mock.calls.map(([, request]) => request)).toEqual([
      { op: "status" }, { op: "reconcile", profile: "a", interrupt: true, pause: true },
      { op: "reconcile", profile: "a", interrupt: true }, { op: "status" }, { op: "status" }]);
    expect(mocks.shell).toHaveBeenCalledWith(identity, undefined, "codex");
  });
  it("keeps waiting through a runtime notice while the project connects", async () => {
    const replies = [worker({}), { applied: true }, { applied: true }, worker({ status: "connecting", warning: "Claude Code is not logged in for this project." }), worker({})];
    mocks.service.mockImplementation(async () => replies.shift());
    await loginProject("a", "codex", false, 5_000, 1);
    expect(replies).toEqual([]);
  });
  it("runs the Antigravity login inside an isolated project (OS-2475)", async () => {
    const replies = [worker({}), { applied: true }, { applied: true }, worker({})];
    mocks.service.mockImplementation(async () => replies.shift());
    await loginProject("a", "antigravity", false, 5_000, 1);
    expect(mocks.shell).toHaveBeenCalledWith(identity, undefined, "antigravity");
    await openProjectShell("a", undefined, undefined, "antigravity");
    expect(mocks.shell).toHaveBeenLastCalledWith(identity, undefined, "antigravity");
  });
  it("refuses to stop active runs without --interrupt", async () => {
    mocks.service.mockResolvedValue(worker({ activeRuns: 2 }));
    await expect(loginProject("a", "codex", false)).rejects.toThrow("Add --interrupt");
    expect(mocks.shell).not.toHaveBeenCalled();
  });
  it("resumes the project when the login fails", async () => {
    mocks.service.mockResolvedValueOnce(worker({})).mockResolvedValue({ applied: true });
    mocks.shell.mockRejectedValueOnce(new Error("Runtime login exited with status 1."));
    await expect(loginProject("a", "claude-code", false)).rejects.toThrow("status 1");
    expect(mocks.service.mock.calls.at(-1)?.[1]).toEqual({ op: "reconcile", profile: "a", interrupt: true });
  });
  it("only logs in when no service runs", async () => {
    await loginProject("a", "codex", false);
    expect(mocks.shell).toHaveBeenCalledWith(identity, undefined, "codex");
    expect(mocks.service).toHaveBeenCalledTimes(1);
  });
});

describe("shared Docker project paths (OS-2251)", () => {
  beforeEach(() => { mocks.state.mode = "shared"; mocks.state.managedMounts = ["/Users/me/code"]; });
  it.each([["/Users/me/code", /Mount its parent/], ["/home/node/app", /under \/workspace or a mounted folder/]])("refuses %s before contacting the backend", async (directory, message) => {
    await expect(addProject(directory, options)).rejects.toThrow(message);
    await expect(addProjectGuided(directory, options)).resolves.toMatchObject({ ok: false, reason: "path" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe("shared project shell and login (OS-2248)", () => {
  const profile = { url: "https://example.convex.cloud", api_key: "k", project_id: "p", paths: ["/code/a"], project_mode: "shared", project_organization: "org" };
  const identity = projectIdentity(profile.url, "org", "p");
  beforeEach(() => {
    mocks.state.mode = "shared";
    mocks.state.config = { profiles: { a: profile } } as unknown as ConfigFile;
    mocks.service.mockResolvedValue({ profiles: [{ profile: "a", identity, status: "online", activeRuns: 2 }], pid: 1, stopping: false });
  });
  it("logs in once for every project without pausing or reloading this one", async () => {
    await loginProject("a", "codex", false);
    expect(mocks.sharedShell).toHaveBeenCalledWith("/code/a", undefined, "codex");
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.shell).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("applies to every project in this environment"));
  });
  it("opens the shell in the project folder only for the confirmed identity", async () => {
    await openProjectShell("a", identity);
    expect(mocks.sharedShell).toHaveBeenCalledWith("/code/a", undefined, undefined);
    await expect(openProjectShell("a", "wrong-identity")).rejects.toThrow("registration changed");
    expect(mocks.sharedShell).toHaveBeenCalledTimes(1);
    expect(mocks.shell).not.toHaveBeenCalled();
  });
  it("reads account status from the runtimes' own status commands, never the launcher", async () => {
    const missing = { installed: false, login: "unknown" };
    mocks.runtimes.mockResolvedValue({ codex: { installed: true, login: "signed-in" }, "claude-code": missing, cursor: missing, opencode: missing });
    await expect(readProjectAccounts("a", identity)).resolves.toEqual({ codex: { status: "signed-in" }, "claude-code": { status: "unknown" } });
    expect(mocks.accounts).not.toHaveBeenCalled();
  });
});

describe("project check", () => {
  const identity = "a".repeat(64);
  beforeEach(() => {
    mocks.state.config = { profiles: { a: { url: "https://example.convex.cloud", api_key: "secret-key", paths: ["/workspace/a"], project_isolation: { identity } } } } as unknown as ConfigFile;
    mocks.check.mockResolvedValue({ sandbox: null, holder: null, runtimes: { codex: { state: "ready", home: true, loggedIn: true }, "claude-code": { state: "missing", home: false, loggedIn: false } } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each([[400, "pass"], [401, "fail"], [500, "fail"]])("probes the backend with a session-less heartbeat (HTTP %s)", async (code, expected) => {
    const fetch = vi.fn(async () => new Response("{}", { status: code }));
    vi.stubGlobal("fetch", fetch);
    const result = await checkProject("a");
    expect(fetch).toHaveBeenCalledWith("https://example.convex.site/api/agent/heartbeat", expect.objectContaining({ method: "POST", body: "{}",
      headers: expect.objectContaining({ Authorization: "Bearer secret-key" }) }));
    expect(result.checks.find(check => check.id === "backend")?.status).toBe(expected);
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(mocks.check).toHaveBeenCalledWith(identity);
  });
  it("skips the Antigravity login row on a managed Gemini key (OS-2476)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    const facts = { state: "ready", home: true, loggedIn: false };
    mocks.check.mockResolvedValue({ sandbox: null, holder: null, runtimes: { codex: facts, "claude-code": facts, antigravity: facts } });
    expect((await checkProject("a")).checks.find(check => check.id === "antigravity-login")).toMatchObject({ status: "fail" });
    vi.spyOn(CredentialStore.prototype, "read").mockReturnValueOnce({ version: 1, generation: 1, bindings: {},
      antigravityBindings: { [identity]: { mode: "managed", name: "g" } },
      entries: { g: { id: "id", enabled: true, current: 1, provider: "gemini", revisions: [{ revision: 1, secret: "s", createdAt: 1 }] } } });
    expect((await checkProject("a")).checks.find(check => check.id === "antigravity-login")).toMatchObject({ status: "skip", label: "Antigravity uses managed credentials" });
  });
  it("reports an unreachable backend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await checkProject("a")).checks.find(check => check.id === "backend")?.fix).toMatch(/^Cannot reach the Convoy backend/);
  });
});

describe("shared project check (OS-2247)", () => {
  const profile = { url: "https://example.convex.cloud", api_key: "secret-key", project_id: "p", paths: ["/code/a"], project_mode: "shared", project_organization: "org" };
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cv-shared-check-")); vi.stubEnv("HOME", home);
    mocks.state.mode = "shared";
    mocks.state.config = { profiles: { a: profile } } as unknown as ConfigFile;
    const missing = { installed: false, login: "unknown" };
    mocks.runtimes.mockResolvedValue({ codex: { installed: true, login: "signed-out" }, "claude-code": missing, cursor: missing, opencode: missing, antigravity: missing });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(home, { recursive: true, force: true }); });
  it("checks in-process without the launcher and reports the lease holder", async () => {
    const release = acquireLock(leasePath(projectIdentity(profile.url, "org", "p"), home), "connect");
    try {
      const result = await checkProject("a");
      expect(mocks.check).not.toHaveBeenCalled();
      expect(result.checks.map(check => check.id)).toEqual(["codex-installed", "codex-login", "claude-code-installed", "cursor-installed", "antigravity-installed", "opencode-installed", "lease", "backend"]);
      expect(result.checks.find(check => check.id === "lease")).toMatchObject({ status: "fail", label: "Project lease: held by a foreground connection" });
      expect(result.checks.find(check => check.id === "backend")?.status).toBe("pass");
    } finally { release(); }
  });
  it("reports a free lease without creating service state", async () => {
    expect((await checkProject("a")).checks.find(check => check.id === "lease")).toMatchObject({ status: "pass", label: "Project lease: free" });
    expect(existsSync(join(home, ".convoy"))).toBe(false);
  });
});

it("reads account status only for the confirmed isolated identity", async () => {
  await addProject("a", options);
  const identity = mocks.state.config.profiles.a.project_isolation!.identity;
  const result = { codex: { status: "signed-out" }, "claude-code": { status: "unknown" } };
  mocks.accounts.mockResolvedValue(result);
  await expect(readProjectAccounts("a", identity)).resolves.toEqual(result);
  expect(mocks.accounts).toHaveBeenCalledWith(identity);
  mocks.accounts.mockClear();
  await expect(readProjectAccounts("a", "wrong-identity")).rejects.toThrow("registration changed");
  expect(mocks.accounts).not.toHaveBeenCalled();
});

it("removes an isolated profile without the launcher when its registry is missing, so recovery works", async () => {
  mocks.state.launcher = false;
  mocks.state.config.profiles.old = { name: "Old", url: options.url, api_key: "k", project_id: "p", paths: ["/workspace/old"],
    project_isolation: { identity: "b".repeat(64), organization_id: "org" } };
  await removeProject("old", true);
  expect(mocks.state.config.profiles).toEqual({});
  expect(mocks.request).not.toHaveBeenCalled();
});

describe("shared project workflow", () => {
  let root: string;
  const sharedQuery = (scope: unknown) => mocks.query.mockImplementation(async (query) => getFunctionName(query) === "apiKeys/core:currentScope"
    ? scope : [{ _id: "project-a", name: "A", alias: "A", organizationId: "org", organizationName: "Org" }]);
  beforeEach(() => {
    mocks.state.mode = "shared";
    root = realpathSync(mkdtempSync(join(tmpdir(), "cv-shared-add-")));
    sharedQuery({ kind: "organization", organizationId: "org", projectIds: [] });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("registers an existing folder with the key as given and never calls the launcher", async () => {
    mkdirSync(join(root, "demo"));
    await addProject(join(root, "demo"), options);
    expect(mocks.state.config.profiles.a).toEqual({ name: "A", url: options.url, api_key: "secret", project_id: "project-a",
      paths: [join(root, "demo")], project_mode: "shared", project_organization: "org" });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map(([query]) => getFunctionName(query))).not.toContain("apiKeys/core:validateWorkerSetupKey");
  });
  it("creates a missing folder relative to the current directory and repeats idempotently", async () => {
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      await addProject("new-project", options);
      expect(existsSync(join(root, "new-project"))).toBe(true);
      const saved = structuredClone(mocks.state.config);
      await addProject("new-project", options);
      expect(mocks.state.config).toEqual(saved);
    } finally { cwd.mockRestore(); }
  });
  it("refuses a symlinked path to a folder another project already uses", async () => {
    mkdirSync(join(root, "actual"));
    symlinkSync(join(root, "actual"), join(root, "alias"));
    mocks.state.config.profiles.other = { name: "Other", url: options.url, api_key: "k", project_id: "other",
      paths: [realpathSync(join(root, "actual"))], project_mode: "shared", project_organization: "org" };
    await expect(addProject(join(root, "alias"), options)).rejects.toThrow("overlaps");
    await expect(addProject(join(root, "alias", "nested"), options)).rejects.toThrow("overlaps");
  });
  it("refuses an alias of a registered project at a different folder", async () => {
    mocks.state.config.profiles.z = { name: "A", url: options.url, api_key: "secret", project_id: "project-a",
      paths: [join(root, "original")], project_mode: "shared", project_organization: "org" };
    await expect(addProject(join(root, "different"), options)).rejects.toThrow("already registered");
    expect(Object.keys(mocks.state.config.profiles)).toEqual(["z"]);
  });
  it("refuses a key that cannot see the project", async () => {
    sharedQuery({ kind: "organization", organizationId: "org", projectIds: ["other"] });
    await expect(addProject(join(root, "demo"), options)).rejects.toThrow("cannot see the project");
    expect(mocks.state.config.profiles).toEqual({});
  });
  it("refuses isolated registrations in a shared environment instead of running them unsandboxed", async () => {
    mocks.state.config.profiles.old = { name: "Old", url: options.url, api_key: "k", project_id: "p", paths: ["/workspace/old"],
      project_isolation: { identity: "b".repeat(64), organization_id: "org" } };
    await expect(addProject(join(root, "demo"), options)).rejects.toThrow("isolated registrations");
  });
  it("lists and removes shared registrations without the launcher", async () => {
    await addProject(join(root, "demo"), options);
    await listProjects(true);
    const rows = JSON.parse(vi.mocked(console.log).mock.calls.at(-1)![0]);
    expect(rows).toEqual([expect.objectContaining({ profile: "a", path: join(root, "demo"), status: "stopped" })]);
    expect(rows[0]).not.toHaveProperty("uid");
    await removeProject("a", true);
    expect(mocks.state.config.profiles).toEqual({});
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(existsSync(join(root, "demo"))).toBe(true);
  });
});
