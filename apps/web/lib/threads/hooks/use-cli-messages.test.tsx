/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliMessages } from "./use-cli-messages";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

const sendMutationMock = vi.fn();
const retryMutationMock = vi.fn();
const steerMutationMock = vi.fn();
const removeQueuedMutationMock = vi.fn();
const editLastResendMutationMock = vi.fn();
const cancelMutationMock = vi.fn();
const backfillMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/lib/cli-stream-ui", () => ({
  applyDeltaPage: (
    eventStore: {
      rows: Array<{ messageId: string; createdAt: number; chunkOrder: number }>;
      dedupKeys: Set<string>;
      cursor: unknown;
    },
    deltaPage: {
      page: Array<{ messageId: string; createdAt: number; chunkOrder: number }>;
      nextCursor: unknown;
    }
  ) => {
    const rows = [...eventStore.rows, ...deltaPage.page].sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      if (a.messageId !== b.messageId) {
        return a.messageId < b.messageId ? -1 : 1;
      }
      return a.chunkOrder - b.chunkOrder;
    });

    const last = rows[rows.length - 1];

    return {
      state: {
        ...eventStore,
        rows,
        cursor:
          deltaPage.nextCursor ??
          (last
            ? {
                createdAt: last.createdAt,
                messageId: last.messageId,
                chunkOrder: last.chunkOrder,
              }
            : eventStore.cursor),
      },
      appliedRows: deltaPage.page,
      appliedCount: deltaPage.page.length,
    };
  },
  applyRowsToComposer: (composer: { messages: Map<string, { parts: Array<{ type: string; text: string }> }> }, rows: Array<{ messageId: string; event?: { kind: string; text?: string } }>) => {
    const messages = new Map(composer.messages);
    rows.forEach((row) => {
      const existing = messages.get(row.messageId) ?? { parts: [] };
      if (row.event?.kind === "text" && row.event.text) {
        messages.set(row.messageId, {
          parts: [...existing.parts, { type: "text", text: row.event.text }],
        });
        return;
      }
      if (row.event?.kind === "runtime-notice") {
        messages.set(row.messageId, {
          parts: [...existing.parts, { type: "task-notice-group", text: "" }],
        });
        return;
      }
      messages.set(row.messageId, existing);
    });
    return { messages };
  },
  initComposerFromStore: (store: {
    rows: Array<{ messageId: string; event?: { kind: string; text?: string } }>;
  }) => {
    const messages = new Map<string, { parts: Array<{ type: string; text: string }> }>();
    store.rows.forEach((row) => {
      const current = messages.get(row.messageId) ?? { parts: [] };
      if (row.event?.kind === "runtime-notice") {
        messages.set(row.messageId, {
          parts: [...current.parts, { type: "task-notice-group", text: "" }],
        });
        return;
      }
      if (row.event?.kind !== "text" || !row.event.text) {
        return;
      }
      messages.set(row.messageId, {
        parts: [...current.parts, { type: "text", text: row.event.text }],
      });
    });
    return { messages };
  },
  // Stand-in: drops every task group of the named message (real rule in composer.test.ts).
  hideUnanchoredTaskGroups: (
    messages: Map<string, { parts: Array<{ type: string; text: string }> }>,
    messageId: string | null
  ) => {
    const msg = messageId ? messages.get(messageId) : undefined;
    if (!messageId || !msg) return messages;
    const next = new Map(messages);
    next.set(messageId, { parts: msg.parts.filter((part) => part.type !== "task-notice-group") });
    return next;
  },
  deriveLatestContextWindow: () => null,
  deriveLatestUsageLimits: () => [],
  mergeUsageLimits: (
    previous: unknown[],
    updates: unknown[]
  ) => (updates.length > 0 ? updates : previous),
}));

type QueryRouterOptions = {
  /** Envelope rows, newest-first — wrapped into the query's window shape. */
  envelopes?: unknown;
  /** Older history exists above the capped envelope window (OS-1600). */
  hasOlderEnvelopes?: boolean;
  window?: unknown;
  olderWindow?: unknown;
  live?: unknown;
};

