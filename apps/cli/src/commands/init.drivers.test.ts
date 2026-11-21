import * as fs from "node:fs";
import * as path from "node:path";
import * as TOML from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeDriver, getClaudeSkillDestination } from "./init/targets/claude.js";
import { codexDriver, getCodexSkillDestination } from "./init/targets/codex.js";
import { opencodeDriver, getOpencodeSkillDestination } from "./init/targets/opencode.js";
import { antigravityDriver, getAntigravitySkillDestination } from "./init/targets/antigravity.js";
import { getInitDriver, getInitDrivers } from "./init/targets/registry.js";

// Lets a test inspect the file right after each write, before any later chmod.
const { afterWrite } = vi.hoisted(() => ({ afterWrite: { hook: undefined as ((file: unknown) => void) | undefined } }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      actual.writeFileSync(...args);
      afterWrite.hook?.(args[0]);
    },
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? process.cwd(), ".tmp-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("init driver registry", () => {
  it("resolves known drivers", () => {
    expect(getInitDriver("claude").id).toBe("claude");
    expect(getInitDriver("codex").id).toBe("codex");
    expect(getInitDriver("opencode").id).toBe("opencode");
    expect(getInitDriver("antigravity").id).toBe("antigravity");
  });

  it("returns drivers in requested order", () => {
    const drivers = getInitDrivers(["codex", "claude"]);
    expect(drivers.map((driver) => driver.id)).toEqual(["codex", "claude"]);
  });
});

describe("claudeDriver", () => {
  it("writes MCP config to baseDir/.mcp.json", async () => {
    const logs: string[] = [];
    await claudeDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    });

    const mcpPath = path.join(tmpDir, ".mcp.json");
    expect(fs.existsSync(mcpPath)).toBe(true);
    expect(fs.readFileSync(mcpPath, "utf-8")).toContain("mcpServers");
    expect(logs.join("\n")).toContain(".mcp.json");
  });

  it("installs raw skill into project .claude path", async () => {
    const marketplaceDir = path.join(tmpDir, "marketplace");
    const sourceDir = path.join(marketplaceDir, "convoy", "skills", "convoy");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# skill", "utf-8");

    const result = await claudeDriver.installSkill({
      baseDir: tmpDir,
      scope: "project",
      marketplaceDir,
      claudeMethods: ["raw"],
    });

    expect(result[0]?.status).toBe("installed");
    expect(
      fs.existsSync(path.join(getClaudeSkillDestination("project", tmpDir), "SKILL.md"))
    ).toBe(true);
  });

  it("skips overwrite when confirmation is denied", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { convoy: { type: "http", url: "x", headers: {} } } }),
      "utf-8"
    );

    const confirmOverwrite = vi.fn(async () => false);
    await claudeDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite,
      log: { info: () => {}, warn: () => {} },
    });

    expect(confirmOverwrite).toHaveBeenCalledTimes(1);
  });
});

describe("codexDriver", () => {
  it("writes MCP config to baseDir/.codex/config.toml", async () => {
    const logs: string[] = [];
    await codexDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    });

    const configPath = path.join(tmpDir, ".codex", "config.toml");
    expect(fs.existsSync(configPath)).toBe(true);

    const parsed = TOML.parse(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(parsed.mcp_servers).toBeDefined();
    expect(logs.join("\n")).toContain(".codex/config.toml");
  });

  it("installs skill into project .agents path", async () => {
    const marketplaceDir = path.join(tmpDir, "marketplace");
    const sourceDir = path.join(marketplaceDir, "convoy", "skills", "convoy");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# skill", "utf-8");

    const result = await codexDriver.installSkill({
      baseDir: tmpDir,
      scope: "project",
      marketplaceDir,
    });

    expect(result[0]?.status).toBe("installed");
    expect(
      fs.existsSync(path.join(getCodexSkillDestination("project", tmpDir), "SKILL.md"))
    ).toBe(true);
  });

  it("skips overwrite when confirmation is denied", async () => {
    fs.mkdirSync(path.join(tmpDir, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".codex", "config.toml"),
      `[mcp_servers.convoy]\nurl = "x"\nhttp_headers = { Authorization = "Bearer old" }\n`,
      "utf-8"
    );

    const confirmOverwrite = vi.fn(async () => false);
    await codexDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite,
      log: { info: () => {}, warn: () => {} },
    });

    expect(confirmOverwrite).toHaveBeenCalledTimes(1);
  });
});

