/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadReadStateProvider } from "./thread-read-state-context";
import { ThreadMarkReadButton } from "./thread-mark-read-button";

const markReadMutationMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => markReadMutationMock,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

const threadId = "chat_1" as Id<"cliThreads">;

function renderButton({
  hasUnread = true,
  requiresAttention = false,
  clearSuppressionIfMatches = vi.fn(),
}: {
  hasUnread?: boolean;
  requiresAttention?: boolean;
  clearSuppressionIfMatches?: (threadId: Id<"cliThreads">) => void;
} = {}) {
  return render(
    <ThreadReadStateProvider
      value={{
        suppressedAutoReadThreadId: undefined,
        setSuppressedAutoReadThreadId: vi.fn(),
        clearSuppressionIfMatches,
      }}
    >
      <ThreadMarkReadButton
        threadId={threadId}
        hasUnread={hasUnread}
        requiresAttention={requiresAttention}
      />
    </ThreadReadStateProvider>
  );
}

describe("ThreadMarkReadButton", () => {
  afterEach(() => {
    cleanup();
    markReadMutationMock.mockReset();
    toastErrorMock.mockReset();
  });

  test("renders nothing when marking read would have no effect", () => {
    renderButton({ hasUnread: false, requiresAttention: false });

    expect(screen.queryByText("Mark as read")).toBeNull();
  });

  test("marks read without acknowledging attention and clears suppression", async () => {
    const clearSuppressionIfMatches = vi.fn();
    renderButton({ hasUnread: true, clearSuppressionIfMatches });

    fireEvent.click(screen.getByText("Mark as read"));

    expect(clearSuppressionIfMatches).toHaveBeenCalledWith(threadId);
    await waitFor(() =>
      expect(markReadMutationMock).toHaveBeenCalledWith({
        threadId,
        acknowledgeAttention: false,
      })
    );
  });

  test("acknowledges attention when the thread requires it", async () => {
    renderButton({ hasUnread: false, requiresAttention: true });

    fireEvent.click(screen.getByText("Mark as read"));

    await waitFor(() =>
      expect(markReadMutationMock).toHaveBeenCalledWith({
        threadId,
        acknowledgeAttention: true,
      })
    );
  });

  test("shows an error toast when the mutation fails", async () => {
    markReadMutationMock.mockRejectedValueOnce(new Error("nope"));
    renderButton({ hasUnread: true });

    fireEvent.click(screen.getByText("Mark as read"));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to mark thread as read")
    );
  });
});
