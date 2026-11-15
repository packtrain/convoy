/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliThreadForkedFrom } from "@/convex/lib/contracts/validators";
import { formatAskUserQuestionResponse } from "@/lib/ai-tools/ask-user-question";
import { readWholeForkPrefix, useForkPrefix, type ForkPrefixView } from "./use-fork-prefix";

const queryMock = vi.fn();

// One client object: `useConvex()` is referentially stable in the app, and the hook's effect depends on it.
const convexClient = { query: (...args: unknown[]) => queryMock(...args) };
vi.mock("convex/react", () => ({
  useConvex: () => convexClient,
}));

vi.mock("@/lib/cli-stream-ui", () => ({
  applyDeltaPage: (
    eventStore: { rows: Array<{ messageId: string; createdAt: number; chunkOrder: number }>; dedupKeys: Set<string>; cursor: unknown },
    deltaPage: { page: Array<{ messageId: string; createdAt: number; chunkOrder: number }> }
  ) => {
    const rows = [...eventStore.rows, ...deltaPage.page].sort((a, b) =>
      a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.chunkOrder - b.chunkOrder
    );
    return { state: { ...eventStore, rows }, appliedRows: deltaPage.page, appliedCount: deltaPage.page.length };
  },
  initComposerFromStore: (store: { rows: Array<{ messageId: string; event?: { kind: string; text?: string } }> }) => {
    const messages = new Map<string, { parts: Array<{ type: string; text: string }> }>();
    store.rows.forEach((row) => {
      if (row.event?.kind !== "text" || !row.event.text) return;
      const current = messages.get(row.messageId) ?? { parts: [] };
      messages.set(row.messageId, { parts: [...current.parts, { type: "text", text: row.event.text }] });
    });
    return { messages };
  },
}));

const parentThreadId = "thread_parent" as Id<"cliThreads">;
const grandparentThreadId = "thread_grandparent" as Id<"cliThreads">;
const runStart = { messageId: "message_3" as Id<"cliMessages">, createdAt: 3000 };
const reply = { messageId: "message_4" as Id<"cliMessages">, createdAt: 3500 };
const forkedFrom: CliThreadForkedFrom = { threadId: parentThreadId, runStart, reply, runId: "run-copied" };
const grandparentFork: CliThreadForkedFrom = {
  threadId: grandparentThreadId,
  runStart: { messageId: "message_g3" as Id<"cliMessages">, createdAt: 300 },
  reply: { messageId: "message_g4" as Id<"cliMessages">, createdAt: 350 },
  runId: "run-grand",
};

function envelope(id: string, role: "user" | "assistant", createdAt: number) {
  return { _id: id as Id<"cliMessages">, role, createdAt, chunkCount: 1, hasLegacyContent: false };
}
function row(messageId: string, createdAt: number, text: string, chunkOrder = 0) {
  return { messageId, threadId: parentThreadId, createdAt, chunkOrder, timestamp: createdAt, event: { kind: "text", text } };
}
function ids(view: ForkPrefixView) {
  return view.segments.flatMap((segment) => segment.messages.map((message) => message._id));
}

type ThreadRoute = {
  thread?: { title: string; forkedFrom?: CliThreadForkedFrom } | null;
  /** Served to the first envelope read, the one cut at the run start. */
  envelopes: unknown[];
  hasOlderEnvelopes?: boolean;
  /** Envelope pages served to later `before` reads, keyed by the cutoff. */
  olderEnvelopes?: Record<number, { envelopes: unknown[]; hasOlderEnvelopes: boolean }>;
  windows: Array<{ page: unknown[]; nextOlderCursor: unknown; hasMore: boolean }>;
};

function routeQueries(routes: Record<string, ThreadRoute>) {
  const windows = Object.fromEntries(Object.entries(routes).map(([threadId, route]) => [threadId, [...route.windows]]));
  const firstEnvelopeRead = new Set<string>();
  queryMock.mockImplementation(async (ref: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    const threadId = args.threadId as string;
    const route = routes[threadId];
    if (!route) throw new Error(`unexpected thread ${threadId}`);
    if (name === getFunctionName(api.cli.threads.core.get)) {
      return route.thread === undefined ? { title: "Parent" } : route.thread;
    }
    if (name === getFunctionName(api.cli.messages.listEnvelopesByThread)) {
      if (!firstEnvelopeRead.has(threadId)) {
        firstEnvelopeRead.add(threadId);
        return { envelopes: route.envelopes, hasOlderEnvelopes: route.hasOlderEnvelopes ?? false };
      }
      return route.olderEnvelopes?.[args.before as number] ?? { envelopes: [], hasOlderEnvelopes: false };
    }
    if (name === getFunctionName(api.cli.messageChunks.listWindowByThread)) {
      return windows[threadId]?.shift() ?? { page: [], nextOlderCursor: null, hasMore: false };
    }
    throw new Error(`unexpected query ${name}`);
  });
}

