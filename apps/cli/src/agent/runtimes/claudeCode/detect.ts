import { execFile } from "child_process";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "util";
import type { CliRuntimeDetectOptions, DetectedCli } from "../contracts.js";
import {
  CLAUDE_PROVIDER_ENV_VAR,
  claudeAuthEnv,
  parseProviderKeyEnv,
} from "../../../lib/config/provider-keys.js";
import type { ClaudeCodeProvider } from "./models.js";

const execFileAsync = promisify(execFile);

export type ClaudeSettings = {
  env?: Record<string, unknown>;
  model?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function getClaudeSettingsPath(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? os.homedir();
  if (!home) {
    return null;
  }

  return path.join(home, ".claude", "settings.json");
}

async function readClaudeSettings(): Promise<ClaudeSettings | null> {
  const settingsPath = getClaudeSettingsPath();
  if (!settingsPath) {
    return null;
  }

  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as ClaudeSettings;
  } catch {
    return null;
  }
}

function getSettingsEnvValue(
  settings: ClaudeSettings | null,
  key: string
): string | undefined {
  if (!settings?.env || typeof settings.env !== "object") {
    return undefined;
  }

  return asNonEmptyString(settings.env[key]);
}

export function detectProvider(
  settings: ClaudeSettings | null,
  providerEnv = parseProviderKeyEnv(process.env[CLAUDE_PROVIDER_ENV_VAR])
): ClaudeCodeProvider {
  // Mirror Claude Code's own per-variable layering, or the detected provider won't match the
  // backend the spawned agent talks to: `--settings` (the env `connect` or a managed key injects) >
  // ~/.claude/settings.json `env` > inherited process env. Trusting process env first misreads
  // a machine whose settings file enables Bedrock over inherited opt-out flags — e.g. the
  // devcontainer, which forwards the host's flags into a container with its own settings.
  const envValue = (key: string) =>
    asNonEmptyString(providerEnv?.[key]) ??
    getSettingsEnvValue(settings, key) ??
    asNonEmptyString(process.env[key]);

  // Mantle proxies Bedrock and sets the same Bedrock flags/token, so it must be
  // detected first. Its models use Bedrock names without the `us.` prefix.
  if (envValue("CLAUDE_CODE_USE_MANTLE") === "1") {
    return "mantle";
  }

  const bedrockFlag = envValue("CLAUDE_CODE_USE_BEDROCK");
  if (bedrockFlag === "1") {
    return "bedrock";
  }
  // An explicit opt-out ("0") beats the heuristics below: Claude Code ignores
  // a stored Bedrock token unless CLAUDE_CODE_USE_BEDROCK is enabled, so a
  // lingering token must not flip the provider to Bedrock.
  if (bedrockFlag !== undefined) {
    return "anthropic";
  }

  if (envValue("AWS_BEARER_TOKEN_BEDROCK")) {
    return "bedrock";
  }

  const configuredDefaultModel = asNonEmptyString(settings?.model);
  if (configuredDefaultModel?.startsWith("us.anthropic.")) {
    return "bedrock";
  }

  return "anthropic";
}

export type AvailableClaudeCli = DetectedCli & {
  type: "claude-code";
  provider: ClaudeCodeProvider;
};

/**
 * Oldest Claude Code major version known to support the Agent SDK control
 * protocol features the runner relies on (stream-json IO + initialize
 * handshake). Older binaries may still work but are unsupported.
 */
const MIN_SUPPORTED_CLAUDE_MAJOR = 2;

function warnOnUnsupportedVersion(version: string): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major >= MIN_SUPPORTED_CLAUDE_MAJOR) {
    return;
  }

  console.warn(
    `Warning: detected Claude Code ${version}; version ${MIN_SUPPORTED_CLAUDE_MAJOR}.x or newer is recommended for SDK-backed execution. Run \`claude update\`.`
  );
}

export async function detectClaudeCode(options?: CliRuntimeDetectOptions): Promise<AvailableClaudeCli | null> {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"]);
    const out = String(stdout ?? "").trim();
    const version = out.match(/(\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
    const settings = await readClaudeSettings();

    if (version !== "unknown") {
      warnOnUnsupportedVersion(version);
    }

    return {
      type: "claude-code",
      version,
      provider: detectProvider(settings, claudeAuthEnv(options?.claudeAuth)),
    };
  } catch {
    return null;
  }
}
