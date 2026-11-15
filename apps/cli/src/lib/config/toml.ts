import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import * as TOML from "smol-toml";
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from "../constants.js";
import {
  ConfigFileSchema,
  codexProviderKeyIssue,
  PROVIDER_KEY_FIELDS,
  type ConfigFile,
  type Profile,
  type ProviderKey,
  type ProviderKeyRuntime,
} from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), CONFIG_DIR_NAME);
const CONFIG_FILE = path.join(CONFIG_DIR, CONFIG_FILE_NAME);

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

/**
 * Read the config file
 * Returns empty config if file doesn't exist
 */
export function readConfig(): ConfigFile {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { profiles: {} };
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = TOML.parse(content);
    const validated = ConfigFileSchema.safeParse(parsed);

    if (!validated.success) {
      throw new Error("Invalid config schema");
    }
    return validated.data;
  } catch {
    // Parser errors can include source lines containing credentials.
    throw new Error(`Cannot read config at ${CONFIG_FILE}. Repair the TOML before continuing.`);
  }
}

/** Hold the config lock while reading or writing. Crashed locks require explicit recovery. */
export function withConfigLock<T>(action: (config: ConfigFile) => T): T {
  ensureConfigDir();
  const lock = `${CONFIG_FILE}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Config is locked at ${lock}. Wait for the other command; after a crash, verify no writer is running before removing that lock directory.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    const config = readConfig();
    return action(config);
  } finally {
    fs.rmdirSync(lock);
  }
}

/** Persist a config mutation under the shared writer lock. */
export function mutateConfig<T>(mutation: (config: ConfigFile) => T): T {
  return withConfigLock((config) => {
    const result = mutation(config);
    writeConfigSnapshot(config);
    return result;
  });
}

function writeConfigSnapshot(config: ConfigFile): void {
  config = ConfigFileSchema.parse(config);

  // Build TOML structure
  const tomlData: Record<string, unknown> = {};

  // Add settings if present
  if (config.settings) {
    tomlData.settings = config.settings;
  }

  // Add profiles
  if (Object.keys(config.profiles).length > 0) {
    tomlData.profiles = config.profiles;
  }

  // Add provider keys
  if (config.keys && Object.keys(config.keys).length > 0) {
    tomlData.keys = config.keys;
  }

  const content = TOML.stringify(tomlData);
  const temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, CONFIG_FILE);
    if (process.platform !== "win32") {
      const directory = fs.openSync(CONFIG_DIR, "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Get a profile by key
 */
export function getProfileByKey(key: string): Profile | undefined {
  const config = readConfig();
  return config.profiles[key];
}

/**
 * Set a profile by key
 */
export function setProfile(key: string, profile: Profile): void {
  return mutateConfig((config) => {
    requireUnregisteredProfile(config.profiles[key]);
    config.profiles[key] = profile;
  });
}

/**
 * Delete a profile by key
 */
export function deleteProfileByKey(key: string): boolean {
  return mutateConfig((config) => {
    requireUnregisteredProfile(config.profiles[key]);
    if (config.profiles[key]) {
      delete config.profiles[key];
      if (config.settings?.default_profile === key) delete config.settings.default_profile;
      return true;
    }
    return false;
  });
}

/**
 * List all profiles
 */
export function listAllProfiles(): Array<{ key: string; profile: Profile }> {
  const config = readConfig();
  return Object.entries(config.profiles).map(([key, profile]) => ({
    key,
    profile,
  }));
}

/**
 * Add a path to an existing profile.
 * No-op if the path is already present.
 */
export function addPathToProfile(key: string, newPath: string): void {
  return mutateConfig((config) => {
    const profile = config.profiles[key];
    requireUnregisteredProfile(profile);
    if (!profile) {
      throw new Error(`Profile "${key}" not found`);
    }
    const resolved = path.resolve(newPath);
    if (profile.paths.some((p) => path.resolve(p) === resolved)) {
      return; // already present
    }
    profile.paths.push(resolved);
  });
}

/**
 * Remove a path from an existing profile.
 * Throws if it's the last path (min 1 required).
 */
export function removePathFromProfile(key: string, targetPath: string): void {
  return mutateConfig((config) => {
    const profile = config.profiles[key];
    requireUnregisteredProfile(profile);
    if (!profile) {
      throw new Error(`Profile "${key}" not found`);
    }
    const resolved = path.resolve(targetPath);
    const idx = profile.paths.findIndex((p) => path.resolve(p) === resolved);
    if (idx === -1) {
      throw new Error(`Path "${targetPath}" not found in profile "${key}"`);
    }
    if (profile.paths.length <= 1) {
      throw new Error(`Cannot remove last path from profile "${key}"`);
    }
    profile.paths.splice(idx, 1);
  });
}

/**
 * List all stored provider keys
 */
export function listProviderKeys(): Array<{ name: string; key: ProviderKey }> {
  const config = readConfig();
  return Object.entries(config.keys ?? {}).map(([name, key]) => ({ name, key }));
}

/**
 * Get a provider key by name
 */
export function getProviderKey(name: string): ProviderKey | undefined {
  const config = readConfig();
  return config.keys?.[name];
}

/** Profiles referencing a key, labeled with the runtime when it is Codex. */
export function providerKeyUsage(config: ConfigFile, name: string): string[] {
  return Object.entries(config.profiles).flatMap(([key, profile]) => [
    ...(profile.provider_key === name ? [key] : []),
    ...(profile.codex_provider_key === name ? [`${key} (Codex)`] : []),
  ]);
}

/**
 * Create or overwrite a provider key. Refuses an edit that would break a
 * Codex assignment (e.g. dropping the region).
 */
export function setProviderKey(name: string, key: ProviderKey): void {
  return mutateConfig((config) => {
    const usedByCodex = Object.values(config.profiles).some((profile) => profile.codex_provider_key === name);
    const issue = usedByCodex ? codexProviderKeyIssue(name, key) : undefined;
    if (issue) {
      throw new Error(`${issue} Unassign it from Codex first with 'convoy keys unassign --runtime codex --profile <key>'.`);
    }
    config.keys = { ...config.keys, [name]: key };
  });
}

/**
 * Delete a provider key. Throws if any profile still references it.
 */
export function deleteProviderKey(name: string): boolean {
  return mutateConfig((config) => {
    if (!config.keys?.[name]) {
      return false;
    }
    const usedBy = providerKeyUsage(config, name);
    if (usedBy.length > 0) {
      const runtime = usedBy.some((user) => user.endsWith(" (Codex)")) ? " [--runtime codex]" : "";
      throw new Error(
        `Key "${name}" is used by profile(s): ${usedBy.join(", ")}. Unassign it first with 'convoy keys unassign${runtime} --profile <key>'.`
      );
    }
    delete config.keys[name];
    return true;
  });
}

/**
 * Assign a provider key to a profile's runtime (or clear with undefined).
 * Claude Code and Codex assignments are independent.
 */
export function setProfileProviderKey(
  profileKey: string,
  keyName: string | undefined,
  runtime: ProviderKeyRuntime = "claude-code"
): void {
  return mutateConfig((config) => {
    const profile = config.profiles[profileKey];
    if (!profile) {
      throw new Error(`Profile "${profileKey}" not found`);
    }
    requireUnregisteredProfile(profile);
    const key = keyName === undefined ? undefined : config.keys?.[keyName];
    if (keyName !== undefined && !key) {
      throw new Error(`Provider key "${keyName}" not found. Run 'convoy keys list'.`);
    }
    const issue = runtime === "codex" && keyName && key ? codexProviderKeyIssue(keyName, key) : undefined;
    if (issue) {
      throw new Error(issue);
    }
    const field = PROVIDER_KEY_FIELDS[runtime];
    if (keyName === undefined) {
      delete profile[field];
    } else {
      profile[field] = keyName;
    }
  });
}

/**
 * Get the default profile name from settings
 */
export function getDefaultProfileKey(): string | undefined {
  const config = readConfig();
  return config.settings?.default_profile;
}

/**
 * Set the default profile in settings
 */
export function setDefaultProfile(key: string): void {
  return mutateConfig((config) => {
    if (!config.settings) {
      config.settings = {};
    }
    config.settings.default_profile = key;
  });
}

function requireUnregisteredProfile(profile: Profile | undefined): void {
  if (profile?.project_isolation || profile?.project_mode) {
    throw new Error("Use convoy project commands to change a registered project; legacy profile/path mutations are disabled.");
  }
}
