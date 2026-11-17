"use client";

import type { FunctionArgs } from "convex/server";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { CliProposedPlanSource, ImageDimensions } from "@/convex/lib/contracts/validators";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ContextWindowSnapshot,
  ComposerMessageState,
  UsageLimitUsage,
} from "@/lib/cli-stream-ui";
import { compareChunkOrder } from "@/convex/cli/lib/chunks/chunkOrder";
import { findLatestRowMessage, rendersFromEnvelope } from "@/lib/threads/message-rows";
import type { CliModel } from "@/lib/threads/types";
import type { ThreadComposerDocument } from "@/lib/slash-commands/composer";
import {
  applyDeltaPage,
  applyRowsToComposer,
  hideUnanchoredTaskGroups,
  initComposerFromStore,
  deriveLatestContextWindow,
  deriveLatestUsageLimits,
  mergeUsageLimits,
} from "@/lib/cli-stream-ui";
import type {
  ComposerState,
  EventStoreState,
  NormalizedChunkRow,
} from "@/lib/cli-stream-ui";

const WINDOW_LIMIT = 50;
const LIVE_LIMIT = 200;
const MAX_OLDER_PAGES_PER_REQUEST = 5;

export interface CliMessageAttachmentInput {
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
  dimensions?: ImageDimensions;
}

export type EditCliMessageOptions = Omit<FunctionArgs<typeof api.cli.messages.editLastResend>, "messageId" | "content">;

export interface SendCliMessageArgs {
  sourceProposedPlan?: CliProposedPlanSource;
  content: string;
  composerDocument?: ThreadComposerDocument;
  cliMode?: string;
  cliModel?: CliModel;
  cliEffort?: string;
  attachments?: CliMessageAttachmentInput[];
  taskId?: Id<"tasks">;
  /** A github.com PR URL; the thread keeps the first one. */
  pullRequestUrl?: string;
  /** Whole message is a runtime slash command — forwarded raw to the agent. */
  runtimeCommand?: boolean;
  /** Deliver the runtime command before every queued message (OS-2339). */
  queueFirst?: boolean;
}

type MessageEnvelope = FunctionReturnType<
  typeof api.cli.messages.listEnvelopesByThread
>["envelopes"][number];

type ChunkCursor = NonNullable<
  FunctionReturnType<typeof api.cli.messageChunks.listLiveByThread>["nextCursor"]
>;

type WindowQueryResult = FunctionReturnType<
  typeof api.cli.messageChunks.listWindowByThread
>;

type LiveQueryResult = FunctionReturnType<
  typeof api.cli.messageChunks.listLiveByThread
>;

export interface UseCliMessagesResult {
  envelopes: MessageEnvelope[];
  envelopesById: Map<string, MessageEnvelope>;
  visibleMessageIds: Array<Id<"cliMessages">>;
  renderStateByMessageId: ComposerState["messages"];
  userTextById: Map<string, string>;
  loadedChunkCount: number;
  isLoading: boolean;
  /**
   * More chunk history is fetchable **within the envelope window**. Clamped at
   * the window's oldest fetchable message: pages older than that resolve to
   * message ids with no envelope, so they would load rows that never render
   * (OS-1600).
   */
  hasOlderChunks: boolean;
  /**
   * Older messages exist above the loaded envelope window (OS-1600). The
   * window is newest-anchored and capped, so a long thread has history that
   * no amount of chunk pagination can reach — the top cut stays visible to
   * say so rather than pretending the thread starts at the window edge.
   */
  hasOlderEnvelopes: boolean;
  isLoadingOlderChunks: boolean;
  /** A bounded history request stopped before reaching another message. */
  olderHistoryPaused?: boolean;
  loadOlderChunks: () => void;
  assistantRenderById: ComposerState["messages"];
  sendMessage: (
    targetThreadId: Id<"cliThreads">,
    args: SendCliMessageArgs
  ) => Promise<Id<"cliMessages">>;
  retryMessage: (messageId: Id<"cliMessages">) => Promise<void>;
  steerMessage: (messageId: Id<"cliMessages">) => Promise<void>;
  removeQueuedMessage: (
    messageId: Id<"cliMessages">,
    options?: { preserveAttachments?: boolean }
  ) => Promise<FunctionReturnType<typeof api.cli.messages.removeQueued>>;
  /** Edit the latest user message and resend it while the thread is idle. */
  editLastMessage: (
    messageId: Id<"cliMessages">,
    content: string,
    options?: EditCliMessageOptions
  ) => Promise<void>;
  /** `superseded`: the user is taking the turn over, not stopping it (OS-1461). */
  cancelProcessing: (
    targetThreadId: Id<"cliThreads">,
    options?: { superseded?: boolean }
  ) => Promise<void>;
  /** Newest stream snapshot; may lack a max until one is carried forward (OS-1900). */
  latestContextWindow: ContextWindowSnapshot | null;
  latestUsageLimits: UsageLimitUsage[];
}

