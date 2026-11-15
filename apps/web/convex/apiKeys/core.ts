import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuthorizedProject, isBroadApiKeyScope } from "../lib/access/permissions";
import { ProjectPermission } from "../../lib/authz/permissions";
import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { getAuthenticatedAccess, getAuthenticatedUser, normalizeApiKeyScope, isApiKeyValid, getAuthenticatedApiKey, isWorkerSourceKey, getWorkerKeyStatus } from "../lib/access/auth";
import { hashApiKey } from "../lib/access/apiKeys";
import { apiKeyKindValidator, apiKeyPrincipalScopeValidator, apiKeyScopeInputValidator } from "../lib/contracts/validators";
import { ensure } from "../lib/shared/ensure";
import { apiKeyListItemValidator } from "./lib/validators";
import {
  deleteApiKey,
  findApiKeyByHash,
  getApiKeyById,
  paginateApiKeysForUser,
  takeExpiredApiKeysOfKind,
  takeWorkerKeysOfSource,
  touchLastUsedAtIfStale,
  updateApiKey,
} from "./lib/apiKeysRepo";
import { mintApiKey } from "../lib/access/mintApiKey";
import { formatScopeForList, validateScopeInput } from "./lib/scope";
import { errors } from "./errors";

// Constants
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const CLOCK_SKEW_TOLERANCE_MS = 1 * 24 * 60 * 60 * 1000; // 1 day tolerance for client/server clock differences
const MAX_NAME_LENGTH = 100;
const CLEANUP_BATCH = 100;

/** Lets the CLI verify a worker credential before exposing it to a project. */
export const currentScope = query({
  args: { apiKey: v.string() },
  returns: v.union(apiKeyPrincipalScopeValidator, v.null()),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    return principal.apiKeyScope;
  },
});

function normalizeApiKeyName(name: string): string {
  const trimmed = name.trim();
  ensure(trimmed).notEq("", errors.API_KEY_NAME_REQUIRED);
  ensure(trimmed.length).lte(MAX_NAME_LENGTH, errors.apiKeyNameTooLong(MAX_NAME_LENGTH));
  return trimmed;
}

/**
 * Create a new API key.
 * Returns the full key (plaintext) only once - it cannot be retrieved later.
 */
export const create = mutation({
  args: {
    name: v.string(),
    // Omit for a key that never expires.
    expiresAt: v.optional(v.number()),
    scope: v.optional(apiKeyScopeInputValidator),
  },
  returns: v.object({
    id: v.id("apiKeys"),
    key: v.string(), // Full plaintext key - shown only once
  }),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const name = normalizeApiKeyName(args.name);

    if (args.expiresAt !== undefined) {
      const now = Date.now();
      ensure(args.expiresAt).gt(now, errors.EXPIRY_NOT_IN_FUTURE);
      ensure(args.expiresAt).lte(now + MAX_EXPIRY_MS + CLOCK_SKEW_TOLERANCE_MS, errors.EXPIRY_TOO_FAR);
    }

    const scope = await validateScopeInput(ctx, user._id, args.scope);

    return mintApiKey(ctx, user._id, { name, expiresAt: args.expiresAt, scope });
  },
});

/**
 * One page of the authenticated user's API keys, newest first. Metadata only.
 * Worker source records are fetched per page, since a source may sit on another page.
 */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(apiKeyListItemValidator),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const result = await paginateApiKeysForUser(ctx, user._id, args.paginationOpts);
    const sources = new Map<Id<"apiKeys">, Promise<Doc<"apiKeys"> | null>>();
    const getSource = (id: Id<"apiKeys">) => {
      if (!sources.has(id)) sources.set(id, getApiKeyById(ctx, id));
      return sources.get(id)!;
    };

    const page = await Promise.all(
      result.page.map(async (key) => {
        const source = key.sourceKeyId ? await getSource(key.sourceKeyId) : null;
        return {
          _id: key._id,
          name: key.name,
          keyPrefix: key.keyPrefix,
          kind: key.kind,
          workerStatus: key.kind === "project-worker" ? getWorkerKeyStatus(key, source) : undefined,
          // Never name another user's key.
          sourceKeyName: source?.userId === user._id ? source.name : undefined,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          scope: await formatScopeForList(ctx, user._id, normalizeApiKeyScope(key)),
        };
      })
    );
    return { ...result, page };
  },
});

