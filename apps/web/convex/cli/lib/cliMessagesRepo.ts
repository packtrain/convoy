import type { PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

import { STREAM_CANCELLED_BY_USER_REASON } from "./constants";
import type { CliResumeHandle } from "./validators";

type Ctx = QueryCtx | MutationCtx;

/**
 * DB access for the `cliMessages` table — the primary entity of the cliMessages
 * domain. Callable modules go through these helpers; secondary owned tables
 * (`cliMessagePendingUploads`, `cliMessageAttachmentRefs`) have their own repos.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** A single message by id, or null when it no longer exists. */
export async function getMessageById(ctx: Ctx, messageId: Id<"cliMessages">): Promise<Doc<"cliMessages"> | null> {
  return ctx.db.get("cliMessages", messageId);
}

/** Several messages by id, aligned by index (null for misses). */
export async function getMessagesByIds(ctx: Ctx, messageIds: ReadonlyArray<Id<"cliMessages">>): Promise<(Doc<"cliMessages"> | null)[]> {
  return Promise.all(messageIds.map((id) => ctx.db.get("cliMessages", id)));
}

/** A page of thread messages, newest first (for paginated `listByThread`). */
export async function paginateThreadMessagesDesc(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  opts: { cursor: string | null; numItems: number }
): Promise<PaginationResult<Doc<"cliMessages">>> {
  return ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
    .order("desc")
    .paginate(opts);
}

/**
 * The newest `limit` thread messages, newest first (OS-1600), plus one extra row so
 * the caller can report whether older history exists without a second query.
 * Newest-anchored because every client derivation needing envelopes works on the
 * newest end, and the chunk window paginates backwards from there.
 */
export async function listNewestThreadMessagesDesc(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  limit: number,
  /** Exclusive `createdAt` cutoff: a fork's view of its parent before the copied run (OS-1397). */
  before?: number
): Promise<{ messages: Doc<"cliMessages">[]; hasOlder: boolean }> {
  const rows = await ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_createdAt", (q) => {
      const scoped = q.eq("threadId", threadId);
      return before === undefined ? scoped : scoped.lt("createdAt", before);
    })
    .order("desc")
    .take(limit + 1);
  return {
    messages: rows.length > limit ? rows.slice(0, limit) : rows,
    hasOlder: rows.length > limit,
  };
}

/** All thread messages, oldest first. */
export async function listThreadMessagesAsc(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  return ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_createdAt", (q) => q.eq("threadId", threadId))
    .order("asc")
    .collect();
}

/** All messages for a thread (unordered) — used by retry's run lookup. */
export async function listMessagesByThread(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  return ctx.db
    .query("cliMessages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();
}

/** Unprocessed user messages for a thread, oldest first; `queueFirst` ones lead (OS-2339). */
export async function listUnprocessedUserMessages(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  const queued = await ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_role_and_processedAt_and_createdAt", (q) =>
      q.eq("threadId", threadId).eq("role", "user").eq("processedAt", undefined)
    )
    .order("asc")
    .collect();
  return [...queued.filter((message) => message.queueFirst), ...queued.filter((message) => !message.queueFirst)];
}

/**
 * Assistant rows the stranded-tail walk will read before giving up. Sized well
 * past any real thread's unsettled run: healthy history settles within a row or
 * two, and only legacy pre-`continuationId` rows stack up (OS-1672).
 */
export const STRANDED_ASSISTANT_SCAN_LIMIT = 200;

/** Find recoverable failed runs and the latest resume point. Spec: cli-message-context.md. */
export async function scanStrandedTail(
  ctx: Ctx,
  threadId: Id<"cliThreads">,
  /** Exclusive `createdAt` cutoff: a fork seeds from the parent's previous turn (OS-1397). */
  before?: number
): Promise<{
  strandedRunIds: Set<string>;
  continuationId: string | null;
  /** The run and Codex turn of the row that carries `continuationId`. */
  resumable: { runId?: string; turnId?: string } | null;
}> {
  const assistants = ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_role_and_createdAt", (q) => {
      const scoped = q.eq("threadId", threadId).eq("role", "assistant");
      return before === undefined ? scoped : scoped.lt("createdAt", before);
    })
    .order("desc");

  const strandedRunIds = new Set<string>();
  let scanned = 0;
  for await (const assistant of assistants) {
    if (scanned++ >= STRANDED_ASSISTANT_SCAN_LIMIT) {
      console.warn(
        `scanStrandedTail: no settled assistant within ${STRANDED_ASSISTANT_SCAN_LIMIT} rows for thread ${threadId}; treating tail as settled`
      );
      return { strandedRunIds: new Set(), continuationId: null, resumable: null };
    }
    // A script turn (OS-1886) never touches the agent session; look past it.
    if (assistant.scriptResult !== undefined) {
      continue;
    }
    const continuationId = assistant.cliContext?.continuationId;
    if (continuationId !== undefined) {
      return { strandedRunIds, continuationId, resumable: { runId: assistant.runId, turnId: assistant.cliContext?.turnId } };
    }
    if (assistant.status === "completed" || assistant.status === "streaming") {
      return { strandedRunIds, continuationId: null, resumable: null };
    }
    // Stop must not replay cancelled work on the next send (OS-2046).
    if (assistant.errorMessage === STREAM_CANCELLED_BY_USER_REASON &&
      (assistant.cliType === "claude-code" || assistant.cliType === "codex")) continue;
    const runId = assistant.runId;
    if (runId !== undefined) {
      strandedRunIds.add(runId);
    }
  }
  return { strandedRunIds, continuationId: null, resumable: null };
}