function mockCliQueryRouter(options: QueryRouterOptions): void {
  useQueryMock.mockImplementation((ref: unknown, args: unknown) => {
    if (args === "skip") {
      return undefined;
    }

    const functionName = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);

    if (functionName === getFunctionName(api.cli.messages.listEnvelopesByThread)) {
      return options.envelopes === undefined
        ? undefined
        : {
            envelopes: options.envelopes,
            hasOlderEnvelopes: options.hasOlderEnvelopes ?? false,
          };
    }

    if (functionName === getFunctionName(api.cli.messageChunks.listWindowByThread)) {
      if (!args || typeof args !== "object") {
        return undefined;
      }
      return "before" in args ? options.olderWindow : options.window;
    }

    if (functionName === getFunctionName(api.cli.messageChunks.listLiveByThread)) {
      return options.live;
    }

    return undefined;
  });
}

describe("useCliMessages", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    sendMutationMock.mockReset();
    retryMutationMock.mockReset();
    steerMutationMock.mockReset();
    removeQueuedMutationMock.mockReset();
    editLastResendMutationMock.mockReset();
    cancelMutationMock.mockReset();
    backfillMutationMock.mockReset();

    useMutationMock
      .mockReturnValueOnce(sendMutationMock)
      .mockReturnValueOnce(retryMutationMock)
      .mockReturnValueOnce(steerMutationMock)
      .mockReturnValueOnce(removeQueuedMutationMock)
      .mockReturnValueOnce(editLastResendMutationMock)
      .mockReturnValueOnce(cancelMutationMock)
      .mockReturnValueOnce(backfillMutationMock);
  });

  afterEach(() => {
    cleanup();
  });

  test("does not request older chunk windows on mount", async () => {
    const envelopesResult: [] = [];
    const windowResult = {
      page: [],
      nextOlderCursor: {
        createdAt: 10,
        messageId: "message_1" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasOlderChunks).toBe(true);
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      threadId: "thread_1",
      limit: 50,
    });
  });

  test("loads older chunk windows only when requested", async () => {
    const envelopesResult: [] = [];
    const windowResult = {
      page: [],
      nextOlderCursor: {
        createdAt: 10,
        messageId: "message_1" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.hasOlderChunks).toBe(true);
    });

    await act(async () => {
      result.current.loadOlderChunks();
    });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        threadId: "thread_1",
        before: {
          createdAt: 10,
          messageId: "message_1",
          chunkOrder: 0,
        },
        limit: 50,
      });
    });
  });

  test("requests the next older cursor on consecutive older-page loads", async () => {
    const envelopesResult: [] = [];
    const firstCursor = {
      createdAt: 10,
      messageId: "message_1" as Id<"cliMessages">,
      chunkOrder: 0,
    };
    const secondCursor = {
      createdAt: 5,
      messageId: "message_0" as Id<"cliMessages">,
      chunkOrder: 0,
    };

    useQueryMock.mockImplementation((ref: unknown, args: unknown) => {
      if (args === "skip") {
        return undefined;
      }

      const functionName = getFunctionName(
        ref as Parameters<typeof getFunctionName>[0]
      );

      if (functionName === getFunctionName(api.cli.messages.listEnvelopesByThread)) {
        return { envelopes: envelopesResult, hasOlderEnvelopes: false };
      }

      if (functionName === getFunctionName(api.cli.messageChunks.listWindowByThread)) {
        if (!args || typeof args !== "object" || !("before" in args)) {
          return {
            page: [],
            nextOlderCursor: firstCursor,
            hasMore: true,
          };
        }

        const before = args.before as typeof firstCursor;
        if (before.createdAt === firstCursor.createdAt) {
          return {
            page: [],
            nextOlderCursor: secondCursor,
            hasMore: true,
          };
        }

        if (before.createdAt === secondCursor.createdAt) {
          return {
            page: [],
            nextOlderCursor: null,
            hasMore: false,
          };
        }

        return undefined;
      }

      if (functionName === getFunctionName(api.cli.messageChunks.listLiveByThread)) {
        return {
          page: [],
          nextCursor: null,
          resetRequired: false,
        };
      }

      return undefined;
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.hasOlderChunks).toBe(true);
    });

    await act(async () => {
      result.current.loadOlderChunks();
    });

    await waitFor(() => {
      expect(result.current.isLoadingOlderChunks).toBe(false);
      expect(result.current.hasOlderChunks).toBe(true);
    });

    await act(async () => {
      result.current.loadOlderChunks();
    });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        threadId: "thread_1",
        before: secondCursor,
        limit: 50,
      });
    });
  });

  test("keeps the bootstrap window subscribed after a chunkless bootstrap so the first streamed chunk still arrives", async () => {
    // A thread launched from a task without typed text starts with zero
    // chunk rows: the bootstrap page is empty and hasMore is false. The
    // window query must stay subscribed (not flip to "skip"), otherwise no
    // subscription ever delivers the first streamed chunk and the thread
    // renders "Streaming..." forever.
    mockCliQueryRouter({
      envelopes: [],
      window: { page: [], nextOlderCursor: null, hasMore: false },
      live: undefined,
    });

    const { result, rerender } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The agent starts streaming: the still-subscribed bootstrap window
    // reactively delivers the first chunk.
    mockCliQueryRouter({
      envelopes: [],
      window: {
        page: [
          {
            messageId: "assistant_1" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 5,
            chunkOrder: 0,
            timestamp: 5,
            event: { kind: "text" as const, text: "Working on it." },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: undefined,
    });
    rerender();

    await waitFor(() => {
      expect(result.current.loadedChunkCount).toBe(1);
      expect(result.current.visibleMessageIds).toContain("assistant_1");
    });
  });

  test("keeps the earliest visible envelope renderable when only older chunks remain", async () => {
    const onlyEnvelope = {
      _id: "message_1" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [
        {
          fileName: "spec.md",
          storageId: "storage_1" as Id<"_storage">,
          fileSize: 42,
          contentType: "text/markdown",
        },
      ],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const envelopesResult = [onlyEnvelope];
    const windowResult = {
      page: [
        {
          messageId: "message_1" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Plan this task." },
        },
      ],
      nextOlderCursor: {
        createdAt: 1,
        messageId: "message_1" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasOlderChunks).toBe(true);
  });

  test("keeps isLoading false while an older chunk request is in flight", async () => {
    const envelopesResult: [] = [];
    const latestWindowResult = {
      page: [],
      nextOlderCursor: {
        createdAt: 10,
        messageId: "message_1" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: latestWindowResult,
      olderWindow: undefined,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.hasOlderChunks).toBe(true);
    });

    await act(async () => {
      result.current.loadOlderChunks();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isLoadingOlderChunks).toBe(true);
  });

  test("rebuilds assistant render order when older chunks for the same message are loaded", async () => {
    const envelopesResult = [
      {
        _id: "message_assistant" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "claude-code",
        attachments: [],
        status: "completed" as const,
        chunkCount: 4,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const latestWindowResult = {
      page: [
        {
          messageId: "message_assistant" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 3,
          chunkOrder: 2,
          timestamp: 3,
          event: { kind: "text" as const, text: "Attempt 3" },
        },
        {
          messageId: "message_assistant" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 4,
          chunkOrder: 3,
          timestamp: 4,
          event: { kind: "text" as const, text: "Attempt 4" },
        },
      ],
      nextOlderCursor: {
        createdAt: 3,
        messageId: "message_assistant" as Id<"cliMessages">,
        chunkOrder: 2,
      },
      hasMore: true,
    };
    const olderWindowResult = {
      page: [
        {
          messageId: "message_assistant" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Attempt 1" },
        },
        {
          messageId: "message_assistant" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 2,
          chunkOrder: 1,
          timestamp: 2,
          event: { kind: "text" as const, text: "Attempt 2" },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: latestWindowResult,
      olderWindow: olderWindowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(
        result.current.renderStateByMessageId
          .get("message_assistant")
          ?.parts.map((part) => ("text" in part ? part.text : ""))
      ).toEqual(["Attempt 3", "Attempt 4"]);
    });

    await act(async () => {
      result.current.loadOlderChunks();
    });

    await waitFor(() => {
      expect(
        result.current.renderStateByMessageId
          .get("message_assistant")
          ?.parts.map((part) => ("text" in part ? part.text : ""))
      ).toEqual(["Attempt 1", "Attempt 2", "Attempt 3", "Attempt 4"]);
    });
  });

  test("hides task groups of a message whose head is above the loaded window (OS-2285)", async () => {
    const messageId = "message_assistant" as Id<"cliMessages">;
    const threadId = "thread_1" as Id<"cliThreads">;
    const row = (chunkOrder: number, event: { kind: "text"; text: string } | { kind: "runtime-notice"; code: string; title: string; message: string }) => ({
      messageId, threadId, createdAt: chunkOrder + 1, chunkOrder, timestamp: chunkOrder + 1, event,
    });
    const notice = { kind: "runtime-notice" as const, code: "claude-system-task_progress", title: "n", message: "n" };
    mockCliQueryRouter({
      envelopes: [{
        _id: messageId, threadId, role: "assistant" as const, profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "claude-code", attachments: [], status: "streaming" as const, chunkCount: 4,
        hasLegacyContent: false, createdAt: 1, updatedAt: 1,
      }],
      window: {
        page: [row(2, { kind: "text", text: "Summary" }), row(3, notice)],
        nextOlderCursor: { createdAt: 3, messageId, chunkOrder: 2 },
        hasMore: true,
      },
      olderWindow: {
        page: [row(0, { kind: "text", text: "Start" }), row(1, notice)],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() => useCliMessages(threadId));
    const partTypes = () => result.current.renderStateByMessageId.get(messageId)?.parts.map((part) => part.type);

    await waitFor(() => expect(partTypes()).toEqual(["text"]));

    await act(async () => {
      result.current.loadOlderChunks();
    });

    await waitFor(() =>
      expect(partTypes()).toEqual(["text", "task-notice-group", "text", "task-notice-group"])
    );
  });

  test("renders chunkless user envelopes inside the loaded suffix (task launch without typed text)", async () => {
    const envelopesResult = [
      {
        _id: "message_user_chunkless" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 0,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "message_assistant" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "streaming" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    const windowResult = {
      page: [
        {
          messageId: "message_assistant" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 2,
          chunkOrder: 0,
          timestamp: 2,
          event: { kind: "text" as const, text: "Working on it." },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toContain(
        "message_user_chunkless"
      );
      expect(result.current.visibleMessageIds).toContain("message_assistant");
    });
  });

  test("renders a completed attachment-only assistant reply inside the loaded suffix (OS-2091)", async () => {
    const base = {
      threadId: "thread_1" as Id<"cliThreads">,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "claude-code",
      status: "completed" as const,
      hasLegacyContent: false,
    };
    const envelopesResult = [
      {
        ...base,
        _id: "message_assistant_files" as Id<"cliMessages">,
        role: "assistant" as const,
        attachments: [
          { storageId: "storage_1" as Id<"_storage">, fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 },
        ],
        chunkCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        ...base,
        _id: "message_assistant_text" as Id<"cliMessages">,
        role: "assistant" as const,
        attachments: [],
        chunkCount: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: {
        page: [
          {
            messageId: "message_assistant_text" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 2,
            chunkOrder: 0,
            timestamp: 2,
            event: { kind: "text" as const, text: "Done." },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toContain("message_assistant_text");
    });
    expect(result.current.visibleMessageIds).toContain("message_assistant_files");
  });

  test("lists a latest failed attachment-only reply once, not as both status row and chunkless row (OS-2091)", async () => {
    const base = {
      threadId: "thread_1" as Id<"cliThreads">,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "claude-code",
      status: "failed" as const,
      hasLegacyContent: false,
    };
    const envelopesResult = [
      {
        ...base,
        _id: "message_assistant_files" as Id<"cliMessages">,
        role: "assistant" as const,
        attachments: [
          { storageId: "storage_1" as Id<"_storage">, fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 },
        ],
        chunkCount: 0,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        ...base,
        _id: "message_assistant_text" as Id<"cliMessages">,
        role: "assistant" as const,
        attachments: [],
        chunkCount: 1,
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: {
        page: [
          {
            messageId: "message_assistant_text" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 2,
            chunkOrder: 0,
            timestamp: 2,
            event: { kind: "text" as const, text: "Done." },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toContain("message_assistant_text");
    });
    expect(result.current.visibleMessageIds.filter((id) => id === "message_assistant_files")).toHaveLength(1);
  });

  test("hides chunkless user envelopes older than the loaded suffix", async () => {
    const envelopesResult = [
      {
        _id: "message_user_chunkless_old" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 0,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        _id: "message_assistant_new" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 5,
        updatedAt: 5,
      },
    ];
    // Older history (between the chunkless user row and the loaded suffix)
    // is not loaded yet: the chunkless row must stay hidden to avoid an
    // envelope-only hole.
    const windowResult = {
      page: [
        {
          messageId: "message_assistant_new" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 5,
          chunkOrder: 0,
          timestamp: 5,
          event: { kind: "text" as const, text: "Done." },
        },
      ],
      nextOlderCursor: {
        createdAt: 5,
        messageId: "message_assistant_new" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toContain(
        "message_assistant_new"
      );
    });
    expect(result.current.visibleMessageIds).not.toContain(
      "message_user_chunkless_old"
    );
  });

  test("builds visible message ids from loaded chunks plus the latest pending assistant row", async () => {
    const envelopesResult = [
      {
        _id: "message_assistant_pending" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "pending" as const,
        chunkCount: 0,
        hasLegacyContent: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "message_user" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const windowResult = {
      page: [
        {
          messageId: "message_user" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Hello" },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_user",
        "message_assistant_pending",
      ]);
    });

    expect(result.current.userTextById.get("message_user")).toBe("Hello");
  });

  test("builds visible message ids from loaded chunks plus the latest streaming assistant row before first chunk", async () => {
    const envelopesResult = [
      {
        _id: "message_assistant_streaming" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "streaming" as const,
        chunkCount: 0,
        hasLegacyContent: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "message_user" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const windowResult = {
      page: [
        {
          messageId: "message_user" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Hello" },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_user",
        "message_assistant_streaming",
      ]);
    });
  });

  test("does not render a user envelope with attachments until its chunks are loaded", async () => {
    const envelopesResult = [
      {
        _id: "message_latest" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "message_attachment_only" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [
          {
            fileName: "spec.md",
            storageId: "storage_1" as Id<"_storage">,
            fileSize: 42,
            contentType: "text/markdown",
          },
        ],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const windowResult = {
      page: [
        {
          messageId: "message_latest" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 2,
          chunkOrder: 0,
          timestamp: 2,
          event: { kind: "text" as const, text: "Latest" },
        },
      ],
      nextOlderCursor: {
        createdAt: 2,
        messageId: "message_latest" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual(["message_latest"]);
    });
  });

  test("does not create envelope-only holes before loaded chunk-backed messages", async () => {
    const envelopesResult = [
      {
        _id: "message_4" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 4,
        updatedAt: 4,
      },
      {
        _id: "message_3" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        _id: "message_2" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "failed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        _id: "message_1" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [
          {
            fileName: "spec.md",
            storageId: "storage_1" as Id<"_storage">,
            fileSize: 42,
            contentType: "text/markdown",
          },
        ],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const windowResult = {
      page: [
        {
          messageId: "message_3" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 3,
          chunkOrder: 0,
          timestamp: 3,
          event: { kind: "text" as const, text: "Third" },
        },
        {
          messageId: "message_4" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 4,
          chunkOrder: 0,
          timestamp: 4,
          event: { kind: "text" as const, text: "Fourth" },
        },
      ],
      nextOlderCursor: {
        createdAt: 3,
        messageId: "message_3" as Id<"cliMessages">,
        chunkOrder: 0,
      },
      hasMore: true,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_3",
        "message_4",
      ]);
    });
  });

  test("skips completed empty envelopes without hiding older loaded messages", async () => {
    const oldestEnvelope = {
      _id: "message_oldest" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const gapEnvelope = {
      _id: "message_gap" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 2,
      updatedAt: 2,
    };
    const latestEnvelope = {
      _id: "message_latest" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 3,
      updatedAt: 3,
    };
    const envelopesResult = [latestEnvelope, gapEnvelope, oldestEnvelope];
    const windowResult = {
      page: [
        {
          messageId: "message_oldest" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Oldest" },
        },
        {
          messageId: "message_latest" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 3,
          chunkOrder: 0,
          timestamp: 3,
          event: { kind: "text" as const, text: "Latest" },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_oldest",
        "message_latest",
      ]);
    });
  });

  test("skips completed zero-output assistant envelopes without hiding older real messages", async () => {
    const oldestEnvelope = {
      _id: "message_oldest" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const noOutputAssistant = {
      _id: "message_no_output" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "assistant" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 0,
      hasLegacyContent: false,
      createdAt: 2,
      updatedAt: 2,
    };
    const latestEnvelope = {
      _id: "message_latest" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 3,
      updatedAt: 3,
    };
    const envelopesResult = [latestEnvelope, noOutputAssistant, oldestEnvelope];
    const windowResult = {
      page: [
        {
          messageId: "message_oldest" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 1,
          chunkOrder: 0,
          timestamp: 1,
          event: { kind: "text" as const, text: "Oldest" },
        },
        {
          messageId: "message_latest" as Id<"cliMessages">,
          threadId: "thread_1" as Id<"cliThreads">,
          createdAt: 3,
          chunkOrder: 0,
          timestamp: 3,
          event: { kind: "text" as const, text: "Latest" },
        },
      ],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_oldest",
        "message_latest",
      ]);
    });
  });

  test("keeps the thread rendered while re-bootstrapping after the cursor's chunks are deleted", async () => {
    // Edit-and-resend (OS-1374) deletes the discarded turn's chunk rows, so
    // the live query reports resetRequired. Dropping to the empty state made
    // the whole page fall back to the loading skeleton (OS-1434).
    const userEnvelope = {
      _id: "message_user" as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: "user" as const,
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "claude-code",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const assistantEnvelope = {
      ...userEnvelope,
      _id: "message_assistant" as Id<"cliMessages">,
      role: "assistant" as const,
      createdAt: 2,
      updatedAt: 2,
    };

    mockCliQueryRouter({
      envelopes: [assistantEnvelope, userEnvelope],
      window: {
        page: [
          {
            messageId: "message_user" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 1,
            chunkOrder: 0,
            timestamp: 1,
            event: { kind: "text" as const, text: "Original" },
          },
          {
            messageId: "message_assistant" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 2,
            chunkOrder: 0,
            timestamp: 2,
            event: { kind: "text" as const, text: "Answer" },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const loadingStates: boolean[] = [];
    const { result, rerender } = renderHook(() => {
      const value = useCliMessages("thread_1" as Id<"cliThreads">);
      loadingStates.push(value.isLoading);
      return value;
    });

    await waitFor(() => {
      expect(result.current.visibleMessageIds).toEqual([
        "message_user",
        "message_assistant",
      ]);
    });

    // The rewind lands: the assistant turn is gone and the user chunk is
    // rewritten, so the live cursor no longer resolves. The re-subscribed
    // bootstrap window is still in flight (undefined) — the thread must keep
    // rendering what it already has instead of dropping to the skeleton.
    loadingStates.length = 0;
    mockCliQueryRouter({
      envelopes: [userEnvelope],
      window: undefined,
      live: { page: [], nextCursor: null, resetRequired: true },
    });
    rerender();

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
        threadId: "thread_1",
        limit: 50,
      });
    });
    expect(loadingStates).not.toContain(true);
    expect(result.current.visibleMessageIds).toEqual([
      "message_user",
      "message_assistant",
    ]);

    // Fresh window lands: it replaces the stale rows rather than merging.
    mockCliQueryRouter({
      envelopes: [userEnvelope],
      window: {
        page: [
          {
            messageId: "message_user" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 1,
            chunkOrder: 0,
            timestamp: 1,
            event: { kind: "text" as const, text: "Edited" },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: true },
    });
    rerender();

    await waitFor(() => {
      expect(result.current.userTextById.get("message_user")).toBe("Edited");
    });
    expect(result.current.loadedChunkCount).toBe(1);
    expect(result.current.visibleMessageIds).toEqual(["message_user"]);
    expect(loadingStates).not.toContain(true);
  });

  test("backfills legacy threads once when envelopes report legacy content", async () => {
    const envelopesResult = [
      {
        _id: "message_legacy" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 0,
        hasLegacyContent: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const windowResult = {
      page: [],
      nextOlderCursor: null,
      hasMore: false,
    };
    const liveResult = {
      page: [],
      nextCursor: null,
      resetRequired: false,
    };

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: windowResult,
      live: liveResult,
    });

    renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));

    await waitFor(() => {
      expect(backfillMutationMock).toHaveBeenCalledWith({
        threadId: "thread_1",
      });
    });
  });

  // Backfill is owner-only; a viewer of a shared thread must not attempt it.
  test("does not backfill legacy threads when the caller cannot write", async () => {
    const envelopesResult = [
      {
        _id: "message_legacy" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 0,
        hasLegacyContent: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    mockCliQueryRouter({
      envelopes: envelopesResult,
      window: { page: [], nextOlderCursor: null, hasMore: false },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">, { canWrite: false })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(backfillMutationMock).not.toHaveBeenCalled();
  });
  test("exposes hasOlderEnvelopes for a thread longer than the capped envelope window", async () => {
    // The window is newest-anchored, so the chunk window sits inside it and
    // every derivation still sees the newest end (OS-1600).
    const envelopesResult = Array.from({ length: 200 }, (_, index) => ({
      _id: `message_${index}` as Id<"cliMessages">,
      threadId: "thread_1" as Id<"cliThreads">,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      profileId: "profile_1" as Id<"cliProfiles">,
      cliType: "codex",
      attachments: [],
      status: "completed" as const,
      chunkCount: 1,
      hasLegacyContent: false,
      createdAt: 1_000 - index,
      updatedAt: 1_000 - index,
    }));

    mockCliQueryRouter({
      envelopes: envelopesResult,
      hasOlderEnvelopes: true,
      window: {
        page: [
          {
            messageId: "message_0" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 1_000,
            chunkOrder: 0,
            timestamp: 1_000,
            event: { kind: "text" as const, text: "newest" },
          },
        ],
        nextOlderCursor: null,
        hasMore: false,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasOlderEnvelopes).toBe(true);
    // The window is reversed to oldest-first for rendering; the newest message
    // must still be the last entry so the pending-assistant and no-holes
    // derivations keep working.
    expect(result.current.envelopes).toHaveLength(200);
    expect(result.current.envelopes.at(-1)?._id).toBe("message_0");
  });

  test("reports no older envelopes for a thread inside the window", async () => {
    mockCliQueryRouter({
      envelopes: [],
      window: { page: [], nextOlderCursor: null, hasMore: false },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasOlderEnvelopes).toBe(false);
  });

  test("clamps chunk pagination once the cursor passes the envelope window", async () => {
    // The chunk table still has older rows (`hasMore: true`), but the next
    // cursor points older than every envelope the window carries. Those pages
    // resolve to message ids with no envelope, so they would be dropped
    // unrendered — the hook must stop offering them rather than let the user
    // click a dead "Show more" forever (OS-1600).
    const envelopesResult = [
      {
        _id: "message_1" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    ];

    mockCliQueryRouter({
      envelopes: envelopesResult,
      hasOlderEnvelopes: true,
      window: {
        page: [
          {
            messageId: "message_1" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 1_000,
            chunkOrder: 0,
            timestamp: 1_000,
            event: { kind: "text" as const, text: "newest" },
          },
        ],
        nextOlderCursor: {
          createdAt: 900,
          messageId: "message_older" as Id<"cliMessages">,
          chunkOrder: 0,
        },
        hasMore: true,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Clamped: the cursor (createdAt 900) is older than the oldest envelope
    // (1_000), so nothing it can reach would render.
    expect(result.current.hasOlderChunks).toBe(false);

    const callCountBefore = useQueryMock.mock.calls.length;
    act(() => {
      result.current.loadOlderChunks();
    });

    // No older-window query was issued.
    expect(
      useQueryMock.mock.calls
        .slice(callCountBefore)
        .some((call) => {
          const args = call[1];
          return Boolean(args && typeof args === "object" && "before" in args);
        })
    ).toBe(false);
  });

  test("keeps chunk pagination available while the cursor is inside the window", async () => {
    // Same shape, but the cursor still points at a message the window carries:
    // pagination must stay live so it can reach it.
    const envelopesResult = [
      {
        _id: "message_2" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "assistant" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        _id: "message_1" as Id<"cliMessages">,
        threadId: "thread_1" as Id<"cliThreads">,
        role: "user" as const,
        profileId: "profile_1" as Id<"cliProfiles">,
        cliType: "codex",
        attachments: [],
        status: "completed" as const,
        chunkCount: 1,
        hasLegacyContent: false,
        createdAt: 900,
        updatedAt: 900,
      },
    ];

    mockCliQueryRouter({
      envelopes: envelopesResult,
      hasOlderEnvelopes: false,
      window: {
        page: [
          {
            messageId: "message_2" as Id<"cliMessages">,
            threadId: "thread_1" as Id<"cliThreads">,
            createdAt: 1_000,
            chunkOrder: 0,
            timestamp: 1_000,
            event: { kind: "text" as const, text: "newest" },
          },
        ],
        nextOlderCursor: {
          createdAt: 900,
          messageId: "message_1" as Id<"cliMessages">,
          chunkOrder: 0,
        },
        hasMore: true,
      },
      live: { page: [], nextCursor: null, resetRequired: false },
    });

    const { result } = renderHook(() =>
      useCliMessages("thread_1" as Id<"cliThreads">)
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasOlderChunks).toBe(true);
  });
  describe("older-history continuation (OS-2007)", () => {
    const cursor = (order: number, messageId = "assistant") => ({
      createdAt: order + 100,
      messageId: messageId as Id<"cliMessages">,
      chunkOrder: order,
    });
    const page = (order: number, messageId = "assistant", hasMore = true) => ({
      page: [{ ...cursor(order, messageId), threadId: "thread_1", timestamp: order + 100,
        event: { kind: "text", text: `part ${order}` } }],
      nextOlderCursor: hasMore ? cursor(order, messageId) : null,
      hasMore,
    });
    function setup() {
      const responses = new Map<number, ReturnType<typeof page>>();
      const requested = new Set<number>();
      const initial = page(20);
      const envelopes = { envelopes: [
        { _id: "assistant", role: "assistant", createdAt: 100, status: "completed", attachments: [] },
        { _id: "user", role: "user", createdAt: 50, chunkCount: 1 },
      ], hasOlderEnvelopes: true };
      useQueryMock.mockImplementation((ref, args) => {
        if (args === "skip") return undefined;
        const name = getFunctionName(ref);
        if (name === getFunctionName(api.cli.messages.listEnvelopesByThread)) return envelopes;
        if (name !== getFunctionName(api.cli.messageChunks.listWindowByThread)) return undefined;
        if (!args.before) return initial;
        requested.add(args.before.chunkOrder);
        return responses.get(args.before.chunkOrder);
      });
      return { responses, requested };
    }

    test("continues same-message pages with uninterrupted loading, then stops at a new in-window message", () => {
      const { responses, requested } = setup();
      const { result, rerender } = renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));
      expect(requested.size).toBe(0);
      responses.set(20, page(19));
      act(() => result.current.loadOlderChunks());
      expect(requested.has(19)).toBe(true);
      expect(result.current.isLoadingOlderChunks).toBe(true);
      responses.set(19, page(18, "outside-window"));
      rerender();
      expect(requested.has(18)).toBe(true);
      responses.set(18, page(17, "user"));
      rerender();
      expect(result.current.isLoadingOlderChunks).toBe(false);
      expect(result.current.visibleMessageIds).toContain("user");
      expect(requested.has(17)).toBe(false);
    });

    test("pauses after five pages and allows a fresh click to continue", () => {
      const { responses, requested } = setup();
      for (let order = 20; order > 14; order--) responses.set(order, page(order - 1));
      const { result } = renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));
      act(() => result.current.loadOlderChunks());
      expect([...requested]).toEqual([20, 19, 18, 17, 16]);
      expect(result.current.isLoadingOlderChunks).toBe(false);
      expect(result.current.olderHistoryPaused).toBe(true);
      act(() => result.current.loadOlderChunks());
      expect(requested.has(15)).toBe(true);
      expect(result.current.olderHistoryPaused).toBe(false);
      expect(result.current.isLoadingOlderChunks).toBe(true);
    });

    test.each(["exhausted", "window-edge", "stalled"] as const)("stops continuation at %s", (reason) => {
      const { responses, requested } = setup();
      responses.set(20, page(19));
      responses.set(19, reason === "exhausted" ? page(18, "assistant", false)
        : reason === "window-edge" ? page(-51, "outside-window") : page(19));
      const { result } = renderHook(() => useCliMessages("thread_1" as Id<"cliThreads">));
      act(() => result.current.loadOlderChunks());
      expect([...requested]).toEqual([20, 19]);
      expect(result.current.isLoadingOlderChunks).toBe(false);
      expect(result.current.hasOlderChunks).toBe(false);
    });

    test("abandons continuation when switching threads", () => {
      const { responses, requested } = setup();
      responses.set(20, page(19));
      const { result, rerender } = renderHook(({ id }) => useCliMessages(id as Id<"cliThreads">), {
        initialProps: { id: "thread_1" },
      });
      act(() => result.current.loadOlderChunks());
      expect(result.current.isLoadingOlderChunks).toBe(true);
      rerender({ id: "thread_2" });
      expect(result.current.isLoadingOlderChunks).toBe(false);
      expect(result.current.olderHistoryPaused).toBe(false);
      expect(requested.has(18)).toBe(false);
    });
  });

});
