/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ComposerMessageState } from "@/lib/cli-stream-ui/types";
import { useThreadDetailMessageVisibility } from "./use-thread-detail-message-visibility";

function createMessages(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `message_${index + 1}`,
    role: "user" as const,
  }));
}

function createRenderState(partsCount: number): ComposerMessageState {
  return {
    parts: Array.from({ length: partsCount }, (_, index) => ({
      type: "text" as const,
      text: `Part ${index + 1}`,
    })),
    metadata: {},
    normalizedEvents: [],
    warnings: [],
    toolPartIndexById: new Map(),
    toolTimingsByCallId: new Map(),
    taskNoticeGroupIndexByKey: new Map(),
    taskNoticeGroupIndexByParentToolUseId: new Map(),
    deltaPartIndices: new Set(),
    narrativePartIndexByKey: new Map(),
    completedNarrativeKeys: new Set(),
  };
}

describe("useThreadDetailMessageVisibility", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows a local cut when the part budget hides loaded messages", () => {
    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages: createMessages(101),
        renderStateByMessageId: new Map(),
        loadedChunkCount: 101,
        hasOlderChunks: false,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.visibleMessages).toHaveLength(100);
    expect(result.current.showOlderMessagesCut).toBe(true);
    expect(result.current.showOlderMessagesLabel).toBe("Show more messages");
  });

  test("shows the generic cut when older chunk pages remain", () => {
    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages: createMessages(1),
        renderStateByMessageId: new Map(),
        loadedChunkCount: 1,
        hasOlderChunks: true,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.showOlderMessagesCut).toBe(true);
    expect(result.current.showOlderMessagesLabel).toBe("Show more");
  });

  test("counts assistant message parts against the render budget", () => {
    const messages = [
      {
        _id: "message_1",
        role: "user" as const,
      },
      {
        _id: "message_assistant",
        role: "assistant" as const,
      },
      ...createMessages(96).map((message, index) => ({
        ...message,
        _id: `message_tail_${index + 1}`,
      })),
    ];

    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages,
        renderStateByMessageId: new Map([
          ["message_assistant", createRenderState(5)],
        ]),
        loadedChunkCount: 102,
        hasOlderChunks: false,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.visibleMessages).toHaveLength(96);
    expect(result.current.visibleMessages[0]?._id).toBe("message_tail_1");
    expect(result.current.showOlderMessagesLabel).toBe("Show more messages");
  });

  test("shows the placeholder immediately and clears it when chunk count grows", () => {
    const loadOlderChunks = vi.fn();
    const { result, rerender } = renderHook(
      ({ loadedChunkCount }) =>
        useThreadDetailMessageVisibility({
          threadId: "thread_1",
          messages: createMessages(1),
          renderStateByMessageId: new Map(),
          loadedChunkCount,
          hasOlderChunks: true,
          isLoadingOlderChunks: false,
          loadOlderChunks,
        }),
      {
        initialProps: {
          loadedChunkCount: 1,
        },
      }
    );

    act(() => {
      result.current.handleShowOlderMessages();
    });

    expect(loadOlderChunks).toHaveBeenCalledTimes(1);
    expect(result.current.showOlderMessagesPlaceholder).toBe(true);

    rerender({ loadedChunkCount: 2 });

    expect(result.current.showOlderMessagesPlaceholder).toBe(false);
  });

  test("clears the placeholder when older history is exhausted", () => {
    const { result, rerender } = renderHook(
      ({ hasOlderChunks }) =>
        useThreadDetailMessageVisibility({
          threadId: "thread_1",
          messages: createMessages(1),
          renderStateByMessageId: new Map(),
          loadedChunkCount: 1,
          hasOlderChunks,
          isLoadingOlderChunks: false,
          loadOlderChunks: vi.fn(),
        }),
      {
        initialProps: {
          hasOlderChunks: true,
        },
      }
    );

    act(() => {
      result.current.handleShowOlderMessages();
    });

    expect(result.current.showOlderMessagesPlaceholder).toBe(true);

    rerender({ hasOlderChunks: false });

    expect(result.current.showOlderMessagesPlaceholder).toBe(false);
  });

  test("resets the local render budget when the thread changes", () => {
    const { result, rerender } = renderHook(
      ({ threadId }) =>
        useThreadDetailMessageVisibility({
          threadId,
          messages: createMessages(101),
          renderStateByMessageId: new Map(),
          loadedChunkCount: 101,
          hasOlderChunks: false,
          isLoadingOlderChunks: false,
          loadOlderChunks: vi.fn(),
        }),
      {
        initialProps: {
          threadId: "thread_1",
        },
      }
    );

    act(() => {
      result.current.handleShowOlderMessages();
    });

    expect(result.current.visibleMessages).toHaveLength(101);
    expect(result.current.showOlderMessagesCut).toBe(false);

    rerender({ threadId: "thread_2" });

    expect(result.current.visibleMessages).toHaveLength(100);
    expect(result.current.showOlderMessagesLabel).toBe("Show more messages");
  });
  /**
   * A streaming assistant on a long thread: its live part count alone decides
   * how much of the history the budget admits, so the floor must advance past
   * whatever mount seeded (OS-1707).
   */
  function renderStreamingThread(initialParts: number) {
    const messages = [
      ...createMessages(150),
      { _id: "message_streaming", role: "assistant" as const },
    ];

    return renderHook(
      ({ parts, removedId }: { parts: number; removedId?: string }) =>
        useThreadDetailMessageVisibility({
          threadId: "thread_1",
          messages: removedId
            ? messages.filter((message) => message._id !== removedId)
            : messages,
          renderStateByMessageId: new Map([
            ["message_streaming", createRenderState(parts)],
          ]),
          loadedChunkCount: 500,
          hasOlderChunks: false,
          isLoadingOlderChunks: false,
          loadOlderChunks: vi.fn(),
        }),
      { initialProps: { parts: initialParts } as { parts: number; removedId?: string } }
    );
  }

  test("keeps clicked-open messages visible when the budget narrows again", () => {
    // Starts with the budget hiding history, so the floor has to move past what
    // mount admitted: only then does a re-narrowing prove the floor holds
    // rather than the budget still admitting everything.
    const { result, rerender } = renderStreamingThread(150);

    expect(result.current.visibleMessages).toHaveLength(1);

    act(() => {
      result.current.handleShowOlderMessages();
    });
    const revealed = result.current.visibleMessages.length;
    expect(revealed).toBeGreaterThan(1);

    // More deltas arrive and the budget narrows again: nothing may be re-hidden.
    rerender({ parts: 300 });

    expect(result.current.visibleMessages).toHaveLength(revealed);
  });

  test("holds the floor when the oldest revealed message leaves the list", () => {
    // Deleting a message (edit-and-resend, removeQueued) or the envelope window
    // sliding drops ids from the array. An id-keyed floor silently vanishes with
    // them and the history collapses — the flap through a different door.
    const { result, rerender } = renderStreamingThread(150);

    act(() => {
      result.current.handleShowOlderMessages();
    });
    const revealedIds = result.current.visibleMessages.map(
      (message) => message._id
    );
    const oldestRevealedId = revealedIds[0];
    expect(oldestRevealedId).toBeDefined();

    rerender({ parts: 300, removedId: oldestRevealedId });

    // Every message still in the list that had been revealed is still revealed.
    const visibleIds = new Set(
      result.current.visibleMessages.map((message) => message._id)
    );
    expect(
      revealedIds
        .filter((id) => id !== oldestRevealedId)
        .every((id) => visibleIds.has(id))
    ).toBe(true);
  });

  test("does not ratchet the floor open on a transient budget widening", () => {
    // `removeDeltaParts` can briefly collapse a streaming message to a single
    // part, which would otherwise latch a far wider floor than the user ever
    // asked for and keep it for the session.
    const { result, rerender } = renderStreamingThread(90);

    const initial = result.current.visibleMessages.length;

    rerender({ parts: 1 });
    rerender({ parts: 90 });

    expect(result.current.visibleMessages).toHaveLength(initial);
  });

  test("resets the floor when the thread changes after it has moved", () => {
    const messages = [
      ...createMessages(150),
      { _id: "message_streaming", role: "assistant" as const },
    ];
    const { result, rerender } = renderHook(
      ({ threadId, parts }) =>
        useThreadDetailMessageVisibility({
          threadId,
          messages,
          renderStateByMessageId: new Map([
            ["message_streaming", createRenderState(parts)],
          ]),
          loadedChunkCount: 500,
          hasOlderChunks: false,
          isLoadingOlderChunks: false,
          loadOlderChunks: vi.fn(),
        }),
      { initialProps: { threadId: "thread_1", parts: 150 } }
    );

    act(() => {
      result.current.handleShowOlderMessages();
    });
    expect(result.current.visibleMessages.length).toBeGreaterThan(1);

    // A different thread must not inherit the previous thread's floor.
    rerender({ threadId: "thread_2", parts: 150 });

    expect(result.current.visibleMessages).toHaveLength(1);
  });

  test("marks the envelope-window edge as a non-actionable cut", () => {
    // Everything loaded is rendered and no chunk pages remain, but the thread
    // is longer than the capped envelope window (OS-1600): the cut must still
    // appear, saying there is history above, and must not offer a fetch that
    // cannot deliver anything.
    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages: createMessages(1),
        renderStateByMessageId: new Map(),
        loadedChunkCount: 1,
        hasOlderChunks: false,
        hasOlderEnvelopes: true,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.showOlderMessagesCut).toBe(true);
    expect(result.current.showOlderMessagesLabel).toBe(
      "Beginning of loaded history"
    );
    expect(result.current.isOlderMessagesCutActionable).toBe(false);
  });

  test("keeps the cut actionable while chunk pages remain", () => {
    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages: createMessages(1),
        renderStateByMessageId: new Map(),
        loadedChunkCount: 1,
        hasOlderChunks: true,
        hasOlderEnvelopes: true,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.showOlderMessagesLabel).toBe("Show more");
    expect(result.current.isOlderMessagesCutActionable).toBe(true);
  });

  test("shows no cut for a fully loaded short thread", () => {
    const { result } = renderHook(() =>
      useThreadDetailMessageVisibility({
        threadId: "thread_1",
        messages: createMessages(1),
        renderStateByMessageId: new Map(),
        loadedChunkCount: 1,
        hasOlderChunks: false,
        hasOlderEnvelopes: false,
        isLoadingOlderChunks: false,
        loadOlderChunks: vi.fn(),
      })
    );

    expect(result.current.showOlderMessagesCut).toBe(false);
    expect(result.current.showOlderMessagesLabel).toBeUndefined();
  });
  test("offers continuation after the older-history budget pauses", () => {
    const { result } = renderHook(() => useThreadDetailMessageVisibility({
      threadId: "paused-thread", messages: createMessages(1),
      renderStateByMessageId: new Map(), loadedChunkCount: 2000,
      hasOlderChunks: true, isLoadingOlderChunks: false,
      olderHistoryPaused: true, loadOlderChunks: vi.fn(),
    }));
    expect(result.current.showOlderMessagesLabel).toBe("More history remains. Continue loading");
    expect(result.current.showOlderMessagesPlaceholder).toBe(false);
    expect(result.current.isOlderMessagesCutActionable).toBe(true);
  });

  test("reserves room beyond the currently visible messages when fetching older history", () => {
    const tail = createMessages(10).map((message) => ({ ...message, role: "assistant" as const }));
    const states = new Map(tail.map((message) => [message._id, createRenderState(10)]));
    const { result, rerender } = renderHook(({ messages, loadedChunkCount }) => useThreadDetailMessageVisibility({
      threadId: "budget-growth", messages, renderStateByMessageId: states,
      loadedChunkCount, hasOlderChunks: true, isLoadingOlderChunks: false,
      loadOlderChunks: vi.fn(),
    }), { initialProps: { messages: tail, loadedChunkCount: 10 } });
    expect(result.current.visibleMessages).toHaveLength(10);
    act(() => result.current.handleShowOlderMessages());
    states.set("message_10", createRenderState(300));
    const older = { _id: "older", role: "assistant" as const };
    states.set("older", createRenderState(10));
    rerender({ messages: [older, ...tail], loadedChunkCount: 400 });
    expect(result.current.visibleMessages.map((message) => message._id)).toContain("older");
  });

});