/**
 * The session the next run resumes. `forkTurnId` is set when that session is
 * another thread's and Codex must fork it first (OS-2073, cli-thread-fork.md).
 */
export async function resolveResumeHandle(ctx: Ctx, chat: Doc<"cliThreads">): Promise<CliResumeHandle | null> {
  const { continuationId, resumable } = await scanStrandedTail(ctx, chat._id);
  const { forkedFrom } = chat;
  if (continuationId !== null) {
    const copied = forkedFrom?.runId !== undefined && resumable?.runId === forkedFrom.runId;
    return copied ? borrowedHandle(chat.cliType, continuationId, resumable?.turnId) : { continuationId };
  }
  if (forkedFrom?.continuationId === undefined) return null;
  return borrowedHandle(chat.cliType, forkedFrom.continuationId, forkedFrom.turnId);
}

/** Another thread's session: Codex must fork it, and cannot without the turn. */
function borrowedHandle(cliType: string, continuationId: string, turnId: string | undefined): CliResumeHandle | null {
  if (cliType !== "codex") return { continuationId };
  return turnId === undefined ? null : { continuationId, forkTurnId: turnId };
}

/** Stopped input is history, never executable work. Spec: cli-message-context.md. */
export async function listInterruptedUserMessages(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  const assistants = ctx.db.query("cliMessages")
    .withIndex("by_thread_and_role_and_createdAt", (q) => q.eq("threadId", threadId).eq("role", "assistant"))
    .order("desc");
  const runIds = new Set<string>();
  let scanned = 0;
  for await (const assistant of assistants) {
    if (scanned++ >= STRANDED_ASSISTANT_SCAN_LIMIT) break;
    if (assistant.scriptResult !== undefined) continue;
    if (assistant.status === "completed" && assistant.cliContext?.continuationId &&
      assistant.cliContext.interruptedContextIncluded) break;
    if (assistant.errorMessage === STREAM_CANCELLED_BY_USER_REASON && assistant.runId &&
      (assistant.cliType === "claude-code" || assistant.cliType === "codex")) runIds.add(assistant.runId);
  }
  const runs = await Promise.all([...runIds].map((runId) => listRunMessages(ctx, threadId, runId)));
  return runs.flat().filter((message) => message.role === "user" && message.processedAt !== undefined)
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** A run's messages, oldest first. */
export async function listRunMessages(ctx: Ctx, threadId: Id<"cliThreads">, runId: string): Promise<Doc<"cliMessages">[]> {
  return ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_runId_and_createdAt", (q) => q.eq("threadId", threadId).eq("runId", runId))
    .order("asc")
    .collect();
}

/**
 * User messages to hand a claiming CLI: the queue, preceded by any stranded
 * runs (OS-1672) so a crashed run's messages stay visible to the
 * agent. Only healed alongside a real queue, which is what keeps re-delivery
 * from looping when a run strands again.
 */
export async function listDeliverableUserMessages(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages">[]> {
  const queued = await listUnprocessedUserMessages(ctx, threadId);
  if (queued.length === 0) {
    return queued;
  }

  const { strandedRunIds } = await scanStrandedTail(ctx, threadId);
  if (strandedRunIds.size === 0) {
    return queued;
  }

  const strandedRuns = await Promise.all([...strandedRunIds].map((runId) => listRunMessages(ctx, threadId, runId)));
  const stranded = strandedRuns
    .flat()
    .filter((message) => message.role === "user")
    .sort((left, right) => left.createdAt - right.createdAt);

  return [...stranded, ...queued];
}

/**
 * Whether the thread still has at least one unprocessed user message. Indexed
 * `.first()` (Chat invariant #4 — no `.collect().length`).
 */
export async function hasUnprocessedUserMessages(ctx: Ctx, threadId: Id<"cliThreads">): Promise<boolean> {
  const firstUnprocessed = await ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_role_and_processedAt_and_createdAt", (q) =>
      q.eq("threadId", threadId).eq("role", "user").eq("processedAt", undefined)
    )
    .first();
  return firstUnprocessed !== null;
}

