import { z } from "zod";

// =============================================================================
// Config Types (config.toml)
// =============================================================================

/**
 * A stored model-provider entry (`[keys.<name>]` in config.toml). Assigned to profiles
 * via `provider_key`; never sent to the backend.
 *
 * `anthropic` is credential-free: it pins agents to this machine's Claude sign-in, which
 * is how a profile opts out of inherited Bedrock/Mantle flags.
 */
export const ProviderKeySchema = z
  .object({
    provider: z.enum(["bedrock", "mantle", "anthropic"]),
    /** Injected as AWS_BEARER_TOKEN_BEDROCK; unused by `anthropic`. */
    token: z.string().min(1).optional(),
    /** Injected as AWS_REGION when set; unused by `anthropic`. */
    region: z.string().optional(),
  })
  .superRefine((key, ctx) => {
    if (key.provider !== "anthropic" && key.token === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["token"],
        message: `Provider "${key.provider}" requires a token`,
      });
    }
  });

export type ProviderKey = z.infer<typeof ProviderKeySchema>;

const REGION_REQUIRED = "Codex needs an AWS region on the key (convoy keys add <name> --region <region>)";

/** Codex accepts only AWS keys, and bearer-token auth needs an explicit Region (OS-2105). */
export const CodexProviderKeySchema = z.object({
  provider: z.enum(["mantle", "bedrock"], {
    message: "Codex needs a Mantle or Bedrock key",
  }),
  token: z.string().min(1),
  region: z
    .string({ message: REGION_REQUIRED })
    .trim()
    .min(1, REGION_REQUIRED),
});

export type CodexProviderKey = z.infer<typeof CodexProviderKeySchema>;

/** Why a key cannot serve Codex, or undefined when it can. */
export function codexProviderKeyIssue(name: string, key: ProviderKey): string | undefined {
  const result = CodexProviderKeySchema.safeParse(key);
  return result.success ? undefined : `Key "${name}" cannot be used by Codex: ${result.error.issues[0]?.message}.`;
}

/** Runtimes with their own `[keys.*]` assignment on a profile. */
export type ProviderKeyRuntime = "claude-code" | "codex";

/**
 * Profile stored in config.toml
 * Contains all connection info for a project/folder
 */
export const ProfileSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  api_key: z.string(),
  project_id: z.string(),
  paths: z.array(z.string()).min(1),
  /**
   * Default for partial (delta) event streaming; `--buffered` turns it off
   * for a run. On when omitted (OS-1659).
   */
  streaming: z.boolean().optional(),
  /** OS-sandbox agents to this profile's paths (OS-1242); `--isolated` flag wins. */
  isolated: z.boolean().optional(),
  /** Max simultaneous thread workers; `--concurrency` wins. */
  concurrency: z.number().int().min(1).max(50).optional(),
  /** Name of a `[keys.<name>]` entry; absent → the machine's own Claude config. */
  provider_key: z.string().optional(),
  /** `[keys.<name>]` entry for Codex (Mantle/Bedrock); absent → the machine's own Codex config. */
  codex_provider_key: z.string().optional(),
  /** Registered Linux project boundary, independent of the legacy sandbox. */
  project_isolation: z.object({
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    organization_id: z.string().min(1),
  }).optional(),
  /** Registered shared project, run by the service without the launcher. Spec: docs/specs/cli-shared-environments.md */
  project_mode: z.literal("shared").optional(),
  /** Organization of a shared registration; its identity is computed from it. */
  project_organization: z.string().min(1).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;

/** Profile field holding each runtime's key assignment. */
export const PROVIDER_KEY_FIELDS = {
  "claude-code": "provider_key",
  codex: "codex_provider_key",
} as const satisfies Record<ProviderKeyRuntime, keyof Profile>;

/**
 * Settings section in config.toml
 */
export const SettingsSchema = z.object({
  default_profile: z.string().optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Full config.toml file structure
 */
export const ConfigFileSchema = z.object({
  settings: SettingsSchema.optional(),
  profiles: z.record(z.string(), ProfileSchema).default({}),
  keys: z.record(z.string(), ProviderKeySchema).optional(),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/**
 * Merged config from all sources
 */
export interface ResolvedConfig {
  convexUrl?: string;
  projectId?: string;
  profile?: string;
  apiKey?: string;
}

/**
 * Resolved config with required credentials
 */
export interface RequiredConfig {
  convexUrl: string;
  apiKey: string;
  projectId?: string;
  profile?: string;
}

/**
 * CLI option overrides (from --url, --api-key, etc.)
 * Highest priority in config resolution
 */
export interface CliOverrides {
  url?: string;
  apiKey?: string;
  profile?: string;
  projectId?: string;
}
