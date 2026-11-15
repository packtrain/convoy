import * as fs from "node:fs";
import * as path from "node:path";
import * as TOML from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeDriver, getClaudeSkillDestination } from "./init/targets/claude.js";
import { codexDriver, getCodexSkillDestination } from "./init/targets/codex.js";
import { opencodeDriver, getOpencodeSkillDestination } from "./init/targets/opencode.js";
import { getInitDriver, getInitDrivers } from "./init/targets/registry.js";

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