/**
 * Permanently delete an API key.
 */
export const deleteKey = mutation({
  args: {
    id: v.id("apiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const apiKey = await ensure(getApiKeyById(ctx, args.id)).notNull(errors.API_KEY_NOT_FOUND);
    // Don't reveal existence of other users' keys
    ensure(apiKey.userId).eq(user._id, errors.API_KEY_NOT_FOUND);

    await deleteApiKey(ctx, args.id);
    if (isWorkerSourceKey(apiKey)) {
      await ctx.scheduler.runAfter(0, internal.apiKeys.core.deleteWorkersOfSource, { sourceKeyId: args.id });
    }

    return null;
  },
});

/** Delete a deleted source's workers in batches; reschedules itself until drained. */
export const deleteWorkersOfSource = internalMutation({
  args: { sourceKeyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const workers = await takeWorkerKeysOfSource(ctx, args.sourceKeyId, CLEANUP_BATCH);
    for (const worker of workers) await deleteApiKey(ctx, worker._id);
    if (workers.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.apiKeys.core.deleteWorkersOfSource, args);
    }
    return null;
  },
});

/**
 * Cron: delete expired automated keys in batches; expired manual keys stay listed.
 * A worker never outlives its source, so this also removes the workers of expired sources.
 */
export const sweepExpiredKeys = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    let more = false;
    for (const { value: kind } of apiKeyKindValidator.members) {
      const expired = await takeExpiredApiKeysOfKind(ctx, kind, now, CLEANUP_BATCH);
      for (const key of expired) await deleteApiKey(ctx, key._id);
      more ||= expired.length === CLEANUP_BATCH;
    }
    if (more) await ctx.scheduler.runAfter(0, internal.apiKeys.core.sweepExpiredKeys, {});
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("apiKeys"),
    name: v.string(),
    scope: apiKeyScopeInputValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const apiKey = await ensure(getApiKeyById(ctx, args.id)).notNull(errors.API_KEY_NOT_FOUND);
    ensure(apiKey.userId).eq(user._id, errors.API_KEY_NOT_FOUND);

    ensure(apiKey.kind).notEq("project-worker", errors.WORKER_KEY_IMMUTABLE);
    const name = normalizeApiKeyName(args.name);
    const scope = await validateScopeInput(ctx, user._id, args.scope);

    await updateApiKey(ctx, args.id, { name, scope });

    return null;
  },
});

/**
 * Validate an API key by its hash.
 * Internal query used for API authentication.
 * Returns the user ID if the key is valid, null otherwise.
 */
export const validateByHash = internalQuery({
  args: {
    keyHash: v.string(),
  },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      apiKeyId: v.id("apiKeys"),
      apiKeyScope: apiKeyPrincipalScopeValidator,
      kind: v.optional(apiKeyKindValidator),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const apiKey = await findApiKeyByHash(ctx, args.keyHash);
    if (!apiKey || !await isApiKeyValid(ctx, apiKey)) {
      return null;
    }

    return {
      userId: apiKey.userId,
      apiKeyId: apiKey._id,
      apiKeyScope: normalizeApiKeyScope(apiKey),
      kind: apiKey.kind,
    };
  },
});

/**
 * Record API key usage.
 * Internal mutation to update lastUsedAt timestamp.
 */
export const recordUsage = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await getApiKeyById(ctx, args.apiKeyId);
    await touchLastUsedAtIfStale(ctx, apiKey, 0);

    return null;
  },
});

export const recordUsageIfStale = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    minIntervalMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = await getApiKeyById(ctx, args.apiKeyId);
    await touchLastUsedAtIfStale(ctx, apiKey, args.minIntervalMs);

    return null;
  },
});