function windowCalls(threadId: string) {
  return queryMock.mock.calls.filter(
    ([ref, args]) => getFunctionName(ref) === getFunctionName(api.cli.messageChunks.listWindowByThread) && args.threadId === threadId
  );
}

describe("useForkPrefix", () => {
  afterEach(() => {
    cleanup();
    queryMock.mockReset();
  });

  test("reads the parent once on mount and renders oldest first", async () => {
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_2", "assistant", 2000), envelope("message_1", "user", 1000)],
        windows: [{ page: [row("message_2", 2000, "reply"), row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false }],
      },
    });

    const { result, rerender } = renderHook(() => useForkPrefix({ forkedFrom }));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    rerender();

    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls.find(([ref]) => getFunctionName(ref) === getFunctionName(api.cli.messages.listEnvelopesByThread))?.[1]).toEqual({
      threadId: parentThreadId,
      before: runStart.createdAt,
    });
    expect(windowCalls(parentThreadId)[0]?.[1]).toEqual({
      threadId: parentThreadId,
      // The chunk axis cuts at the copied reply: chunk rows are stamped on append, so a
      // reply still streaming when the forked prompt was queued has rows past the prompt.
      before: { createdAt: reply.createdAt, messageId: reply.messageId, chunkOrder: 0 },
      limit: 50,
    });
    expect(result.current.segments).toHaveLength(1);
    expect(result.current.segments[0]?.forkedFrom).toBe(forkedFrom);
    expect(result.current.segments[0]?.parentForkedFrom).toBeUndefined();
    expect(ids(result.current)).toEqual(["message_1", "message_2"]);
    expect(result.current.userTextById.get("message_1")).toBe("ask");
    expect(result.current.renderStateByMessageId.get("message_2")?.parts).toEqual([{ type: "text", text: "reply" }]);
    expect(result.current.hasOlder).toBe(false);
  });

  test("loads older pages on demand and hides messages whose chunks have not arrived", async () => {
    const olderCursor = { createdAt: 2000, messageId: "message_2", chunkOrder: 0 };
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_2", "assistant", 2000), envelope("message_1", "user", 1000)],
        windows: [
          { page: [row("message_2", 2000, "reply")], nextOlderCursor: olderCursor, hasMore: true },
          { page: [row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false },
        ],
      },
    });

    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(ids(result.current)).toEqual(["message_2"]);
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(ids(result.current)).toHaveLength(2));
    expect(ids(result.current)).toEqual(["message_1", "message_2"]);
    expect(result.current.hasOlder).toBe(false);
    expect(windowCalls(parentThreadId)[1]?.[1]).toMatchObject({ before: olderCursor });
  });

  test("hides the forked run's own rows, which arrive without an envelope", async () => {
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_2", "assistant", 2000)],
        windows: [{ page: [row("message_3", 3000, "forked prompt"), row("message_2", 2000, "reply")], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(ids(result.current)).toEqual(["message_2"]);
  });

  test("does not restart the read when the fork document re-renders with a fresh object", async () => {
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_1", "user", 1000)],
        windows: [{ page: [row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result, rerender } = renderHook((props: { forkedFrom: CliThreadForkedFrom }) => useForkPrefix(props), {
      initialProps: { forkedFrom },
    });
    rerender({ forkedFrom: { ...forkedFrom } });
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  test("reports unavailable when the parent is deleted or not viewable", async () => {
    routeQueries({ [parentThreadId]: { thread: null, envelopes: [], windows: [{ page: [], nextOlderCursor: null, hasMore: false }] } });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  test("exposes answered questions and attachments for history rows", async () => {
    const payload = {
      toolName: "AskUserQuestion" as const,
      toolCallId: "toolu_1",
      submittedAt: 1,
      answers: [{ questionIndex: 0, question: "Which?", multiSelect: false, selectedOptionLabels: ["A"] }],
    };
    const attachments = [{ storageId: "st_1", fileName: "f.png", fileSize: 3, contentType: "image/png", uploadedAt: 1 }];
    routeQueries({
      [parentThreadId]: {
        envelopes: [{ ...envelope("message_1", "user", 1000), attachments }],
        windows: [{ page: [row("message_1", 1000, formatAskUserQuestionResponse(payload))], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.askUserQuestionResponses).toEqual({ toolu_1: payload });
    expect(result.current.getUserMessageAttachments("message_1")).toBe(attachments);
    expect(result.current.getUserMessageAttachments("message_x")).toBeUndefined();
  });

  test("keeps an attachment-only assistant reply, which has no chunk rows (OS-2091)", async () => {
    const attachments = [{ storageId: "st_1", fileName: "shot.png", fileSize: 3, contentType: "image/png", uploadedAt: 1 }];
    routeQueries({
      [parentThreadId]: {
        envelopes: [{ ...envelope("message_2", "assistant", 2000), chunkCount: 0, attachments }, envelope("message_1", "user", 1000)],
        windows: [{ page: [row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(ids(result.current)).toEqual(["message_1", "message_2"]);
  });

  test("derives answered-question responses like the live view", async () => {
    const payload = {
      toolName: "AskUserQuestion" as const,
      toolCallId: "toolu_1",
      submittedAt: 1,
      answers: [{ questionIndex: 0, question: "Which?", multiSelect: false, selectedOptionLabels: ["A"] }],
    };
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_1", "user", 1000)],
        windows: [{ page: [row("message_1", 1000, formatAskUserQuestionResponse(payload))], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.userMessageResponseMap.get("message_1")).toEqual(payload);
  });

  test("pages envelopes past the window so older chunks can render", async () => {
    routeQueries({
      [parentThreadId]: {
        envelopes: [envelope("message_2", "assistant", 2000)],
        hasOlderEnvelopes: true,
        olderEnvelopes: { 2000: { envelopes: [envelope("message_1", "user", 1000)], hasOlderEnvelopes: false } },
        windows: [{ page: [row("message_2", 2000, "reply"), row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false }],
      },
    });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(ids(result.current)).toEqual(["message_2"]);
    expect(result.current.hasOlder).toBe(true);

    act(() => result.current.loadOlder());
    await waitFor(() => expect(ids(result.current)).toHaveLength(2));
    expect(ids(result.current)).toEqual(["message_1", "message_2"]);
    expect(result.current.hasOlder).toBe(false);
  });

  test("loads with no messages when the parent has nothing before the run", async () => {
    routeQueries({ [parentThreadId]: { envelopes: [], windows: [{ page: [], nextOlderCursor: null, hasMore: false }] } });
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(ids(result.current)).toEqual([]);
    expect(result.current.hasOlder).toBe(false);
  });

  test("reports unavailable when the read fails", async () => {
    queryMock.mockRejectedValue(new Error("not viewable"));
    const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  describe("fork chain", () => {
    test("stops at the parent on mount; Show more walks into the grandparent once the parent is exhausted", async () => {
      routeQueries({
        [parentThreadId]: {
          thread: { title: "Parent", forkedFrom: grandparentFork },
          envelopes: [envelope("message_2", "assistant", 2000)],
          windows: [{ page: [row("message_2", 2000, "parent reply")], nextOlderCursor: null, hasMore: false }],
        },
        [grandparentThreadId]: {
          envelopes: [envelope("message_g2", "assistant", 200)],
          windows: [{ page: [row("message_g2", 200, "grand reply")], nextOlderCursor: null, hasMore: false }],
        },
      });

      const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
      await waitFor(() => expect(result.current.status).toBe("loaded"));
      expect(ids(result.current)).toEqual(["message_2"]);
      expect(result.current.segments[0]?.parentForkedFrom).toEqual(grandparentFork);
      // The grandparent is one click away, not read yet.
      expect(windowCalls(grandparentThreadId)).toHaveLength(0);
      expect(result.current.hasOlder).toBe(true);

      act(() => result.current.loadOlder());
      await waitFor(() => expect(result.current.segments).toHaveLength(2));
      expect(result.current.segments.map((segment) => segment.forkedFrom.threadId)).toEqual([grandparentThreadId, parentThreadId]);
      expect(ids(result.current)).toEqual(["message_g2", "message_2"]);
      expect(result.current.renderStateByMessageId.get("message_g2")?.parts).toEqual([{ type: "text", text: "grand reply" }]);
      expect(result.current.hasOlder).toBe(false);
    });

    test("pages the parent before moving on", async () => {
      const olderCursor = { createdAt: 2000, messageId: "message_2", chunkOrder: 0 };
      routeQueries({
        [parentThreadId]: {
          thread: { title: "Parent", forkedFrom: grandparentFork },
          envelopes: [envelope("message_2", "assistant", 2000), envelope("message_1", "user", 1000)],
          windows: [
            { page: [row("message_2", 2000, "reply")], nextOlderCursor: olderCursor, hasMore: true },
            { page: [row("message_1", 1000, "ask")], nextOlderCursor: null, hasMore: false },
          ],
        },
        [grandparentThreadId]: { envelopes: [], windows: [] },
      });

      const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
      await waitFor(() => expect(result.current.status).toBe("loaded"));
      act(() => result.current.loadOlder());
      await waitFor(() => expect(ids(result.current)).toEqual(["message_1", "message_2"]));
      expect(windowCalls(grandparentThreadId)).toHaveLength(0);
      expect(result.current.hasOlder).toBe(true);
    });

    test("ends the walk when the grandparent is gone, keeping what is loaded", async () => {
      routeQueries({
        [parentThreadId]: {
          thread: { title: "Parent", forkedFrom: grandparentFork },
          envelopes: [envelope("message_2", "assistant", 2000)],
          windows: [{ page: [row("message_2", 2000, "parent reply")], nextOlderCursor: null, hasMore: false }],
        },
        [grandparentThreadId]: { thread: null, envelopes: [], windows: [] },
      });

      const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
      await waitFor(() => expect(result.current.status).toBe("loaded"));
      expect(result.current.hasOlder).toBe(true);
      act(() => result.current.loadOlder());
      await waitFor(() => expect(result.current.hasOlder).toBe(false));
      expect(result.current.status).toBe("loaded");
      expect(ids(result.current)).toEqual(["message_2"]);
    });

    test("skips an ancestor that held nothing before the copied run", async () => {
      routeQueries({
        [parentThreadId]: {
          thread: { title: "Parent", forkedFrom: grandparentFork },
          envelopes: [],
          windows: [{ page: [], nextOlderCursor: null, hasMore: false }],
        },
        [grandparentThreadId]: {
          envelopes: [envelope("message_g2", "assistant", 200)],
          windows: [{ page: [row("message_g2", 200, "grand reply")], nextOlderCursor: null, hasMore: false }],
        },
      });

      const { result } = renderHook(() => useForkPrefix({ forkedFrom }));
      await waitFor(() => expect(result.current.status).toBe("loaded"));
      expect(ids(result.current)).toEqual(["message_g2"]);
      expect(result.current.segments.map((segment) => segment.forkedFrom.threadId)).toEqual([grandparentThreadId, parentThreadId]);
      expect(result.current.hasOlder).toBe(false);
    });
  });

  describe("readWholeForkPrefix", () => {
    test("pages every ancestor to the end, oldest first", async () => {
      const olderCursor = { createdAt: 2000, messageId: "message_2", chunkOrder: 0 };
      routeQueries({
        [parentThreadId]: {
          thread: { title: "Parent", forkedFrom: grandparentFork },
          envelopes: [envelope("message_2", "assistant", 2000), envelope("message_1", "user", 1000)],
          windows: [
            { page: [row("message_2", 2000, "parent reply")], nextOlderCursor: olderCursor, hasMore: true },
            { page: [row("message_1", 1000, "parent ask")], nextOlderCursor: null, hasMore: false },
          ],
        },
        [grandparentThreadId]: {
          envelopes: [envelope("message_g1", "user", 100)],
          windows: [{ page: [row("message_g1", 100, "first ask")], nextOlderCursor: null, hasMore: false }],
        },
      });

      const prefix = await readWholeForkPrefix(convexClient as never, forkedFrom);

      expect(prefix.envelopes.map((message) => message._id)).toEqual(["message_g1", "message_1", "message_2"]);
      expect(prefix.userTextById.get("message_g1")).toBe("first ask");
      expect(prefix.partsByMessageId.get("message_2")?.parts).toEqual([{ type: "text", text: "parent reply" }]);
      expect(prefix.complete).toBe(true);
    });

    test("stops, marked incomplete, when a page makes no progress", async () => {
      routeQueries({
        [parentThreadId]: {
          envelopes: [envelope("message_2", "assistant", 2000)],
          // `hasMore` with no cursor: a page that can never advance.
          windows: [{ page: [row("message_2", 2000, "reply")], nextOlderCursor: null, hasMore: true }],
        },
      });

      const prefix = await readWholeForkPrefix(convexClient as never, forkedFrom);

      expect(prefix.envelopes.map((message) => message._id)).toEqual(["message_2"]);
      expect(prefix.complete).toBe(false);
    });
  });
});
