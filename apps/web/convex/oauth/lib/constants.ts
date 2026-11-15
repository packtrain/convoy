/** Authorization codes live briefly; the janitor deletes rows after TTL + grace. */
export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_CLEANUP_GRACE_MS = 60 * 1000;

/**
 * Expiry of the access token (API key) minted at token exchange. Kept short:
 * expiry → 401 → the MCP client re-runs the OAuth flow (one browser click).
 */
export const OAUTH_KEY_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Registration is unauthenticated, so clients that never receive a user
 * approval are janitor-deleted after this TTL (bounds table growth).
 * Kept under ~24.8 days: longer delays overflow Node's 32-bit setTimeout in
 * convex-test and fire immediately, deleting clients mid-test.
 */
export const OAUTH_UNUSED_CLIENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
