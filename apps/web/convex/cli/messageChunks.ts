import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthenticatedUser } from "../lib/access/auth";
import { getViewableThread } from "./lib/permissions";
import { resolveChunkReadEvent } from "./lib/chunks/normalizedEvents";
import { mergeOrderedChunkGroups } from "./lib/chunks/chunkOrder";
import {
  cliNormalizedEventValidator,
  type CliNormalizedEvent,
  type CliType,
} from "../lib/contracts/validators";
import { clampPageSize } from "../lib/shared/pagination";
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";
import {
  getChunkAtCursor,
  listChunksAfterCursor,
  listChunksBeforeCursor,
  listChunksByMessage,
  listLatestChunks,
  type ChunkCursor,
} from "./lib/cliMessageChunksRepo";

const CHUNK_LIMIT = { min: 1, max: 1000, default: 50 };
// A history page targets whole messages, not a fixed chunk count: chunk-dense runtimes
// (codex app-server stores 50+ rows per run) would otherwise surface ~1 message per "Show
// more". Each page fetches batches of `limit` until it covers MIN_WINDOW_MESSAGES complete
// messages, bounded by MAX_WINDOW_FETCHES batches and WINDOW_CHUNK_BUDGET rows. The fetch
// count derives from the budget so a large `limit` can't multiply past Convex's scan limit
// (each cursor fetch scans up to 3 × (limit + 1) index rows).
const MIN_WINDOW_MESSAGES = 10;
const MAX_WINDOW_FETCHES = 8;
const WINDOW_CHUNK_BUDGET = 400;
const MAX_BOOTSTRAP_MESSAGE_IDS = 200;
const MAX_BOOTSTRAP_CHUNKS_PER_MESSAGE = 2000;

const cursorValidator = v.object({
  createdAt: v.number(),
  messageId: v.id("cliMessages"),
  chunkOrder: v.number(),
});

const rowValidator = v.object({
  messageId: v.id("cliMessages"),
  threadId: v.id("cliThreads"),
  createdAt: v.number(),
  chunkOrder: v.number(),
  timestamp: v.number(),
  event: v.optional(cliNormalizedEventValidator),
});

const listNormalizedResultValidator = v.object({
  page: v.array(rowValidator),
  nextCursor: v.union(cursorValidator, v.null()),
  resetRequired: v.boolean(),
});

const listWindowResultValidator = v.object({
  page: v.array(rowValidator),
  nextOlderCursor: v.union(cursorValidator, v.null()),
  hasMore: v.boolean(),
});

type ReadRow = {
  messageId: Id<"cliMessages">;
  threadId: Id<"cliThreads">;
  createdAt: number;
  chunkOrder: number;
  timestamp: number;
  event: CliNormalizedEvent | undefined;
};

/**
 * Resolve the thread the caller may read chunks from — the owner, or a project
 * teammate on a shared thread (OS-1574) — or null when the thread is missing or
 * the caller lacks access. Null maps to an empty page everywhere (access
 * semantics, not an error).
 */
async function resolveReadableThread(
  ctx: QueryCtx,
  threadId: Id<"cliThreads">
): Promise<Doc<"cliThreads"> | null> {
  const user = await getAuthenticatedUser(ctx);
  const viewable = await getViewableThread(ctx, user._id, threadId);
  return viewable?.thread ?? null;
}

/**
 * Message ids whose chunks are fully covered on the older side of a
 * newest-first window. `chunkOrder` starts at 0 per message, so a message is
 * complete once its order-0 row is present — robust even when messages'
 * `createdAt` ranges interleave in the composite scan order.
 */
function collectCompleteMessageIds(
  rows: Doc<"cliMessageChunks">[]
): Set<Id<"cliMessages">> {
  const ids = new Set<Id<"cliMessages">>();
  for (const row of rows) {
    if (row.chunkOrder === 0) {
      ids.add(row.messageId);
    }
  }
  return ids;
}

function countCompleteMessages(rows: Doc<"cliMessageChunks">[]): number {
  return collectCompleteMessageIds(rows).size;
}

function toReadRow(args: {
  cliType: CliType | undefined;
  chunk: Doc<"cliMessageChunks">;
}): ReadRow {
  return {
    messageId: args.chunk.messageId,
    threadId: args.chunk.threadId,
    createdAt: args.chunk.createdAt,
    chunkOrder: args.chunk.chunkOrder,
    timestamp: args.chunk.timestamp,
    event: resolveChunkReadEvent(args.chunk, args.cliType),
  };
}

function toReadRows(
  cliType: CliType | undefined,
  chunks: Doc<"cliMessageChunks">[]
): ReadRow[] {
  return chunks.map((chunk) => toReadRow({ cliType, chunk }));
}

function toCursor(row: {
  createdAt: number;
  messageId: Id<"cliMessages">;
  chunkOrder: number;
}): ChunkCursor {
  return {
    createdAt: row.createdAt,
    messageId: row.messageId,
    chunkOrder: row.chunkOrder,
  };
}

/** Cursor pointing at the last row of a page, or null for an empty page. */
function pageTailCursor(page: ReadRow[]): ChunkCursor | null {
  const last = page.at(-1);
  return last ? toCursor(last) : null;
}

/**
 * Read a window of normalized chunks for a thread: the latest page when `before`
 * is omitted, otherwise the page older than `before`.
 */
