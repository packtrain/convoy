import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthenticatedUser } from "../lib/access/auth";
import { hashApiKey } from "../lib/access/apiKeys";
import { cliLoginRequestStatusValidator } from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { mintApiKey } from "../lib/access/mintApiKey";
import { errors } from "./errors";
import {
  CLI_LOGIN_CLEANUP_GRACE_MS,
  CLI_LOGIN_KEY_EXPIRY_MS,
  CLI_LOGIN_TTL_MS,
  MAX_LIVE_LOGIN_REQUESTS,
} from "./lib/login/constants";
import { generateUserCode, normalizeUserCode } from "./lib/login/codes";
import { assertDeviceLookupAllowed, recordDeviceLookupFailure } from "./lib/login/deviceAttemptsRepo";
import {
  deleteLoginRequestIfExists,
  findLoginRequestByChallengeId,
  findLoginRequestByUserCode,
  insertLoginRequest,
  takeLiveLoginRequests,
  updateLoginRequest,
} from "./lib/login/requestsRepo";
import { getUserById } from "../users/lib/usersRepo";

const VERIFIER_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_HOSTNAME_LENGTH = 100;
const MAX_USER_CODE_ATTEMPTS = 5;

function keyNameForHostname(hostname: string | undefined): string {
  const name = hostname ? `CLI login (${hostname})` : "CLI login";
  return name.slice(0, MAX_HOSTNAME_LENGTH);
}

/**
 * Create a pending login request (called by the unauthenticated
 * /api/cli/login/start HTTP endpoint). The CLI keeps the verifier secret and
 * sends only its SHA-256 hash; the challenge id and user code merely select
 * the request, they can never retrieve the minted key.
 */
