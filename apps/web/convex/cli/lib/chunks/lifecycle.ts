import { MAX_CHUNK_DATA_CHARS } from "./invariants";
import { isRecord } from "@/lib/type-guards";
import { ConvexError, convexToJson, type Value } from "convex/values";
import { internal } from "../../../_generated/api";
import type { QueryCtx, MutationCtx } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";
import {
  isEphemeralCliChunk,
  splitOversizedCliChunk,
} from "@/convex/cli/lib/runtimes/registry";
import { foldPlanEvents } from "@/convex/cli/lib/runtimes/shared/planProgress";
import { scrubOversizedChunkData } from "@/convex/cli/lib/runtimes/shared/scrubChunk";
import {
  expandCliNormalizedEvent,
  normalizeCliChunkToEvent,
  normalizeUserChunkToEvent,
} from "./normalizedEvents";
import type {
  CliNormalizedEvent,
  CliThreadGoal,
  CliThreadUsageLimit,
} from "../../../lib/contracts/validators";
import { toCliAccountUsage } from "../../../lib/contracts/validators";
import {
  deleteCliMessageChunk,
  insertCliMessageChunk,
  listAllChunksByMessage,
  listChunksByMessageAfterOrder,
  listEphemeralChunksByMessage,
  listLatestChunksByMessage,
} from "../cliMessageChunksRepo";
import {
  deleteStreamHead,
  getStreamHeadByMessage,
  insertStreamHead,
  setStreamHeadOrder,
} from "../cliMessageStreamHeadsRepo";
import { setMessageChunkOrder } from "../cliMessagesRepo";
import { getThreadById, mergeThreadStreamMetadata } from "../../threads/lib/cliThreadsRepo";

type ReadCtx = QueryCtx | MutationCtx;

function equalMetadata(left: Value | undefined, right: Value | undefined): boolean {
  return JSON.stringify(left === undefined ? null : convexToJson(left)) ===
    JSON.stringify(right === undefined ? null : convexToJson(right));
}

export type CliMessageContent = Doc<"cliMessages">["content"];
export type CliMessageContentBlock = CliMessageContent[number];

type ChunkTargetMessage = Pick<
  Doc<"cliMessages">,
  "_id" | "threadId" | "profileId" | "role" | "cliType"
>;

type StoredChunkInput = {
  type: string;
  data: string;
  timestamp: number;
  createdAt?: number;
};

function normalizeMessageChunk(args: {
  message: ChunkTargetMessage;
  chunk: Pick<StoredChunkInput, "type" | "data">;
}): CliNormalizedEvent {
  if (args.message.role === "user") {
    return normalizeUserChunkToEvent(args.chunk);
  }

  // Handles Convoy bridge chunks (convoy_notice) before delegating to the
  // runtime-specific normalizer.
  return normalizeCliChunkToEvent(args.chunk, args.message.cliType);
}

function truncateChunkData(data: string): string {
  let end = MAX_CHUNK_DATA_CHARS;
  // Never split a surrogate pair: a lone surrogate is not valid Unicode.
  const lastCode = data.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    end -= 1;
  }
  return data.slice(0, end);
}

/**
 * Keep every chunk row under the storage budget: oversized chunks are split
 * losslessly when the runtime knows how (coalesced streaming deltas), else
 * scrubbed into valid smaller JSON (base64 payloads dropped, huge strings
 * clamped — runtime-agnostic), else raw-truncated. Without this, one
 * oversized chunk fails the whole append and kills the stream (OS-1521).
 */
function prepareChunksForStorage(
  message: ChunkTargetMessage,
  chunks: StoredChunkInput[]
): StoredChunkInput[] {
  return chunks.flatMap((chunk) => {
    if (chunk.data.length <= MAX_CHUNK_DATA_CHARS) {
      return [chunk];
    }

    const pieces = splitOversizedCliChunk({
      cliType: message.cliType,
      chunk,
      maxDataChars: MAX_CHUNK_DATA_CHARS,
    });
    if (pieces) {
      return pieces.map((piece) => ({ ...chunk, ...piece }));
    }

    const scrubbed = scrubOversizedChunkData(chunk.data, MAX_CHUNK_DATA_CHARS);
    if (scrubbed !== null) {
      return [{ ...chunk, data: scrubbed }];
    }

    return [{ ...chunk, data: truncateChunkData(chunk.data) }];
  });
}

