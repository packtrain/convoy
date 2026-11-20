import { redactAuth } from "../../../lib/config/convex-client.js";
import type { CodexAuth } from "../../../lib/config/credentials/validators.js";
import { PROVIDER_LABELS } from "../../../lib/config/provider-keys.js";
import type { CodexProviderKey } from "../../../lib/config/types.js";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { JsonRpc } from "../json-rpc.js";

/** Codex's built-in AWS providers. See docs/specs/cli-provider-keys.md → Codex. */
export const CODEX_AWS_PROVIDER_IDS = { mantle: "amazon-bedrock", bedrock: "amazon-bedrock-runtime" } as const;

/** The host Codex calls for an AWS provider, e.g. for a firewall allowlist. */
export function codexAwsHost({ provider, region }: { provider: "mantle" | "bedrock"; region: string }): string {
  return provider === "mantle" ? `bedrock-mantle.${region}.api.aws` : `bedrock-runtime.${region}.amazonaws.com`;
}

export function codexProviderLabel(provider: CodexProviderKey): string {
  return PROVIDER_LABELS[provider.provider];
}

/** Per-process provider selection; the token travels only in the child env. */
export function codexProviderArgs(provider?: CodexProviderKey): string[] {
  if (!provider) return [];
  return [
    "-c", `model_provider="${CODEX_AWS_PROVIDER_IDS[provider.provider]}"`,
    // Hosted web search is unavailable on Bedrock Runtime.
    ...(provider.provider === "bedrock" ? ["-c", 'web_search="disabled"'] : []),
  ];
}

export function codexProviderEnv(env: NodeJS.ProcessEnv, provider?: CodexProviderKey): NodeJS.ProcessEnv {
  if (!provider) return env;
  return { ...env, AWS_BEARER_TOKEN_BEDROCK: provider.token, AWS_REGION: provider.region };
}

/** The credential to redact from Codex output, if any. */
export function codexSecret(auth?: CodexAuth, provider?: CodexProviderKey): string | undefined {
  return auth?.mode === "managed" ? auth.secret : provider?.token;
}

/** Effective config must select the built-in AWS provider; native login is never consulted. */
export async function assertCodexProvider(rpc: JsonRpc, provider: CodexProviderKey): Promise<void> {
  const id = CODEX_AWS_PROVIDER_IDS[provider.provider];
  const label = codexProviderLabel(provider);
  let response: unknown;
  try {
    response = await withTimeout(rpc.request("config/read", { includeLayers: false }), "timed out");
  } catch (error) {
    throw new Error(`Could not read the Codex configuration for ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const config = isRecord(response) && isRecord(response.config) ? response.config : {};
  if (config.model_provider !== id) {
    throw new Error(`Codex did not select ${label} (effective model_provider: ${JSON.stringify(config.model_provider ?? null)}). Check profile settings in ~/.codex/config.toml.`);
  }
  if (isRecord(config.model_providers) && id in config.model_providers) {
    throw new Error(`~/.codex/config.toml overrides the built-in "${id}" provider. Remove [model_providers.${id}] to run Codex on ${label} from Convoy.`);
  }
  if (config.service_tier != null && config.service_tier !== "default") {
    throw new Error(`Fast mode is not available on ${label}. Remove service_tier = ${JSON.stringify(config.service_tier)} from ~/.codex/config.toml.`);
  }
}

export function managedAuthArgs(auth?: CodexAuth): string[] {
  if (auth?.mode !== "managed") return [];
  return ["-c", 'cli_auth_credentials_store="ephemeral"', "-c", 'forced_login_method="api"', "-c", 'model_provider="openai"'];
}

export function managedAuthEnv(env: NodeJS.ProcessEnv, auth?: CodexAuth): NodeJS.ProcessEnv {
  if (auth?.mode !== "managed") return env;
  const result = { ...env };
  for (const key of Object.keys(result))
    if (/^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|AZURE_OPENAI_|AWS_)/.test(key)) delete result[key];
  return result;
}

export async function authenticateCodex(rpc: JsonRpc, auth?: CodexAuth): Promise<void> {
  if (auth?.mode !== "managed") return;
  try {
    await withTimeout(
      (async () => {
        const config = (await rpc.request("config/read", { includeLayers: false })) as { config?: Record<string, unknown> };
        if (
          config.config?.cli_auth_credentials_store !== "ephemeral" ||
          config.config?.forced_login_method !== "api" ||
          config.config?.model_provider !== "openai"
        )
          throw new Error("Incompatible settings");
        const endpoint = config.config?.openai_base_url;
        if (endpoint != null && endpoint !== "https://api.openai.com/v1") throw new Error("OpenAI endpoint override is not supported");
        const providers = config.config?.model_providers;
        if (providers && typeof providers === "object" && "openai" in providers)
          throw new Error("OpenAI provider override is not supported");
        await rpc.request("account/login/start", { type: "apiKey", apiKey: auth.secret });
        const account = (await rpc.request("account/read", { refreshToken: false })) as { account?: { type?: string } };
        if (account.account?.type !== "apiKey") throw new Error("Unexpected auth mode");
      })(),
      "Authentication timeout"
    );
  } catch {
    throw new Error(
      "Managed Codex authentication setup failed. Check runtime compatibility, API login policy and the assigned key; native login was not used."
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), 15000)))]);
  } finally {
    clearTimeout(timer);
  }
}

export function redactAuthParams(params: Record<string, unknown>, secret?: string): Record<string, unknown> {
  if (!secret) return params;
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return redactAuth(value, secret);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactAuth(key, secret), clean(item)]));
    return value;
  };
  return clean(params) as Record<string, unknown>;
}

/** A best-effort probe: only an explicit required-but-missing account blocks a run. */
export async function checkNativeCodexAuth(rpc: JsonRpc): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let account: unknown;
  try {
    account = await Promise.race([
      rpc.request("account/read", { refreshToken: false }),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 5000); }),
    ]);
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
  if (isRecord(account) && account.account === null && account.requiresOpenaiAuth === true) {
    throw new Error("Codex is not authenticated. OpenAI authentication is required by the configured provider.");
  }
}
