import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readMcpConfig,
  writeMcpConfig,
  upsertConvoyServer,
  isMcpJsonGitignored,
  type McpConfig,
  type McpServerConfig,
} from "./claude-mcp.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? process.cwd(), ".tmp-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("readMcpConfig", () => {
  it("returns undefined when .mcp.json does not exist", () => {
    expect(readMcpConfig(tmpDir)).toBeUndefined();
  });

  it("reads and parses existing .mcp.json", () => {
    const config: McpConfig = {
      mcpServers: {
        other: {
          type: "http",
          url: "https://example.com",
          headers: {},
        },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify(config),
      "utf-8"
    );

    expect(readMcpConfig(tmpDir)).toEqual(config);
  });

  it("throws on malformed JSON", () => {
    fs.writeFileSync(path.join(tmpDir, ".mcp.json"), "not json", "utf-8");
    expect(() => readMcpConfig(tmpDir)).toThrow();
  });

  it("throws on valid JSON missing mcpServers key", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".mcp.json"),
      JSON.stringify({ servers: {} }),
      "utf-8"
    );
    expect(() => readMcpConfig(tmpDir)).toThrow(
      'expected an object with "mcpServers" key'
    );
  });
});

describe("writeMcpConfig", () => {
  it("writes .mcp.json with pretty formatting", () => {
    const config: McpConfig = {
      mcpServers: {
        convoy: {
          type: "http",
          url: "https://test.convex.site/api/mcp",
          headers: { Authorization: "Bearer sk_user_test" },
        },
      },
    };
    writeMcpConfig(tmpDir, config);

    const content = fs.readFileSync(
      path.join(tmpDir, ".mcp.json"),
      "utf-8"
    );
    expect(content).toBe(JSON.stringify(config, null, 2) + "\n");
  });
});

describe("upsertConvoyServer", () => {
  const server: McpServerConfig = {
    type: "http",
    url: "https://test.convex.site/api/mcp?project=acme/WEB",
    headers: { Authorization: "Bearer sk_user_test" },
  };

  it("creates new config when none exists", () => {
    const result = upsertConvoyServer(undefined, server);
    expect(result).toEqual({
      mcpServers: { convoy: server },
    });
  });

  it("adds convoy to existing config with other servers", () => {
    const existing: McpConfig = {
      mcpServers: {
        other: {
          type: "http",
          url: "https://other.example.com",
          headers: {},
        },
      },
    };
    const result = upsertConvoyServer(existing, server);
    expect(result.mcpServers.other).toEqual(existing.mcpServers.other);
    expect(result.mcpServers.convoy).toEqual(server);
  });

  it("overwrites existing convoy entry", () => {
    const existing: McpConfig = {
      mcpServers: {
        convoy: {
          type: "http",
          url: "https://old.convex.site/api/mcp",
          headers: { Authorization: "Bearer old_key" },
        },
      },
    };
    const result = upsertConvoyServer(existing, server);
    expect(result.mcpServers.convoy).toEqual(server);
  });
});

describe("isMcpJsonGitignored", () => {
  it("returns false when no .gitignore exists", () => {
    expect(isMcpJsonGitignored(tmpDir)).toBe(false);
  });

  it("returns false when .gitignore does not include .mcp.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "node_modules\n.env\n",
      "utf-8"
    );
    expect(isMcpJsonGitignored(tmpDir)).toBe(false);
  });

  it("returns true when .gitignore includes .mcp.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "node_modules\n.mcp.json\n",
      "utf-8"
    );
    expect(isMcpJsonGitignored(tmpDir)).toBe(true);
  });

  it("returns true when .gitignore includes /.mcp.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gitignore"),
      "/.mcp.json\n",
      "utf-8"
    );
    expect(isMcpJsonGitignored(tmpDir)).toBe(true);
  });
});
