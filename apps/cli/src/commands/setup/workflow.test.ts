import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectChoice } from "./prompts.js";

vi.mock("ora", () => {
  return {
    default: vi.fn(() => ({
      start() {
        return this;
      },
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  };
});

vi.mock("./prompts.js", () => ({
  promptUrl: vi.fn(),
  promptApiKey: vi.fn(),
  promptAuthMethod: vi.fn(),
  promptProfileName: vi.fn(),
  promptProjectSelect: vi.fn(),
  promptProfileKey: vi.fn(),
  promptWorkspacePath: vi.fn(),
  resolveWorkspacePath: vi.fn((value: string, defaultPath = process.cwd()) =>
    path.resolve(value.trim() || defaultPath)
  ),
  validateWorkspaceDirectory: vi.fn(() => true),
}));

vi.mock("../../lib/browser-login.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/browser-login.js")>();
  return { ...actual, runBrowserLogin: vi.fn() };
});

vi.mock("../../lib/config/index.js", () => ({
  setProfileInConfig: vi.fn(),
  createConvexClient: vi.fn(),
  getConfigPath: vi.fn(),
  getProfileByKey: vi.fn(),
}));

vi.mock("../connect/workflow.js", () => ({
  runConnect: vi.fn(),
}));

import {
  promptUrl,
  promptApiKey,
  promptAuthMethod,
  promptProfileName,
  promptProjectSelect,
  promptProfileKey,
  promptWorkspacePath,
  resolveWorkspacePath,
  validateWorkspaceDirectory,
} from "./prompts.js";
import {
  setProfileInConfig,
  createConvexClient,
  getConfigPath,
  getProfileByKey,
} from "../../lib/config/index.js";
import { runConnect } from "../connect/workflow.js";
import { LoginStartError, runBrowserLogin } from "../../lib/browser-login.js";
import { runSetup } from "./workflow.js";

const mockPromptUrl = vi.mocked(promptUrl);
const mockPromptApiKey = vi.mocked(promptApiKey);
const mockPromptAuthMethod = vi.mocked(promptAuthMethod);
const mockPromptProfileName = vi.mocked(promptProfileName);
const mockPromptProjectSelect = vi.mocked(promptProjectSelect);
const mockPromptProfileKey = vi.mocked(promptProfileKey);
const mockPromptWorkspacePath = vi.mocked(promptWorkspacePath);
const mockResolveWorkspacePath = vi.mocked(resolveWorkspacePath);
const mockValidateWorkspaceDirectory = vi.mocked(validateWorkspaceDirectory);

const mockSetProfileInConfig = vi.mocked(setProfileInConfig);
const mockCreateConvexClient = vi.mocked(createConvexClient);
const mockGetConfigPath = vi.mocked(getConfigPath);
const mockGetProfileByKey = vi.mocked(getProfileByKey);

const mockRunConnect = vi.mocked(runConnect);
const mockRunBrowserLogin = vi.mocked(runBrowserLogin);

const accessibleProjects: ProjectChoice[] = [
  {
    _id: "proj_abc123",
    name: "Project Alpha",
    alias: "ALPHA",
    organizationName: "Acme",
  },
];

function setupClient(projects: ProjectChoice[]) {
  const query = vi.fn().mockResolvedValue(projects);
  const close = vi.fn().mockResolvedValue(undefined);

  mockCreateConvexClient.mockReturnValue({
    client: {} as never,
    secrets: [],
    query,
    mutation: vi.fn(),
    action: vi.fn(),
    subscribe: vi.fn(),
    close,
  });

  return { query, close };
}

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${String(code)}`);
    }) as never);
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "convoy-setup-test-"));
}

describe("runSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigPath.mockReturnValue("/tmp/config.toml");
    mockGetProfileByKey.mockReturnValue(undefined);
    mockResolveWorkspacePath.mockImplementation((value, defaultPath = process.cwd()) =>
      path.resolve(value.trim() || defaultPath)
    );
    mockValidateWorkspaceDirectory.mockReturnValue(true);
    mockPromptWorkspacePath.mockResolvedValue(process.cwd());
    // Existing interactive tests exercise the paste path; browser login has
    // its own coverage in lib/browser-login.
    mockPromptAuthMethod.mockResolvedValue("paste");
    setupClient(accessibleProjects);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a profile non-interactively when all required props are passed", async () => {
    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profileKey: "work-profile",
    });

    expect(mockPromptUrl).not.toHaveBeenCalled();
    expect(mockPromptApiKey).not.toHaveBeenCalled();
    expect(mockPromptProjectSelect).not.toHaveBeenCalled();
    expect(mockPromptProfileName).not.toHaveBeenCalled();
    expect(mockPromptProfileKey).not.toHaveBeenCalled();
    expect(mockPromptWorkspacePath).not.toHaveBeenCalled();

    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "work-profile",
      expect.objectContaining({
        name: "Project Alpha",
        url: "https://test.convex.cloud",
        api_key: "sk_user_test_key_1234567890",
        project_id: "proj_abc123",
        paths: [process.cwd()],
      })
    );
  });

  it("does not connect in fully non-interactive mode", async () => {
    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profile: "Work Display Name",
      profileKey: "work-profile",
    });

    expect(mockRunConnect).not.toHaveBeenCalled();
  });

  it("re-prompts for the URL when browser login cannot start", async () => {
    mockPromptAuthMethod.mockResolvedValue("browser");
    mockPromptUrl
      .mockResolvedValueOnce("https://wrong.example.com")
      .mockResolvedValueOnce("https://test.convex.cloud");
    mockRunBrowserLogin
      .mockRejectedValueOnce(new LoginStartError("fetch failed"))
      .mockResolvedValueOnce({ apiKey: "sk_user_test_key_1234567890", email: "a@b.c" });
    mockPromptProjectSelect.mockResolvedValue("proj_abc123");
    mockPromptProfileName.mockResolvedValue("Project Alpha");
    mockPromptProfileKey.mockResolvedValue("work-profile");

    await runSetup({});

    expect(mockPromptUrl).toHaveBeenCalledTimes(2);
    // Second prompt prefills the failed URL for easy editing.
    expect(mockPromptUrl).toHaveBeenNthCalledWith(2, "https://wrong.example.com");
    expect(mockRunBrowserLogin).toHaveBeenNthCalledWith(1, "https://wrong.example.com");
    expect(mockRunBrowserLogin).toHaveBeenNthCalledWith(2, "https://test.convex.cloud");
    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "work-profile",
      expect.objectContaining({ url: "https://test.convex.cloud" })
    );
  });

  it("fails without --force when profile key already exists in non-interactive mode", async () => {
    mockGetProfileByKey.mockReturnValue({
      name: "Existing",
      url: "https://existing.convex.cloud",
      api_key: "sk_user_existing_1234567890",
      project_id: "proj_existing",
      paths: ["/tmp/existing"],
    });
    const exitSpy = mockProcessExit();

    await expect(
      runSetup({
        url: "https://test.convex.cloud",
        apiKey: "sk_user_test_key_1234567890",
        project: "proj_abc123",
        profileKey: "work-profile",
      })
    ).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSetProfileInConfig).not.toHaveBeenCalled();
    expect(mockRunConnect).not.toHaveBeenCalled();
  });

  it("overwrites existing profile key when --force is set in non-interactive mode", async () => {
    mockGetProfileByKey.mockReturnValue({
      name: "Existing",
      url: "https://existing.convex.cloud",
      api_key: "sk_user_existing_1234567890",
      project_id: "proj_existing",
      paths: ["/tmp/existing"],
    });

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profileKey: "work-profile",
      force: true,
    });

    expect(mockSetProfileInConfig).toHaveBeenCalledTimes(1);
    expect(mockRunConnect).not.toHaveBeenCalled();
  });

  it("saves --path . as an absolute workspace path", async () => {
    const cwd = makeTmpDir();
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profileKey: "work-profile",
      path: ".",
    });

    expect(mockPromptWorkspacePath).not.toHaveBeenCalled();
    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "work-profile",
      expect.objectContaining({
        paths: [cwd],
      })
    );

    cwdSpy.mockRestore();
  });

  it("saves relative and absolute --path values as absolute workspace paths", async () => {
    const cwd = makeTmpDir();
    const relativeDir = path.join(cwd, "relative-repo");
    const absoluteDir = makeTmpDir();
    fs.mkdirSync(relativeDir);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwd);

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profileKey: "relative-profile",
      path: "relative-repo",
    });

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profileKey: "absolute-profile",
      path: absoluteDir,
    });

    expect(mockSetProfileInConfig).toHaveBeenNthCalledWith(
      1,
      "relative-profile",
      expect.objectContaining({
        paths: [relativeDir],
      })
    );
    expect(mockSetProfileInConfig).toHaveBeenNthCalledWith(
      2,
      "absolute-profile",
      expect.objectContaining({
        paths: [absoluteDir],
      })
    );

    cwdSpy.mockRestore();
  });

  it("fails when non-interactive --path does not resolve to a directory", async () => {
    const exitSpy = mockProcessExit();
    mockValidateWorkspaceDirectory.mockReturnValue("Workspace path must exist");

    await expect(
      runSetup({
        url: "https://test.convex.cloud",
        apiKey: "sk_user_test_key_1234567890",
        project: "proj_abc123",
        profileKey: "work-profile",
        path: "/tmp/missing-repo",
      })
    ).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSetProfileInConfig).not.toHaveBeenCalled();
    expect(mockRunConnect).not.toHaveBeenCalled();
  });

  it("fails when provided project is not accessible in non-interactive mode", async () => {
    const exitSpy = mockProcessExit();

    await expect(
      runSetup({
        url: "https://test.convex.cloud",
        apiKey: "sk_user_test_key_1234567890",
        project: "proj_unknown",
        profileKey: "work-profile",
      })
    ).rejects.toThrow("process.exit:1");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockSetProfileInConfig).not.toHaveBeenCalled();
    expect(mockRunConnect).not.toHaveBeenCalled();
  });

  it("falls back to interactive behavior when one required non-interactive prop is missing", async () => {
    mockPromptProfileKey.mockResolvedValue("interactive-key");

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profile: "Interactive Name",
    });

    expect(mockPromptProfileKey).toHaveBeenCalled();
    expect(mockRunConnect).toHaveBeenCalledWith({
      convexUrl: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      projectId: "proj_abc123",
      paths: [process.cwd()],
      profileKey: "interactive-key",
    });
  });

  it("keeps interactive prefill behavior for existing setup flags", async () => {
    mockPromptProfileKey.mockResolvedValue("prefilled-name-key");

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profile: "My Display Name",
    });

    expect(mockPromptUrl).not.toHaveBeenCalled();
    expect(mockPromptApiKey).not.toHaveBeenCalled();
    expect(mockPromptProjectSelect).not.toHaveBeenCalled();
    expect(mockPromptProfileName).not.toHaveBeenCalled();
    expect(mockPromptProfileKey).toHaveBeenCalled();
    expect(mockPromptWorkspacePath).toHaveBeenCalledWith(process.cwd());

    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "prefilled-name-key",
      expect.objectContaining({
        name: "My Display Name",
        project_id: "proj_abc123",
      })
    );
    expect(mockRunConnect).toHaveBeenCalledTimes(1);
    expect(mockRunConnect).toHaveBeenCalledWith({
      convexUrl: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      projectId: "proj_abc123",
      paths: [process.cwd()],
      profileKey: "prefilled-name-key",
    });
  });

  it("uses provided profile key as the interactive profile key prompt default", async () => {
    mockPromptApiKey.mockResolvedValue("sk_user_prompted_key_1234567890");
    mockPromptProfileKey.mockResolvedValue("abc");

    await runSetup({
      url: "https://test.convex.cloud",
      project: "proj_abc123",
      profile: "Project Alpha",
      profileKey: "abc",
    });

    expect(mockPromptApiKey).toHaveBeenCalled();
    expect(mockPromptProfileKey).toHaveBeenCalledWith("abc");
    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({
        name: "Project Alpha",
        project_id: "proj_abc123",
      })
    );
    expect(mockRunConnect).toHaveBeenCalledWith({
      convexUrl: "https://test.convex.cloud",
      apiKey: "sk_user_prompted_key_1234567890",
      projectId: "proj_abc123",
      paths: [process.cwd()],
      profileKey: "abc",
    });
  });

  it("prompts for workspace path during partial interactive setup", async () => {
    const selectedPath = makeTmpDir();
    mockPromptProfileKey.mockResolvedValue("interactive-key");
    mockPromptWorkspacePath.mockResolvedValue(selectedPath);

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profile: "Interactive Name",
    });

    expect(mockPromptWorkspacePath).toHaveBeenCalledWith(process.cwd());
    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "interactive-key",
      expect.objectContaining({
        paths: [selectedPath],
      })
    );
    expect(mockRunConnect).toHaveBeenCalledWith({
      convexUrl: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      projectId: "proj_abc123",
      paths: [selectedPath],
      profileKey: "interactive-key",
    });
  });

  it("does not prompt for workspace path when --path is passed in partial interactive setup", async () => {
    const selectedPath = makeTmpDir();
    mockPromptProfileKey.mockResolvedValue("interactive-key");

    await runSetup({
      url: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      project: "proj_abc123",
      profile: "Interactive Name",
      path: selectedPath,
    });

    expect(mockPromptWorkspacePath).not.toHaveBeenCalled();
    expect(mockSetProfileInConfig).toHaveBeenCalledWith(
      "interactive-key",
      expect.objectContaining({
        paths: [selectedPath],
      })
    );
    expect(mockRunConnect).toHaveBeenCalledWith({
      convexUrl: "https://test.convex.cloud",
      apiKey: "sk_user_test_key_1234567890",
      projectId: "proj_abc123",
      paths: [selectedPath],
      profileKey: "interactive-key",
    });
  });
});

describe("setup project creation", () => {
  it("creates and saves a new ordinary profile without connecting in non-interactive mode", async () => {
    const { getFunctionName } = await import("convex/server");
    const query = vi.fn().mockImplementation(async (ref) => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible":
          return [];
        case "apiKeys/core:currentScope":
          return { kind: "unscoped" };
        case "organizations/core:listForUser":
          return [{ _id: "org", name: "Acme", slug: "acme" }];
      }
    });
    const mutation = vi.fn().mockResolvedValue("new-project");
    mockCreateConvexClient.mockReturnValue({ query, mutation, close: vi.fn() } as never);
    mockGetProfileByKey.mockReturnValue(undefined);
    mockValidateWorkspaceDirectory.mockReturnValue(true);
    mockRunConnect.mockClear();
    await runSetup({
      url: "https://example.convex.cloud",
      apiKey: "setup-key",
      create: true,
      org: "acme",
      projectName: "First",
      projectAlias: "FIRST",
      profileKey: "first",
      path: "/workspace",
    });
    expect(mockSetProfileInConfig).toHaveBeenLastCalledWith(
      "first",
      expect.objectContaining({ project_id: "new-project", name: "First", paths: ["/workspace"] })
    );
    expect(mockRunConnect).not.toHaveBeenCalled();
  });
});

it("does not create a remote project for an invalid setup profile key", async () => {
  const mutation = vi.fn().mockResolvedValue("new-project");
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce({ kind: "unscoped" })
    .mockResolvedValueOnce([{ _id: "org", name: "Acme", slug: "acme" }]);
  mockCreateConvexClient.mockReturnValue({ query, mutation, close: vi.fn() } as never);
  const exitSpy = mockProcessExit();
  await expect(
    runSetup({
      url: "https://example.convex.cloud",
      apiKey: "setup-key",
      create: true,
      org: "acme",
      projectName: "First",
      projectAlias: "FIRST",
      profileKey: "INVALID",
      path: "/workspace",
    })
  ).rejects.toThrow("process.exit:1");
  expect(mutation.mock.calls.length).toBe(0);
  exitSpy.mockRestore();
});

describe("creation preflight", () => {
  it.each(["profile", "path"])("rejects a local %s conflict before remote creation", async (failure) => {
    const { getFunctionName } = await import("convex/server");
    const query = vi.fn().mockImplementation(async (ref) => {
      switch (getFunctionName(ref)) {
        case "projects/core:listAccessible":
          return [];
        case "apiKeys/core:currentScope":
          return { kind: "unscoped" };
        case "organizations/core:listForUser":
          return [{ _id: "org", name: "Acme", slug: "acme" }];
      }
    });
    const mutation = vi.fn().mockResolvedValue("new-project");
    mockCreateConvexClient.mockReturnValue({ query, mutation, close: vi.fn() } as never);
    mockGetProfileByKey.mockReturnValue(failure === "profile" ? ({ name: "Existing" } as never) : undefined);
    mockValidateWorkspaceDirectory.mockReturnValue(failure === "path" ? "Not a directory" : true);
    const exitSpy = mockProcessExit();
    try {
      await expect(
        runSetup({
          url: "https://example.convex.cloud",
          apiKey: "setup-key",
          create: true,
          org: "acme",
          projectName: "First",
          projectAlias: "FIRST",
          profileKey: "first",
          path: "/workspace",
        })
      ).rejects.toThrow("process.exit:1");
      expect(mutation.mock.calls.length).toBe(0);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