export const start = internalMutation({
  args: {
    verifierHash: v.string(),
    hostname: v.optional(v.string()),
  },
  returns: v.object({
    challengeId: v.string(),
    userCode: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    ensure(args.verifierHash).regex(VERIFIER_HASH_PATTERN, errors.LOGIN_VERIFIER_HASH_INVALID);

    // Bounded live set: caps unauthenticated flooding (fail closed). Only
    // unexpired rows count — expired ones are already dead weight awaiting
    // their janitor.
    const now = Date.now();
    const liveRequests = await takeLiveLoginRequests(ctx, MAX_LIVE_LOGIN_REQUESTS + 1);
    const pendingCount = liveRequests.filter((request) => request.expiresAt > now).length;
    ensure(pendingCount).lt(MAX_LIVE_LOGIN_REQUESTS, errors.LOGIN_REQUESTS_BUSY);

    const hostname = args.hostname?.trim().slice(0, MAX_HOSTNAME_LENGTH) || undefined;

    let userCode = generateUserCode();
    for (let attempt = 0; attempt < MAX_USER_CODE_ATTEMPTS; attempt += 1) {
      const collision = await findLoginRequestByUserCode(ctx, userCode);
      if (!collision) break;
      userCode = generateUserCode();
    }

    const challengeId = crypto.randomUUID();
    const expiresAt = now + CLI_LOGIN_TTL_MS;

    const requestId = await insertLoginRequest(ctx, { challengeId, userCode, verifierHash: args.verifierHash, hostname, expiresAt });

    // One janitor covers every terminal path: abandoned, denied, expired,
    // and completed rows are all gone shortly after the TTL.
    await ctx.scheduler.runAfter(CLI_LOGIN_TTL_MS + CLI_LOGIN_CLEANUP_GRACE_MS, internal.cli.login.cleanup, { requestId });

    return { challengeId, userCode, expiresAt };
  },
});

/** Janitor: delete the request row once its TTL (plus grace) has passed. */
export const cleanup = internalMutation({
  args: { requestId: v.id("cliLoginRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteLoginRequestIfExists(ctx, args.requestId);
    return null;
  },
});

/** Powers the /cli-login approve page (link path). */
export const getByChallenge = query({
  args: { challengeId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      hostname: v.optional(v.string()),
      status: cliLoginRequestStatusValidator,
      expiresAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    await getAuthenticatedUser(ctx);

    const request = await findLoginRequestByChallengeId(ctx, args.challengeId);
    if (!request || request.expiresAt <= Date.now()) return null;

    return { hostname: request.hostname, status: request.status, expiresAt: request.expiresAt };
  },
});

/**
 * Powers the /device code-entry page. A mutation (not a query) so failed
 * lookups can be recorded: the short user code is brute-forceable in theory,
 * so lookups lock fail-closed after repeated misses.
 */
export const lookupByUserCode = mutation({
  args: { userCode: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      challengeId: v.string(),
      hostname: v.optional(v.string()),
      expiresAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    await assertDeviceLookupAllowed(ctx, user._id);

    const userCode = normalizeUserCode(args.userCode);
    const request = userCode ? await findLoginRequestByUserCode(ctx, userCode) : null;

    if (!request || request.expiresAt <= Date.now() || request.status !== "pending") {
      await recordDeviceLookupFailure(ctx, user._id);
      return null;
    }

    return { challengeId: request.challengeId, hostname: request.hostname, expiresAt: request.expiresAt };
  },
});

/**
 * Approve a pending login request. Records who approved; mints nothing —
 * the key is minted verifier-gated at poll time.
 */
export const approve = mutation({
  args: { challengeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const request = await ensure(findLoginRequestByChallengeId(ctx, args.challengeId)).notNull(errors.LOGIN_REQUEST_NOT_FOUND);
    ensure(request.expiresAt).gt(Date.now(), errors.LOGIN_REQUEST_EXPIRED);
    ensure(request.status).eq("pending", errors.LOGIN_REQUEST_NOT_PENDING);

    await updateLoginRequest(ctx, request._id, { status: "approved", approvedByUserId: user._id });

    return null;
  },
});

/** Deny a pending login request. */
export const deny = mutation({
  args: { challengeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getAuthenticatedUser(ctx);

    const request = await ensure(findLoginRequestByChallengeId(ctx, args.challengeId)).notNull(errors.LOGIN_REQUEST_NOT_FOUND);
    ensure(request.expiresAt).gt(Date.now(), errors.LOGIN_REQUEST_EXPIRED);
    ensure(request.status).eq("pending", errors.LOGIN_REQUEST_NOT_PENDING);

    await updateLoginRequest(ctx, request._id, { status: "denied" });

    return null;
  },
});

/**
 * Verifier-gated poll (called by the unauthenticated /api/cli/login/poll HTTP
 * endpoint). On an approved request this mints the API key for the approving
 * user, deletes the row (single-use structurally), and returns the plaintext
 * exactly once — it is never stored. Verifier mismatches are reported as
 * `not_found` so nothing about the request state leaks.
 */
export const poll = internalMutation({
  args: {
    challengeId: v.string(),
    verifier: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("pending") }),
    v.object({ status: v.literal("approved"), apiKey: v.string(), email: v.string() }),
    v.object({ status: v.literal("denied") }),
    v.object({ status: v.literal("expired") }),
    v.object({ status: v.literal("not_found") })
  ),
  handler: async (ctx, args) => {
    const request = await findLoginRequestByChallengeId(ctx, args.challengeId);
    if (!request) return { status: "not_found" as const };

    const verifierHash = await hashApiKey(args.verifier);
    if (verifierHash !== request.verifierHash) return { status: "not_found" as const };

    if (request.expiresAt <= Date.now()) return { status: "expired" as const };
    if (request.status === "pending") return { status: "pending" as const };
    if (request.status === "denied") return { status: "denied" as const };

    const approvedByUserId = await ensure(request.approvedByUserId).notNull(errors.LOGIN_REQUEST_NOT_FOUND);
    const user = await ensure(getUserById(ctx, approvedByUserId)).notNull(errors.LOGIN_REQUEST_NOT_FOUND);

    // Re-login from the same hostname replaces the previous auto-minted key.
    const { key } = await mintApiKey(ctx, user._id, {
      name: keyNameForHostname(request.hostname),
      expiresAt: Date.now() + CLI_LOGIN_KEY_EXPIRY_MS,
      scope: undefined,
      kind: "cli-login",
      replaceSameName: true,
    });

    await deleteLoginRequestIfExists(ctx, request._id);

    return { status: "approved" as const, apiKey: key, email: user.email };
  },
});
