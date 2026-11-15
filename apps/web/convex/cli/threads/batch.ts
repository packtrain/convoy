import { mutation, type MutationCtx } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "../../lib/access/auth";
import { hasProjectAccess } from "../../lib/access/permissions";
import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { ProjectPermission } from "../../../lib/authz/permissions";
import { THREAD_BATCH_ACTION_MAX, THREAD_BATCH_FANOUT_MAX } from "../../../lib/threads/constants";
import { getOwnedThreadsByIds, markThreadDone, markThreadNotDone, markThreadRead } from "./lib/cliThreadsRepo";
import { threadNeedsAttentionAck } from "../lib/watchStatus";
import { deleteThreadWithCleanup } from "./core";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Resolve batch-action targets (OS-1255). Stale ids (missing, deleted, not the
 * caller's, inaccessible) are skipped rather than failing the batch.
 *
 * Two caps: row count, and the cascade fan-out a selected container brings
 * (OS-1475). 50 maxed-out groups would read ~15k docs and Convex would abort the
 * mutation. `childCount` is a denorm, so the check costs no extra reads.
 */
async function getBatchActionThreads(ctx: MutationCtx, userId: Id<"users">, threadIds: Id<"cliThreads">[]): Promise<Doc<"cliThreads">[]> {
  ensure(threadIds.length).between(0, THREAD_BATCH_ACTION_MAX, errors.batchTooLarge(THREAD_BATCH_ACTION_MAX));
  const owned = await getOwnedThreadsByIds(ctx, userId, [...new Set(threadIds)]);
  const accessible = await Promise.all(
    owned.map(async (chat) => ((await hasProjectAccess(ctx, userId, chat.projectId, ProjectPermission.CLI_THREAD)) ? chat : null))
  );
  const chats = accessible.filter((chat): chat is Doc<"cliThreads"> => chat !== null);
  const fanOut = chats.reduce((rows, chat) => rows + 1 + (chat.childCount ?? 0), 0);
  ensure(fanOut).between(0, THREAD_BATCH_FANOUT_MAX, errors.batchFanOutTooLarge(THREAD_BATCH_FANOUT_MAX));
  return chats;
}

/**
 * Mark up to 50 own threads as read, acknowledging attention so failed/waiting
 * threads demote out of the attention buckets (OS-1255).
 */
export const batchMarkRead = mutation({
  args: { threadIds: v.array(v.id("cliThreads")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chats = await getBatchActionThreads(ctx, user._id, args.threadIds);
    const now = Date.now();
    // Sequential: under Promise.all two selected children's read-collect-patch pairs
    // interleave, and a recompute from a pre-patch collect can land last.
    for (const chat of chats) {
      await markThreadRead(ctx, chat._id, { now, acknowledgeAttention: threadNeedsAttentionAck(chat) });
    }
    return null;
  },
});

/**
 * Explicitly mark up to 50 own threads done (OS-1382). Done implies reviewed:
 * also marks read and acknowledges attention so failed/waiting threads demote.
 */
export const batchMarkDone = mutation({
  args: { threadIds: v.array(v.id("cliThreads")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chats = await getBatchActionThreads(ctx, user._id, args.threadIds);
    const now = Date.now();
    // Sequential — same container-denorm interleaving hazard as batchMarkRead.
    for (const chat of chats) {
      await markThreadDone(ctx, chat._id, { now, acknowledgeAttention: threadNeedsAttentionAck(chat) });
    }
    return null;
  },
});

/** Clear the done mark on up to 50 own threads, returning them to needs-review (OS-1382). */
export const batchMarkNotDone = mutation({
  args: { threadIds: v.array(v.id("cliThreads")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chats = await getBatchActionThreads(ctx, user._id, args.threadIds);
    // Sequential — same container-denorm interleaving hazard as batchMarkRead.
    for (const chat of chats) {
      await markThreadNotDone(ctx, chat._id);
    }
    return null;
  },
});

/** Soft-delete up to 50 own threads, winding down live ones first (OS-1255). */
export const batchRemove = mutation({
  args: { threadIds: v.array(v.id("cliThreads")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const chats = await getBatchActionThreads(ctx, user._id, args.threadIds);
    const now = Date.now();
    for (const chat of chats) {
      await deleteThreadWithCleanup(ctx, chat, now, user._id);
    }
    return null;
  },
});