export const listWindowByThread = query({
  args: {
    threadId: v.id("cliThreads"),
    before: v.optional(cursorValidator),
    limit: v.optional(v.number()),
  },
  returns: listWindowResultValidator,
  handler: async (ctx, args) => {
    const thread = await resolveReadableThread(ctx, args.threadId);
    if (!thread) {
      return { page: [], nextOlderCursor: null, hasMore: false };
    }

    const limit = clampPageSize(args.limit, CHUNK_LIMIT);

    const maxFetches = Math.min(
      MAX_WINDOW_FETCHES,
      Math.max(1, Math.floor(WINDOW_CHUNK_BUDGET / limit))
    );
    const rows: Doc<"cliMessageChunks">[] = [];
    let cursor = args.before;
    // First row older than `rows`, when one exists (the over-fetched row).
    let overflow: Doc<"cliMessageChunks"> | undefined;
    for (let fetchCount = 0; fetchCount < maxFetches; fetchCount++) {
      const batch = cursor
        ? await listChunksBeforeCursor(ctx, args.threadId, cursor, limit)
        : await listLatestChunks(ctx, args.threadId, limit);
      rows.push(...batch.slice(0, limit));
      overflow = batch.length > limit ? batch[limit] : undefined;
      const tail = rows[rows.length - 1];
      if (!overflow || !tail) {
        break;
      }

      if (countCompleteMessages(rows) >= MIN_WINDOW_MESSAGES) {
        break;
      }

      cursor = toCursor(tail);
    }

    // Cut the page at the trailing message boundary so the tail never renders from a partial
    // chunk set; dropped rows come back with the next page. Only a suffix may be trimmed (the
    // cursor must stay older than every returned row), so a mid-page message interleaving
    // with newer ones can still land partially. Trimming happens only while older rows exist:
    // once the thread is exhausted every loaded row must be delivered, even when completeness
    // can't be proven (ephemeral cleanup may have deleted a message's order-0 row). A message
    // larger than the whole budget still splits, which keeps the page non-empty.
    let pageRows = rows;
    if (overflow) {
      const completeIds = collectCompleteMessageIds(rows);
      let end = rows.length;
      while (end > 0 && !completeIds.has(rows[end - 1]!.messageId)) {
        end -= 1;
      }
      if (end > 0) {
        pageRows = rows.slice(0, end);
      }
    }

    const hasMore = overflow !== undefined;
    const page = toReadRows(thread.cliType, pageRows);

    return {
      page,
      nextOlderCursor: hasMore ? pageTailCursor(page) : null,
      hasMore,
    };
  },
});

export const listLiveByThread = query({
  args: {
    threadId: v.id("cliThreads"),
    after: v.optional(cursorValidator),
    limit: v.optional(v.number()),
  },
  returns: listNormalizedResultValidator,
  handler: async (ctx, args) => {
    const thread = await resolveReadableThread(ctx, args.threadId);
    if (!thread || !args.after) {
      return { page: [], nextCursor: null, resetRequired: false };
    }
    const after = args.after;

    const anchor = await getChunkAtCursor(ctx, args.threadId, after);
    if (!anchor) {
      return { page: [], nextCursor: null, resetRequired: true };
    }

    const rows = await listChunksAfterCursor(
      ctx,
      args.threadId,
      after,
      clampPageSize(args.limit, CHUNK_LIMIT)
    );
    const page = toReadRows(thread.cliType, rows);

    return {
      page,
      nextCursor: pageTailCursor(page) ?? after,
      resetRequired: false,
    };
  },
});

export const listNormalizedByMessages = query({
  args: {
    threadId: v.id("cliThreads"),
    messageIds: v.array(v.id("cliMessages")),
  },
  returns: listNormalizedResultValidator,
  handler: async (ctx, args) => {
    const thread = await resolveReadableThread(ctx, args.threadId);
    if (!thread || args.messageIds.length === 0) {
      return { page: [], nextCursor: null, resetRequired: false };
    }

    const uniqueMessageIds = Array.from(new Set(args.messageIds));
    ensure(uniqueMessageIds.length).lte(
      MAX_BOOTSTRAP_MESSAGE_IDS,
      errors.TOO_MANY_BOOTSTRAP_MESSAGES
    );

    const chunkGroups = await Promise.all(
      uniqueMessageIds.map((messageId) =>
        listChunksByMessage(
          ctx,
          args.threadId,
          messageId,
          MAX_BOOTSTRAP_CHUNKS_PER_MESSAGE + 1
        )
      )
    );

    chunkGroups.forEach((chunks) => {
      ensure(chunks.length).lte(
        MAX_BOOTSTRAP_CHUNKS_PER_MESSAGE,
        errors.bootstrapChunksExceeded(MAX_BOOTSTRAP_CHUNKS_PER_MESSAGE)
      );
    });

    // Each group is index-sorted by (createdAt, chunkOrder) for a single
    // message; merge the (at most MAX_BOOTSTRAP_MESSAGE_IDS) groups into one
    // ascending stream without an Array.sort over the combined set.
    const orderedChunks = mergeOrderedChunkGroups(chunkGroups);
    const page = toReadRows(thread.cliType, orderedChunks);
    return { page, nextCursor: pageTailCursor(page), resetRequired: false };
  },
});
