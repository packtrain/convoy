import { codexProviderKeyIssue, PROVIDER_KEY_FIELDS, type Profile, type ProviderKey, type ProviderKeyRuntime } from "./types.js";
import { getProviderKey } from "./toml.js";
import type { ClaudeAuth } from "./credentials/validators.js";

export interface ResolvedProviderKey {
  name: string;
  key: ProviderKey;
}

export const PROVIDER_LABELS: Record<ProviderKey["provider"], string> = {
  bedrock: "AWS Bedrock",
  mantle: "AWS Bedrock (Mantle)",
  anthropic: "Claude.ai subscription",
};

/** Managed store entries (`keys status`, TUI); here `anthropic` is an API key, not the sign-in entry. */
export const MANAGED_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", mantle: PROVIDER_LABELS.mantle, bedrock: PROVIDER_LABELS.bedrock, cursor: "Cursor account key", gemini: "Gemini",
};

/** Providers that carry a credential; `anthropic` uses the machine's sign-in. */
export function providerRequiresToken(provider: ProviderKey["provider"]): boolean {
  return provider !== "anthropic";
}

/**
 * Resolve the key a profile assigns to a runtime. Throws when the profile
 * references a key that no longer exists (or no longer suits Codex) —
 * connecting silently on the machine's default config would be a misconfiguration.
 */
export function resolveProfileProviderKey(
  profile: Profile,
  runtime: ProviderKeyRuntime = "claude-code"
): ResolvedProviderKey | undefined {
  const name = profile[PROVIDER_KEY_FIELDS[runtime]];
  if (!name) {
    return undefined;
  }
  const key = getProviderKey(name);
  const unassign = runtime === "codex" ? "convoy keys unassign --runtime codex" : "convoy keys unassign";
  if (!key) {
    throw new Error(
      `Profile references provider key "${name}" which is not defined in config.toml. Run 'convoy keys list' or '${unassign}'.`
    );
  }
  const issue = runtime === "codex" ? codexProviderKeyIssue(name, key) : undefined;
  if (issue) {
    throw new Error(`${issue} Fix the key or run '${unassign}'.`);
  }
  return { name, key };
}

/**
 * Resolve a provider key by explicit name (the `--provider-key` connect
 * override). Throws when the key does not exist in config.toml.
 */
export function resolveProviderKeyByName(name: string): ResolvedProviderKey {
  const key = getProviderKey(name);
  if (!key) {
    throw new Error(
      `Provider key "${name}" is not defined in config.toml. Run 'convoy keys list' to see available keys.`
    );
  }
  return { name, key };
}

/**
 * Environment the CLI process (and every spawned agent) gets when a provider key is
 * assigned. Mirrors a manual Claude Code Bedrock/Mantle setup; explicit "0"/"1" flags so
 * machine-level config cannot bleed in.
 *
 * `anthropic` emits only the "0" flags: they travel through `--settings`, which outranks
 * `~/.claude/settings.json`, so the run lands on the machine's Claude sign-in even where
 * Bedrock is enabled globally. A lingering AWS_BEARER_TOKEN_BEDROCK needs no unsetting —
 * Claude Code ignores it while the flags are off.
 */
export function buildProviderKeyEnv(key: ProviderKey): Record<string, string> {
  // Vertex and Foundry are switched off too, so a settings file enabling one cannot compete.
  const otherClouds = { CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_FOUNDRY: "0" };
  if (key.provider === "anthropic") {
    return { CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_MANTLE: "0", ...otherClouds };
  }

  const env: Record<string, string> = {
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_MANTLE: key.provider === "mantle" ? "1" : "0",
    ...otherClouds,
    ...(key.token ? { AWS_BEARER_TOKEN_BEDROCK: key.token } : {}),
  };
  if (key.region) {
    env.AWS_REGION = key.region;
  }
  return env;
}

/**
 * Provider env of a managed Claude Code credential (OS-2108); none when disabled. An Anthropic key
 * clears every env source that outranks or replaces it and pins the endpoint (OS-2016).
 */
export function claudeAuthEnv(auth?: ClaudeAuth): Record<string, string> | undefined {
  if (!auth || auth.mode === "disabled") return undefined;
  if (auth.mode === "anthropic")
    return {
      ...buildProviderKeyEnv({ provider: "anthropic" }),
      ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_CUSTOM_HEADERS: "", ANTHROPIC_API_KEY: auth.secret, ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    };
  return buildProviderKeyEnv({ provider: auth.mode, token: auth.secret, region: auth.region });
}

/**
 * Marker env var carrying the provider env as JSON from `convoy connect`
 * to the Claude Code runner, which re-sends it via the `--settings` CLI
 * layer (see buildProviderSettingsJson).
 */
export const CLAUDE_PROVIDER_ENV_VAR = "CONVOY_CLAUDE_PROVIDER_ENV";

/** Values the Claude override replaced, so Codex children still see the machine's own env. */
const envBeforeProviderKey = new Map<string, string | undefined>();

export function applyProviderKeyEnv(env: Record<string, string>): void {
  for (const name of [...Object.keys(env), CLAUDE_PROVIDER_ENV_VAR]) {
    if (!envBeforeProviderKey.has(name)) envBeforeProviderKey.set(name, process.env[name]);
  }
  Object.assign(process.env, env, {
    [CLAUDE_PROVIDER_ENV_VAR]: JSON.stringify(env),
  });
}

/** `env` with the Claude provider override undone: Codex never inherits Claude's key (OS-2105). */
export function withoutClaudeProviderEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const [name, value] of envBeforeProviderKey) {
    if (value === undefined) delete result[name];
    else result[name] = value;
  }
  return result;
}

/**
 * Claude Code applies `env` from ~/.claude/settings.json ON TOP of its process
 * environment, so inherited vars alone lose to machine settings. Command-line
 * `--settings` outranks user settings, so the runner re-sends the provider env through
 * that layer; the user's file is never modified. Undefined when the marker is absent or
 * malformed.
 */
export function buildProviderSettingsJson(
  markerValue: string | undefined
): string | undefined {
  const env = parseProviderKeyEnv(markerValue);
  return env ? JSON.stringify({ env }) : undefined;
}

/** Parse the marker value back into the injected provider env. */
export function parseProviderKeyEnv(
  markerValue: string | undefined
): Record<string, string> | undefined {
  if (!markerValue) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(markerValue) as Record<string, unknown>;
    const env = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
    return Object.keys(env).length > 0 ? env : undefined;
  } catch {
    return undefined;
  }
}

