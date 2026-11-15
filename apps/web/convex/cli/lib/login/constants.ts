/** One TTL everywhere: challenge expiry, CLI poll timeout, janitor schedule. */
export const CLI_LOGIN_TTL_MS = 10 * 60 * 1000;

/** Janitor grace after TTL before the row is deleted. */
export const CLI_LOGIN_CLEANUP_GRACE_MS = 60 * 1000;

/** Expiry of the API key minted on approval (same ceiling as manual keys). */
export const CLI_LOGIN_KEY_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Fail-closed guard on /device code guessing: after this many failed lookups
 * within a TTL window, the user's lookups are rejected until the window rolls.
 */
export const MAX_DEVICE_LOOKUP_FAILURES = 10;

/**
 * Global cap on live login requests. Bounds unauthenticated /start flooding
 * (table growth + userCode keyspace burn); the janitor keeps the live set
 * tiny in normal operation.
 * ponytail: global cap, per-IP buckets if login-flow DoS ever matters.
 */
export const MAX_LIVE_LOGIN_REQUESTS = 500;
