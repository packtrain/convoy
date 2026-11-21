import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as TOML from "smol-toml";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start() {
      return this;
    },
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../lib/config/index.js", () => ({
  resolveConfigFromProfileCommand: vi.fn(),
  createConvexClient: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("util", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    promisify: vi.fn(() => mockExecFileAsync),
  };
});

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { checkbox, confirm, select } from "@inquirer/prompts";
import {
  createConvexClient,
  resolveConfigFromProfileCommand,
} from "../lib/config/index.js";
import {
  runInitMcp,
  runInitSkill,
  getMarketplaceDir,
  InitError,
  parseCliTargets,
  parseScope,
  parseClaudeMethods,
  getClaudeSkillDestination,
  initCommand,
} from "./init.js";

const mockCheckbox = vi.mocked(checkbox);
const mockConfirm = vi.mocked(confirm);
const mockSelect = vi.mocked(select);
const mockCreateConvexClient = vi.mocked(createConvexClient);
const mockResolveConfigFromProfileCommand = vi.mocked(
  resolveConfigFromProfileCommand
);

let tmpDir: string;
let previousCodexHome: string | undefined;
let previousHome: string | undefined;
let previousCwd: string;
let previousIsTTY: boolean | undefined;

beforeEach(() => {
  previousCodexHome = process.env.CODEX_HOME;
  previousHome = process.env.HOME;
  previousCwd = process.cwd();
  previousIsTTY = process.stdin.isTTY;
  tmpDir = fs.mkdtempSync(
    path.join(import.meta.dirname ?? process.cwd(), ".tmp-test-init-")
  );
  // Antigravity's MCP config is per user; keep it out of the real home.
  process.env.HOME = path.join(tmpDir, "home");
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.HOME = previousHome;
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }
  process.stdin.isTTY = previousIsTTY as boolean;
  process.chdir(previousCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── runInitMcp tests ────────────────────────────────────────────────────────

describe("runInitMcp", () => {
  const mockClient = {
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn(),
    subscribe: vi.fn(),
    close: vi.fn(),
    client: {} as unknown,
    secrets: [],
  };

  beforeEach(() => {
    mockCreateConvexClient.mockReturnValue(
      mockClient as ReturnType<typeof createConvexClient>
    );
  });

  it("creates .mcp.json with correct MCP URL", async () => {
    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
    });

    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8")
    );
    expect(content.mcpServers.convoy.type).toBe("http");
    expect(content.mcpServers.convoy.url).toBe(
      "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"
    );
    expect(content.mcpServers.convoy.headers.Authorization).toBe(
      "Bearer sk_user_test123"
    );

    const codexConfigPath = path.join(tmpDir, ".codex", "config.toml");
    expect(fs.existsSync(codexConfigPath)).toBe(true);

    // Antigravity's file is per user, so it is written only when named.
    expect(
      fs.existsSync(path.join(tmpDir, "home", ".gemini", "config", "mcp_config.json"))
    ).toBe(false);
  });

  it("merges with existing .mcp.json preserving other servers", async () => {
    const existing = {
      mcpServers: {
        other: {
          type: "http",
          url: "https://other.example.com",
          headers: {},
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(existing),
      "utf-8"
    );

    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
      force: true,
    });

    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8")
    );
    expect(content.mcpServers.other).toEqual(existing.mcpServers.other);
    expect(content.mcpServers.convoy).toBeDefined();
  });

  it("prompts to overwrite when convoy entry already exists", async () => {
    const existing = {
      mcpServers: {
        convoy: {
          type: "http",
          url: "https://old.convex.site/api/mcp",
          headers: { Authorization: "Bearer old" },
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(existing),
      "utf-8"
    );

    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);

    mockConfirm.mockResolvedValue(false);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
    });

    expect(mockConfirm).toHaveBeenCalled();

    const content = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8")
    );
    expect(content.mcpServers.convoy.headers.Authorization).toBe(
      "Bearer old"
    );
  });

  it("throws InitError when project is not found", async () => {
    mockClient.query.mockResolvedValue([]);

    await expect(
      runInitMcp({
        convexUrl: "https://happy-animal-123.convex.cloud",
        apiKey: "sk_user_test123",
        projectId: "nonexistent",
        outputDir: tmpDir,
      })
    ).rejects.toThrow(InitError);
  });

  it("writes only Codex project config when cliTargets=codex", async () => {
    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
      cliTargets: ["codex"],
    });

    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    const codexPath = path.join(tmpDir, ".codex", "config.toml");
    expect(fs.existsSync(codexPath)).toBe(true);

    const parsed = TOML.parse(fs.readFileSync(codexPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const mcpServers = parsed.mcp_servers as Record<string, unknown>;
    const convoy = mcpServers.convoy as Record<string, unknown>;
    expect(convoy.url).toBe(
      "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB"
    );
  });

  it("writes only Claude .mcp.json when cliTargets=claude", async () => {
    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
      cliTargets: ["claude"],
    });

    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(false);
  });

  it("prompts to overwrite when Codex convoy entry already exists", async () => {
    fs.mkdirSync(path.join(tmpDir, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".codex", "config.toml"),
      `[mcp_servers.convoy]
url = "https://old.convex.site/api/mcp"
http_headers = { Authorization = "Bearer old" }
`,
      "utf-8"
    );

    mockClient.query.mockResolvedValue([
      {
        _id: "proj123",
        name: "Web App",
        alias: "WEB",
        organizationId: "org123",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: { name: "org-owner", permissions: ["*"] },
      },
    ]);
    mockConfirm.mockResolvedValueOnce(false);

    await runInitMcp({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
      outputDir: tmpDir,
      cliTargets: ["codex"],
    });

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(".codex/config.toml"),
      })
    );

    const content = fs.readFileSync(path.join(tmpDir, ".codex", "config.toml"), "utf-8");
    expect(content).toContain("https://old.convex.site/api/mcp");
  });
});

