import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { compareChunkOrder, compareChunkOrderDesc } from "./chunks/chunkOrder";

type Ctx = QueryCtx | MutationCtx;

/** Composite cursor identifying a single chunk row in thread sort order. */
export type ChunkCursor = {
  createdAt: number;
  messageId: Id<"cliMessages">;
  chunkOrder: number;
};

const THREAD_ORDER_INDEX =
  "by_thread_and_createdAt_and_messageId_and_chunkOrder";
const THREAD_MESSAGE_CHUNK_ORDER_INDEX =
  "by_thread_and_message_and_chunkOrder";
const THREAD_MESSAGE_INDEX =
  "by_thread_and_message_and_createdAt_and_chunkOrder";
const THREAD_MESSAGE_EPHEMERAL_INDEX =
  "by_thread_and_message_and_ephemeral_and_chunkOrder";

/**
 * Newest chunks for a thread in descending sort order. Over-fetches by one
 * (`limit + 1`) so callers can detect "has more" from the row count.
 */
export async function listLatestChunks(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_ORDER_INDEX, (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(limit + 1);
}

/**
 * The page of chunks immediately older than `before` in composite sort order,
 * over-fetching by one so the merged slice can detect "has more".
 *
 * Three branches, because a single `.lt("createdAt", ...)` would miss rows at the
 * same timestamp with a lower messageId or chunkOrder.
 */
export async function listChunksBeforeCursor(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">,
  before: ChunkCursor,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  const branchLimit = limit + 1;

  const [sameMessage, sameTimestamp, olderTimestamps] = await Promise.all([
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q
          .eq("threadId", threadId)
          .eq("createdAt", before.createdAt)
          .eq("messageId", before.messageId)
          .lt("chunkOrder", before.chunkOrder)
      )
      .order("desc")
      .take(branchLimit),
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q
          .eq("threadId", threadId)
          .eq("createdAt", before.createdAt)
          .lt("messageId", before.messageId)
      )
      .order("desc")
      .take(branchLimit),
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q.eq("threadId", threadId).lt("createdAt", before.createdAt)
      )
      .order("desc")
      .take(branchLimit),
  ]);

  return [...sameMessage, ...sameTimestamp, ...olderTimestamps]
    .sort(compareChunkOrderDesc)
    .slice(0, limit + 1);
}

/**
 * The page of chunks immediately newer than `after` in composite sort order.
 * Same three-branch reasoning as {@link listChunksBeforeCursor}.
 */
export async function listChunksAfterCursor(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">,
  after: ChunkCursor,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  const [sameMessage, sameTimestamp, newerTimestamps] = await Promise.all([
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q
          .eq("threadId", threadId)
          .eq("createdAt", after.createdAt)
          .eq("messageId", after.messageId)
          .gt("chunkOrder", after.chunkOrder)
      )
      .order("asc")
      .take(limit),
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q
          .eq("threadId", threadId)
          .eq("createdAt", after.createdAt)
          .gt("messageId", after.messageId)
      )
      .order("asc")
      .take(limit),
    ctx.db
      .query("cliMessageChunks")
      .withIndex(THREAD_ORDER_INDEX, (q) =>
        q.eq("threadId", threadId).gt("createdAt", after.createdAt)
      )
      .order("asc")
      .take(limit),
  ]);

  return [...sameMessage, ...sameTimestamp, ...newerTimestamps]
    .sort(compareChunkOrder)
    .slice(0, limit);
}

/** The exact chunk row addressed by `cursor`, or null if it no longer exists. */
export async function getChunkAtCursor(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">,
  cursor: ChunkCursor
): Promise<Doc<"cliMessageChunks"> | null> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_ORDER_INDEX, (q) =>
      q
        .eq("threadId", threadId)
        .eq("createdAt", cursor.createdAt)
        .eq("messageId", cursor.messageId)
        .eq("chunkOrder", cursor.chunkOrder)
    )
    .unique();
}

/** First `limit` chunks for a single message, ascending by (createdAt, chunkOrder). */
export async function listChunksByMessage(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId)
    )
    .order("asc")
    .take(limit);
}

