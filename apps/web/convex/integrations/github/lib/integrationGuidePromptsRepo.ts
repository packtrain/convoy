import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

async function findRow(ctx: Ctx, projectId: Id<"projects">) {
  return ctx.db
    .query("integrationGuidePrompts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .unique();
}

/** The project's Guide prompt; null is the built-in default. */
export async function getGuidePrompt(ctx: Ctx, projectId: Id<"projects">): Promise<string | null> {
  return (await findRow(ctx, projectId))?.prompt ?? null;
}

/** Null deletes the row, so the project gets the built-in default and its later changes. */
export async function setGuidePrompt(ctx: MutationCtx, projectId: Id<"projects">, prompt: string | null, userId: Id<"users">) {
  const row = await findRow(ctx, projectId);
  if (prompt === null) {
    if (row) await ctx.db.delete("integrationGuidePrompts", row._id);
  } else if (row) {
    await ctx.db.patch("integrationGuidePrompts", row._id, { prompt, updatedBy: userId, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("integrationGuidePrompts", { projectId, prompt, updatedBy: userId, updatedAt: Date.now() });
  }
}
