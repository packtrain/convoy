import type { PaginationOptions, PaginationResult } from "convex/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ApiKeyScope } from "../../lib/access/permissions";

type Ctx = QueryCtx | MutationCtx;

export type StoredApiKeyScope = Extract<ApiKeyScope, { kind: "organization" }> | undefined;

export async function getApiKeyById(ctx: Ctx, apiKeyId: Id<"apiKeys">): Promise<Doc<"apiKeys"> | null> {
  return ctx.db.get("apiKeys", apiKeyId);
}

/** Newest first. */
export async function paginateApiKeysForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"apiKeys">>> {
  return ctx.db
    .query("apiKeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .paginate(paginationOpts);
}

/** Keys of one kind whose expiry has passed; keys without expiry never match. */
export async function takeExpiredApiKeysOfKind(
  ctx: Ctx,
  kind: NonNullable<Doc<"apiKeys">["kind"]>,
  now: number,
  limit: number
): Promise<Doc<"apiKeys">[]> {
  return ctx.db
    .query("apiKeys")
    .withIndex("by_kind_and_expiresAt", (q) => q.eq("kind", kind).gte("expiresAt", 0).lte("expiresAt", now))
    .take(limit);
}

export async function takeWorkerKeysOfSource(ctx: Ctx, sourceKeyId: Id<"apiKeys">, limit: number): Promise<Doc<"apiKeys">[]> {
  return ctx.db
    .query("apiKeys")
    .withIndex("by_sourceKeyId", (q) => q.eq("sourceKeyId", sourceKeyId))
    .take(limit);
}

/** Names are not unique (a rename can collide), so return every match; normally one. */
export async function listApiKeysByUserKindAndName(
  ctx: Ctx,
  userId: Id<"users">,
  kind: Doc<"apiKeys">["kind"],
  name: string
): Promise<Doc<"apiKeys">[]> {
  return ctx.db
    .query("apiKeys")
    .withIndex("by_userId_and_kind_and_name", (q) => q.eq("userId", userId).eq("kind", kind).eq("name", name))
    .collect();
}

export async function findApiKeyByHash(ctx: Ctx, keyHash: string): Promise<Doc<"apiKeys"> | null> {
  return ctx.db
    .query("apiKeys")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
    .unique();
}

/** Insert an API key, stamping `createdAt`. */
export async function insertApiKey(
  ctx: MutationCtx,
  props: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    expiresAt: number | undefined;
    scope: StoredApiKeyScope;
    kind?: Doc<"apiKeys">["kind"];
    sourceKeyId?: Id<"apiKeys">;
  },
  userId: Id<"users">
): Promise<Id<"apiKeys">> {
  return ctx.db.insert("apiKeys", {
    userId,
    ...props,
    createdAt: Date.now(),
  });
}

export async function updateApiKey(
  ctx: MutationCtx,
  apiKeyId: Id<"apiKeys">,
  patch: { name: string; scope: StoredApiKeyScope }
): Promise<void> {
  await ctx.db.patch("apiKeys", apiKeyId, patch);
}

export async function deleteApiKey(ctx: MutationCtx, apiKeyId: Id<"apiKeys">): Promise<void> {
  await ctx.db.delete("apiKeys", apiKeyId);
}

function shouldUpdateLastUsedAt(
  apiKey: Pick<Doc<"apiKeys">, "lastUsedAt">,
  minIntervalMs: number,
  now: number
): boolean {
  if (apiKey.lastUsedAt === undefined) {
    return true;
  }

  return now - apiKey.lastUsedAt >= Math.max(0, minIntervalMs);
}

/**
 * Stamp `lastUsedAt` unless it was already stamped within `minIntervalMs`
 * (usage recording is high-frequency; staleness gating bounds the writes).
 */
export async function touchLastUsedAtIfStale(
  ctx: MutationCtx,
  apiKey: Pick<Doc<"apiKeys">, "_id" | "lastUsedAt"> | null,
  minIntervalMs: number
): Promise<void> {
  if (!apiKey) {
    return;
  }

  const now = Date.now();
  if (!shouldUpdateLastUsedAt(apiKey, minIntervalMs, now)) {
    return;
  }

  await ctx.db.patch("apiKeys", apiKey._id, {
    lastUsedAt: now,
  });
}