/** Up to `limit` ephemeral (partial-streaming) chunk rows for a message. */
export async function listEphemeralChunksByMessage(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_EPHEMERAL_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId).eq("ephemeral", true)
    )
    .take(limit);
}

/**
 * Last `limit` *stored* (non-ephemeral) chunks for a message, descending by chunk
 * order — what every tail reader wants: partial-streaming deltas are superseded by
 * the whole event they build up to, and scanning them wastes the window.
 *
 * Pinning `ephemeral` in the index also keeps this read disjoint from the range
 * `cleanupEphemeralChunks` deletes from, which otherwise forced write-conflict
 * retries of `events/core:ingest` (OS-1673).
 */
export async function listLatestStoredChunksByMessage(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_EPHEMERAL_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId).eq("ephemeral", undefined)
    )
    .order("desc")
    .take(limit);
}

/** Last `limit` chunks for a message, descending by chunk order. */
export async function listLatestChunksByMessage(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_CHUNK_ORDER_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId)
    )
    .order("desc")
    .take(limit);
}

/** Up to `limit` chunks of a message past `afterChunkOrder`, ascending. */
export async function listChunksByMessageAfterOrder(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  afterChunkOrder: number,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_CHUNK_ORDER_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId).gt("chunkOrder", afterChunkOrder)
    )
    .order("asc")
    .take(limit);
}

/** All chunks for a message, ascending by chunk order. */
export async function listAllChunksByMessage(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">
): Promise<Doc<"cliMessageChunks">[]> {
  return ctx.db
    .query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_CHUNK_ORDER_INDEX, (q) =>
      q.eq("threadId", threadId).eq("messageId", messageId)
    )
    .order("asc")
    .collect();
}

type ChunkInsert = Omit<Doc<"cliMessageChunks">, "_id" | "_creationTime">;

export async function getCliMessageChunkById(
  ctx: Ctx,
  chunkId: Id<"cliMessageChunks">
): Promise<Doc<"cliMessageChunks"> | null> {
  return ctx.db.get("cliMessageChunks", chunkId);
}

export async function insertCliMessageChunk(
  ctx: MutationCtx,
  chunk: ChunkInsert
): Promise<Id<"cliMessageChunks">> {
  return ctx.db.insert("cliMessageChunks", chunk);
}

export async function deleteCliMessageChunk(
  ctx: MutationCtx,
  chunkId: Id<"cliMessageChunks">
): Promise<void> {
  await ctx.db.delete("cliMessageChunks", chunkId);
}

/**
 * Tail of a message's chunk stream, ascending by chunk order. Completion-time checks
 * only care how a run ended, and collecting a long run's tens of thousands of
 * partial-streaming rows exceeds the transaction read limits.
 *
 * ponytail: fixed window; if a run can end with more chunks than this after its last
 * tool call, track the interesting events at insert time instead.
 */
export async function listRecentChunksByMessageAsc(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<Doc<"cliMessageChunks">[]> {
  const rows = await listLatestChunksByMessage(ctx, threadId, messageId, limit);
  return rows.reverse();
}

export async function hasEphemeralChunks(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">
): Promise<boolean> {
  const rows = await listEphemeralChunksByMessage(ctx, threadId, messageId, 1);
  return rows.length > 0;
}

export async function listStoredRunChunksAfter(ctx: Ctx, threadId: Id<"cliThreads">, messageId: Id<"cliMessages">, after: number, limit: number) {
  return ctx.db.query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_EPHEMERAL_INDEX, q => q.eq("threadId", threadId).eq("messageId", messageId).eq("ephemeral", undefined).gt("chunkOrder", after))
    .order("asc").take(limit);
}


/** Bounded stored history; excludes replaceable streaming deltas. */
export async function listStoredRunChunksBefore(ctx: Ctx, threadId: Id<"cliThreads">, messageId: Id<"cliMessages">, before: number, limit: number) {
  return ctx.db.query("cliMessageChunks")
    .withIndex(THREAD_MESSAGE_EPHEMERAL_INDEX, q => q.eq("threadId", threadId).eq("messageId", messageId).eq("ephemeral", undefined).lt("chunkOrder", before))
    .order("desc").take(limit);
}