/** The most recent user message for a thread, or null. */
export async function getLatestUserMessage(ctx: Ctx, threadId: Id<"cliThreads">): Promise<Doc<"cliMessages"> | null> {
  return ctx.db
    .query("cliMessages")
    .withIndex("by_thread_and_role_and_createdAt", (q) => q.eq("threadId", threadId).eq("role", "user"))
    .order("desc")
    .first();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type MessageInsert = Omit<Doc<"cliMessages">, "_id" | "_creationTime">;

/** Insert a message row (system/derived fields are already shaped by callers). */
export async function insertCliMessage(ctx: MutationCtx, message: MessageInsert): Promise<Id<"cliMessages">> {
  return ctx.db.insert("cliMessages", message);
}

type AssistantMessageInsert = {
  threadId: Id<"cliThreads">;
  profileId: Id<"cliProfiles">;
  cliType: Doc<"cliMessages">["cliType"];
  cliMode?: string;
  cliModel?: Doc<"cliMessages">["cliModel"];
  cliEffort?: Doc<"cliMessages">["cliEffort"];
  cliVersion?: string;
  claimedBySessionId: Id<"cliSessions">;
  runId: string;
  now: number;
};

/**
 * Insert the streaming assistant message that a run response targets. Stamps
 * the streaming status, empty content, `nextChunkOrder: 0`, and timestamps.
 */
export async function insertAssistantStreamingMessage(ctx: MutationCtx, props: AssistantMessageInsert): Promise<Id<"cliMessages">> {
  return ctx.db.insert("cliMessages", {
    threadId: props.threadId,
    role: "assistant",
    profileId: props.profileId,
    cliType: props.cliType,
    cliMode: props.cliMode,
    cliModel: props.cliModel,
    cliEffort: props.cliEffort,
    ...(props.cliVersion !== undefined ? { cliVersion: props.cliVersion } : {}),
    nextChunkOrder: 0,
    content: [],
    status: "streaming",
    claimedBySessionId: props.claimedBySessionId,
    claimedAt: props.now,
    runId: props.runId,
    createdAt: props.now,
    updatedAt: props.now,
  });
}

/** A field-level patch on a message. Applied directly so `undefined` clears. */
export type CliMessageUpdatePatch = Partial<Omit<Doc<"cliMessages">, "_id" | "_creationTime">>;

/**
 * Apply a message patch, stamping `updatedAt`. The patch is applied via
 * `ctx.db.patch` so an explicit `undefined` value clears a field.
 */
export async function updateCliMessage(
  ctx: MutationCtx,
  messageId: Id<"cliMessages">,
  patch: CliMessageUpdatePatch,
  now: number
): Promise<void> {
  await ctx.db.patch("cliMessages", messageId, { ...patch, updatedAt: now });
}

/**
 * Set a message's `nextChunkOrder` without bumping `updatedAt` — used by the
 * send path when chunk insertion advanced the cursor past its initial value.
 */
export async function setMessageChunkOrder(ctx: MutationCtx, messageId: Id<"cliMessages">, nextChunkOrder: number): Promise<void> {
  await ctx.db.patch("cliMessages", messageId, { nextChunkOrder });
}

export async function deleteCliMessage(ctx: MutationCtx, messageId: Id<"cliMessages">): Promise<void> {
  await ctx.db.delete("cliMessages", messageId);
}

/**
 * Un-stamp a run's processed user messages back into the queue — the single
 * definition of what "un-processing" clears (`retry` and the edit-last rewind
 * both rewind through here, so the field list can't drift between them).
 * `excludeMessageId` skips a message the caller is about to delete anyway.
 */
export async function unstampRunUserMessages(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  runId: string,
  now: number,
  opts?: { excludeMessageId?: Id<"cliMessages"> }
): Promise<void> {
  const messages = await listRunMessages(ctx, threadId, runId);
  await Promise.all(
    messages
      .filter(
        (candidate) =>
          candidate.role === "user" && candidate.processedAt !== undefined && candidate._id !== opts?.excludeMessageId
      )
      .map((candidate) =>
        updateCliMessage(
          ctx,
          candidate._id,
          {
            processedAt: undefined,
            processedBySessionId: undefined,
            runId: undefined,
            steerRequestedAt: undefined,
            steeredAt: undefined,
          },
          now
        )
      )
  );
}

export async function paginateAssistantMessages(ctx: Ctx, threadId: Id<"cliThreads">, opts: { cursor: string | null; numItems: number }) {
  return ctx.db.query("cliMessages")
    .withIndex("by_thread_and_role_and_createdAt", q => q.eq("threadId", threadId).eq("role", "assistant"))
    .order("desc").paginate(opts);
}
