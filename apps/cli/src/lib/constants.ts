/**
 * Centralized constants for the CLI
 */

/** Expected prefix for user API keys */
export const API_KEY_PREFIX = "sk_user_";

// =============================================================================
// Config File Names
// =============================================================================

/** Config directory name (under home) */
export const CONFIG_DIR_NAME = ".config/convoy";

/** Config file name */
export const CONFIG_FILE_NAME = "config.toml";

// =============================================================================
// Environment Variable Names
// =============================================================================

/** Env var for Convex URL override */
export const ENV_URL = "CONVOY_URL";

/** Env var for direct API key */
export const ENV_API_KEY = "CONVOY_API_KEY";

/** Env var for profile name */
export const ENV_PROFILE = "CONVOY_PROFILE";

/**
 * Env var set ON the spawned coding runtime (not read by the CLI): the
 * Convoy thread ID the run belongs to (OS-1223).
 */
export const ENV_THREAD_ID = "CONVOY_THREAD_ID";
