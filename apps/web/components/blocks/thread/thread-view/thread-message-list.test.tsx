/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThreadMessageList } from "./thread-message-list";
import { useState, type ComponentProps } from "react";
import type { ThreadComposer } from "../thread-composer";
import type { Id } from "@/convex/_generated/dataModel";
import type { ComposerMessageState } from "@/lib/cli-stream-ui";

vi.mock("@/components/blocks/thread/assistant-cli-thread-message", () => ({
  AssistantCliMessage: ({ timestamp, cliModel, cliEffort, attachments, renderState }: { timestamp?: number; cliModel?: string; cliEffort?: string; attachments?: Array<{ fileName: string }>; renderState?: { parts: Array<{ type: string }> } }) => (
    <div data-testid="assistant-message" data-timestamp={timestamp} data-model={cliModel} data-effort={cliEffort} data-attachments={attachments?.map((attachment) => attachment.fileName).join(",")} data-part-types={renderState?.parts.map((part) => part.type).join(",")} />
  ),
}));

vi.mock("@/components/blocks/worktree-setups", () => ({
  WorktreeSetupBlockedCallout: ({ repoKey, onRetry, onRetryWithoutConfirm, isRetrying }: { repoKey: string; onRetry: () => void; onRetryWithoutConfirm: () => Promise<void>; isRetrying: boolean }) => (
    <div data-testid="setup-blocked" data-repo-key={repoKey} data-retrying={String(isRetrying)}>
      <button onClick={onRetry}>Blocked retry</button>
      <button onClick={() => void onRetryWithoutConfirm()}>Blocked approve</button>
    </div>
  ),
}));

vi.mock("@/components/blocks/thread/response-attachments", () => ({
  ResponseAttachments: ({ messageId, attachments, className }: { messageId: string; attachments: Array<{ fileName: string }>; className?: string }) => (
    <div data-testid="response-attachments" data-message-id={messageId} className={className}>
      {attachments.map((attachment) => attachment.fileName).join(",")}
    </div>
  ),
}));

// User bubbles render attachment pills, which resolve signed URLs through a
// lazy query on click (OS-1600).
const taskChecksMock = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : taskChecksMock.current),
  useMutation: () => vi.fn(),
}));

vi.mock("../thread-composer", () => ({
  ThreadComposer: ({ hideContextBar, initialInput, onSubmit, extraSubmitActions, extraSelectorTools, extraAttachmentPills, selectorsProps }: ComponentProps<typeof ThreadComposer>) => {
    const [text, setText] = useState(initialInput ?? "");
    return <div>
      {!hideContextBar && <div>Thread context bar</div>}
      <textarea data-thread-composer-editor="true" value={text} onChange={(event) => setText(event.target.value)} />
      <button onClick={() => selectorsProps.onModeChange("plan")}>Plan</button>
      <button onClick={() => selectorsProps.onCliModelChange?.("opus")}>Opus</button>
      <button onClick={() => selectorsProps.onCliEffortChange?.("high")}>High</button>
      <div>{extraSubmitActions}<button onClick={() => void Promise.resolve(onSubmit({ text, files: [] })).catch(() => {})}>Send</button></div>
      {extraSelectorTools}{extraAttachmentPills}
    </div>;
  },
}));

