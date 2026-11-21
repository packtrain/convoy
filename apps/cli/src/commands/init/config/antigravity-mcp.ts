import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type AnyRecord = Record<string, unknown>;

/** agy's HTTP MCP entry, in the shape `agy mcp add` writes. */
export interface AntigravityMcpServerConfig {
  disabled: false;
  headers: Record<string, string>;
  serverUrl: string;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** agy reads MCP servers from this user file only; it has no project-scope file. */
export function getAntigravityMcpConfigPath(): string {
  return path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
}

export function readAntigravityMcpConfig(): AnyRecord | undefined {
  const filePath = getAntigravityMcpConfigPath();
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  // agy creates the file empty on first start.
  const content = fs.readFileSync(filePath, "utf-8");
  if (content.trim().length === 0) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Invalid ${filePath}: expected a top-level JSON object`);
  }
  return parsed;
}

export function hasAntigravityConvoyServer(config: AnyRecord | undefined): boolean {
  const servers = config?.mcpServers;
  return isRecord(servers) && "convoy" in servers;
}

export function upsertAntigravityConvoyServer(
  existing: AnyRecord | undefined,
  server: AntigravityMcpServerConfig,
): AnyRecord {
  const config: AnyRecord = existing ? { ...existing } : {};
  if ("mcpServers" in config && !isRecord(config.mcpServers)) {
    throw new Error('Invalid mcp_config.json: expected "mcpServers" to be an object');
  }

  config.mcpServers = {
    ...(isRecord(config.mcpServers) ? config.mcpServers : {}),
    convoy: server,
  };
  return config;
}

export function writeAntigravityMcpConfig(config: AnyRecord): void {
  const filePath = getAntigravityMcpConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // The file holds an API key, and agy creates it 0644: restrict it before the key goes in.
  if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}
