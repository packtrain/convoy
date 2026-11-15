import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getCodexMcpConfigPath,
  hasCodexConvoyServer,
  isCodexMcpConfigGitignored,
  readCodexMcpConfig,
  upsertCodexConvoyServer,
  writeCodexMcpConfig,
  type CodexMcpServerConfig,
} from "./codex-mcp.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? process.cwd(), ".tmp-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("codex mcp config", () => {
  const convoyServer: CodexMcpServerConfig = {
    url: "https://happy-animal-123.convex.site/api/mcp?project=acme/WEB",
    http_headers: { Authorization: "Bearer sk_user_test" },
  };

  it("creates .codex/config.toml when missing", () => {
    const merged = upsertCodexConvoyServer(undefined, convoyServer);
    writeCodexMcpConfig(tmpDir, merged);

    const filePath = getCodexMcpConfigPath(tmpDir);
    expect(fs.existsSync(filePath)).toBe(true);

    const parsed = readCodexMcpConfig(tmpDir);
    expect(parsed).toBeDefined();
    expect(hasCodexConvoyServer(parsed)).toBe(true);
  });

  it("merges with existing non-convoy servers", () => {
    const existing = {
      mcp_servers: {
        trigger: {
          command: "npx",
          args: ["trigger.dev@latest", "mcp"],
        },
      },
    };
    writeCodexMcpConfig(tmpDir, existing);

    const merged = upsertCodexConvoyServer(
      readCodexMcpConfig(tmpDir),
      convoyServer
    );
    writeCodexMcpConfig(tmpDir, merged);

    const parsed = readCodexMcpConfig(tmpDir) as Record<string, unknown>;
    const table = parsed.mcp_servers as Record<string, unknown>;
    expect(table.trigger).toBeDefined();
    expect(table.convoy).toBeDefined();
  });

  it("detects existing convoy entry", () => {
    const existing = {
      mcp_servers: {
        convoy: {
          url: "https://old.example.com/api/mcp",
          http_headers: { Authorization: "Bearer old" },
        },
      },
    };
    writeCodexMcpConfig(tmpDir, existing);

    expect(hasCodexConvoyServer(readCodexMcpConfig(tmpDir))).toBe(true);
  });

  it("preserves mcp_servers style when present", () => {
    const existing = {
      mcp_servers: {
        trigger: {
          command: "npx",
          args: ["trigger.dev@latest", "mcp"],
        },
      },
    };
    const merged = upsertCodexConvoyServer(existing, convoyServer);
    expect("mcp_servers" in merged).toBe(true);
    expect("mcpServers" in merged).toBe(false);
  });

  it("preserves mcpServers style when present", () => {
    const existing = {
      mcpServers: {
        trigger: {
          command: "npx",
          args: ["trigger.dev@latest", "mcp"],
        },
      },
    };
    const merged = upsertCodexConvoyServer(existing, convoyServer);
    expect("mcpServers" in merged).toBe(true);
    expect("mcp_servers" in merged).toBe(false);
  });

  it("defaults to mcp_servers style for new files", () => {
    const merged = upsertCodexConvoyServer(undefined, convoyServer);
    expect("mcp_servers" in merged).toBe(true);
  });
});

describe("isCodexMcpConfigGitignored", () => {
  it("returns false without .gitignore", () => {
    expect(isCodexMcpConfigGitignored(tmpDir)).toBe(false);
  });

  it("returns true for .codex", () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), ".codex\n", "utf-8");
    expect(isCodexMcpConfigGitignored(tmpDir)).toBe(true);
  });

  it("returns true for /.codex", () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "/.codex\n", "utf-8");
    expect(isCodexMcpConfigGitignored(tmpDir)).toBe(true);
  });

  it("returns true for .codex/config.toml", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      ".codex/config.toml\n",
      "utf-8"
    );
    expect(isCodexMcpConfigGitignored(tmpDir)).toBe(true);
  });

  it("returns false when no codex path is ignored", () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), ".mcp.json\n", "utf-8");
    expect(isCodexMcpConfigGitignored(tmpDir)).toBe(false);
  });
});