// Conversation (stick-to-bottom) needs ResizeObserver, absent in jsdom.
const resizeCallbacks: Array<() => void> = [];
class ResizeObserverStub {
  constructor(callback: (entries: Array<{ contentRect: { height: number } }>) => void) {
    resizeCallbacks.push(() => callback([{ contentRect: { height: 0 } }]));
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

type ThreadMessageListProps = ComponentProps<typeof ThreadMessageList>;
type ThreadDetailMessage = ThreadMessageListProps["visibleMessages"][number];

const USER_MESSAGE_ID = "user-message-1" as Id<"cliMessages">;
const ASSISTANT_MESSAGE_ID = "assistant-message-1" as Id<"cliMessages">;
const SENT_BY_LABEL = "Sent by another thread's agent. Click to open";

function createUserMessage(
  overrides: Partial<ThreadDetailMessage> = {}
): ThreadDetailMessage {
  return {
    _id: USER_MESSAGE_ID,
    _creationTime: 100,
    threadId: "thread-1" as Id<"cliThreads">,
    profileId: "profile-1" as Id<"cliProfiles">,
    role: "user",
    status: "completed",
    cliType: "claude-code",
    chunkCount: 0,
    attachments: [],
    createdAt: 100,
    updatedAt: 100,
    processedAt: 150,
    runId: "run-1",
    ...overrides,
  } as ThreadDetailMessage;
}

function createAssistantMessage(
  overrides: Partial<ThreadDetailMessage> = {}
): ThreadDetailMessage {
  return {
    _id: ASSISTANT_MESSAGE_ID,
    _creationTime: 200,
    threadId: "thread-1" as Id<"cliThreads">,
    profileId: "profile-1" as Id<"cliProfiles">,
    role: "assistant",
    status: "completed",
    cliType: "claude-code",
    chunkCount: 1,
    attachments: [],
    createdAt: 200,
    updatedAt: 200,
    runId: "run-1",
    cliContext: { continuationId: "session-1" },
    ...overrides,
  } as ThreadDetailMessage;
}

function createAssistantRenderState(): ComposerMessageState {
  return {
    normalizedEvents: [],
    parts: [{ type: "text", text: "Assistant response" }],
    metadata: {},
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

function renderList(overrides: Partial<ThreadMessageListProps> = {}) {
  const props: ThreadMessageListProps = {
    showOlderMessagesCut: false,
    showOlderMessagesPlaceholder: false,
    visibleMessages: [createUserMessage(), createAssistantMessage()],
    hasPendingAssistantPlaceholder: false,
    pendingAssistantLabel: "Claude Code",
    latestThreadMessageId: ASSISTANT_MESSAGE_ID,
    userTextById: new Map([[USER_MESSAGE_ID, "fix the bug"]]),
    userMessageResponseMap: new Map(),
    renderStateByMessageId: new Map(),
    askUserQuestionResponses: {},
    isThreadProcessing: false,
    isThreadStreaming: false,
    isQueueHeld: false,
    latestUserMessageId: USER_MESSAGE_ID,
    onSubmitEditLast: vi.fn().mockResolvedValue(undefined),
    editComposerProps: {
      onSubmit: vi.fn(), textareaPlaceholder: "Follow up",
      selectorsProps: { profiles: [], profileId: "profile-1", pathId: "path-1", cliType: "claude-code", mode: undefined, cliModel: undefined, onModeChange: vi.fn() },
    },
    continuingFailedMessageId: null,
    isSubmitting: false,
    isRetrying: false,
    onShowOlderMessages: vi.fn(),
    onSubmitAskUserQuestion: vi.fn(),
    onPlanDecision: vi.fn(),
    onContinueFailedSession: vi.fn(),
    onRetry: vi.fn(),
    taskLinkHref: () => "#",
    conversationRef: null,
    ...overrides,
  };
  return { ...render(<ThreadMessageList {...props} />), props };
}

afterEach(() => {
  cleanup();
});

describe("ThreadMessageList queued messages", () => {
  test("hides held unprocessed user messages — they live in the queued strip (OS-2171)", () => {
    renderList({
      visibleMessages: [
        createUserMessage({ _id: "stopped-message" as Id<"cliMessages"> }),
        createUserMessage({ processedAt: undefined }),
      ],
      userTextById: new Map([
        ["stopped-message" as Id<"cliMessages">, "stopped turn"],
        [USER_MESSAGE_ID, "fix the bug"],
      ]),
      latestThreadMessageId: USER_MESSAGE_ID,
      isQueueHeld: true,
    });
    expect(screen.getByText("stopped turn")).toBeDefined();
    expect(screen.queryByText("fix the bug")).toBeNull();
  });

  test("still hides unprocessed user messages while streaming", () => {
    renderList({
      visibleMessages: [
        createUserMessage({ processedAt: undefined }),
        createAssistantMessage({ status: "streaming" }),
      ],
      isThreadProcessing: true,
      isThreadStreaming: true,
    });
    expect(screen.queryByText("fix the bug")).toBeNull();
  });

  test("hides unprocessed user messages while the CLI is offline (OS-2311)", () => {
    renderList({
      visibleMessages: [createUserMessage({ processedAt: undefined })],
      isThreadProcessing: true,
      isCliOffline: true,
    });
    expect(screen.queryByText("fix the bug")).toBeNull();
  });
});

// A read-only viewer of a shared thread gets no write handlers, but must still
// see that a run failed (docs/specs/cli-thread-sharing.md).
describe("ThreadMessageList waiting labels", () => {
  test("a streaming reply with no output yet reads Working", () => {
    renderList({
      visibleMessages: [createUserMessage(), createAssistantMessage({ chunkCount: 0, status: "streaming" })],
    });

    expect(screen.getByText("Working")).toBeTruthy();
  });

  test("says the message is queued while the CLI is offline", () => {
    const { rerender, props } = renderList({
      visibleMessages: [createUserMessage(), createAssistantMessage({ chunkCount: 0, status: "pending" })],
      hasPendingAssistantPlaceholder: true,
    });
    expect(screen.getAllByText("Waiting for Claude Code...")).toHaveLength(2);

    rerender(<ThreadMessageList {...props} isCliOffline />);
    expect(screen.queryByText("Waiting for Claude Code...")).toBeNull();
    expect(screen.getAllByText("Queued until the CLI reconnects")).toHaveLength(2);
  });
});

describe("ThreadMessageList failed-run actions (OS-1575)", () => {
  const failedMessage = () =>
    createAssistantMessage({
      status: "failed",
      errorMessage: "Session crashed",
    });

  test("offers Continue and Retry on the failed latest message", () => {
    renderList({ visibleMessages: [createUserMessage(), failedMessage()] });

    expect(screen.getByText("Session crashed")).toBeDefined();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeDefined();
  });

  test("keeps the error text but drops the actions without their handlers", () => {
    renderList({
      visibleMessages: [createUserMessage(), failedMessage()],
      onContinueFailedSession: undefined,
      onRetry: undefined,
    });

    expect(screen.getByText("Session crashed")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  test("splits multi-line failure copy into headline and detail", () => {
    renderList({
      visibleMessages: [
        createUserMessage(),
        createAssistantMessage({
          status: "failed",
          errorMessage:
            "Generation stopped\nThe model hit the output limit after 4,096 tokens.",
        }),
      ],
    });

    expect(screen.getByText("Generation stopped")).toBeDefined();
    expect(
      screen.getByText("The model hit the output limit after 4,096 tokens.")
    ).toBeDefined();
  });
});

describe("ThreadMessageList blocked worktree setup (OS-2584)", () => {
  const PROJECT_ID = "project-1" as Id<"projects">;
  const blockedRender = (): ComposerMessageState => ({
    ...createAssistantRenderState(),
    parts: [
      { type: "text", text: "Starting" },
      { type: "runtime-notice", code: "worktree-setup-unapproved", title: "Worktree setup", message: "The setup script for `packtrain/convoy` needs your approval." },
    ],
  });
  const blockedList = (overrides: Partial<ThreadMessageListProps> = {}) =>
    renderList({
      projectId: PROJECT_ID,
      visibleMessages: [
        createUserMessage(),
        createAssistantMessage({ status: "failed", errorMessage: "This project has a worktree setup script for packtrain/convoy that you haven't approved." }),
      ],
      renderStateByMessageId: new Map([[ASSISTANT_MESSAGE_ID, blockedRender()]]),
      onRetryWithoutConfirm: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });

  test("shows one blocked state: the setup callout instead of the notice and the failure text", () => {
    blockedList();

    expect(screen.getByTestId("setup-blocked").dataset.repoKey).toBe("packtrain/convoy");
    expect(screen.getByTestId("assistant-message").dataset.partTypes).toBe("text");
    expect(screen.queryByText(/that you haven't approved/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();
  });

  test("Retry confirms as usual; Approve and retry retries the failed message at once", () => {
    const { props } = blockedList();

    fireEvent.click(screen.getByRole("button", { name: "Blocked retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Blocked approve" }));

    expect(props.onRetry).toHaveBeenCalledWith(ASSISTANT_MESSAGE_ID);
    expect(props.onRetryWithoutConfirm).toHaveBeenCalledWith(ASSISTANT_MESSAGE_ID);
  });

  test("passes the in-flight retry to the callout, as the failed-run callout disables Retry", () => {
    blockedList({ isRetrying: true });

    expect(screen.getByTestId("setup-blocked").dataset.retrying).toBe("true");
  });

  test("a read-only viewer keeps the notice and the failure text", () => {
    blockedList({ onRetry: undefined, onRetryWithoutConfirm: undefined });

    expect(screen.queryByTestId("setup-blocked")).toBeNull();
    expect(screen.getByTestId("assistant-message").dataset.partTypes).toBe("text,runtime-notice");
    expect(screen.getByText(/that you haven't approved/)).toBeDefined();
  });
});

describe("ThreadMessageList edit-last action (OS-1374)", () => {
  test("shows Edit on the newest user message", () => {
    renderList();
    expect(screen.getByLabelText("Edit message")).toBeDefined();
  });

  test("hides Edit while a response is in flight (Stop first)", () => {
    renderList({ isThreadProcessing: true, isThreadStreaming: true });
    expect(screen.queryByLabelText("Edit message")).toBeNull();
  });

  test("hides Edit on non-latest user messages", () => {
    renderList({
      latestUserMessageId: "other-message" as Id<"cliMessages">,
    });
    expect(screen.queryByLabelText("Edit message")).toBeNull();
  });

  test("edits in place: textarea prefilled, Send resends the edited text", async () => {
    const onSubmitEditLast = vi.fn().mockResolvedValue(undefined);
    renderList({ onSubmitEditLast });

    fireEvent.click(screen.getByLabelText("Edit message"));
    const textarea = screen.getByDisplayValue("fix the bug");
    fireEvent.change(textarea, { target: { value: "fix the bug properly" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onSubmitEditLast).toHaveBeenCalledWith(
        USER_MESSAGE_ID,
        "fix the bug properly",
        expect.objectContaining({ cliMode: null, cliModel: null, cliEffort: null, attachments: [] })
      );
    });
    // Editor closes after a successful resend.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    });
  });

  test("hides fixed thread context when editing", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Edit message"));
    expect(screen.queryByText("Thread context bar")).toBeNull();
    expect(screen.getByRole("button", { name: "Plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Opus" })).toBeDefined();
  });

  test("focuses the composer when edit opens", async () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Edit message"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByDisplayValue("fix the bug")));
  });

  test("resends model, mode, effort and attachment removals through the full composer", async () => {
    const onSubmitEditLast = vi.fn().mockResolvedValue(undefined);
    renderList({ onSubmitEditLast, visibleMessages: [createUserMessage({
      attachments: [{ storageId: "storage-1" as Id<"_storage">, fileName: "before.txt", fileSize: 3, contentType: "text/plain", uploadedAt: 1 }],
    })] });
    fireEvent.click(screen.getByLabelText("Edit message"));
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Opus" }));
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove before.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmitEditLast).toHaveBeenCalledWith(USER_MESSAGE_ID, "fix the bug", expect.objectContaining({
      cliMode: "plan", cliModel: "opus", cliEffort: "high", attachments: [],
    })));
  });

  test("a resend keeps a retained image's dimensions", async () => {
    const onSubmitEditLast = vi.fn().mockResolvedValue(undefined);
    const dimensions = { width: 800, height: 400 };
    renderList({ onSubmitEditLast, visibleMessages: [createUserMessage({
      attachments: [{ storageId: "storage-1" as Id<"_storage">, fileName: "shot.png", fileSize: 3, contentType: "image/png", uploadedAt: 1, dimensions }],
    })] });
    fireEvent.click(screen.getByLabelText("Edit message"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmitEditLast).toHaveBeenCalledWith(USER_MESSAGE_ID, "fix the bug", expect.objectContaining({
      attachments: [expect.objectContaining({ storageId: "storage-1", dimensions })],
    })));
  });

  test("failed resend keeps the edited draft open", async () => {
    const onSubmitEditLast = vi.fn().mockRejectedValue(new Error("Stop first"));
    renderList({ onSubmitEditLast });
    fireEvent.click(screen.getByLabelText("Edit message"));
    fireEvent.change(screen.getByDisplayValue("fix the bug"), { target: { value: "keep my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSubmitEditLast).toHaveBeenCalled());
    expect(screen.getByDisplayValue("keep my draft")).toBeDefined();
  });

  test("places Cancel beside Send in the edit form", () => {
    renderList();
    fireEvent.click(screen.getByLabelText("Edit message"));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.nextElementSibling).toBe(screen.getByRole("button", { name: "Send" }));
  });

  test("Cancel restores the bubble without submitting", () => {
    const onSubmitEditLast = vi.fn().mockResolvedValue(undefined);
    renderList({ onSubmitEditLast });

    fireEvent.click(screen.getByLabelText("Edit message"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSubmitEditLast).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByLabelText("Edit message")).toBeDefined();
  });
});

describe("ThreadMessageList response attachments (OS-2091)", () => {
  const shot = { storageId: "storage-1" as Id<"_storage">, fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 };

  test("an attachment-only reply mounts the reply, which hosts its files, instead of No output generated", () => {
    renderList({ visibleMessages: [createUserMessage(), createAssistantMessage({ chunkCount: 0, attachments: [shot] })] });

    expect(screen.getByTestId("assistant-message").getAttribute("data-attachments")).toBe("shot.png");
    expect(screen.queryByTestId("response-attachments")).toBeNull();
    expect(screen.queryByText("No output generated.")).toBeNull();
  });

  test("a streaming attachment-only reply keeps one host, so text arriving later does not remount the files", () => {
    renderList({
      visibleMessages: [createUserMessage(), createAssistantMessage({ chunkCount: 0, status: "streaming", attachments: [shot] })],
    });

    expect(screen.getByTestId("assistant-message").getAttribute("data-attachments")).toBe("shot.png");
    expect(screen.queryByText("Streaming...")).toBeNull();
  });

  test("hands the files to the reply, which places them above its footer", () => {
    renderList({
      visibleMessages: [createUserMessage(), createAssistantMessage({ attachments: [shot] })],
      renderStateByMessageId: new Map([[ASSISTANT_MESSAGE_ID, createAssistantRenderState()]]),
    });

    expect(screen.getByTestId("assistant-message").getAttribute("data-attachments")).toBe("shot.png");
    expect(screen.queryByTestId("response-attachments")).toBeNull();
  });

  test("a user message renders its files the way a reply does, aligned to the bubble", () => {
    renderList({ visibleMessages: [createUserMessage({ attachments: [shot] })] });

    const host = screen.getByTestId("response-attachments");
    expect(host.getAttribute("data-message-id")).toBe(USER_MESSAGE_ID);
    expect(host.textContent).toBe("shot.png");
    expect(host.classList.contains("items-end")).toBe(true);
  });

  test("a check-only reply, with no chunks or files, still mounts the reply that hosts its checks card (OS-2291)", () => {
    taskChecksMock.current = {
      checklists: [],
      checklistId: null,
      checks: [{ key: "spec", label: "Spec", instruction: "", added: true, results: [{ messageId: ASSISTANT_MESSAGE_ID, files: [] }] }],
    };
    renderList({
      taskId: "task_1" as Id<"tasks">,
      visibleMessages: [createUserMessage(), createAssistantMessage({ chunkCount: 0, status: "streaming" })],
    });
    taskChecksMock.current = undefined;

    expect(screen.getByTestId("assistant-message")).toBeDefined();
    expect(screen.queryByText("Streaming...")).toBeNull();
  });

  test("renders nothing for a reply without files", () => {
    renderList();
    expect(screen.queryByTestId("response-attachments")).toBeNull();
  });
});

describe("ThreadMessageList assistant timestamp (OS-1480)", () => {
  test.each(["completed", "failed"] as const)(
    "passes updatedAt as the timestamp for a %s response",
    (status) => {
      renderList({
        visibleMessages: [
          createUserMessage(),
          createAssistantMessage({
            status,
            createdAt: 200,
            updatedAt: 450,
          }),
        ],
        renderStateByMessageId: new Map([
          [ASSISTANT_MESSAGE_ID, createAssistantRenderState()],
        ]),
      });

      expect(
        screen.getByTestId("assistant-message").getAttribute("data-timestamp")
      ).toBe("450");
    }
  );

  test("passes createdAt while a response is streaming", () => {
    renderList({
      visibleMessages: [
        createUserMessage(),
        createAssistantMessage({
          status: "streaming",
          createdAt: 200,
          updatedAt: 450,
        }),
      ],
      renderStateByMessageId: new Map([
        [ASSISTANT_MESSAGE_ID, createAssistantRenderState()],
      ]),
      isThreadProcessing: true,
      isThreadStreaming: true,
    });

    expect(
      screen.getByTestId("assistant-message").getAttribute("data-timestamp")
    ).toBe("200");
  });

  // A workflow script request is a command the CLI runs, not something the user
  // typed: it wears the exec accent of the editor's bash card (OS-1886).
  test("a script request bubble wears the blue exec accent with a terminal icon", () => {
    const { container } = renderList({
      visibleMessages: [
        createUserMessage({ scriptRequest: { script: "pnpm lint", timeoutMs: 60_000 } }),
      ],
      userTextById: new Map([[USER_MESSAGE_ID, "pnpm lint"]]),
      latestThreadMessageId: USER_MESSAGE_ID,
    });

    const bubble = container.querySelector(".group-\\[\\.is-user\\]\\:bg-info-soft");
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector("svg.lucide-terminal")).not.toBeNull();
    expect(screen.getByText("pnpm lint")).toBeTruthy();
  });

  /**
   * An agent-sent message must not wear `bg-secondary`, which is "what I said"
   * (OS-1631). Absent `sentBy` is the pre-existing meaning: a human sent it.
   */
  describe("agent-sent user messages", () => {
    const SENDER_ID = "sender-thread-1" as Id<"cliThreads">;

    const renderSentByAgent = () =>
      renderList({
        visibleMessages: [
          createUserMessage({ sentBy: { kind: "thread", threadId: SENDER_ID } }),
        ],
        latestThreadMessageId: USER_MESSAGE_ID,
        organizationSlug: "acme",
        projectAlias: "web",
      });

    test("links the badge to the sending thread", () => {
      renderSentByAgent();

      const badge = screen.getByLabelText(SENT_BY_LABEL);
      // Optimistic: a deleted sender lands on the route's own not-found rather
      // than costing a read per message.
      expect(badge.getAttribute("href")).toBe(`/o/acme/web/threads/${SENDER_ID}`);
    });

    // Icon only: the tinted bubble already says "not you", so a label would
    // repeat it in a footer row that is already dense.
    test("carries no visible label, only the accessible name", () => {
      renderSentByAgent();

      expect(screen.getByLabelText(SENT_BY_LABEL).textContent).toBe("");
      expect(screen.queryByText(/Sent by/)).toBeNull();
    });

    // Last in the row: the arrow points back down-left into its own bubble, so
    // at the left end it would point away from the message it belongs to.
    test("sits after the run-details trigger", () => {
      renderSentByAgent();

      const badge = screen.getByLabelText(SENT_BY_LABEL);
      const row = badge.parentElement;
      expect(row?.lastElementChild).toBe(badge);
      expect(row?.children.length).toBeGreaterThan(1);
    });

    /**
     * A distinct token, not `bg-muted` / `bg-accent`: both equal `--secondary` in
     * this grayscale palette, so either would render as no change at all.
     */
    test("tints the bubble away from the human 'what I said' background", () => {
      const { container } = renderSentByAgent();

      const bubble = container.querySelector(
        ".group-\\[\\.is-user\\]\\:bg-thread-message-foreign"
      );
      expect(bubble).not.toBeNull();
      expect(container.querySelector(".group-\\[\\.is-user\\]\\:bg-muted")).toBeNull();
    });

    test("shows neither badge nor tint for a human message", () => {
      renderList({
        visibleMessages: [createUserMessage()],
        latestThreadMessageId: USER_MESSAGE_ID,
        organizationSlug: "acme",
        projectAlias: "web",
      });

      expect(
        screen.queryByLabelText(SENT_BY_LABEL)
      ).toBeNull();
    });

    // The slugs are optional props, and a badge with no route is worse than none.
    test("omits the badge when the route is unknown", () => {
      renderList({
        visibleMessages: [
          createUserMessage({ sentBy: { kind: "thread", threadId: SENDER_ID } }),
        ],
        latestThreadMessageId: USER_MESSAGE_ID,
      });

      expect(
        screen.queryByLabelText(SENT_BY_LABEL)
      ).toBeNull();
    });
  });
});

// Cmd/Ctrl+P (docs/specs/cli-thread-print.md): the transcript is copied to a
// body-level block for the print, because the app shell's scroll ancestors clip
// it to one page in place.
describe("ThreadMessageList printing (OS-1748)", () => {
  const printClone = () =>
    document.body.querySelector("[data-thread-print-clone]");

  test("copies the transcript to body on beforeprint", () => {
    renderList();
    fireEvent(window, new Event("beforeprint"));

    const clone = printClone();
    expect(clone).not.toBeNull();
    expect(clone?.querySelectorAll("[data-thread-message-row]").length).toBe(2);
    expect(clone?.textContent).toContain("fix the bug");
    expect(document.documentElement.dataset.printingThread).toBe("");
  });

  test("removes the copy on afterprint", () => {
    renderList();
    fireEvent(window, new Event("beforeprint"));
    fireEvent(window, new Event("afterprint"));

    expect(printClone()).toBeNull();
    expect(document.documentElement.dataset.printingThread).toBeUndefined();
  });

  // A cancelled print leaves the copy behind; unmounting must not leak it.
  test("removes the copy on unmount", () => {
    const { unmount } = renderList();
    fireEvent(window, new Event("beforeprint"));
    unmount();

    expect(printClone()).toBeNull();
  });
});


describe("ThreadMessageList assistant model details", () => {
  test("passes the assistant message's stored model and effort to its footer", () => {
    renderList({
      visibleMessages: [createAssistantMessage({ cliType: "codex", cliModel: "gpt-6-astra", cliEffort: "ultra" })],
      renderStateByMessageId: new Map([[ASSISTANT_MESSAGE_ID, createAssistantRenderState()]]),
    });
    const message = screen.getByTestId("assistant-message");
    expect(message.getAttribute("data-model")).toBe("gpt-6-astra");
    expect(message.getAttribute("data-effort")).toBe("ultra");
  });
});

// The branch icon sits under the reply, which the fork copies too (OS-1397).
describe("ThreadMessageList branch action (OS-1397)", () => {
  test("a sent user message shows no branch icon, even on a forkable run", () => {
    renderList({ onBranchFromHere: vi.fn() });
    expect(screen.queryByLabelText("Branch from here")).toBeNull();
  });

describe("transcript divider", () => {
  test("renders after the anchored row", () => {
    renderList({
      transcriptDivider: { afterMessageId: USER_MESSAGE_ID, node: <div data-testid="divider">Forked from X</div> },
    });
    const rows = document.querySelectorAll("[data-thread-message-row]");
    const divider = screen.getByTestId("divider");
    expect(rows[0]!.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(rows[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("is not rendered once its anchor row is gone", () => {
    renderList({
      transcriptDivider: { afterMessageId: null, node: <div data-testid="divider">Forked from X</div> },
    });
    expect(screen.queryByTestId("divider")).toBeNull();
  });
});
});

test("renders inline image references from the regular user message's attachments", () => {
  renderList({
    visibleMessages: [createUserMessage({ attachments: [{
      storageId: "image-1" as Id<"_storage">, fileName: "before.png", contentType: "image/png", fileSize: 100, uploadedAt: 1,
    }] })],
    userTextById: new Map([[USER_MESSAGE_ID, "Compare #before.png"]]),
  });
  expect(screen.getByRole("button", { name: "Preview before.png" })).toBeDefined();
});

describe("ThreadMessageList embedded fork prefix (OS-1397)", () => {
  test("rows join the host transcript's flex column so they keep its gap", () => {
    renderList({ embedded: true });
    const wrapper = screen.getByTestId("thread-fork-prefix");
    expect(wrapper.classList.contains("contents")).toBe(true);
    expect(wrapper.querySelectorAll(":scope > [data-thread-message-row]").length).toBe(2);
  });
});

describe("ThreadMessageList show more keeps the view (OS-2170)", () => {
  test("older rows load above the viewport without scrolling it", () => {
    resizeCallbacks.length = 0;
    const { props, rerender } = renderList({ showOlderMessagesCut: true });
    const scroller = screen.getByRole("log").firstElementChild as HTMLElement;
    let scrollHeight = 1000;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => scrollHeight });
    scroller.scrollTop = 300;

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    rerender(<ThreadMessageList {...props} showOlderMessagesCut showOlderMessagesPlaceholder />);
    rerender(
      <ThreadMessageList
        {...props}
        showOlderMessagesCut
        visibleMessages={[createAssistantMessage({ _id: "older" as Id<"cliMessages"> }), ...props.visibleMessages]}
      />
    );
    scrollHeight = 1600;
    resizeCallbacks.forEach((notify) => notify());

    expect(scroller.scrollTop).toBe(900);

    // The load is done: later growth (a streaming reply) leaves the view alone.
    scrollHeight = 2000;
    resizeCallbacks.forEach((notify) => notify());
    expect(scroller.scrollTop).toBe(900);
  });
});
