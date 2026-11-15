import * as path from "node:path";
import { ConfigError } from "./validate.js";
import type { Command } from "commander";
import { ENV_PROFILE, ENV_URL, ENV_API_KEY } from "../constants.js";
import type { Profile, ResolvedConfig, CliOverrides } from "./types.js";
import {
  readConfig,
  getProfileByKey,
  getDefaultProfileKey,
  listAllProfiles,
} from "./toml.js";

/**
 * Result of profile resolution
 */
export interface ProfileResolution {
  /** The resolved profile, if found */
  profile: Profile | undefined;
  /** The key of the resolved profile */
  key: string | undefined;
  /** How the profile was resolved */
  source:
    | "cli-flag"
    | "env"
    | "path-match"
    | "default"
    | "none";
}

/**
 * Check if a path is equal to or a subdirectory of another path
 */
function isPathMatch(targetPath: string, profilePath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedProfile = path.resolve(profilePath);

  // Exact match
  if (normalizedTarget === normalizedProfile) {
    return true;
  }

  // Check if target is a subdirectory of profile path
  const relative = path.relative(normalizedProfile, normalizedTarget);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

/**
 * Find a profile that matches the given path.
 * Iterates all paths in every profile, returning the most specific (longest) match.
 */
function findProfileByPath(
  targetPath: string
): { key: string; profile: Profile } | undefined {
  const profiles = listAllProfiles();
  let bestMatch: { key: string; profile: Profile } | undefined;
  let longestPath = 0;

  for (const { key, profile } of profiles) {
    for (const profilePath of profile.paths) {
      if (isPathMatch(targetPath, profilePath)) {
        const pathLength = path.resolve(profilePath).length;
        if (pathLength > longestPath) {
          longestPath = pathLength;
          bestMatch = { key, profile };
        }
      }
    }
  }

  return bestMatch;
}

/** Project host paths onto the mounted checkout without changing the shared profile file. */
function containerProfile(profile: Profile): Profile {
  const host = process.env.CONVOY_HOST_WORKSPACE;
  const container = process.env.CONVOY_CONTAINER_WORKSPACE;
  if (!host || !container) return profile;
  const paths = profile.paths.flatMap((entry) => {
    if (isPathMatch(entry, container)) return [entry];
    if (isPathMatch(entry, host)) return [path.join(container, path.relative(host, entry))];
    if (isPathMatch(host, entry)) return [container];
    return [];
  });
  return { ...profile, paths: [...new Set(paths)] };
}

/**
 * Resolve a profile, in priority order: `--profile` flag, `CONVOY_PROFILE`, a
 * `profile.paths` entry matching (or an ancestor of) cwd, `settings.default_profile`, then
 * no match.
 */
export function resolveProfile(
  cwd?: string,
  overrides?: CliOverrides
): ProfileResolution {
  const targetPath = cwd || process.cwd();

  // 1. CLI flag
  if (overrides?.profile) {
    const profile = getProfileByKey(overrides.profile);
    if (!profile) throw new ConfigError(`Convoy profile "${overrides.profile}" was not found`, "Choose an existing --profile or run convoy setup.");
    return {
      profile: containerProfile(profile),
      key: overrides.profile,
      source: "cli-flag",
    };
  }

  // 2. Environment variable
  const envProfile = process.env[ENV_PROFILE];
  if (envProfile) {
    const profile = getProfileByKey(envProfile);
    if (!profile) throw new ConfigError(`Convoy profile "${envProfile}" was not found (CONVOY_PROFILE)`, "Set CONVOY_PROFILE to an existing profile or unset it to use workspace matching.");
    return {
      profile: containerProfile(profile),
      key: envProfile,
      source: "env",
    };
  }

  // 3. Path match
  const hostWorkspace = process.env.CONVOY_HOST_WORKSPACE;
  const containerWorkspace = process.env.CONVOY_CONTAINER_WORKSPACE;
  const hostPath = hostWorkspace && containerWorkspace && isPathMatch(targetPath, containerWorkspace)
    ? path.join(hostWorkspace, path.relative(containerWorkspace, targetPath))
    : undefined;
  const pathMatch = findProfileByPath(targetPath) ?? (hostPath ? findProfileByPath(hostPath) : undefined);
  if (pathMatch) {
    return {
      profile: containerProfile(pathMatch.profile),
      key: pathMatch.key,
      source: "path-match",
    };
  }

  // 4. Default profile
  const defaultKey = getDefaultProfileKey();
  if (defaultKey) {
    const profile = getProfileByKey(defaultKey);
    if (profile) {
      return {
        profile: containerProfile(profile),
        key: defaultKey,
        source: "default",
      };
    }
  }

  // 5. No match
  return {
    profile: undefined,
    key: undefined,
    source: "none",
  };
}

/**
 * Resolve full config from profile + overrides + env
 * This merges profile data with any CLI/env overrides
 */
export function resolveConfigFromProfile(
  cwd?: string,
  overrides?: CliOverrides
): ResolvedConfig {
  const resolution = resolveProfile(cwd, overrides);

  // Start with profile values
  let convexUrl = resolution.profile?.url;
  let apiKey = resolution.profile?.api_key;
  let projectId = resolution.profile?.project_id;

  // Apply environment variable overrides
  if (process.env[ENV_URL]) {
    convexUrl = process.env[ENV_URL];
  }
  if (process.env[ENV_API_KEY]) {
    apiKey = process.env[ENV_API_KEY];
  }

  // Apply CLI overrides (highest priority)
  if (overrides?.url) {
    convexUrl = overrides.url;
  }
  if (overrides?.apiKey) {
    apiKey = overrides.apiKey;
  }
  if (overrides?.projectId) {
    projectId = overrides.projectId;
  }

  return {
    convexUrl,
    apiKey,
    projectId,
    profile: resolution.key,
  };
}

/**
 * Resolve config using global CLI options from Commander
 * Use in command actions: resolveConfigFromCommand(cmd)
 */
export function resolveConfigFromProfileCommand(
  cmd: Command,
  cwd?: string
): ResolvedConfig {
  const opts = cmd.optsWithGlobals();
  return resolveConfigFromProfile(cwd, {
    url: opts.url,
    apiKey: opts.apiKey,
    profile: opts.profile,
    projectId: opts.project,
  });
}

/**
 * Check if any profiles exist
 */
export function hasProfiles(): boolean {
  const config = readConfig();
  return Object.keys(config.profiles).length > 0;
}

/**
 * Get all profiles for display/selection
 */
export function getAllProfiles(): Array<{ key: string; profile: Profile }> {
  return listAllProfiles();
}
