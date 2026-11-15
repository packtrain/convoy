import * as fs from "node:fs";
import * as path from "node:path";

type AnyRecord = Record<string, unknown>;

/** OpenCode remote MCP server entry (`opencode.json` `mcp` key). */
export interface OpencodeMcpServerConfig {
  type: "remote";
  url: string;
  headers: Record<string, string>;
  /** Bearer header auth — disable OpenCode's OAuth auto-detection. */
  oauth: false;
}

const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getOpencodeMcpConfigPath(dir: string): string {
  return path.join(dir, "opencode.json");
}

export function readOpencodeMcpConfig(dir: string): AnyRecord | undefined {
  const filePath = getOpencodeMcpConfigPath(dir);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("Invalid opencode.json: expected a top-level JSON object");
  }
  return parsed;
}

export function hasOpencodeConvoyServer(
  config: AnyRecord | undefined,
): boolean {
  if (!config) {
    return false;
  }
  const mcp = config.mcp;
  return isRecord(mcp) && "convoy" in mcp;
}

export function upsertOpencodeConvoyServer(
  existing: AnyRecord | undefined,
  server: OpencodeMcpServerConfig,
): AnyRecord {
  const config: AnyRecord = existing
    ? { ...existing }
    : { $schema: OPENCODE_CONFIG_SCHEMA };

  if ("mcp" in config && !isRecord(config.mcp)) {
    throw new Error('Invalid opencode.json: expected "mcp" to be an object');
  }

  const mcp: AnyRecord = isRecord(config.mcp) ? { ...config.mcp } : {};
  mcp.convoy = server;
  config.mcp = mcp;
  return config;
}

export function writeOpencodeMcpConfig(dir: string, config: AnyRecord): void {
  const filePath = getOpencodeMcpConfigPath(dir);
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function isOpencodeMcpConfigGitignored(dir: string): boolean {
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return false;

  const content = fs.readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === "opencode.json" || line === "/opencode.json");
}