export async function insertMessageChunkRows(
  ctx: MutationCtx,
  args: {
    message: ChunkTargetMessage;
    chunks: StoredChunkInput[];
    startChunkOrder: number;
  }
): Promise<number> {
  if (args.chunks.length === 0) {
    return args.startChunkOrder;
  }

  const chunks = prepareChunksForStorage(args.message, args.chunks);

  const normalizedEvents = chunks.map((chunk) =>
    normalizeMessageChunk({ message: args.message, chunk })
  );

  if (args.message.role === "assistant" && args.message.cliType === "claude-code" &&
    normalizedEvents.some(event => event.kind === "account-usage" && event.usage.source === "unavailable")) {
    const thread = await getThreadById(ctx, args.message.threadId);
    const limits = thread?.metadata?.usageLimits ?? [];
    if (limits.length > 0) {
      for (const [index, event] of normalizedEvents.entries()) {
        if (event.kind !== "account-usage" || event.usage.source !== "unavailable") continue;
        const usage = toCliAccountUsage({
          ...event.usage, source: "last-reported", account: "Historical thread data; account unverified",
          buckets: limits.map(limit => ({ id: limit.window, windows: [{
            name: limit.window,
            label: limit.window === "5h" ? "5-hour limit" : limit.window === "weekly" ? "Weekly limit" : limit.window.replaceAll("_", " "),
            ...(limit.utilization !== undefined ? { usedPercent: limit.utilization * 100 } : {}),
            ...(limit.resetsAt !== undefined ? { resetsAt: limit.resetsAt } : {}),
            ...(limit.reportedAt !== undefined ? { reportedAt: limit.reportedAt } : {}),
            ...(limit.isUsingOverage !== undefined ? { isUsingOverage: limit.isUsingOverage } : {}),
          }] })),
        });
        if (!usage) continue;
        normalizedEvents[index] = { kind: "account-usage", usage };
        // Freeze historical values so subsequent account activity cannot rewrite this report.
        chunks[index] = { ...chunks[index], data: JSON.stringify(usage) };
      }
    }
  }

  const chunkIds = await Promise.all(
    chunks.map((chunk, index) => {
      const ephemeral =
        args.message.role === "assistant" &&
        isEphemeralCliChunk({ cliType: args.message.cliType, chunk });
      return insertCliMessageChunk(ctx, {
        messageId: args.message._id,
        threadId: args.message.threadId,
        profileId: args.message.profileId,
        chunkOrder: args.startChunkOrder + index,
        type: chunk.type,
        data: chunk.data,
        normalizedEvent: normalizedEvents[index],
        ...(ephemeral ? { ephemeral: true } : {}),
        timestamp: chunk.timestamp,
        createdAt: chunk.createdAt ?? chunk.timestamp,
      });
    })
  );

  await applyThreadMetadataEvents(ctx, args.message, normalizedEvents, chunks);
  await applyProposedPlanEvents(ctx, args.message, chunks, normalizedEvents, chunkIds);

  return args.startChunkOrder + chunks.length;
}

/** Keep a pointer to the proposal; its markdown stays in the completed chunk. */
async function applyProposedPlanEvents(
  ctx: MutationCtx,
  message: ChunkTargetMessage,
  chunks: StoredChunkInput[],
  events: CliNormalizedEvent[],
  chunkIds: Id<"cliMessageChunks">[]
): Promise<void> {
  if (message.role !== "assistant" || message.cliType !== "codex") return;
  const indices = events.flatMap((event, index) => {
    const isPlan = event.kind === "proposed-plan" && event.phase === "completed";
    const isTurn = chunks[index].type === "turn/completed" || chunks[index].type === "turn/started";
    return isPlan || isTurn ? [index] : [];
  });
  if (indices.length === 0) return;
  const thread = await getThreadById(ctx, message.threadId);
  if (!thread) return;
  let proposal = thread.metadata?.proposedPlan;
  for (const index of indices) {
    const event = events[index];
    if (event.kind === "proposed-plan") {
      proposal = event.text.trim()
        ? {
            messageId: message._id,
            itemId: event.itemId,
            turnId: event.turnId,
            chunkId: chunkIds[index],
            ready: false,
          }
        : undefined;
      continue;
    }
    if (chunks[index].type === "turn/started") {
      proposal = undefined;
      continue;
    }
    if (!proposal || proposal.messageId !== message._id) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(chunks[index].data);
    } catch {
      continue;
    }
    const turn = isRecord(payload) && isRecord(payload.turn) ? payload.turn : null;
    proposal =
      turn?.id === proposal.turnId && turn.status === "completed"
        ? { ...proposal, ready: true }
        : undefined;
  }
  const previous = thread.metadata?.proposedPlan;
  if (
    proposal?.messageId !== previous?.messageId ||
    proposal?.itemId !== previous?.itemId ||
    proposal?.turnId !== previous?.turnId ||
    proposal?.chunkId !== previous?.chunkId ||
    proposal?.ready !== previous?.ready
  ) {
    await mergeThreadStreamMetadata(ctx, thread, { proposedPlan: proposal });
  }
}

