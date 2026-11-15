import * as fs from "node:fs";
import * as path from "node:path";

export interface McpServerConfig {
  type: string;
  url: string;
  headers: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

function isMcpConfig(value: unknown): value is McpConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "mcpServers" in value &&
    typeof (value as McpConfig).mcpServers === "object" &&
    (value as McpConfig).mcpServers !== null
  );
}

/**
 * Read existing .mcp.json from the given directory.
 * Returns undefined if file doesn't exist.
 * Returns a validated McpConfig, or throws on malformed content.
 */
export function readMcpConfig(dir: string): McpConfig | undefined {
  const filePath = path.join(dir, ".mcp.json");
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(content);

  if (!isMcpConfig(parsed)) {
    throw new Error(
      `Invalid .mcp.json: expected an object with "mcpServers" key.`
    );
  }

  return parsed;
}

/**
 * Write .mcp.json to the given directory.
 */
export function writeMcpConfig(dir: string, config: McpConfig): void {
  const filePath = path.join(dir, ".mcp.json");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Upsert the convoy MCP server entry into an existing or new config.
 * Preserves other servers in the config.
 */
export function upsertConvoyServer(
  existing: McpConfig | undefined,
  server: McpServerConfig
): McpConfig {
  const config: McpConfig = existing ?? { mcpServers: {} };
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers.convoy = server;
  return config;
}

/**
 * Check if .mcp.json is listed in .gitignore.
 */
export function isMcpJsonGitignored(dir: string): boolean {
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .some((line) => line.trim() === ".mcp.json" || line.trim() === "/.mcp.json");
}