/**
 * Record API key usage by key string.
 * Internal mutation used by HTTP handler which only has the raw key.
 * Looks up key by hash and updates lastUsedAt.
 */
export const recordUsageByKey = internalMutation({
  args: {
    apiKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const keyHash = await hashApiKey(args.apiKey);
    const apiKeyDoc = await findApiKeyByHash(ctx, keyHash);
    await touchLastUsedAtIfStale(ctx, apiKeyDoc, 0);

    return null;
  },
});

export const recordUsageByKeyIfStale = internalMutation({
  args: {
    apiKey: v.string(),
    minIntervalMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const keyHash = await hashApiKey(args.apiKey);
    const apiKeyDoc = await findApiKeyByHash(ctx, keyHash);
    await touchLastUsedAtIfStale(ctx, apiKeyDoc, args.minIntervalMs);

    return null;
  },
});

/**
 * Validate API key by raw key string.
 * Internal query used by HTTP handlers for authentication.
 * Returns userId and apiKeyId if valid, null otherwise.
 */
export const validateByKey = internalQuery({
  args: {
    apiKey: v.string(),
  },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      apiKeyId: v.id("apiKeys"),
      apiKeyScope: apiKeyPrincipalScopeValidator,
      kind: v.optional(apiKeyKindValidator),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const keyHash = await hashApiKey(args.apiKey);
    const apiKey = await findApiKeyByHash(ctx, keyHash);
    if (!apiKey || !await isApiKeyValid(ctx, apiKey)) {
      return null;
    }

    return {
      userId: apiKey.userId,
      apiKeyId: apiKey._id,
      apiKeyScope: normalizeApiKeyScope(apiKey),
      kind: apiKey.kind,
    };
  },
});

/** Issue a worker credential without exposing the broad setup key to a project. */
export const createProjectKey = mutation({
  args: { apiKey: v.string(), projectId: v.id("projects") },
  returns: v.object({ id: v.id("apiKeys"), key: v.string() }),
  handler: async (ctx, args) => {
    const { key: source, principal } = await requireWorkerSetupKey(ctx, args.apiKey);
    const { project } = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);

    return mintApiKey(ctx, source.userId, {
      name: `Convoy worker ${project.alias}`,
      kind: "project-worker",
      sourceKeyId: source._id,
      expiresAt: Math.min(source.expiresAt ?? Infinity, Date.now() + MAX_EXPIRY_MS),
      scope: { kind: "organization", organizationId: project.organizationId, projectIds: [project._id] },
    });
  },
});


/** Confirm reuse without returning or accepting a second plaintext credential. */
export const canReuseProjectKey = query({
  args: { apiKey: v.string(), projectId: v.id("projects"), keyHash: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { key: source, principal } = await getAuthenticatedApiKey(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_UPDATE);
    if (!isWorkerSourceKey(source)) return false;
    const worker = await findApiKeyByHash(ctx, args.keyHash);
    return Boolean(worker && worker.kind === "project-worker" && worker.sourceKeyId === source._id &&
      worker.scope?.projectIds.length === 1 && worker.scope.projectIds[0] === args.projectId &&
      await isApiKeyValid(ctx, worker));
  },
});

async function requireWorkerSetupKey(ctx: QueryCtx | MutationCtx, apiKey: string) {
  const resolved = await getAuthenticatedApiKey(ctx, apiKey);
  ensure(isWorkerSourceKey(resolved.key)).isTrue(errors.WORKER_SETUP_KEY_REQUIRED);
  ensure(isBroadApiKeyScope(resolved.principal.apiKeyScope)).isTrue(errors.WORKER_KEY_SCOPE_REQUIRED);
  return resolved;
}

/** Reject unsuitable setup credentials before the CLI creates a remote project. */
export const validateWorkerSetupKey = query({
  args: { apiKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireWorkerSetupKey(ctx, args.apiKey);
    return null;
  },
});