type StreamState = {
  eventStore: EventStoreState;
  composer: ComposerState;
  orderedLoadedMessageIds: Array<Id<"cliMessages">>;
  latestContextWindow: ContextWindowSnapshot | null;
  latestUsageLimits: UsageLimitUsage[];
  bootstrapLoaded: boolean;
  nextOlderCursor: ChunkCursor | null;
  hasOlderChunks: boolean;
  historyBeforeCursor: ChunkCursor | null;
  isLoadingOlderChunks: boolean;
  /** Server dropped the chunks under our cursor: the next bootstrap window
   * replaces the store instead of merging into it. */
  pendingRebootstrap: boolean;
  olderPagesLoaded: number;
  olderHistoryPaused: boolean;
};

type StreamAction =
  | { type: "reset" }
  | { type: "requestOlder" }
  | {
      type: "window";
      rows: NormalizedChunkRow[];
      nextOlderCursor: ChunkCursor | null;
      hasMore: boolean;
      envelopes: MessageEnvelope[];
    }
  | {
      type: "live";
      page: NormalizedChunkRow[];
      nextCursor: ChunkCursor | null;
      resetRequired: boolean;
    };

const INITIAL_STREAM_STATE: StreamState = {
  eventStore: { rows: [], dedupKeys: new Set(), cursor: null },
  composer: { messages: new Map() },
  orderedLoadedMessageIds: [],
  latestContextWindow: null,
  latestUsageLimits: [],
  bootstrapLoaded: false,
  nextOlderCursor: null,
  hasOlderChunks: false,
  historyBeforeCursor: null,
  isLoadingOlderChunks: false,
  pendingRebootstrap: false,
  olderPagesLoaded: 0,
  olderHistoryPaused: false,
};

