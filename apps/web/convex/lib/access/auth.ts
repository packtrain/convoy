import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getApiKeyById, findApiKeyByHash } from "../../apiKeys/lib/apiKeysRepo";
import type { WorkerKeyStatus } from "../../apiKeys/lib/validators";
import { env, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { hashApiKey, isApiKeyExpired } from "./apiKeys";
import { getLocalDemoUser } from "./localDemo";
import { getUserByTokenIdentifier } from "../../users/lib/usersRepo";
import type { ApiKeyScope, AuthenticatedAccess } from "./permissions";

export function normalizeApiKeyScope(
  apiKey: Pick<Doc<"apiKeys">, "scope">
): ApiKeyScope {
  if (!apiKey.scope) {
    return { kind: "unscoped" };
  }

  return {
    kind: "organization",
    organizationId: apiKey.scope.organizationId,
    projectIds: [...new Set(apiKey.scope.projectIds)],
  };
}

/** New Convex Auth accounts need AUTH_MODE=convex on the deployment; tokens dispatch on issuer alone. */
export function isConvexAuthDeployment(): boolean {
  return process.env.AUTH_MODE === "convex";
}

/** Convex Auth tokens are issued by the `auth` component of this deployment. */
export function isConvexAuthIdentity(identity: UserIdentity): boolean {
  return identity.issuer === `${env.CONVEX_CLOUD_URL}/components/auth`;
}

/**
 * The user behind a verified JWT. Dispatches on the issuer: a Convex Auth token
 * names a session, any other issuer's token is matched by `tokenIdentifier`.
 */
export async function resolveIdentityUser(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity
): Promise<Doc<"users"> | null> {
  if (isConvexAuthIdentity(identity)) {
    const userId = await getAuthUserId(ctx);
    return userId ? await ctx.db.get("users", userId) : null;
  }
  return getUserByTokenIdentifier(ctx, identity.tokenIdentifier);
}

export async function getAuthenticatedAccess(
  ctx: MutationCtx | QueryCtx,
  apiKey?: string
): Promise<{ user: Doc<"users">; principal: AuthenticatedAccess }> {
  const access = await getOptionalAuthenticatedAccess(ctx, apiKey);
  if (!access) {
    // User-facing (ConvexError): same message as domain catalogs'
    // NOT_AUTHENTICATED, which this shared module must not import.
    throw new ConvexError("Not authenticated");
  }
  return access;
}

export async function getOptionalAuthenticatedAccess(
  ctx: QueryCtx | MutationCtx,
  apiKey?: string
): Promise<{ user: Doc<"users">; principal: AuthenticatedAccess } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const user = await resolveIdentityUser(ctx, identity);
    if (!user) {
      return null;
    }
    return {
      user,
      principal: { userId: user._id, apiKeyScope: null },
    };
  }

  if (apiKey) {
    const keyHash = await hashApiKey(apiKey);
    const apiKeyDoc = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
      .unique();

    if (!apiKeyDoc) return null;
    if (!await isApiKeyValid(ctx, apiKeyDoc)) return null;

    const user = await ctx.db.get("users", apiKeyDoc.userId);
    if (!user) {
      return null;
    }

    return {
      user,
      principal: {
        userId: user._id,
        apiKeyScope: normalizeApiKeyScope(apiKeyDoc),
      },
    };
  }

  // Local-demo mode (OS-1230): anonymous callers act as the demo user.
  // Lookup-only — the user is created by users.core.onboardLocalDemo. Until
  // then this still returns null, so "optional auth" semantics only differ
  // on onboarded local-demo deployments.
  const demoUser = await getLocalDemoUser(ctx);
  if (demoUser) {
    return {
      user: demoUser,
      principal: { userId: demoUser._id, apiKeyScope: null },
    };
  }

  return null;
}

/**
 * Get the authenticated user from the context.
 * Supports JWTs (Clerk or Convex Auth) and API keys.
 *
 * @param ctx - The Convex context
 * @param apiKey - Optional API key (for HTTP/MCP access)
 * @returns The authenticated user document
 * @throws Error if not authenticated
 */
export async function getAuthenticatedUser(
  ctx: MutationCtx | QueryCtx,
  apiKey?: string
): Promise<Doc<"users">> {
  const access = await getAuthenticatedAccess(ctx, apiKey);
  return access.user;
}

/**
 * Get the authenticated user from the context, or null if not authenticated.
 * Supports JWTs (Clerk or Convex Auth) and API keys.
 *
 * Priority:
 * 1. JWT (ctx.auth.getUserIdentity())
 * 2. API key (if provided and valid)
 *
 * @param ctx - The Convex context
 * @param apiKey - Optional API key (for HTTP/MCP access)
 * @returns The user document, or null if not authenticated
 */
export async function getOptionalAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
  apiKey?: string
): Promise<Doc<"users"> | null> {
  const access = await getOptionalAuthenticatedAccess(ctx, apiKey);
  return access?.user ?? null;
}

/** Resolve the supplied key once, retaining JWT-owner checks when both are present. */
export async function getAuthenticatedApiKey(ctx: QueryCtx | MutationCtx, apiKey: string) {
  const key = await findApiKeyByHash(ctx, await hashApiKey(apiKey));
  if (!key || !await isApiKeyValid(ctx, key)) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get("users", key.userId);
  if (!user) throw new ConvexError("Not authenticated");
  if (await ctx.auth.getUserIdentity()) {
    const jwt = await getAuthenticatedAccess(ctx);
    if (jwt.user._id !== key.userId) throw new ConvexError("Not authenticated");
  }
  return { key, principal: { userId: key.userId, apiKeyScope: normalizeApiKeyScope(key) } };
}

export function isWorkerSourceKey(key: Doc<"apiKeys">): boolean {
  return key.kind === undefined && key.sourceKeyId === undefined;
}

/** Shared validity projection for authentication and API Keys; see permissions-system.md. */
export function getWorkerKeyStatus(
  key: Doc<"apiKeys">,
  source: Doc<"apiKeys"> | null | undefined,
  now = Date.now(),
): WorkerKeyStatus {
  if (isApiKeyExpired(key, now)) return "expired";
  if (!key.sourceKeyId || !key.scope || key.scope.projectIds.length !== 1) return "invalid";
  if (!source) return "source-deleted";
  if (!isWorkerSourceKey(source) || source.userId !== key.userId) return "invalid";
  if (isApiKeyExpired(source, now)) return "source-expired";
  if (source.scope && (source.scope.organizationId !== key.scope.organizationId ||
      (source.scope.projectIds.length > 0 && !source.scope.projectIds.includes(key.scope.projectIds[0])))) return "source-scope";
  return "active";
}

export async function isApiKeyValid(ctx: QueryCtx | MutationCtx, key: Doc<"apiKeys"> | null): Promise<boolean> {
  if (!key || isApiKeyExpired(key)) return false;
  if (key.kind !== "project-worker") return key.sourceKeyId === undefined;
  const source = key.sourceKeyId ? await getApiKeyById(ctx, key.sourceKeyId) : null;
  return getWorkerKeyStatus(key, source) === "active";
}
