import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export async function getWorktreeOpById(ctx: Ctx, opId: Id<"cliWorktreeOps">): Promise<Doc<"cliWorktreeOps"> | null> {
  return ctx.db.get("cliWorktreeOps", opId);
}

export async function listPendingWorktreeOpsByProfile(ctx: Ctx, profileId: Id<"cliProfiles">): Promise<Doc<"cliWorktreeOps">[]> {
  return ctx.db
    .query("cliWorktreeOps")
    .withIndex("by_profile_and_status", (q) => q.eq("profileId", profileId).eq("status", "pending"))
    .collect();
}

type WorktreeOpInsert = Omit<Doc<"cliWorktreeOps">, "_id" | "_creationTime">;

export async function insertWorktreeOp(ctx: MutationCtx, op: WorktreeOpInsert): Promise<Id<"cliWorktreeOps">> {
  return ctx.db.insert("cliWorktreeOps", op);
}

export async function updateWorktreeOp(
  ctx: MutationCtx,
  opId: Id<"cliWorktreeOps">,
  patch: Partial<Pick<Doc<"cliWorktreeOps">, "status" | "error" | "resultJson" | "storageId">>
): Promise<void> {
  await ctx.db.patch("cliWorktreeOps", opId, { ...patch, updatedAt: Date.now() });
}

export async function deleteWorktreeOp(ctx: MutationCtx, opId: Id<"cliWorktreeOps">): Promise<void> {
  await ctx.db.delete("cliWorktreeOps", opId);
}
