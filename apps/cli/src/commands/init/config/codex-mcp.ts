import * as fs from "node:fs";
import * as path from "node:path";
import * as TOML from "smol-toml";

type AnyRecord = Record<string, unknown>;

export interface CodexMcpServerConfig {
  url: string;
  http_headers: Record<string, string>;
}

type CodexMcpTableKey = "mcp_servers" | "mcpServers";

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null;
}

function resolveTableKey(config: AnyRecord): CodexMcpTableKey {
  const hasSnake = "mcp_servers" in config;
  if (hasSnake) {
    const value = config.mcp_servers;
    if (!isRecord(value)) {
      throw new Error(
        'Invalid .codex/config.toml: expected "mcp_servers" to be a table'
      );
    }
    return "mcp_servers";
  }

  const hasCamel = "mcpServers" in config;
  if (hasCamel) {
    const value = config.mcpServers;
    if (!isRecord(value)) {
      throw new Error(
        'Invalid .codex/config.toml: expected "mcpServers" to be a table'
      );
    }
    return "mcpServers";
  }

  return "mcp_servers";
}

export function getCodexMcpConfigPath(dir: string): string {
  return path.join(dir, ".codex", "config.toml");
}

export function readCodexMcpConfig(dir: string): AnyRecord | undefined {
  const filePath = getCodexMcpConfigPath(dir);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = TOML.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(
      "Invalid .codex/config.toml: expected a top-level TOML table"
    );
  }
  return parsed;
}

export function hasCodexConvoyServer(config: AnyRecord | undefined): boolean {
  if (!config) {
    return false;
  }

  const tableKey = resolveTableKey(config);
  const table = config[tableKey];
  if (!isRecord(table)) {
    return false;
  }

  return "convoy" in table;
}

export function upsertCodexConvoyServer(
  existing: AnyRecord | undefined,
  server: CodexMcpServerConfig
): AnyRecord {
  const config: AnyRecord = existing ? { ...existing } : {};
  const tableKey = resolveTableKey(config);
  const existingTable = config[tableKey];
  const table: AnyRecord = isRecord(existingTable) ? { ...existingTable } : {};

  table.convoy = server;
  config[tableKey] = table;
  return config;
}

export function writeCodexMcpConfig(dir: string, config: AnyRecord): void {
  const filePath = getCodexMcpConfigPath(dir);
  const codexDir = path.dirname(filePath);
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  const content = TOML.stringify(config);
  fs.writeFileSync(filePath, content, "utf-8");
}

export function isCodexMcpConfigGitignored(dir: string): boolean {
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return false;

  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .some(
      (line) =>
        line === ".codex" ||
        line === "/.codex" ||
        line === ".codex/config.toml" ||
        line === "/.codex/config.toml"
    );
}
