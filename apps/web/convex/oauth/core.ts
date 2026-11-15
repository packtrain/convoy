import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthenticatedUser } from "../lib/access/auth";
import { ensure } from "../lib/shared/ensure";
import { mintApiKey } from "../lib/access/mintApiKey";
import { isRedirectUriAllowed, isRegistrableRedirectUri } from "../../lib/oauth/redirect-uris";
import { errors } from "./errors";
import {
  OAUTH_CLEANUP_GRACE_MS,
  OAUTH_CODE_TTL_MS,
  OAUTH_KEY_EXPIRY_MS,
  OAUTH_UNUSED_CLIENT_TTL_MS,
} from "./lib/constants";
import { CODE_CHALLENGE_PATTERN, CODE_VERIFIER_PATTERN, generateRandomToken, s256Challenge } from "./lib/pkce";
import {
  deleteAuthRequestIfExists,
  deleteClientIfNeverApproved,
  findAuthRequestByCode,
  findClientByClientId,
  findClientsByName,
  insertAuthRequest,
  insertClient,
  touchClientApproved,
} from "./lib/oauthRepo";

const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_REDIRECT_URIS = 10;
const MAX_STATE_LENGTH = 2000;
const DEDUP_CANDIDATE_LIMIT = 20;

function keyNameForClient(clientName: string | undefined): string {
  const name = clientName ? `MCP (${clientName})` : "MCP OAuth client";
  return name.slice(0, MAX_CLIENT_NAME_LENGTH);
}

/**
 * Dynamic client registration (RFC 7591), called by the unauthenticated
 * /oauth/register HTTP endpoint. Public clients only — no secret is issued;
 * PKCE + user consent gate everything sensitive.
 */
export const register = internalMutation({
  args: {
    clientName: v.optional(v.string()),
    redirectUris: v.array(v.string()),
  },
  returns: v.object({ clientId: v.string() }),
  handler: async (ctx, args) => {
    const clientName = args.clientName?.trim().slice(0, MAX_CLIENT_NAME_LENGTH) || undefined;

    ensure(args.redirectUris.length).gte(1, errors.REDIRECT_URIS_REQUIRED);
    ensure(args.redirectUris.length).lte(MAX_REDIRECT_URIS, errors.REDIRECT_URIS_TOO_MANY);
    for (const uri of args.redirectUris) {
      ensure(isRegistrableRedirectUri(uri)).isTrue(errors.REDIRECT_URI_INVALID);
    }

    // Idempotent for well-behaved clients: an identical registration (same
    // name + same URI set) reuses the existing client instead of growing the
    // table on every `claude mcp add` retry.
    const requestedUris = [...new Set(args.redirectUris)].sort();
    const candidates = await findClientsByName(ctx, clientName, DEDUP_CANDIDATE_LIMIT);
    const existing = candidates.find(
      (candidate) =>
        candidate.redirectUris.length === requestedUris.length &&
        [...candidate.redirectUris].sort().every((uri, index) => uri === requestedUris[index])
    );
    if (existing) {
      return { clientId: existing.clientId };
    }

    const clientId = generateRandomToken();
    const clientDocId = await insertClient(ctx, { clientId, clientName, redirectUris: args.redirectUris });

    // Registration is unauthenticated: clients that never get approved are
    // janitor-deleted so abandoned/hostile registrations cannot accumulate.
    await ctx.scheduler.runAfter(OAUTH_UNUSED_CLIENT_TTL_MS, internal.oauth.core.cleanupClient, { clientDocId });

    return { clientId };
  },
});