function deriveOrderedMessageIds(
  rows: NormalizedChunkRow[]
): Array<Id<"cliMessages">> {
  const orderedMessageIds: Array<Id<"cliMessages">> = [];
  const seenMessageIds = new Set<string>();

  rows.forEach((row) => {
    if (seenMessageIds.has(row.messageId)) {
      return;
    }

    seenMessageIds.add(row.messageId);
    orderedMessageIds.push(row.messageId);
  });

  return orderedMessageIds;
}

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case "reset":
      return INITIAL_STREAM_STATE;

    case "requestOlder":
      if (
        state.isLoadingOlderChunks ||
        !state.hasOlderChunks ||
        !state.nextOlderCursor
      ) {
        return state;
      }
      return {
        ...state,
        historyBeforeCursor: state.nextOlderCursor,
        isLoadingOlderChunks: true,
        olderPagesLoaded: 0,
        olderHistoryPaused: false,
      };

    case "window": {
      const baseStore = state.pendingRebootstrap
        ? { rows: [], dedupKeys: new Set<string>(), cursor: null }
        : state.eventStore;
      const { state: eventStore, appliedRows } = applyDeltaPage(baseStore, {
        page: action.rows,
        nextCursor: null,
        resetRequired: false,
      });
      const isOlderWindow = state.historyBeforeCursor !== null;
      const shouldRebuildComposer =
        !state.bootstrapLoaded || (isOlderWindow && appliedRows.length > 0);
      const composer = shouldRebuildComposer
        ? initComposerFromStore(eventStore)
        : state.composer;
      const orderedLoadedMessageIds =
        !state.bootstrapLoaded || isOlderWindow
          ? deriveOrderedMessageIds(eventStore.rows)
          : state.orderedLoadedMessageIds;

      const loadedIds = new Set(state.orderedLoadedMessageIds);
      const envelopeIds = new Set(action.envelopes.map((envelope) => envelope._id));
      const addedMessage = appliedRows.some(
        (row) => envelopeIds.has(row.messageId) && !loadedIds.has(row.messageId)
      );
      const cursorAdvanced =
        !state.historyBeforeCursor ||
        (action.nextOlderCursor !== null &&
          compareChunkOrder(action.nextOlderCursor, state.historyBeforeCursor) < 0);
      const hasOlderChunks =
        action.hasMore && action.nextOlderCursor !== null && cursorAdvanced;
      const withinWindow =
        action.envelopes.length > 0 &&
        action.nextOlderCursor !== null &&
        action.nextOlderCursor.createdAt >=
          Math.min(...action.envelopes.map((envelope) => envelope.createdAt));
      const olderPagesLoaded = isOlderWindow ? state.olderPagesLoaded + 1 : 0;
      // Same-message chunks can disappear inside a collapsed tool group (OS-2007).
      const needsAnotherPage =
        isOlderWindow && !addedMessage && hasOlderChunks && withinWindow;
      const olderHistoryPaused =
        needsAnotherPage && olderPagesLoaded >= MAX_OLDER_PAGES_PER_REQUEST;
      const continueHistory = needsAnotherPage && !olderHistoryPaused;

      return {
        eventStore,
        composer,
        orderedLoadedMessageIds,
        latestContextWindow:
          deriveLatestContextWindow(eventStore.rows, state.latestContextWindow?.maxTokens) ??
          state.latestContextWindow,
        latestUsageLimits: mergeUsageLimits(
          state.latestUsageLimits,
          deriveLatestUsageLimits(eventStore.rows)
        ),
        // A chunkless bootstrap (empty page, no history) must not complete: that unsubscribes
        // the window query while the live query is still gated on a null cursor, leaving nothing
        // to deliver the first chunk. Threads launched from a task without typed text start
        // chunkless, so their first chunks arrive only once the agent streams.
        bootstrapLoaded:
          state.bootstrapLoaded ||
          eventStore.rows.length > 0 ||
          action.hasMore,
        nextOlderCursor: action.nextOlderCursor,
        hasOlderChunks,
        historyBeforeCursor: continueHistory ? action.nextOlderCursor : null,
        isLoadingOlderChunks: continueHistory,
        olderPagesLoaded,
        olderHistoryPaused,
        pendingRebootstrap: false,
      };
    }

    case "live": {
      if (action.resetRequired) {
        // The chunks our cursor pointed at were deleted server-side (an edit-and-resend rewinds
        // the last turn). Re-bootstrap, but keep the current rows rendered until the fresh window
        // lands — dropping to the empty state blanks the thread and reads as a page reload
        // (OS-1434). Clearing the cursor unsubscribes the live query so it can't re-fire the
        // reset mid-bootstrap.
        return {
          ...state,
          eventStore: { ...state.eventStore, cursor: null },
          bootstrapLoaded: false,
          pendingRebootstrap: true,
          olderPagesLoaded: 0,
          olderHistoryPaused: false,
          historyBeforeCursor: null,
          isLoadingOlderChunks: false,
        };
      }

      const { state: eventStore, appliedRows } = applyDeltaPage(state.eventStore, {
        page: action.page,
        nextCursor: action.nextCursor,
        resetRequired: false,
      });
      const orderedLoadedMessageIds = [...state.orderedLoadedMessageIds];
      const seenMessageIds = new Set(orderedLoadedMessageIds);
      appliedRows.forEach((row) => {
        if (seenMessageIds.has(row.messageId)) {
          return;
        }
        seenMessageIds.add(row.messageId);
        orderedLoadedMessageIds.push(row.messageId);
      });

      return {
        ...state,
        eventStore,
        composer: applyRowsToComposer(state.composer, appliedRows),
        orderedLoadedMessageIds,
        latestContextWindow:
          deriveLatestContextWindow(appliedRows, state.latestContextWindow?.maxTokens) ??
          state.latestContextWindow,
        latestUsageLimits: mergeUsageLimits(
          state.latestUsageLimits,
          deriveLatestUsageLimits(appliedRows)
        ),
        bootstrapLoaded: true,
      };
    }
  }
}