// ─── runInitSkill tests ──────────────────────────────────────────────────────

describe("runInitSkill", () => {
  // ── Codex ─────────────────────────────────────────────────────────────────

  it("installs Codex skill in project scope", async () => {
    await runInitSkill({
      cliTargets: ["codex"],
      scope: "project",
      baseDir: tmpDir,
    });

    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpDir, ".agents", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);
  });

  it("installs Codex skill in user scope honoring CODEX_HOME", async () => {
    const codexHome = path.join(tmpDir, "custom-codex-home");
    process.env.CODEX_HOME = codexHome;

    await runInitSkill({
      cliTargets: ["codex"],
      scope: "user",
      baseDir: tmpDir,
    });

    expect(
      fs.existsSync(path.join(codexHome, "skills", "convoy"))
    ).toBe(true);
  });

  it("uses project scope by default when unspecified", async () => {
    process.stdin.isTTY = true;
    // scope prompt returns "project"
    mockSelect.mockResolvedValueOnce("project");

    await runInitSkill({
      cliTargets: ["codex"],
      baseDir: tmpDir,
    });

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Where should skills be installed?",
      })
    );
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });

  it("prompts before overwriting existing Codex skill and skips when denied", async () => {
    fs.mkdirSync(path.join(tmpDir, ".agents", "skills", "convoy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"),
      "existing",
      "utf-8"
    );
    mockConfirm.mockResolvedValueOnce(false);

    await expect(
      runInitSkill({
        cliTargets: ["codex"],
        scope: "project",
        baseDir: tmpDir,
      })
    ).resolves.toBeUndefined();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(".agents/skills/convoy"),
      })
    );
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "SKILL.md"))
    ).toBe(false);
  });

  it("overwrites existing Codex skill when confirmed", async () => {
    fs.mkdirSync(path.join(tmpDir, ".agents", "skills", "convoy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"),
      "existing",
      "utf-8"
    );
    mockConfirm.mockResolvedValueOnce(true);

    await runInitSkill({
      cliTargets: ["codex"],
      scope: "project",
      baseDir: tmpDir,
    });

    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "SKILL.md"))
    ).toBe(true);
  });

  it("force overwrites existing Codex skill without prompting", async () => {
    fs.mkdirSync(path.join(tmpDir, ".agents", "skills", "convoy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"),
      "existing",
      "utf-8"
    );

    await runInitSkill({
      cliTargets: ["codex"],
      scope: "project",
      force: true,
      baseDir: tmpDir,
    });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "marker.txt"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy", "SKILL.md"))
    ).toBe(true);
  });

  // ── Claude (raw) ──────────────────────────────────────────────────────────

  it("installs Claude raw skill files in project scope", async () => {
    await runInitSkill({
      cliTargets: ["claude"],
      scope: "project",
      claudeMethods: ["raw"],
      baseDir: tmpDir,
    });

    const canonicalPath = path.join(tmpDir, ".agents", "skills", "convoy");
    const claudePath = path.join(tmpDir, ".claude", "skills", "convoy");

    expect(
      fs.existsSync(path.join(canonicalPath, "SKILL.md"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(claudePath, "SKILL.md"))
    ).toBe(true);
    expect(fs.lstatSync(claudePath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(claudePath)).toBe(fs.realpathSync(canonicalPath));
  });

  it("computes Claude user-scope destination under home directory", () => {
    const dest = getClaudeSkillDestination("user", "/some/project");
    // User scope should resolve to ~/.claude/skills/convoy
    // (not project-relative)
    expect(dest).not.toContain("/some/project");
    expect(dest).toContain(path.join(".claude", "skills", "convoy"));
  });

  it("prompts before replacing existing Claude raw destination and skips when denied", async () => {
    fs.mkdirSync(path.join(tmpDir, ".claude", "skills", "convoy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "skills", "convoy", "marker.txt"),
      "existing",
      "utf-8"
    );
    mockConfirm.mockResolvedValueOnce(false);

    await expect(
      runInitSkill({
        cliTargets: ["claude"],
        scope: "project",
        claudeMethods: ["raw"],
        baseDir: tmpDir,
      })
    ).resolves.toBeUndefined();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(".claude/skills/convoy"),
      })
    );
    expect(
      fs.existsSync(path.join(tmpDir, ".claude", "skills", "convoy", "marker.txt"))
    ).toBe(true);
    expect(fs.lstatSync(path.join(tmpDir, ".claude", "skills", "convoy")).isSymbolicLink()).toBe(false);
  });

  it("overwrites existing Claude raw directory with a symlink when confirmed", async () => {
    fs.mkdirSync(path.join(tmpDir, ".claude", "skills", "convoy"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, ".claude", "skills", "convoy", "marker.txt"),
      "existing",
      "utf-8"
    );
    mockConfirm.mockResolvedValueOnce(true);

    await runInitSkill({
      cliTargets: ["claude"],
      scope: "project",
      claudeMethods: ["raw"],
      baseDir: tmpDir,
    });

    const canonicalPath = path.join(tmpDir, ".agents", "skills", "convoy");
    const claudePath = path.join(tmpDir, ".claude", "skills", "convoy");

    expect(fs.existsSync(path.join(canonicalPath, "SKILL.md"))).toBe(true);
    expect(fs.lstatSync(claudePath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(claudePath)).toBe(fs.realpathSync(canonicalPath));
    expect(fs.existsSync(path.join(claudePath, "marker.txt"))).toBe(false);
  });

  // ── Claude (plugin) ───────────────────────────────────────────────────────

  it("installs Claude plugin when claude CLI is available", async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({}) // marketplace add
      .mockResolvedValueOnce({}); // plugin install

    await runInitSkill({
      cliTargets: ["claude"],
      scope: "project",
      claudeMethods: ["plugin"],
      baseDir: tmpDir,
    });

    expect(mockExecFileAsync).toHaveBeenCalledWith("claude", [
      "plugin",
      "install",
      "convoy@convoy",
      "--scope",
      "project",
    ]);
  });

  it("fails gracefully when claude CLI is not available for plugin install", async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })
    );

    // Plugin-only install fails → throws because no successful installs
    await expect(
      runInitSkill({
        cliTargets: ["claude"],
        scope: "project",
        claudeMethods: ["plugin"],
        baseDir: tmpDir,
      })
    ).rejects.toThrow(InitError);
  });

  // ── Claude (both methods) ─────────────────────────────────────────────────

  it("installs both plugin and raw files when both methods selected", async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({}) // marketplace add
      .mockResolvedValueOnce({}); // plugin install

    await runInitSkill({
      cliTargets: ["claude"],
      scope: "project",
      claudeMethods: ["plugin", "raw"],
      baseDir: tmpDir,
    });

    // Raw files copied
    expect(
      fs.existsSync(
        path.join(tmpDir, ".claude", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);

    // Plugin installed
    expect(mockExecFileAsync).toHaveBeenCalledWith("claude", [
      "plugin",
      "install",
      "convoy@convoy",
      "--scope",
      "project",
    ]);
  });

  it("succeeds with raw files even when plugin install fails", async () => {
    mockExecFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })
    );

    // Should not throw because raw install succeeds
    await runInitSkill({
      cliTargets: ["claude"],
      scope: "project",
      claudeMethods: ["raw", "plugin"],
      baseDir: tmpDir,
    });

    expect(
      fs.existsSync(
        path.join(tmpDir, ".claude", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);
  });

  // ── Combined targets ──────────────────────────────────────────────────────

  it("installs to both .claude and .agents when both targets selected", async () => {
    await runInitSkill({
      cliTargets: ["claude", "codex"],
      scope: "project",
      claudeMethods: ["raw"],
      baseDir: tmpDir,
    });

    expect(
      fs.existsSync(
        path.join(tmpDir, ".claude", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpDir, ".agents", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);
  });

  it("succeeds when Claude plugin fails but Codex and Claude raw install", async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error("claude missing"));

    await expect(
      runInitSkill({
        cliTargets: ["claude", "codex"],
        scope: "project",
        claudeMethods: ["raw", "plugin"],
        baseDir: tmpDir,
      })
    ).resolves.toBeUndefined();

    // Claude raw files copied
    expect(
      fs.existsSync(
        path.join(tmpDir, ".claude", "skills", "convoy", "SKILL.md")
      )
    ).toBe(true);
    // Codex files copied
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });

  // ── Prompts ───────────────────────────────────────────────────────────────

  it("prompts for CLI targets when --cli is omitted", async () => {
    process.stdin.isTTY = true;
    mockCheckbox.mockResolvedValueOnce(["codex"]); // targets
    mockSelect.mockResolvedValueOnce("project"); // scope

    await runInitSkill({ baseDir: tmpDir });

    expect(mockCheckbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Which CLI(s) should get Convoy skills?",
      })
    );
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });

  it("prompts for Claude methods when Claude is selected", async () => {
    process.stdin.isTTY = true;
    mockCheckbox
      .mockResolvedValueOnce(["claude"]) // targets
      .mockResolvedValueOnce(["raw"]); // claude methods
    mockSelect.mockResolvedValueOnce("project"); // scope

    await runInitSkill({ baseDir: tmpDir });

    expect(mockCheckbox).toHaveBeenCalledTimes(2);
    expect(mockCheckbox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: "How should the Claude Code skill be installed?",
      })
    );
  });

  it("does not prompt for Claude methods when Codex only", async () => {
    await runInitSkill({
      cliTargets: ["codex"],
      scope: "project",
      baseDir: tmpDir,
    });

    // checkbox should not be called (targets were provided via config)
    expect(mockCheckbox).not.toHaveBeenCalled();
  });

  it("prints skills.sh alternative after skill installation summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runInitSkill({
      cliTargets: ["codex"],
      scope: "project",
      baseDir: tmpDir,
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Alternative installer with skills.sh")
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("npx skills add https://github.com/packtrain/convoy/tree/main/plugins/convoy/skills --skill convoy")
    );

    logSpy.mockRestore();
  });
});