/** Janitor: remove a registered client that never received a user approval. */
export const cleanupClient = internalMutation({
  args: { clientDocId: v.id("oauthClients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteClientIfNeverApproved(ctx, args.clientDocId);
    return null;
  },
});

/** Powers the /oauth/authorize consent page. */
export const getClient = query({
  args: { clientId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      clientName: v.optional(v.string()),
      redirectUris: v.array(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    await getAuthenticatedUser(ctx);

    const client = await findClientByClientId(ctx, args.clientId);
    if (!client) return null;

    return { clientName: client.clientName, redirectUris: client.redirectUris };
  },
});

/**
 * Consent: mint a one-time authorization code bound to the client, redirect
 * URI, and PKCE challenge, and return the redirect target. The access token
 * is NOT minted here — only at the PKCE-gated token exchange.
 */
export const approve = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    responseType: v.string(),
    state: v.optional(v.string()),
  },
  returns: v.object({ redirectTo: v.string() }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    ensure(args.responseType).eq("code", errors.RESPONSE_TYPE_UNSUPPORTED);
    const client = await ensure(findClientByClientId(ctx, args.clientId)).notNull(errors.CLIENT_NOT_FOUND);
    ensure(isRedirectUriAllowed(client.redirectUris, args.redirectUri)).isTrue(errors.REDIRECT_URI_NOT_REGISTERED);
    ensure(args.codeChallenge).regex(CODE_CHALLENGE_PATTERN, errors.CODE_CHALLENGE_INVALID);
    if (args.state !== undefined) {
      ensure(args.state.length).lte(MAX_STATE_LENGTH, errors.STATE_TOO_LONG);
    }

    await touchClientApproved(ctx, client._id);

    const code = generateRandomToken();
    const expiresAt = Date.now() + OAUTH_CODE_TTL_MS;

    const requestId = await insertAuthRequest(ctx, {
      code,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      approvedByUserId: user._id,
      expiresAt,
    });

    await ctx.scheduler.runAfter(OAUTH_CODE_TTL_MS + OAUTH_CLEANUP_GRACE_MS, internal.oauth.core.cleanup, { requestId });

    const redirectTo = new URL(args.redirectUri);
    redirectTo.searchParams.set("code", code);
    if (args.state !== undefined) {
      redirectTo.searchParams.set("state", args.state);
    }

    return { redirectTo: redirectTo.toString() };
  },
});

/** Janitor: delete the auth-code row once its TTL (plus grace) has passed. */
export const cleanup = internalMutation({
  args: { requestId: v.id("oauthAuthRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteAuthRequestIfExists(ctx, args.requestId);
    return null;
  },
});

/**
 * Token exchange (from the unauthenticated /oauth/token endpoint). Verifies the PKCE
 * verifier, mints an `sk_user_` API key the existing /api/mcp bearer auth accepts
 * unchanged, deletes the row (single-use structurally), and returns the plaintext
 * once — it is never stored.
 *
 * Protocol failures are returned as values, not thrown, so the HTTP layer can emit
 * RFC 6749 error JSON.
 */
export const token = internalMutation({
  args: {
    code: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeVerifier: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      accessToken: v.string(),
      expiresInSeconds: v.number(),
    }),
    v.object({
      ok: v.literal(false),
      error: v.union(v.literal("invalid_request"), v.literal("invalid_grant")),
      errorDescription: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    if (!CODE_VERIFIER_PATTERN.test(args.codeVerifier)) {
      return { ok: false as const, error: "invalid_request" as const, errorDescription: "Malformed code_verifier" };
    }

    const request = await findAuthRequestByCode(ctx, args.code);
    if (!request) {
      return { ok: false as const, error: "invalid_grant" as const, errorDescription: "Unknown or already used code" };
    }

    if (request.expiresAt <= Date.now()) {
      return { ok: false as const, error: "invalid_grant" as const, errorDescription: "Code has expired" };
    }

    if (request.clientId !== args.clientId || request.redirectUri !== args.redirectUri) {
      return { ok: false as const, error: "invalid_grant" as const, errorDescription: "Client or redirect URI mismatch" };
    }

    const challenge = await s256Challenge(args.codeVerifier);
    if (challenge !== request.codeChallenge) {
      return { ok: false as const, error: "invalid_grant" as const, errorDescription: "PKCE verification failed" };
    }

    const client = await findClientByClientId(ctx, args.clientId);

    // kind "mcp-oauth" audience-binds the key: the MCP endpoint accepts it,
    // the agent-bridge endpoints reject it (see lib/http/agentAuth.ts).
    const { key } = await mintApiKey(ctx, request.approvedByUserId, {
      name: keyNameForClient(client?.clientName),
      expiresAt: Date.now() + OAUTH_KEY_EXPIRY_MS,
      scope: undefined,
      kind: "mcp-oauth",
    });

    await deleteAuthRequestIfExists(ctx, request._id);

    return { ok: true as const, accessToken: key, expiresInSeconds: Math.floor(OAUTH_KEY_EXPIRY_MS / 1000) };
  },
});
