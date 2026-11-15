import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { CliLoginRequestStatus } from "../../../lib/contracts/validators";

type Ctx = QueryCtx | MutationCtx;

export async function findLoginRequestByChallengeId(ctx: Ctx, challengeId: string): Promise<Doc<"cliLoginRequests"> | null> {
  return ctx.db
    .query("cliLoginRequests")
    .withIndex("by_challengeId", (q) => q.eq("challengeId", challengeId))
    .unique();
}

export async function findLoginRequestByUserCode(ctx: Ctx, userCode: string): Promise<Doc<"cliLoginRequests"> | null> {
  return ctx.db
    .query("cliLoginRequests")
    .withIndex("by_userCode", (q) => q.eq("userCode", userCode))
    .unique();
}

export async function insertLoginRequest(
  ctx: MutationCtx,
  props: {
    challengeId: string;
    userCode: string;
    verifierHash: string;
    hostname?: string;
    expiresAt: number;
  }
): Promise<Id<"cliLoginRequests">> {
  return ctx.db.insert("cliLoginRequests", {
    ...props,
    status: "pending" satisfies CliLoginRequestStatus,
    createdAt: Date.now(),
  });
}

/** Bounded snapshot of live requests (rows only exist for ~TTL + grace). */
export async function takeLiveLoginRequests(ctx: Ctx, limit: number): Promise<Doc<"cliLoginRequests">[]> {
  return ctx.db.query("cliLoginRequests").take(limit);
}

export async function updateLoginRequest(
  ctx: MutationCtx,
  requestId: Id<"cliLoginRequests">,
  patch: { status: CliLoginRequestStatus; approvedByUserId?: Id<"users"> }
): Promise<void> {
  await ctx.db.patch("cliLoginRequests", requestId, patch);
}

/** Delete if present (janitor + successful poll both call this). */
export async function deleteLoginRequestIfExists(ctx: MutationCtx, requestId: Id<"cliLoginRequests">): Promise<void> {
  const request = await ctx.db.get("cliLoginRequests", requestId);
  if (request) {
    await ctx.db.delete("cliLoginRequests", requestId);
  }
}
