// Re-export all config-related functionality

// Types
export type {
  ResolvedConfig,
  RequiredConfig,
  CliOverrides,
  Profile,
  Settings,
  ConfigFile,
  ProviderKey,
} from "./types.js";

export {
  ProfileSchema,
  SettingsSchema,
  ConfigFileSchema,
  ProviderKeySchema,
} from "./types.js";

// TOML config (unified config at ~/.config/convoy/config.toml)
export {
  getConfigPath,
  configExists,
  readConfig,
  getProfileByKey,
  setProfile as setProfileInConfig,
  deleteProfileByKey,
  listAllProfiles,
  getDefaultProfileKey,
  setDefaultProfile,
  addPathToProfile,
  removePathFromProfile,
  listProviderKeys,
  getProviderKey,
  setProviderKey,
  deleteProviderKey,
  setProfileProviderKey,
} from "./toml.js";

// Provider keys (per-profile Bedrock/Mantle credential or pinned claude.ai)
export {
  resolveProfileProviderKey,
  resolveProviderKeyByName,
  buildProviderKeyEnv,
  applyProviderKeyEnv,
  buildProviderSettingsJson,
  providerRequiresToken,
  CLAUDE_PROVIDER_ENV_VAR,
  PROVIDER_LABELS,
  type ResolvedProviderKey,
} from "./provider-keys.js";

// Profile resolution
export {
  resolveProfile,
  resolveConfigFromProfile,
  resolveConfigFromProfileCommand,
  hasProfiles,
  getAllProfiles,
  type ProfileResolution,
} from "./profile.js";

// Validation
export {
  ConfigError,
  requireCredentials,
  requireProject,
  handleConfigError,
  withConfigError,
} from "./validate.js";

// Convex client
export {
  createConvexClient,
  type ConvexClientOptions,
  type ConvoyClient,
} from "./convex-client.js";