// ─── parseCliTargets tests ──────────────────────────────────────────────────

describe("parseCliTargets", () => {
  it("parses comma-separated and repeated values", () => {
    expect(parseCliTargets(["claude,codex", "codex"])).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("throws on invalid values", () => {
    expect(() => parseCliTargets("claude,invalid")).toThrow(InitError);
  });
});

// ─── parseScope tests ───────────────────────────────────────────────────────

describe("parseScope", () => {
  it("returns undefined for undefined input", () => {
    expect(parseScope(undefined)).toBeUndefined();
  });

  it("parses valid scopes", () => {
    expect(parseScope("project")).toBe("project");
    expect(parseScope("user")).toBe("user");
  });

  it("throws on invalid scope", () => {
    expect(() => parseScope("local")).toThrow(InitError);
    expect(() => parseScope("invalid")).toThrow(InitError);
  });
});

// ─── parseClaudeMethods tests ───────────────────────────────────────────────

describe("parseClaudeMethods", () => {
  it("returns undefined for undefined input", () => {
    expect(parseClaudeMethods(undefined)).toBeUndefined();
  });

  it("parses comma-separated and repeated values", () => {
    expect(parseClaudeMethods(["plugin,raw"])).toEqual(["plugin", "raw"]);
    expect(parseClaudeMethods(["plugin", "raw"])).toEqual(["plugin", "raw"]);
  });

  it("deduplicates values", () => {
    expect(parseClaudeMethods(["raw,raw"])).toEqual(["raw"]);
  });

  it("throws on invalid values", () => {
    expect(() => parseClaudeMethods("invalid")).toThrow(InitError);
    expect(() => parseClaudeMethods("plugin,bad")).toThrow(InitError);
  });
});

// ─── initCommand tests ──────────────────────────────────────────────────────

describe("initCommand", () => {
  it("init skill forwards Codex target/scope flags", async () => {
    process.chdir(tmpDir);

    await initCommand.parseAsync(
      ["skill", "--cli", "codex", "--scope", "project"],
      {
        from: "user",
      }
    );

    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });

  it("init skill forwards Claude method flags", async () => {
    process.chdir(tmpDir);

    await initCommand.parseAsync(
      ["skill", "--cli", "claude", "--scope", "project", "--claude-method", "raw"],
      {
        from: "user",
      }
    );

    expect(
      fs.existsSync(path.join(tmpDir, ".claude", "skills", "convoy"))
    ).toBe(true);
  });

  it("root init forwards flags to skill phase", async () => {
    process.chdir(tmpDir);
    mockResolveConfigFromProfileCommand.mockReturnValue({
      convexUrl: undefined,
      apiKey: undefined,
      projectId: undefined,
    });

    await initCommand.parseAsync(
      ["--cli", "codex", "--scope", "project"],
      {
        from: "user",
      }
    );

    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });

  it("init mcp --cli codex writes only .codex/config.toml", async () => {
    process.chdir(tmpDir);
    mockResolveConfigFromProfileCommand.mockReturnValue({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
    });
    const mockClient = {
      query: vi.fn().mockResolvedValue([
        {
          _id: "proj123",
          name: "Web App",
          alias: "WEB",
          organizationId: "org123",
          organizationName: "Acme",
          organizationSlug: "acme",
          role: { name: "org-owner", permissions: ["*"] },
        },
      ]),
      mutation: vi.fn(),
      action: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      client: {} as unknown,
      secrets: [],
    };
    mockCreateConvexClient.mockReturnValue(
      mockClient as ReturnType<typeof createConvexClient>
    );

    await initCommand.parseAsync(["mcp", "--cli", "codex", "--force"], {
      from: "user",
    });

    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(true);
  });

  it("init mcp without --cli leaves the global Antigravity server alone, and --cli antigravity replaces it", async () => {
    process.chdir(tmpDir);
    mockResolveConfigFromProfileCommand.mockReturnValue({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
    });
    mockCreateConvexClient.mockReturnValue({
      query: vi.fn().mockResolvedValue([
        { _id: "proj123", name: "Web App", alias: "WEB", organizationId: "org123", organizationName: "Acme", organizationSlug: "acme", role: { name: "org-owner", permissions: ["*"] } },
      ]),
      mutation: vi.fn(),
      action: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      client: {} as unknown,
      secrets: [],
    } as ReturnType<typeof createConvexClient>);
    const agyConfigPath = path.join(tmpDir, "home", ".gemini", "config", "mcp_config.json");
    fs.mkdirSync(path.dirname(agyConfigPath), { recursive: true });
    fs.writeFileSync(agyConfigPath, JSON.stringify({ mcpServers: { convoy: { serverUrl: "project-a" } } }), "utf-8");
    const agyServerUrl = () => JSON.parse(fs.readFileSync(agyConfigPath, "utf-8")).mcpServers.convoy.serverUrl;

    await initCommand.parseAsync(["mcp", "--force"], { from: "user" });
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
    expect(agyServerUrl()).toBe("project-a");

    await initCommand.parseAsync(["mcp", "--cli", "antigravity", "--force"], { from: "user" });
    expect(agyServerUrl()).toBe("https://happy-animal-123.convex.site/api/mcp?project=acme/WEB");
  });

  it("root init uses one interactive target selection for MCP and skills", async () => {
    process.chdir(tmpDir);
    process.stdin.isTTY = true;
    mockResolveConfigFromProfileCommand.mockReturnValue({
      convexUrl: "https://happy-animal-123.convex.cloud",
      apiKey: "sk_user_test123",
      projectId: "proj123",
    });
    const mockClient = {
      query: vi.fn().mockResolvedValue([
        {
          _id: "proj123",
          name: "Web App",
          alias: "WEB",
          organizationId: "org123",
          organizationName: "Acme",
          organizationSlug: "acme",
          role: { name: "org-owner", permissions: ["*"] },
        },
      ]),
      mutation: vi.fn(),
      action: vi.fn(),
      subscribe: vi.fn(),
      close: vi.fn(),
      client: {} as unknown,
      secrets: [],
    };
    mockCreateConvexClient.mockReturnValue(
      mockClient as ReturnType<typeof createConvexClient>
    );

    mockCheckbox.mockResolvedValueOnce(["codex"]);
    mockSelect.mockResolvedValueOnce("project");

    await initCommand.parseAsync(["--force"], { from: "user" });

    expect(mockCheckbox).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".codex", "config.toml"))).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, ".agents", "skills", "convoy"))
    ).toBe(true);
  });
});

// ─── getMarketplaceDir tests ─────────────────────────────────────────────────

describe("getMarketplaceDir", () => {
  it("returns a valid path or throws informative error", () => {
    try {
      const dir = getMarketplaceDir();
      // If it succeeds (e.g., in dev), verify it's valid
      expect(fs.existsSync(dir)).toBe(true);
      expect(
        fs.existsSync(path.join(dir, ".claude-plugin/marketplace.json"))
      ).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "marketplace directory not found"
      );
    }
  });
});