describe("opencodeDriver", () => {
  it("writes MCP config to baseDir/opencode.json", async () => {
    const logs: string[] = [];
    await opencodeDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      },
    });

    const configPath = path.join(tmpDir, "opencode.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed.mcp.convoy).toEqual({
      type: "remote",
      url: "https://example.convex.site/api/mcp?project=acme/WEB",
      headers: { Authorization: "Bearer sk_user_test" },
      oauth: false,
    });
    expect(logs.join("\n")).toContain("opencode.json");
  });

  it("preserves unrelated opencode.json settings when upserting", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ theme: "dark", mcp: { other: { type: "remote", url: "x" } } }),
      "utf-8"
    );

    await opencodeDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: { info: () => {}, warn: () => {} },
    });

    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf-8")
    ) as Record<string, Record<string, unknown>>;
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcp.other).toEqual({ type: "remote", url: "x" });
    expect(parsed.mcp.convoy).toBeDefined();
  });

  it("installs skill into project .opencode path", async () => {
    const marketplaceDir = path.join(tmpDir, "marketplace");
    const sourceDir = path.join(marketplaceDir, "convoy", "skills", "convoy");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# skill", "utf-8");

    const result = await opencodeDriver.installSkill({
      baseDir: tmpDir,
      scope: "project",
      marketplaceDir,
    });

    expect(result[0]?.status).toBe("installed");
    expect(
      fs.existsSync(
        path.join(getOpencodeSkillDestination("project", tmpDir), "SKILL.md")
      )
    ).toBe(true);
  });

  it("skips overwrite when confirmation is denied", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ mcp: { convoy: { type: "remote", url: "x", headers: {}, oauth: false } } }),
      "utf-8"
    );

    const confirmOverwrite = vi.fn(async () => false);
    await opencodeDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl: "https://example.convex.site/api/mcp?project=acme/WEB",
      apiKey: "sk_user_test",
      confirmOverwrite,
      log: { info: () => {}, warn: () => {} },
    });

    expect(confirmOverwrite).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "opencode.json"), "utf-8")
    ) as Record<string, Record<string, Record<string, unknown>>>;
    expect(parsed.mcp.convoy.url).toBe("x");
  });
});