function toChunkRows(
  page: WindowQueryResult["page"] | LiveQueryResult["page"]
): NormalizedChunkRow[] {
  return page as NormalizedChunkRow[];
}

function toChunkCursor(
  cursor: WindowQueryResult["nextOlderCursor"] | LiveQueryResult["nextCursor"]
): ChunkCursor | null {
  return cursor as ChunkCursor | null;
}

function cursorKey(cursor: ChunkCursor | null): string {
  if (!cursor) {
    return "latest";
  }

  return `${cursor.createdAt}:${cursor.messageId}:${cursor.chunkOrder}`;
}

export function extractUserText(renderState: ComposerMessageState | undefined): string {
  if (!renderState) {
    return "";
  }

  return renderState.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

interface UseCliMessagesOptions {
  /**
   * Whether the caller owns the thread. A viewer of a shared thread reads the
   * same transcript but must not fire the legacy-content backfill, which is an
   * owner-only mutation (`docs/specs/cli-thread-sharing.md`). Defaults to true
   * so the owner path is unchanged while `isOwner` is still loading.
   */
  canWrite?: boolean;
}

export function useCliMessages(
  threadId: Id<"cliThreads"> | undefined,
  options?: UseCliMessagesOptions
): UseCliMessagesResult {
  const canWrite = options?.canWrite ?? true;
  const [stream, dispatch] = useReducer(streamReducer, INITIAL_STREAM_STATE);

  const lastWindowRef = useRef<WindowQueryResult | undefined>(undefined);
  const lastWindowKeyRef = useRef<string>("");
  const lastLiveRef = useRef<LiveQueryResult | undefined>(undefined);
  const migratedThreadRef = useRef<Id<"cliThreads"> | undefined>(undefined);

  useEffect(() => {
    lastWindowRef.current = undefined;
    lastWindowKeyRef.current = "";
    lastLiveRef.current = undefined;
    migratedThreadRef.current = undefined;
    dispatch({ type: "reset" });
  }, [threadId]);

  const sendMutation = useMutation(api.cli.messages.send);
  const retryMutation = useMutation(api.cli.messages.retry);
  const steerMutation = useMutation(api.cli.messages.requestSteer);
  const removeQueuedMutation = useMutation(api.cli.messages.removeQueued);
  const editLastResendMutation = useMutation(api.cli.messages.editLastResend);
  const cancelProcessingMutation = useMutation(
    api.cli.threads.runControl.cancelProcessing
  );
  const backfillThreadMutation = useMutation(
    api.cli.messages.backfillLegacyContentForThread
  );

  const envelopeWindow = useQuery(
    api.cli.messages.listEnvelopesByThread,
    threadId ? { threadId } : "skip"
  );
  const newestFirstEnvelopes = envelopeWindow?.envelopes;

  useEffect(() => {
    if (!threadId || !newestFirstEnvelopes || !canWrite) {
      return;
    }

    if (!newestFirstEnvelopes.some((message) => message.hasLegacyContent)) {
      return;
    }

    if (migratedThreadRef.current === threadId) {
      return;
    }

    migratedThreadRef.current = threadId;
    void backfillThreadMutation({ threadId });
  }, [backfillThreadMutation, canWrite, newestFirstEnvelopes, threadId]);

  const windowQueryBeforeCursor =
    !stream.bootstrapLoaded ? null : stream.historyBeforeCursor;
  const windowQueryKey = cursorKey(windowQueryBeforeCursor);
  const windowResult = useQuery(
    api.cli.messageChunks.listWindowByThread,
    !threadId
      ? "skip"
      : !stream.bootstrapLoaded
        ? {
            threadId,
            limit: WINDOW_LIMIT,
          }
        : windowQueryBeforeCursor
          ? {
              threadId,
              before: windowQueryBeforeCursor,
              limit: WINDOW_LIMIT,
            }
          : "skip"
  );

  useEffect(() => {
    if (!windowResult) {
      return;
    }

    if (
      windowResult === lastWindowRef.current &&
      windowQueryKey === lastWindowKeyRef.current
    ) {
      return;
    }

    lastWindowRef.current = windowResult;
    lastWindowKeyRef.current = windowQueryKey;

    dispatch({
      type: "window",
      rows: toChunkRows(windowResult.page),
      nextOlderCursor: toChunkCursor(windowResult.nextOlderCursor),
      hasMore: windowResult.hasMore,
      envelopes: newestFirstEnvelopes ?? [],
    });
  }, [newestFirstEnvelopes, windowQueryKey, windowResult]);

  const liveCursor = stream.eventStore.cursor as ChunkCursor | null;
  const liveResult = useQuery(
    api.cli.messageChunks.listLiveByThread,
    threadId && liveCursor
      ? { threadId, after: liveCursor, limit: LIVE_LIMIT }
      : "skip"
  );

  useEffect(() => {
    if (!liveResult || liveResult === lastLiveRef.current) {
      return;
    }

    lastLiveRef.current = liveResult;
    if (liveResult.resetRequired) {
      lastWindowRef.current = undefined;
      lastWindowKeyRef.current = "";
    }

    dispatch({
      type: "live",
      page: toChunkRows(liveResult.page),
      nextCursor: toChunkCursor(liveResult.nextCursor),
      resetRequired: liveResult.resetRequired,
    });
  }, [liveResult]);

  const envelopes = useMemo(
    () => (newestFirstEnvelopes ? [...newestFirstEnvelopes].reverse() : []),
    [newestFirstEnvelopes]
  );

  const envelopesById = useMemo(
    () => new Map(envelopes.map((message) => [message._id, message])),
    [envelopes]
  );

  const loadedMessageIds = useMemo(
    () => new Set(stream.orderedLoadedMessageIds),
    [stream.orderedLoadedMessageIds]
  );

  /**
  * `stream.hasOlderChunks` is computed over the chunk table alone and knows nothing
  * about `ENVELOPE_WINDOW_LIMIT`, so past the window edge every further page resolves
  * to message ids with no envelope — the user clicks a live "Show more", pays the read
  * and sees nothing. So chunk pagination stops once the cursor leaves the window
  * (OS-1600).
  *
  * The test is the cursor, not "is every in-window message loaded": a loaded id only
  * proves *some* of its chunks arrived. A chunk is never older than its message, so a
  * cursor older than the oldest envelope can only reach messages outside the window.
  */
  const hasOlderChunksInWindow = useMemo(() => {
    if (!stream.hasOlderChunks || !stream.nextOlderCursor) {
      return stream.hasOlderChunks;
    }
    if (envelopes.length === 0) {
      // No window yet: the chunk axis is the only thing that knows whether
      // older history exists.
      return stream.hasOlderChunks;
    }

    const oldestEnvelopeCreatedAt = Math.min(
      ...envelopes.map((envelope) => envelope.createdAt)
    );
    return stream.nextOlderCursor.createdAt >= oldestEnvelopeCreatedAt;
  }, [envelopes, stream.hasOlderChunks, stream.nextOlderCursor]);

  const visibleMessageIds = useMemo(() => {
    const orderedChunkMessageIds = [...stream.orderedLoadedMessageIds];
    // A trailing steer has no row of its own, so it must not stand in for the
    // thread's latest message here either (OS-1463).
    const latestEnvelope = findLatestRowMessage(envelopes);
    const latestStatusOnlyAssistantId =
      latestEnvelope &&
      latestEnvelope.role === "assistant" &&
      !loadedMessageIds.has(latestEnvelope._id) &&
      (latestEnvelope.status === "pending" ||
        latestEnvelope.status === "streaming" ||
        latestEnvelope.status === "failed")
        ? latestEnvelope._id
        : null;

    if (
      latestStatusOnlyAssistantId &&
      !loadedMessageIds.has(latestStatusOnlyAssistantId)
    ) {
      orderedChunkMessageIds.push(latestStatusOnlyAssistantId);
    }

    // Chunkless user envelopes render from envelope data alone (task pill, attachments): threads
    // launched from a task without typed text never store user chunk rows, so chunk-gated
    // visibility would hide them forever. Same for an attachment-only assistant reply (OS-2091).
    // Included only inside the fully-loaded suffix of history, so they can't form envelope-only
    // holes above unloaded messages.
    const oldestLoadedEnvelope = envelopes.find((envelope) =>
      loadedMessageIds.has(envelope._id)
    );
    envelopes.forEach((envelope) => {
      if (
        !rendersFromEnvelope(envelope) ||
        envelope.hasLegacyContent ||
        loadedMessageIds.has(envelope._id) ||
        envelope._id === latestStatusOnlyAssistantId
      ) {
        return;
      }
      // Clamped, not raw: once the window's oldest fetchable message is loaded,
      // the loaded suffix covers the whole envelope window, so no chunkless
      // envelope in it can form a hole above unloaded history.
      const insideLoadedSuffix =
        !hasOlderChunksInWindow ||
        (oldestLoadedEnvelope !== undefined &&
          envelope.createdAt >= oldestLoadedEnvelope.createdAt);
      if (insideLoadedSuffix) {
        orderedChunkMessageIds.push(envelope._id);
      }
    });

    return orderedChunkMessageIds;
  }, [
    envelopes,
    hasOlderChunksInWindow,
    loadedMessageIds,
    stream.orderedLoadedMessageIds,
  ]);

  // Only the oldest loaded message can be cut, and only while its order-0 row is unloaded (OS-2285).
  const oldestRow = stream.eventStore.rows[0];
  const headlessMessageId =
    hasOlderChunksInWindow && oldestRow && oldestRow.chunkOrder !== 0 ? oldestRow.messageId : null;
  const renderStateByMessageId = useMemo(
    () => hideUnanchoredTaskGroups(stream.composer.messages, headlessMessageId),
    [headlessMessageId, stream.composer.messages]
  );
  const loadedChunkCount = stream.eventStore.rows.length;

  // The queued strip lists every unprocessed message, but a long run can push one's chunks
  // below the history window, so those are read by id instead (OS-2422).
  const unloadedQueuedIds = useMemo(
    () =>
      envelopes
        .filter((message) => message.role === "user" && message.processedAt === undefined && !loadedMessageIds.has(message._id))
        .map((message) => message._id),
    [envelopes, loadedMessageIds]
  );
  const unloadedQueuedRows = useQuery(
    api.cli.messageChunks.listNormalizedByMessages,
    threadId && unloadedQueuedIds.length > 0 ? { threadId, messageIds: unloadedQueuedIds } : "skip"
  )?.page;
  const unloadedQueuedParts = useMemo(
    () =>
      unloadedQueuedRows
        ? initComposerFromStore({ rows: unloadedQueuedRows as NormalizedChunkRow[], dedupKeys: new Set(), cursor: null }).messages
        : undefined,
    [unloadedQueuedRows]
  );

  const userTextById = useMemo(() => {
    const textMap = new Map<string, string>();

    envelopes.forEach((message) => {
      if (message.role !== "user") {
        return;
      }

      textMap.set(
        message._id,
        extractUserText(renderStateByMessageId.get(message._id) ?? unloadedQueuedParts?.get(message._id))
      );
    });

    return textMap;
  }, [envelopes, renderStateByMessageId, unloadedQueuedParts]);

  const sendMessage = useCallback(
    async (
      targetThreadId: Id<"cliThreads">,
      args: SendCliMessageArgs
    ) => {
      return await sendMutation({
        threadId: targetThreadId,
        content: args.content,
        sourceProposedPlan: args.sourceProposedPlan,
        composerDocument: args.composerDocument,
        cliMode: args.cliMode,
        cliModel: args.cliModel,
        cliEffort: args.cliEffort,
        attachments: args.attachments,
        taskId: args.taskId,
        pullRequestUrl: args.pullRequestUrl,
        runtimeCommand: args.runtimeCommand,
        queueFirst: args.queueFirst,
      });
    },
    [sendMutation]
  );

  const retryMessage = useCallback(
    async (messageId: Id<"cliMessages">) => {
      await retryMutation({ messageId });
    },
    [retryMutation]
  );

  const steerMessage = useCallback(
    async (messageId: Id<"cliMessages">) => {
      await steerMutation({ messageId });
    },
    [steerMutation]
  );

  const removeQueuedMessage = useCallback(
    async (messageId: Id<"cliMessages">, options?: { preserveAttachments?: boolean }) => {
      return await removeQueuedMutation({
        messageId,
        preserveAttachments: options?.preserveAttachments,
      });
    },
    [removeQueuedMutation]
  );

  const editLastMessage = useCallback(
    async (messageId: Id<"cliMessages">, content: string, options?: EditCliMessageOptions) => {
      await editLastResendMutation({ messageId, content, ...options });
    },
    [editLastResendMutation]
  );

  const cancelProcessing = useCallback(
    async (targetThreadId: Id<"cliThreads">, options?: { superseded?: boolean }) => {
      await cancelProcessingMutation({
        threadId: targetThreadId,
        superseded: options?.superseded,
      });
    },
    [cancelProcessingMutation]
  );

  const loadOlderChunks = useCallback(() => {
    if (
      stream.isLoadingOlderChunks ||
      !hasOlderChunksInWindow ||
      !stream.nextOlderCursor
    ) {
      return;
    }

    dispatch({ type: "requestOlder" });
  }, [hasOlderChunksInWindow, stream.isLoadingOlderChunks, stream.nextOlderCursor]);

  return {
    envelopes,
    envelopesById,
      visibleMessageIds,
    renderStateByMessageId,
    userTextById,
    loadedChunkCount,
    // Only the first load counts: a re-bootstrap keeps its rows on screen, and
    // flipping back to loading would swap the whole thread for a skeleton.
    isLoading:
      newestFirstEnvelopes === undefined ||
      (!stream.bootstrapLoaded &&
        stream.eventStore.rows.length === 0 &&
        windowResult === undefined),
    hasOlderChunks: hasOlderChunksInWindow,
    hasOlderEnvelopes: envelopeWindow?.hasOlderEnvelopes ?? false,
    isLoadingOlderChunks: stream.isLoadingOlderChunks,
    olderHistoryPaused: stream.olderHistoryPaused,
    loadOlderChunks,
    assistantRenderById: renderStateByMessageId,
    sendMessage,
    retryMessage,
    steerMessage,
    removeQueuedMessage,
    editLastMessage,
    cancelProcessing,
    latestContextWindow: stream.latestContextWindow,
    latestUsageLimits: stream.latestUsageLimits,
  };
}
