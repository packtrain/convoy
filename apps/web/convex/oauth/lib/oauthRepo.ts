import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function findClientByClientId(ctx: Ctx, clientId: string): Promise<Doc<"oauthClients"> | null> {
  return ctx.db
    .query("oauthClients")
    .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
    .unique();
}

export async function insertClient(
  ctx: MutationCtx,
  props: { clientId: string; clientName?: string; redirectUris: string[] }
): Promise<Id<"oauthClients">> {
  return ctx.db.insert("oauthClients", { ...props, createdAt: Date.now() });
}

/** Bounded candidate list for registration dedup (same display name). */
export async function findClientsByName(ctx: Ctx, clientName: string | undefined, limit: number): Promise<Doc<"oauthClients">[]> {
  return ctx.db
    .query("oauthClients")
    .withIndex("by_clientName", (q) => q.eq("clientName", clientName))
    .take(limit);
}

/** Mark the client as approved at least once (exempts it from the unused-client janitor). */
export async function touchClientApproved(ctx: MutationCtx, clientDocId: Id<"oauthClients">): Promise<void> {
  await ctx.db.patch("oauthClients", clientDocId, { lastApprovedAt: Date.now() });
}

/** Janitor: delete a client that never received a user approval. */
export async function deleteClientIfNeverApproved(ctx: MutationCtx, clientDocId: Id<"oauthClients">): Promise<void> {
  const client = await ctx.db.get("oauthClients", clientDocId);
  if (client && client.lastApprovedAt === undefined) {
    await ctx.db.delete("oauthClients", clientDocId);
  }
}

export async function findAuthRequestByCode(ctx: Ctx, code: string): Promise<Doc<"oauthAuthRequests"> | null> {
  return ctx.db
    .query("oauthAuthRequests")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

export async function insertAuthRequest(
  ctx: MutationCtx,
  props: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    approvedByUserId: Id<"users">;
    expiresAt: number;
  }
): Promise<Id<"oauthAuthRequests">> {
  return ctx.db.insert("oauthAuthRequests", { ...props, createdAt: Date.now() });
}

/** Delete if present (janitor + successful token exchange both call this). */
export async function deleteAuthRequestIfExists(ctx: MutationCtx, requestId: Id<"oauthAuthRequests">): Promise<void> {
  const request = await ctx.db.get("oauthAuthRequests", requestId);
  if (request) {
    await ctx.db.delete("oauthAuthRequests", requestId);
  }
}
