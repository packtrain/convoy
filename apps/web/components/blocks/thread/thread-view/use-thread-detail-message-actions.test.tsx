/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import type { AskUserQuestionResponsePayload } from "@/lib/ai-tools/ask-user-question";
import { loadRememberedNewThreadCliSelection } from "@/lib/threads/remembered-new-thread-cli-models";
import { useThreadDetailMessageActions } from "./use-thread-detail-message-actions";

const respondMock = vi.fn().mockResolvedValue(null);
vi.mock("convex/react", () => ({
  useMutation: () => respondMock,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const THREAD_ID = "thread_1" as Id<"cliThreads">;
const SENT_MESSAGE_ID = "message_sent" as Id<"cliMessages">;
const ASK_USER_QUESTION_RESPONSE: AskUserQuestionResponsePayload = {
  toolName: "AskUserQuestion",
  toolCallId: "tool_call_1",
  submittedAt: 123,
  answers: [],
};

function renderActions(overrides?: Partial<Parameters<typeof useThreadDetailMessageActions>[0]>) {
  const sendMessage = vi.fn().mockResolvedValue(SENT_MESSAGE_ID);
  const result = renderHook(() =>
    useThreadDetailMessageActions({
      threadId: THREAD_ID,
      cliType: "claude-code",
      activeMode: "agent",
      activeCliModel: "haiku",
      activeCliEffort: "low",
      envelopes: [],
      sendMessage,
      retryMessage: vi.fn(),
      steerMessage: vi.fn(),
      cancelProcessing: vi.fn(),
      prepareAttachmentsForSubmit: vi.fn().mockResolvedValue([]),
      clearAfterSubmit: vi.fn(),
      setDraft: vi.fn(),
      onMessageSent: vi.fn(),
      ...overrides,
    })
  );
  return { ...result, sendMessage };
}

describe("useThreadDetailMessageActions", () => {
  test("Retry now retries at once, holds the in-flight flag, then hands focus to the composer (OS-2584)", async () => {
    let finish!: () => void;
    const retryMessage = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const focusComposer = vi.fn();
    const { result } = renderActions({ retryMessage, focusComposer });

    let done!: Promise<void>;
    act(() => { done = result.current.handleRetryNow(SENT_MESSAGE_ID); });
    expect(retryMessage).toHaveBeenCalledWith(SENT_MESSAGE_ID);
    expect(result.current.isRetrying).toBe(true);
    await act(async () => { finish(); await done; });

    expect(result.current.isRetrying).toBe(false);
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  test("a Retry now callback kept across a pending approval cannot start a second retry beside a confirmed one", async () => {
    const pending: Array<() => void> = [];
    const retryMessage = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
    const { result } = renderActions({ retryMessage });
    const retainedByApproval = result.current.handleRetryNow;

    act(() => result.current.handleRetry(SENT_MESSAGE_ID));
    let first!: Promise<void>;
    act(() => { first = result.current.handleRetryConfirm(); });
    let second!: Promise<void>;
    act(() => { second = retainedByApproval(SENT_MESSAGE_ID); });

    expect(retryMessage).toHaveBeenCalledTimes(1);
    expect(result.current.isRetrying).toBe(true);
    await act(async () => { pending.forEach((resolve) => resolve()); await Promise.all([first, second]); });
    expect(result.current.isRetrying).toBe(false);
  });

  test("Retry now ignores a second call while one is in flight", async () => {
    let finish!: () => void;
    const retryMessage = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result } = renderActions({ retryMessage });

    let first!: Promise<void>;
    act(() => { first = result.current.handleRetryNow(SENT_MESSAGE_ID); });
    await act(async () => { await result.current.handleRetryNow(SENT_MESSAGE_ID); });
    await act(async () => { finish(); await first; });

    expect(retryMessage).toHaveBeenCalledTimes(1);
  });

  test.each(["auto", "default", "agent"] as const)("approves a completed proposal in %s with server-validated identity", async nextMode => {
    const source = { messageId: SENT_MESSAGE_ID, itemId: "p1", turnId: "t1" };
    const stored = { ...source, chunkId: "chunk-1", ready: true };
    const setDraft = vi.fn();
    const { result, sendMessage } = renderActions({ pendingProposedPlan: stored, setDraft });
    await act(async () => { await result.current.handlePlanDecision({ nextMode, proposedPlan: source }); });
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, expect.objectContaining({ cliMode: nextMode, sourceProposedPlan: source }));
    expect(setDraft).toHaveBeenCalledWith({ mode: nextMode });
    expect(sendMessage.mock.calls[0][1].sourceProposedPlan).toEqual(source);
    expect(respondMock).not.toHaveBeenCalled();
  });

  test.each(["messageId", "itemId", "turnId"] as const)("reports a stale approval when %s differs", field => {
    const source = { messageId: SENT_MESSAGE_ID, itemId: "p1", turnId: "t1" };
    const setDraft = vi.fn();
    const { result, sendMessage } = renderActions({ pendingProposedPlan: source, setDraft });
    return act(async () => {
      await result.current.handlePlanDecision({ nextMode: "agent", proposedPlan: { ...source, [field]: "stale" } });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(setDraft).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("This plan is no longer awaiting approval");
    });
  });

  test("clearing the goal sends /goal clear as a runtime command and keeps the draft (OS-2276)", async () => {
    const setDraft = vi.fn();
    const clearAfterSubmit = vi.fn();
    const prepareAttachmentsForSubmit = vi.fn().mockResolvedValue([]);
    const { result, sendMessage } = renderActions({ setDraft, clearAfterSubmit, prepareAttachmentsForSubmit });
    await act(async () => { await result.current.handleClearGoal(); });
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      content: "/goal clear", runtimeCommand: true, cliMode: "agent", cliModel: "haiku", cliEffort: "low",
    });
    expect(setDraft).not.toHaveBeenCalled();
    expect(clearAfterSubmit).not.toHaveBeenCalled();
    expect(prepareAttachmentsForSubmit).not.toHaveBeenCalled();
  });

  test("compacting sends /compact ahead of the queue and keeps the draft (OS-2339)", async () => {
    const setDraft = vi.fn();
    const clearAfterSubmit = vi.fn();
    const { result, sendMessage } = renderActions({ setDraft, clearAfterSubmit });
    await act(async () => { await result.current.handleCompact(); });
    expect(sendMessage).toHaveBeenCalledWith(THREAD_ID, {
      content: "/compact", runtimeCommand: true, queueFirst: true, cliMode: "agent", cliModel: "haiku", cliEffort: "low",
    });
    expect(setDraft).not.toHaveBeenCalled();
    expect(clearAfterSubmit).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    window.localStorage.clear();
    respondMock.mockClear();
    vi.mocked(toast.error).mockClear();
  });

  test("successful follow-up send records the used model+effort combo (OS-1200)", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleSubmit({ text: "hello", files: [] });
    });

    const selection = loadRememberedNewThreadCliSelection();
    expect(selection.lastCliType).toBe("claude-code");
    expect(selection.modelsByCliType["claude-code"]).toBe("haiku");
    expect(selection.effortsByCliType["claude-code"]).toBe("low");
    expect(selection.combosByCliType["claude-code"]).toEqual([
      { cliModel: "haiku", cliEffort: "low" },
    ]);
  });

  test("successful follow-up send reports that scrolling can start (OS-1339)", async () => {
    const onMessageSent = vi.fn();
    const { result } = renderActions({ onMessageSent });

    await act(async () => {
      await result.current.handleSubmit({ text: "hello", files: [] });
    });

    expect(onMessageSent).toHaveBeenCalledWith();
  });

  test("successful failed-session continuation reports that scrolling can start (OS-1339)", async () => {
    const onMessageSent = vi.fn();
    const { result } = renderActions({ onMessageSent });

    await act(async () => {
      await result.current.handleContinueFailedSession(SENT_MESSAGE_ID);
    });

    expect(onMessageSent).toHaveBeenCalledWith();
  });

  test("successful question response reports that scrolling can start (OS-1339)", async () => {
    const onMessageSent = vi.fn();
    const { result } = renderActions({ onMessageSent });

    await act(async () => {
      await result.current.handleSubmitAskUserQuestion(
        ASK_USER_QUESTION_RESPONSE
      );
    });

    expect(onMessageSent).toHaveBeenCalledWith();
  });

  test("approving answers the parked request and switches the composer mode", async () => {
    const setDraft = vi.fn();
    const { result } = renderActions({
      setDraft,
      pendingPlanApprovalRequestId: "request_1",
    });

    await act(async () => {
      await result.current.handlePlanDecision({ nextMode: "auto" });
    });

    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request_1",
        responseJson: JSON.stringify({ decision: "approve", nextMode: "auto" }),
      })
    );
    expect(setDraft).toHaveBeenCalledWith({ mode: "auto" });
  });

  // OS-1463: an orphaned gate (the CLI died while parked on ExitPlanMode)
  // cannot wake the dead callback, so approving degrades to a sent resume
  // message in the approved mode.
  test("approving an orphaned gate sends the fallback message in the approved mode", async () => {
    const setDraft = vi.fn();
    const onMessageSent = vi.fn();
    const { result, sendMessage } = renderActions({
      setDraft,
      onMessageSent,
      orphanedParkedPlan: true,
    });

    await act(async () => {
      await result.current.handlePlanDecision({ nextMode: "auto" });
    });

    expect(respondMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      THREAD_ID,
      expect.objectContaining({
        content: "Implement the approved plan.",
        cliMode: "auto",
      })
    );
    expect(onMessageSent).toHaveBeenCalledWith();
    expect(setDraft).toHaveBeenCalledWith({ mode: "auto" });
  });

  // OS-1467: no live request and no orphaned gate means a stale click (the
  // request settled elsewhere between state update and click) — a send here
  // would inject a spurious message into a live run.
  test("approving with neither a request nor an orphaned gate is a no-op", async () => {
    const setDraft = vi.fn();
    const { result, sendMessage } = renderActions({ setDraft });

    await act(async () => {
      await result.current.handlePlanDecision({ nextMode: "auto" });
    });

    expect(respondMock).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setDraft).not.toHaveBeenCalled();
  });

  test("sending while parked on a prompt stops the run first (OS-1458)", async () => {
    const cancelProcessing = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(SENT_MESSAGE_ID);
    const { result } = renderActions({
      hasPendingInteraction: true,
      cancelProcessing,
      sendMessage,
    });

    await act(async () => {
      await result.current.handleSubmit({ text: "actually, do X", files: [] });
    });

    expect(cancelProcessing).toHaveBeenCalledWith(THREAD_ID, { superseded: true });
    expect(cancelProcessing.mock.invocationCallOrder[0]!).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!
    );
  });

  test("an ordinary send does not stop the run", async () => {
    const cancelProcessing = vi.fn().mockResolvedValue(undefined);
    const { result } = renderActions({ cancelProcessing });

    await act(async () => {
      await result.current.handleSubmit({ text: "hello", files: [] });
    });

    expect(cancelProcessing).not.toHaveBeenCalled();
  });

  test("failed sends record nothing", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("nope"));
    const onMessageSent = vi.fn();
    const { result } = renderActions({ onMessageSent, sendMessage });

    await act(async () => {
      await expect(
        result.current.handleSubmit({ text: "hello", files: [] })
      ).rejects.toThrow("nope");
    });

    expect(loadRememberedNewThreadCliSelection().lastCliType).toBeUndefined();
    expect(onMessageSent).not.toHaveBeenCalled();
  });

  test("empty submits record nothing", async () => {
    const { result, sendMessage } = renderActions();

    await act(async () => {
      await result.current.handleSubmit({ text: "   ", files: [] });
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(loadRememberedNewThreadCliSelection().lastCliType).toBeUndefined();
  });
});