describe("antigravityDriver", () => {
  const mcpUrl = "https://example.convex.site/api/mcp?project=acme/WEB";
  const configPath = () => path.join(tmpDir, "home", ".gemini", "config", "mcp_config.json");
  const readConfig = () =>
    JSON.parse(fs.readFileSync(configPath(), "utf-8")) as { mcpServers: Record<string, unknown> } & Record<string, unknown>;
  let previousHome: string | undefined;

  beforeEach(() => {
    previousHome = process.env.HOME;
    process.env.HOME = path.join(tmpDir, "home");
  });

  afterEach(() => {
    process.env.HOME = previousHome;
  });

  it("writes the user mcp_config.json in agy's shape, ignoring baseDir", async () => {
    const logs: string[] = [];
    await antigravityDriver.configureMcp({
      baseDir: path.join(tmpDir, "repo"),
      mcpUrl,
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: { info: (message) => logs.push(message), warn: (message) => logs.push(message) },
    });

    expect(readConfig().mcpServers.convoy).toEqual({
      disabled: false,
      headers: { Authorization: "Bearer sk_user_test" },
      serverUrl: mcpUrl,
    });
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(tmpDir, "repo"))).toBe(false);
    expect(logs.join("\n")).toContain(configPath());
    expect(logs.join("\n")).toContain("per user");
  });

  it("treats agy's empty first-start file as no config", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), "", { encoding: "utf-8", mode: 0o644 });

    await antigravityDriver.configureMcp({
      baseDir: tmpDir,
      mcpUrl,
      apiKey: "sk_user_test",
      confirmOverwrite: async () => true,
      log: { info: () => {}, warn: () => {} },
    });

    expect(readConfig().mcpServers.convoy).toBeDefined();
    // The key must not stay readable by others in agy's 0644 file.
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it.each([
    ["agy's existing 0644 file", true],
    ["a new file", false],
  ])("never writes the key while %s is readable by others", async (_name, existing) => {
    if (existing) {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), "", { encoding: "utf-8", mode: 0o644 });
    }
    const modesAtWrite: number[] = [];
    afterWrite.hook = (file) => {
      if (file === configPath()) modesAtWrite.push(fs.statSync(configPath()).mode & 0o077);
    };
    try {
      await antigravityDriver.configureMcp({ baseDir: tmpDir, mcpUrl, apiKey: "k", confirmOverwrite: async () => true, log: { info: () => {}, warn: () => {} } });
    } finally {
      afterWrite.hook = undefined;
    }
    expect(modesAtWrite).toEqual([0]);
  });

  it("keeps other servers and settings, and asks before replacing convoy", async () => {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ extra: 1, mcpServers: { other: { serverUrl: "x" }, convoy: { serverUrl: "old" } } }),
      "utf-8",
    );

    const declined = vi.fn(async () => false);
    await antigravityDriver.configureMcp({ baseDir: tmpDir, mcpUrl, apiKey: "k", confirmOverwrite: declined, log: { info: () => {}, warn: () => {} } });
    expect(declined).toHaveBeenCalledTimes(1);
    expect(readConfig().mcpServers.convoy).toEqual({ serverUrl: "old" });

    await antigravityDriver.configureMcp({ baseDir: tmpDir, mcpUrl, apiKey: "k", force: true, confirmOverwrite: declined, log: { info: () => {}, warn: () => {} } });
    expect(declined).toHaveBeenCalledTimes(1);
    const config = readConfig();
    expect(config.extra).toBe(1);
    expect(config.mcpServers.other).toEqual({ serverUrl: "x" });
    expect(config.mcpServers.convoy).toMatchObject({ serverUrl: mcpUrl });
  });

  it.each([
    ["project", () => path.join(tmpDir, ".agents", "skills", "convoy")],
    ["user", () => path.join(tmpDir, "home", ".gemini", "config", "skills", "convoy")],
  ] as const)("installs the skill at %s scope where agy loads it", async (scope, expected) => {
    const marketplaceDir = path.join(tmpDir, "marketplace");
    const sourceDir = path.join(marketplaceDir, "convoy", "skills", "convoy");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# skill", "utf-8");

    const result = await antigravityDriver.installSkill({ baseDir: tmpDir, scope, marketplaceDir });

    expect(result[0]?.status).toBe("installed");
    expect(getAntigravitySkillDestination(scope, tmpDir)).toBe(expected());
    expect(fs.existsSync(path.join(expected(), "SKILL.md"))).toBe(true);
  });

  it("does not copy the project skill twice when Codex already wrote it", async () => {
    const marketplaceDir = path.join(tmpDir, "marketplace");
    const sourceDir = path.join(marketplaceDir, "convoy", "skills", "convoy");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# skill", "utf-8");
    const preparedDestinations = new Set<string>();
    const confirmOverwrite = vi.fn(async () => true);

    await codexDriver.installSkill({ baseDir: tmpDir, scope: "project", marketplaceDir, preparedDestinations, confirmOverwrite });
    const result = await antigravityDriver.installSkill({ baseDir: tmpDir, scope: "project", marketplaceDir, preparedDestinations, confirmOverwrite });

    expect(result[0]?.status).toBe("installed");
    expect(confirmOverwrite).not.toHaveBeenCalled();
  });
});
