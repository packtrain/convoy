/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliThread } from "./use-cli-thread";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const markReadMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

/** Must match AUTO_READ_SETTLE_MS in the hook. */
const SETTLE_MS = 1_000;

function mockQueries(thread: unknown) {
  useQueryMock.mockImplementation(() => thread);
}

/** Advance past the auto-read settle window. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useCliThread", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    markReadMutationMock.mockReset();
  });

  test("auto marks read when chat is unread and suppression is disabled", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: true,
      processingState: "idle",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() => useCliThread(threadId));
    await advance(SETTLE_MS);

    expect(markReadMutationMock).toHaveBeenCalledWith({ threadId: resolvedThreadId });
  });

  test("auto mark-read does not acknowledge attention", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: true,
      processingState: "idle",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() => useCliThread(threadId));
    await advance(SETTLE_MS);

    expect(markReadMutationMock).toHaveBeenCalledWith({ threadId: resolvedThreadId });
    expect(markReadMutationMock).not.toHaveBeenCalledWith({
      threadId: resolvedThreadId,
      acknowledgeAttention: true,
    });
  });

  test("does not auto mark read when suppression is enabled", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "idle",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() =>
      useCliThread(threadId, { suppressAutoReadThreadId: resolvedThreadId })
    );
    await advance(SETTLE_MS);

    expect(markReadMutationMock).not.toHaveBeenCalled();
  });

  test("does not auto mark read while thread is actively streaming", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "streaming",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() => useCliThread(threadId));
    await advance(SETTLE_MS);

    expect(markReadMutationMock).not.toHaveBeenCalled();
  });

  // A claimed thread is mid-run: the CLI is still writing the same doc, so
  // marking read there is what forced releaseClaim write conflicts.
  test("does not auto mark read while the thread is still claimed", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "claimed",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() => useCliThread(threadId));
    await advance(SETTLE_MS);

    expect(markReadMutationMock).not.toHaveBeenCalled();
  });

  // A viewer of a shared thread has no write access: markRead would throw, and
  // the shared-thread contract is that the viewer path performs zero writes.
  test("does not auto mark read when the caller does not own the thread", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "idle",
      isOwner: false,
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    renderHook(() => useCliThread(threadId));
    await advance(SETTLE_MS);

    expect(markReadMutationMock).not.toHaveBeenCalled();
  });

  test("waits for the thread to settle before marking read", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    const idleThread = (lastActivityAt: number) => ({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "idle" as const,
      lastActivityAt,
    });
    mockQueries(idleThread(1));
    useMutationMock.mockReturnValue(markReadMutationMock);

    const { rerender } = renderHook(() => useCliThread(threadId));

    await advance(SETTLE_MS / 2);
    expect(markReadMutationMock).not.toHaveBeenCalled();

    // Another lifecycle write lands mid-window: the timer restarts.
    mockQueries(idleThread(2));
    rerender();

    await advance(SETTLE_MS / 2);
    expect(markReadMutationMock).not.toHaveBeenCalled();

    await advance(SETTLE_MS / 2);
    expect(markReadMutationMock).toHaveBeenCalledTimes(1);
  });

  test("auto marks read once streaming completes", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "streaming",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    const { rerender } = renderHook(() => useCliThread(threadId));

    await advance(SETTLE_MS);
    expect(markReadMutationMock).not.toHaveBeenCalled();

    // Streaming ends — processingState becomes idle
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "idle",
    });
    rerender();

    await advance(SETTLE_MS);
    expect(markReadMutationMock).toHaveBeenCalledWith({ threadId: resolvedThreadId });
  });

  test("auto mark read resumes when suppression is removed", async () => {
    const threadId = "chat_1";
    const resolvedThreadId = "chat_1" as Id<"cliThreads">;
    mockQueries({
      _id: resolvedThreadId,
      hasUnread: true,
      requiresAttention: false,
      processingState: "idle",
    });
    useMutationMock.mockReturnValue(markReadMutationMock);

    const { rerender } = renderHook(
      ({ suppressedThreadId }) =>
        useCliThread(threadId, { suppressAutoReadThreadId: suppressedThreadId }),
      {
        initialProps: {
          suppressedThreadId: resolvedThreadId,
        } as { suppressedThreadId: Id<"cliThreads"> | undefined },
      }
    );

    await advance(SETTLE_MS);
    expect(markReadMutationMock).not.toHaveBeenCalled();

    rerender({ suppressedThreadId: undefined });

    await advance(SETTLE_MS);
    expect(markReadMutationMock).toHaveBeenCalledWith({ threadId: resolvedThreadId });
  });
});