/** Latest snapshot per window, newest event winning (usage is state, not a log). */
function foldUsageLimits(
  current: CliThreadUsageLimit[],
  events: Array<Extract<CliNormalizedEvent, { kind: "usage-limit" }> & { reportedAt: number }>
): CliThreadUsageLimit[] {
  const byWindow = new Map(current.map((limit) => [limit.window, limit]));
  for (const event of events) {
    byWindow.set(event.window, {
      window: event.window,
      reportedAt: event.reportedAt,
      ...(event.utilization !== undefined ? { utilization: event.utilization } : {}),
      ...(event.resetsAt !== undefined ? { resetsAt: event.resetsAt } : {}),
      ...(event.isUsingOverage === true ? { isUsingOverage: true } : {}),
    });
  }
  return Array.from(byWindow.values());
}

/** Fold goal transitions in order. Spec: docs/specs/cli-thread-goal.md → Fold rules. */
function foldGoalEvents(
  current: CliThreadGoal | undefined,
  events: Array<Extract<CliNormalizedEvent, { kind: "goal" }>>
): CliThreadGoal | undefined {
  let goal = current;
  for (const event of events) {
    switch (event.source) {
      case "set":
        goal = event.objective ? { objective: event.objective, status: "active", iterations: 0 } : goal;
        break;
      case "check": {
        if (!event.objective) break;
        // The normalizer splits `[X]: R` at the first `]: `; an objective holding `]: ` re-splits on the known one.
        const feedback = `[${event.objective}]: ${event.lastReason ?? ""}`;
        const known = goal && feedback.startsWith(`[${goal.objective}]: `) ? goal.objective : undefined;
        const lastReason = known !== undefined ? feedback.slice(known.length + 4) : event.lastReason;
        goal = {
          objective: known ?? event.objective,
          status: "active",
          iterations: known !== undefined && goal?.status === "active" ? goal.iterations + 1 : 1,
          ...(lastReason ? { lastReason } : {}),
        };
        break;
      }
      case "report":
        goal = event.status && event.status !== "none" && event.objective
          ? {
              objective: event.objective,
              status: event.status,
              iterations: event.iterations ?? 0,
              ...(event.lastReason ? { lastReason: event.lastReason } : {}),
              ...(event.tokensUsed !== undefined ? { tokensUsed: event.tokensUsed } : {}),
              ...(event.tokenBudget !== undefined ? { tokenBudget: event.tokenBudget } : {}),
            }
          : undefined;
        break;
      case "cleared":
        goal = undefined;
        break;
      case "run-completed":
        goal = goal?.status === "active" ? { ...goal, status: "complete" } : goal;
        break;
    }
  }
  return goal;
}

/**
 * Fold this batch's thread-level events into `cliThreads.metadata`: plan
 * (OS-1442), context window and usage limits (OS-1889), goal (OS-2276). They live on the
 * thread rather than being derived from chunks at read time because the
 * message list is paginated: a reader may not hold the source chunks. See
 * docs/specs/cli-thread-plan-progress.md → Where the plan lives.
 */
