import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for `cliMessageStreamHeads` — a streaming run's chunk cursor, kept
 * off the message envelope so a flush invalidates no reader (OS-1729).
 */

/** The run's head row, or null before its first flush / after it settled. */
export async function getStreamHeadByMessage(
  ctx: Ctx,
  messageId: Id<"cliMessages">
): Promise<Doc<"cliMessageStreamHeads"> | null> {
  return ctx.db
    .query("cliMessageStreamHeads")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .first();
}

export async function insertStreamHead(
  ctx: MutationCtx,
  head: { messageId: Id<"cliMessages">; nextChunkOrder: number }
): Promise<void> {
  await ctx.db.insert("cliMessageStreamHeads", head);
}

export async function setStreamHeadOrder(
  ctx: MutationCtx,
  headId: Id<"cliMessageStreamHeads">,
  nextChunkOrder: number
): Promise<void> {
  await ctx.db.patch("cliMessageStreamHeads", headId, { nextChunkOrder });
}

export async function deleteStreamHead(ctx: MutationCtx, headId: Id<"cliMessageStreamHeads">): Promise<void> {
  await ctx.db.delete("cliMessageStreamHeads", headId);
}
