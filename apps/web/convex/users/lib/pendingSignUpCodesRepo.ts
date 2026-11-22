import type { MutationCtx } from "../../_generated/server";

/** Keeps one pending code per address; a new sign-up overwrites the old one. */
export async function upsertPendingSignUpCode(ctx: MutationCtx, row: { email: string; code: string }): Promise<void> {
  const existing = await ctx.db
    .query("pendingSignUpCodes")
    .withIndex("by_email", (q) => q.eq("email", row.email))
    .unique();
  if (existing) {
    await ctx.db.replace("pendingSignUpCodes", existing._id, row);
  } else {
    await ctx.db.insert("pendingSignUpCodes", row);
  }
}

/** Deletes the address's pending code and returns it, or null when there is none. */
export async function takePendingSignUpCode(ctx: MutationCtx, email: string): Promise<string | null> {
  const row = await ctx.db
    .query("pendingSignUpCodes")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!row) return null;
  await ctx.db.delete("pendingSignUpCodes", row._id);
  return row.code;
}