async function applyThreadMetadataEvents(
  ctx: MutationCtx,
  message: ChunkTargetMessage,
  normalizedEvents: CliNormalizedEvent[],
  chunks: StoredChunkInput[],
): Promise<void> {
  const events = normalizedEvents.flatMap((event) => expandCliNormalizedEvent(event));
  const planEvents = events.filter(
    (event) => event.kind === "plan-progress" || event.kind === "plan-step-update"
  );
  const usageLimitEvents = normalizedEvents.flatMap((event, index) =>
    expandCliNormalizedEvent(event).flatMap(item => item.kind === "usage-limit"
      ? [{ ...item, reportedAt: chunks[index].timestamp }] : [])
  );
  const backgroundTasks = message.role === "assistant" && (message.cliType === "claude-code" || message.cliType === "codex")
    ? events.flatMap((event) => event.kind === "metadata" && event.backgroundTasks ? [event.backgroundTasks] : []).at(-1)
    : undefined;
  // Only snapshots with a max land on the thread: Claude's per-API-call events
  // have none, and writing them would patch `cliThreads` on every call (OS-1900).
  const contextWindow = events
    .flatMap((event) =>
      event.kind === "context-window" && event.maxTokens !== undefined
        ? [{ usedTokens: event.usedTokens, maxTokens: event.maxTokens }]
        : []
    )
    .at(-1);

  const goalEvents = events.filter((event) => event.kind === "goal");

  if (planEvents.length === 0 && usageLimitEvents.length === 0 && !contextWindow && !backgroundTasks &&
    goalEvents.length === 0) {
    return;
  }

  const thread = await getThreadById(ctx, message.threadId);
  if (!thread) {
    return;
  }

  // Only write what changed: a no-op patch would put avoidable OCC contention
  // on `cliThreads` in the streaming path, which otherwise never touches it.
  const patch: Partial<Pick<NonNullable<typeof thread.metadata>, "plan" | "contextWindow" | "usageLimits" | "backgroundTasks" | "goal">> = {};

  if (backgroundTasks && !thread.isDeleted && thread.processingState === "streaming" &&
      thread.activeAssistantMessageId === message._id) {
    const snapshot = { ...backgroundTasks, messageId: message._id };
    const stored = thread.metadata?.backgroundTasks;
    // Run init sends an empty snapshot; with nothing stored it changes nothing (OS-2623).
    if ((stored || snapshot.totalCount > 0) && !equalMetadata(snapshot, stored)) {
      patch.backgroundTasks = snapshot;
    }
  }

  const currentSteps = thread.metadata?.plan?.steps ?? [];
  const steps = planEvents.length > 0 ? foldPlanEvents(currentSteps, planEvents) : null;
  if (steps && !equalMetadata(steps, currentSteps)) {
    patch.plan = { steps };
  }

  if (contextWindow && !equalMetadata(contextWindow, thread.metadata?.contextWindow)) {
    patch.contextWindow = contextWindow;
  }

  if (usageLimitEvents.length > 0) {
    const current = thread.metadata?.usageLimits ?? [];
    const usageLimits = foldUsageLimits(current, usageLimitEvents);
    if (!equalMetadata(usageLimits, current)) {
      patch.usageLimits = usageLimits;
    }
  }

  if (goalEvents.length > 0) {
    const goal = foldGoalEvents(thread.metadata?.goal, goalEvents);
    if (!equalMetadata(goal, thread.metadata?.goal)) {
      patch.goal = goal;
    }
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  await mergeThreadStreamMetadata(ctx, thread, patch);
}

export async function getMessageContentForRead(
  ctx: ReadCtx,
  message: Doc<"cliMessages">
): Promise<CliMessageContent> {
  if (message.content.length > 0) {
    return message.content;
  }

  const chunkRows = await listAllChunksByMessage(ctx, message.threadId, message._id);
  return chunkRows.map((chunk) => ({
    type: chunk.type,
    data: chunk.data,
    timestamp: chunk.timestamp,
  }));
}

/**
 * A stamp this far from the server's clock is a broken agent clock, not a
 * latency artifact, so it is discarded rather than trusted.
 */
const MAX_AGENT_CLOCK_SKEW_MS = 60 * 60 * 1000;

/**
 * Prefer the agent's own emit time when it is plausible. Every chunk in one
 * `appendRunContent` call shares the server's `now`, which flattens tool
 * calls that resolve inside a single flush window to a 0ms span.
 */
function resolveChunkTimestamp(
  agentTimestamp: number | undefined,
  now: number
): number {
  if (agentTimestamp === undefined || !Number.isFinite(agentTimestamp)) {
    return now;
  }
  return Math.abs(agentTimestamp - now) > MAX_AGENT_CLOCK_SKEW_MS
    ? now
    : agentTimestamp;
}

/**
 * Advance the run's cursor on its own head row, never on the message: the
 * envelope window is subscribed, so a steady-state flush must not write the
 * message doc at all (OS-1729).
 */
export async function appendAssistantChunks(
  ctx: MutationCtx,
  message: Doc<"cliMessages">,
  incomingChunks: Array<{ type: string; data: string; timestamp?: number }>,
  now: number
): Promise<void> {
  const head = await getStreamHeadByMessage(ctx, message._id);
  // No head row yet on the run's first flush, and on a run already streaming
  // when this shipped — both resume from the envelope's settled value.
  const startChunkOrder = head?.nextChunkOrder ?? message.nextChunkOrder;
  if (startChunkOrder === undefined) {
    throw new ConvexError("Assistant message missing nextChunkOrder");
  }
  if (message.content.length > 0) {
    throw new ConvexError("Legacy assistant inline content is not supported");
  }
  if (incomingChunks.length === 0) {
    return;
  }

  const nextChunkOrder = await insertMessageChunkRows(ctx, {
    message,
    chunks: incomingChunks.map((chunk) => ({
      type: chunk.type,
      data: chunk.data,
      timestamp: resolveChunkTimestamp(chunk.timestamp, now),
      // `createdAt` is the read cursor and index sort key, so it stays on the
      // server clock even when the agent stamped the chunk itself.
      createdAt: now,
    })),
    startChunkOrder,
  });

  if (head) {
    await setStreamHeadOrder(ctx, head._id, nextChunkOrder);
  } else {
    await insertStreamHead(ctx, { messageId: message._id, nextChunkOrder });
  }
}

/** Rows one chunk-copy transaction moves; each carries its data, so smaller than the delete batch. */
export const CHUNK_COPY_BATCH_SIZE = 100;
/** Characters of chunk data one copy transaction writes before it cuts the batch early. */
export const CHUNK_COPY_BATCH_CHARS = 1_000_000;

export type CopiedMessageIdMap = Record<Id<"cliMessages">, Id<"cliMessages">>;

/** Steered-message markers name the steered user row; the copy must name the copied row. */
function remapSteeredMarker(
  row: Pick<Doc<"cliMessageChunks">, "type" | "data" | "normalizedEvent">,
  messageIdMap: CopiedMessageIdMap
): Pick<Doc<"cliMessageChunks">, "data" | "normalizedEvent"> {
  const unchanged = { data: row.data, normalizedEvent: row.normalizedEvent };
  if (row.type !== "convoy_notice") {
    return unchanged;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return unchanged;
  }
  if (!isRecord(parsed) || parsed.code !== "steered-message" || typeof parsed.messageId !== "string") {
    return unchanged;
  }
  const copied = messageIdMap[parsed.messageId as Id<"cliMessages">];
  if (!copied) {
    return unchanged;
  }
  const detailsJson = JSON.stringify({ messageId: copied });
  return {
    data: JSON.stringify({ ...parsed, messageId: copied }),
    normalizedEvent:
      row.normalizedEvent?.kind === "runtime-notice" ? { ...row.normalizedEvent, detailsJson } : row.normalizedEvent,
  };
}

/**
 * Copy a message's chunk rows onto another message one batch at a time (OS-1397),
 * keeping `chunkOrder` and stamping one shared `createdAt`. A batch that fills
 * its row or character budget reschedules through `cli/messages.copyMessageChunks`;
 * returns whether it did. Spec: cli-thread-fork.md.
 */
export async function copyMessageChunkRows(
  ctx: MutationCtx,
  args: {
    source: { threadId: Id<"cliThreads">; messageId: Id<"cliMessages"> };
    target: { threadId: Id<"cliThreads">; messageId: Id<"cliMessages">; profileId: Id<"cliProfiles"> };
    afterChunkOrder: number;
    createdAt: number;
    /** Source user row id to copied row id, for the reply's steered-message markers. */
    messageIdMap?: CopiedMessageIdMap;
  }
): Promise<boolean> {
  const page = await listChunksByMessageAfterOrder(
    ctx,
    args.source.threadId,
    args.source.messageId,
    args.afterChunkOrder,
    CHUNK_COPY_BATCH_SIZE
  );
  const rows = takeWithinCharBudget(page);
  const messageIdMap = args.messageIdMap ?? {};
  await Promise.all(
    rows
      .filter((row) => row.ephemeral === undefined)
      .map((row) =>
        insertCliMessageChunk(ctx, {
          messageId: args.target.messageId,
          threadId: args.target.threadId,
          profileId: args.target.profileId,
          chunkOrder: row.chunkOrder,
          type: row.type,
          ...remapSteeredMarker(row, messageIdMap),
          timestamp: row.timestamp,
          createdAt: args.createdAt,
        })
      )
  );

  const last = rows[rows.length - 1];
  if ((page.length === CHUNK_COPY_BATCH_SIZE || rows.length < page.length) && last) {
    await ctx.scheduler.runAfter(0, internal.cli.messages.copyMessageChunks, {
      sourceThreadId: args.source.threadId,
      sourceMessageId: args.source.messageId,
      targetThreadId: args.target.threadId,
      targetMessageId: args.target.messageId,
      afterChunkOrder: last.chunkOrder,
      createdAt: args.createdAt,
      messageIdMap,
    });
    return true;
  }
  return false;
}

/** The longest prefix under `CHUNK_COPY_BATCH_CHARS`, never shorter than one row. */
function takeWithinCharBudget<T extends { data: string }>(rows: T[]): T[] {
  let chars = 0;
  for (const [index, row] of rows.entries()) {
    chars += row.data.length;
    if (chars > CHUNK_COPY_BATCH_CHARS && index > 0) {
      return rows.slice(0, index);
    }
  }
  return rows;
}

/** Appended when the parent's reply vanished mid-copy: the fork's copy ends here (OS-1397). */
export const FORK_COPY_INCOMPLETE_NOTICE = {
  code: "fork-copy-incomplete",
  title: "Copy incomplete",
  message: "The original response changed before this copy finished; later parts are missing.",
};

/**
 * End of run: fold the head row's cursor back onto the message so a settled
 * envelope carries the real `chunkCount`, then drop the row (OS-1729).
 */
export async function settleAssistantStreamHead(
  ctx: MutationCtx,
  messageId: Id<"cliMessages">
): Promise<void> {
  const head = await getStreamHeadByMessage(ctx, messageId);
  if (!head) {
    return;
  }
  await setMessageChunkOrder(ctx, messageId, head.nextChunkOrder);
  await deleteStreamHead(ctx, head._id);
}

/**
 * A long run holds tens of thousands of chunk rows, and collecting plus deleting
 * them all in one transaction blows Convex's read limit (OS-1840). Deletion runs
 * one batch per transaction, rescheduling itself while rows remain.
 */
export const CHUNK_DELETE_BATCH_SIZE = 500;

export async function deleteAssistantChunkRows(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">
): Promise<void> {
  // Every path that destroys a message's chunks routes through here, so the
  // head row cannot outlive them.
  const head = await getStreamHeadByMessage(ctx, messageId);
  if (head) {
    await deleteStreamHead(ctx, head._id);
  }

  const chunkRows = await listLatestChunksByMessage(
    ctx,
    threadId,
    messageId,
    CHUNK_DELETE_BATCH_SIZE
  );
  await Promise.all(
    chunkRows.map((chunk) => deleteCliMessageChunk(ctx, chunk._id))
  );

  if (chunkRows.length === CHUNK_DELETE_BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.cli.messages.cleanupMessageChunks, {
      threadId,
      messageId,
    });
  }
}

/**
 * Delete up to `limit` ephemeral (partial-streaming) chunk rows for a message.
 * Returns the number of rows deleted so callers can reschedule for the rest.
 */
export async function deleteEphemeralChunkRows(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">,
  limit: number
): Promise<number> {
  const ephemeralRows = await listEphemeralChunksByMessage(
    ctx,
    threadId,
    messageId,
    limit
  );
  await Promise.all(
    ephemeralRows.map((chunk) => deleteCliMessageChunk(ctx, chunk._id))
  );
  return ephemeralRows.length;
}
