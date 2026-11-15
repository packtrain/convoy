/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { THREAD_TASKS_SIDEBAR_HOTKEY } from "@/lib/browser/hotkeys";
import { NewThreadComposerMock } from "@/test-utils/mocks/thread-composer";
import { createThreadWorkspaceState } from "@/test-utils/mocks/thread-workspace";
import { ThreadWorkspaceHost } from "./thread-workspace-host";

/**
 * The composer's own surface is only reachable through the host, which owns the
 * sidebar and Tasks panel it shares with the workspace (OS-1660) — so these
 * render the host on a route with no thread id.
 */
function NewThreadPage() {
  return (
    <ThreadWorkspaceHost
      project={PROJECT_FIXTURE}
      organizationId={"org_1" as Id<"organizations">}
      onSidebarHighlightChange={() => {}}
    />
  );
}

/** The layout resolves the project doc and passes it down (OS-1660). */
const PROJECT_FIXTURE = {
  _id: "project_1" as Id<"projects">,
  defaultListId: null,
  hiddenTaskTableColumns: undefined,
} as unknown as Doc<"projects">;

const useParamsMock = vi.fn();
const usePathnameMock = vi.fn();
const useRouterMock = vi.fn();
const useSearchParamsMock = vi.fn();
const useConvexAuthMock = vi.fn();
const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useCliProfilesMock = vi.fn();
const useNewThreadComposerMock = vi.fn();
const useThreadDraftMock = vi.fn();
const useThreadMessageAttachmentUploadMock = vi.fn();
const useRememberedNewThreadCliModelsMock = vi.fn();
const useThreadWorkspaceTaskSidebarMock = vi.fn();

const createThreadMutationMock = vi.fn();
const rememberCliModelMock = vi.fn();
const setDraftMock = vi.fn();
const clearDraftMock = vi.fn();
const replaceMock = vi.fn();
const pushMock = vi.fn();
const prepareAttachmentsForSubmitMock = vi.fn();
const clearAfterSubmitMock = vi.fn();
const syncFilePartsMock = vi.fn();
const toastErrorMock = vi.fn();
const threadTasksPanelRenderMock = vi.fn();
const tasksPanelMountMock = vi.fn();

/**
 * What the created thread's subscriptions resolve to (OS-1665). `undefined`
 * holds the composer in place; an object releases it and lets the send finish.
 */
let createdThreadQueryResult: Record<string, unknown> | undefined;

/** A resolved `task=<REF>` selection, for the pane's task-detail branch. */
const SELECTED_TASK_FIXTURE = {
  _id: "task_42" as Id<"tasks">,
  clientId: "client_42",
  refNumber: 42,
  refId: "OS-42",
  name: "Selected task",
  description: null,
  taskType: {
    key: "task",
    name: "Task",
    icon: "SquareCheckBig",
    color: "#64748b",
    isSystem: true,
  },
  priority: "None" as const,
  dueDate: null,
  status: "Todo" as const,
  tags: [],
  rank: "a",
  parentId: null,
  createdAt: 1,
  isArchived: false,
};

vi.mock("next/navigation", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
  usePathname: (...args: unknown[]) => usePathnameMock(...args),
  useRouter: (...args: unknown[]) => useRouterMock(...args),
  useSearchParams: (...args: unknown[]) => useSearchParamsMock(...args),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: (...args: unknown[]) => useConvexAuthMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useConvex: () => ({}),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: (...args: unknown[]) => useCliProfilesMock(...args),
}));

// A send mounts the workspace for the created thread before the route commits
// (OS-1660). Its doc is genuinely still in flight at that point, which is the
// state these tests leave it in — the transcript loads inside the held shell.
let cliThreadResult: { thread: unknown; isLoading: boolean } = {
  thread: null,
  isLoading: true,
};
vi.mock("@/lib/threads/hooks/use-cli-thread", () => ({
  useCliThread: () => cliThreadResult,
}));

vi.mock("@/lib/threads/hooks/use-cli-messages", () => ({
  useCliMessages: () => ({
    envelopes: [],
    messages: [],
    isLoading: true,
    userTextById: new Map(),
    assistantRenderById: new Map(),
    sendMessage: vi.fn(),
    retryMessage: vi.fn(),
    cancelProcessing: vi.fn(),
    loadOlderChunks: vi.fn(),
    latestContextWindowUsage: null,
  }),
}));

// The created thread's transcript; these tests only watch the shell around it.
vi.mock("@/components/blocks/thread/thread-view/thread-view", () => ({
  ThreadView: () => <div data-testid="thread-view" />,
}));

vi.mock("@/lib/threads/hooks/use-new-thread-composer", () => ({
  useNewThreadComposer: (...args: unknown[]) => useNewThreadComposerMock(...args),
}));

vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  getNewThreadDraftKey: () => "new",
  // Reached once a send mounts the workspace for the created thread (OS-1660).
  buildThreadDraftKey: (threadId: string) => `thread:${threadId}`,
  useThreadDraft: (...args: unknown[]) => useThreadDraftMock(...args),
  useThreadDraftProvider: () => ({ getDraftSnapshot: vi.fn(), seedDraft: vi.fn() }),
}));

vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: (...args: unknown[]) =>
    useThreadMessageAttachmentUploadMock(...args),
  isThreadAttachmentSubmitError: (error: unknown) =>
    error instanceof Error && error.message === "Attachment upload failed",
}));

vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({
  useRememberedNewThreadCliModels: (...args: unknown[]) =>
    useRememberedNewThreadCliModelsMock(...args),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  // The transcript skeleton the workspace shows while the created thread's doc
  // loads renders these two (OS-1660).
  // Forwards data-testid, so "no transcript placeholder" is actually assertable.
  Conversation: ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  ConversationContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ConversationEmptyState: ({
    className,
    title,
    description,
  }: {
    className?: string;
    title: string;
    description: string;
  }) => (
    <div className={className} data-testid="conversation-empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}));

vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: NewThreadComposerMock,
}));

vi.mock("@/components/blocks/thread/thread-header", () => ({
  ThreadHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}));

vi.mock("@/components/blocks/thread/thread-tasks-panel", () => ({
  DEFAULT_THREAD_TASKS_PANEL_FILTERS: {
    selectedListRef: null,
    archiveFilter: "active",
    statusFilter: "all",
    assigneeFilter: null,
  },
  ThreadTasksPanel: (props: Record<string, unknown>) => {
    threadTasksPanelRenderMock(props);
    useEffect(() => {
      tasksPanelMountMock();
    }, []);
    const filters = props.filters as { selectedListRef: string | null } | undefined;
    return (
      <div data-testid="thread-tasks-panel">
        Tasks panel
        <button
          type="button"
          onClick={() =>
            (props.onFiltersChange as (patch: Record<string, unknown>) => void)?.({
              selectedListRef: "L2",
            })
          }
        >
          Pick another list
        </button>
        <span data-testid="tasks-panel-list">{filters?.selectedListRef ?? "default"}</span>
      </div>
    );
  },
}));


vi.mock("@/components/blocks/thread/thread-workspace-split-pane", () => ({
  ThreadWorkspaceSplitPane: ({
    children,
    isSidebarOpen,
    sidebarHeader,
    sidebarContent,
  }: {
    children: ReactNode;
    isSidebarOpen: boolean;
    sidebarHeader?: ReactNode;
    sidebarContent?: ReactNode;
  }) => (
    <div>
      {children}
      {isSidebarOpen ? (
        <div data-testid="thread-workspace-sidebar">
          {sidebarHeader}
          {sidebarContent}
        </div>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-detail-sidebar", () => ({
  TaskDetailSidebar: ({ task }: { task: { refId: string } }) => (
    <div data-testid="thread-task-detail-sidebar">{task.refId}</div>
  ),
}));

vi.mock("@/lib/threads/hooks/use-thread-workspace-task-sidebar", () => ({
  useThreadWorkspaceTaskSidebar: (...args: unknown[]) =>
    useThreadWorkspaceTaskSidebarMock(...args),
}));

describe("NewThreadPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/o/org/ABC/threads");
    cliThreadResult = { thread: null, isLoading: true };
    // Warm by default: a send completes unless a test holds it (OS-1665).
    createdThreadQueryResult = { _id: "thread_new" };
    useParamsMock.mockReturnValue({
      organizationSlug: "org",
      projectAlias: "ABC",
    });
    usePathnameMock.mockReturnValue("/o/org/ABC/threads");
    useRouterMock.mockReturnValue({
      replace: replaceMock,
      push: pushMock,
    });
    useSearchParamsMock.mockReturnValue({
      get: vi.fn().mockReturnValue(null),
    });
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
    });
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (!args || args === "skip" || typeof args !== "object") {
        return undefined;
      }
      if (getFunctionName(query) === "cli/messages:listAgentAttachmentsByThread") {
        return [];
      }
      if (getFunctionName(query) === "checks/checklists:getForThread") {
        return null;
      }

      // The created thread's subscriptions — doc and first message page. The
      // hold releases only when both land (OS-1665), so tests that assert the
      // *held* beat leave this in flight and the rest resolve it.
      if ("threadId" in args) {
        return createdThreadQueryResult;
      }

      // The mounted thread view's profile lookup; still loading is enough.
      if ("profileId" in args) {
        return undefined;
      }

      if ("slug" in args) {
        return {
          _id: "org_1" as Id<"organizations">,
        };
      }

      return {
        _id: "project_1" as Id<"projects">,
      };
    });
    // A successful send mounts the workspace for the new thread before the route
    // commits (OS-1660), and its mutations are all `withOptimisticUpdate`-wrapped.
    useMutationMock.mockReturnValue(
      Object.assign(createThreadMutationMock, {
        withOptimisticUpdate: () => createThreadMutationMock,
      })
    );
    useCliProfilesMock.mockReturnValue({
      profiles: [
        {
          _id: "profile_1" as Id<"cliProfiles">,
          name: "Primary profile",
          isOnline: true,
          availableClis: [{ type: "claude-code", version: "2.1.0" }],
          paths: [{ id: "path_1", path: "/tmp/project", label: "project" }],
        },
      ],
    });
    useThreadDraftMock.mockReturnValue({
      draft: undefined,
      setDraft: setDraftMock,
      clearDraft: clearDraftMock,
    });
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState()
    );
    useNewThreadComposerMock.mockReturnValue({
      resolvedDraftState: {
        text: "",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "agent",
        profileId: "profile_1",
        pathId: "path_1",
      },
      handleTextChange: vi.fn(),
      handleWorkingDirectoryChange: vi.fn(),
      handleCliTypeChange: vi.fn(),
      handleModeChange: vi.fn(),
      handleCliModelChange: vi.fn(),
    });
    useThreadMessageAttachmentUploadMock.mockReturnValue({
      pendingAttachments: [],
      syncFileParts: syncFilePartsMock,
      prepareAttachmentsForSubmit: prepareAttachmentsForSubmitMock,
      clearAfterSubmit: clearAfterSubmitMock,
    });
    useRememberedNewThreadCliModelsMock.mockReturnValue({
      rememberedCliModels: {},
      rememberCliModel: rememberCliModelMock,
    });

    tasksPanelMountMock.mockReset();
    createThreadMutationMock.mockReset();
    rememberCliModelMock.mockReset();
    setDraftMock.mockReset();
    clearDraftMock.mockReset();
    replaceMock.mockReset();
    pushMock.mockReset();
    prepareAttachmentsForSubmitMock.mockReset();
    clearAfterSubmitMock.mockReset();
    syncFilePartsMock.mockReset();
    toastErrorMock.mockReset();

    createThreadMutationMock.mockResolvedValue("thread_new");
    prepareAttachmentsForSubmitMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("describes Act mode in the new-thread notice", () => {
    render(<NewThreadPage />);

    expect(screen.getByText("Act mode.")).toBeDefined();
    expect(
      screen.getByText("Full access, never asks for approval.")
    ).toBeDefined();
  });

  test("keeps the mode notice close to the new-thread copy", () => {
    render(<NewThreadPage />);

    const emptyState = screen.getByTestId("conversation-empty-state");
    expect(emptyState.classList.contains("p-0")).toBe(true);
    expect(emptyState.parentElement?.classList.contains("gap-3")).toBe(true);
  });

  test("allows longer mode descriptions to remain on one line", () => {
    useNewThreadComposerMock.mockReturnValue({
      resolvedDraftState: {
        text: "",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "acceptEdits",
        profileId: "profile_1",
        pathId: "path_1",
      },
      handleTextChange: vi.fn(),
      handleWorkingDirectoryChange: vi.fn(),
      handleCliTypeChange: vi.fn(),
      handleModeChange: vi.fn(),
      handleCliModelChange: vi.fn(),
    });

    render(<NewThreadPage />);

    const notice = screen.getByText("Accept edits mode.").closest("div");
    expect(
      screen.getByText("Accepts edits; asks for other actions.")
    ).toBeDefined();
    expect(notice?.classList.contains("max-w-md")).toBe(true);
  });

  test("describes the selected non-Act mode in the new-thread notice", () => {
    useNewThreadComposerMock.mockReturnValue({
      resolvedDraftState: {
        text: "",
        cliType: "claude-code",
        cliModel: "opus",
        mode: "plan",
        profileId: "profile_1",
        pathId: "path_1",
      },
      handleTextChange: vi.fn(),
      handleWorkingDirectoryChange: vi.fn(),
      handleCliTypeChange: vi.fn(),
      handleModeChange: vi.fn(),
      handleCliModelChange: vi.fn(),
    });

    render(<NewThreadPage />);

    expect(screen.getByText("Plan mode.")).toBeDefined();
    expect(
      screen.getByText("Plans before acting; you approve the plan.")
    ).toBeDefined();
    expect(screen.queryByText("Full access mode.")).toBeNull();
  });

  test("binds composer attachments to the new-thread draft (OS-2141)", () => {
    const attachments = { pending: true, uploaded: [{ filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png" }] };
    useThreadDraftMock.mockReturnValue({
      draft: { text: "", attachments, updatedAt: Date.now() },
      setDraft: setDraftMock,
      clearDraft: clearDraftMock,
    });

    render(<NewThreadPage />);

    const binding = useThreadMessageAttachmentUploadMock.mock.calls.at(-1)?.[1] as
      | { attachments: unknown; save: (value: { pending: boolean }) => void }
      | undefined;
    expect(binding?.attachments).toBe(attachments);
    binding?.save({ pending: false });
    expect(setDraftMock).toHaveBeenCalledWith({ attachments: { pending: false } });
  });

  test("stores the remembered CLI selection after a successful new thread create", async () => {
    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));

    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalledWith({
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "claude-code",
        cliMode: "agent",
        cliModel: "opus",
        content: "New thread request",
        attachments: undefined,
        taskId: undefined,
      });
    });

    expect(rememberCliModelMock).toHaveBeenCalledWith("claude-code", "opus", undefined);
    expect(setDraftMock).toHaveBeenCalledWith({ text: "", composerContent: undefined, attachments: { pending: false } });
  });

  test("stores the remembered CLI type when the resolved thread model is missing", async () => {
    useNewThreadComposerMock.mockReturnValue({
      resolvedDraftState: {
        text: "",
        cliType: "codex",
        cliModel: undefined,
        mode: "agent",
        profileId: "profile_1",
        pathId: "path_1",
      },
      handleTextChange: vi.fn(),
      handleWorkingDirectoryChange: vi.fn(),
      handleCliTypeChange: vi.fn(),
      handleModeChange: vi.fn(),
      handleCliModelChange: vi.fn(),
    });

    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));

    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalledWith({
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "codex",
        cliMode: "agent",
        cliModel: undefined,
        content: "New thread request",
        attachments: undefined,
        taskId: undefined,
      });
    });

    expect(rememberCliModelMock).toHaveBeenCalledWith("codex", undefined, undefined);
    expect(setDraftMock).toHaveBeenCalledWith({ text: "", composerContent: undefined, attachments: { pending: false } });
  });

  test("accepts task-only new thread submit and forwards taskId", async () => {
    render(<NewThreadPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Submit task-only thread" })
    );

    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalledWith({
        profileId: "profile_1",
        pathId: "path_1",
        cliType: "claude-code",
        cliMode: "agent",
        cliModel: "opus",
        content: "",
        attachments: undefined,
        taskId: "task_1",
      });
    });

    expect(setDraftMock).toHaveBeenCalledWith({ text: "", composerContent: undefined, attachments: { pending: false } });
  });

  test("preselects a task from the URL and makes it removable on the full page", async () => {
    useSearchParamsMock.mockReturnValue({
      get: vi.fn((key: string) => (key === "attachedTask" ? "OS-635" : null)),
      toString: () => "attachedTask=OS-635",
    });
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({
        attachedTask: {
          _id: "task_635" as Id<"tasks">,
          refId: "OS-635",
          name: "Wire task preselection into threads page",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        },
      })
    );

    render(<NewThreadPage />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("initial-attached-task-ref").textContent).toBe(
        "OS-635"
      );
    });

    expect(screen.getByTestId("initial-attached-task-name").textContent).toBe(
      "Wire task preselection into threads page"
    );
    expect(screen.getByTestId("attached-task-removable").textContent).toBe("true");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  test("cleans agent preselection params while preserving task-sidebar params", async () => {
    window.history.replaceState(
      null,
      "",
      "/o/org/ABC/threads?profileId=profile_1&pathId=path_1&attachedTask=OS-999&task=OS-42"
    );
    useSearchParamsMock.mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === "profileId") return "profile_1";
        if (key === "pathId") return "path_1";
        if (key === "attachedTask") return "OS-999";
        if (key === "task") return "OS-42";
        return null;
      }),
      toString: () => "profileId=profile_1&pathId=path_1&attachedTask=OS-999&task=OS-42",
    });

    render(<NewThreadPage />);

    await vi.waitFor(() => {
      expect(window.location.search).toBe("?attachedTask=OS-999&task=OS-42");
    });
    expect(replaceMock).not.toHaveBeenCalled();

    expect(screen.getByTestId("initial-attached-task-ref").textContent).toBe("");
    expect(screen.getByTestId("initial-attached-task-name").textContent).toBe("");
  });

  test("resolves agent preselection when the location store lags the first render", async () => {
    // Reproduces the project-header agent click: a cross-path router push lands
    // on /threads, but the navigation-location store (useSyncExternalStore over
    // window.location) only catches up in a post-commit effect. On first render
    // the search string is still empty, so the params must be read live rather
    // than frozen at mount.
    window.history.replaceState(null, "", "/o/org/ABC/threads");

    render(<NewThreadPage />);

    // Store catches up: the URL now carries the preselection params.
    window.history.replaceState(
      null,
      "",
      "/o/org/ABC/threads?profileId=profile_1&pathId=path_1"
    );
    fireEvent.popState(window);

    await vi.waitFor(() => {
      const lastArgs = useNewThreadComposerMock.mock.calls.at(-1)?.[0] as
        | { preselection?: unknown }
        | undefined;
      expect(lastArgs?.preselection).toEqual({
        profileId: "profile_1",
        pathId: "path_1",
      });
    });
  });

  test("renders the shared task details pane when a thread task is selected", () => {
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({
        detailsTask: {
          _id: "task_42" as Id<"tasks">,
          clientId: "client_42",
          refNumber: 42,
          refId: "OS-42",
          name: "Selected task",
          description: null,
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
          priority: "None",
          dueDate: null,
          status: "Todo",
          tags: [],
          rank: "a",
          parentId: null,
          createdAt: Date.now(),
          isArchived: false,
        },
        allTasks: [],
      })
    );

    render(<NewThreadPage />);

    expect(screen.getByTestId("thread-workspace-sidebar")).toBeDefined();
    expect(screen.getByTestId("thread-task-detail-sidebar").textContent).toBe(
      "OS-42"
    );
    // Task detail replaces the tasks panel while a task is selected.
    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();
    // Same ref size as the workspace's task tab, so a send doesn't resize it.
    expect(
      screen.getByRole("tab", { name: "OS-42" }).closest('[data-slot="thread-tab"]')
        ?.classList.contains("text-xs")
    ).toBe(true);
  });

  // The mirror is edge-triggered on the task selection, and re-opening the
  // already-selected task leaves it unchanged — so the opener reveals the
  // collapsed sidebar itself (OS-1663).
  test("re-opening the already-selected task reveals a manually collapsed sidebar", () => {
    let openTaskFromPanel: (() => void) | undefined;
    useThreadWorkspaceTaskSidebarMock.mockImplementation((...args: unknown[]) => {
      const state = createThreadWorkspaceState(
        {},
        args[0] as { onOpenTask?: () => void }
      );
      openTaskFromPanel = () => state.setTask("OS-42", "active");
      return state;
    });

    render(<NewThreadPage />);
    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();

    act(() => openTaskFromPanel?.());

    expect(screen.getByTestId("thread-workspace-sidebar")).toBeDefined();
  });

  // OS-1660: the send used to be a cross-segment route push that remounted the
  // whole shell, so the new thread arrived with the sidebar collapsed even
  // though the user had opened it a moment earlier.
  test("keeps the sidebar open across a send", async () => {
    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));

    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalled();
    });
    // The workspace has taken over the thread column — the composer's own empty
    // state is gone — and the pane came along with its panel intact.
    await vi.waitFor(() => {
      expect(screen.getByTestId("thread-workspace-sidebar")).toBeDefined();
    });
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    // And the thread column shows a composer, not a placeholder.
    expect(screen.queryByTestId("thread-transcript-skeleton")).toBeNull();
  });

  /** Sends, then lands the pushed thread route so the host swaps to the workspace. */
  async function sendAndLandOnThread(view: ReturnType<typeof render>) {
    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));
    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalled();
    });
    cliThreadResult = {
      isLoading: false,
      thread: {
        _id: "thread_new",
        projectId: "project_1",
        title: "New thread",
        status: "completed",
        processingState: "idle",
        isOwner: true,
      },
    };
    useParamsMock.mockReturnValue({
      organizationSlug: "org",
      projectAlias: "ABC",
      threadId: "thread_new",
    });
    view.rerender(<NewThreadPage />);
    expect(screen.queryByTestId("conversation-empty-state")).toBeNull();
  }

  // Opening the pane by T (or arriving with it open from a thread on Changes)
  // never recorded the pick, so the send handed over to the workspace's Changes.
  test("keeps the Tasks panel across a send when T opened the pane", async () => {
    const view = render(<NewThreadPage />);
    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();

    await sendAndLandOnThread(view);

    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Tasks");
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
  });

  test("keeps an open task across a send", async () => {
    window.history.replaceState(null, "", "/o/org/ABC/threads?task=OS-42&attachedTask=OS-7");
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({
        detailsTask: {
          _id: "task_42" as Id<"tasks">,
          refId: "OS-42",
          name: "Selected task",
          taskType: { key: "task", name: "Task", icon: "SquareCheckBig", color: "#64748b" },
        },
      })
    );
    const view = render(<NewThreadPage />);
    expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();

    await sendAndLandOnThread(view);

    // `task=<REF>` is what keeps the task open, so the push carries it — but not
    // the composer's `attachedTask`, which the created thread now owns.
    expect(pushMock).toHaveBeenCalledWith(
      "/o/org/ABC/threads/thread_new?task=OS-42",
      expect.anything()
    );
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("OS-42");
    expect(screen.getByTestId("thread-task-detail-sidebar").textContent).toBe("OS-42");
  });

  // OS-1660 #1: hoisting the shell removed the *cost* of the route push (no
  // remount), not the need for it. Without it the URL stays on /threads, so
  // reload/share/Back lose the thread and the mobile layout renders the thread
  // list and the workspace at once.
  test("pushes the created thread's URL on send", async () => {
    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/org/ABC/threads/thread_new"),
        expect.anything()
      );
    });
  });

  // OS-1665: the route commit *is* the swap now, so it waits for the created
  // thread's data. Pushing earlier lands the workspace on a doc that isn't there
  // — the skeleton the user reported — so the composer holds the beat instead.
  test("holds the composer, and the route, until the created thread's data lands", async () => {
    createdThreadQueryResult = undefined;

    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));
    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalled();
    });

    // Neither placeholder, because neither view has swapped: the composer is
    // still the thread column, holding the user's text.
    expect(screen.queryByTestId("thread-detail-skeleton")).toBeNull();
    expect(screen.queryByTestId("thread-transcript-skeleton")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit new thread" })).toBeDefined();
    expect(pushMock).not.toHaveBeenCalled();
    // The draft is untouched while held — clearing it would empty the composer
    // the user is still looking at.
    expect(setDraftMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: "" })
    );
  });

  // OS-1660 #2: the panel's own state is what a send used to reset. The view
  // swap still remounts the component (two parents, so React cannot keep it),
  // which is exactly why the state is lifted to the host rather than owned here.
  test("keeps the Tasks panel's filters across a send", async () => {
    render(<NewThreadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick another list" }));
    expect(screen.getByTestId("tasks-panel-list").textContent).toBe("L2");

    fireEvent.click(screen.getByRole("button", { name: "Submit new thread" }));
    await vi.waitFor(() => {
      expect(createThreadMutationMock).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("thread-workspace-sidebar")).toBeDefined();
    });

    expect(screen.getByTestId("tasks-panel-list").textContent).toBe("L2");
  });

  // OS-1660 #3: the composer pane picked its tab from `detailsTask` alone, so
  // the shared handler's "tasks" pick was ignored here — and then handed to the
  // workspace after a send, overriding its panel from a keypress that visibly
  // did nothing.
  test("T switches from task details back to the Tasks panel", () => {
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({
        detailsTask: SELECTED_TASK_FIXTURE,
        allTasks: [],
      })
    );

    render(<NewThreadPage />);
    expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();

    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });

    expect(useThreadWorkspaceTaskSidebarMock.mock.results.at(-1)?.value.closeTaskSidebar)
      .toHaveBeenCalled();
  });

  test("starts with the Tasks panel sidebar collapsed and toggles from the header", () => {
    render(<NewThreadPage />);

    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open thread sidebar" })
    );
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    expect(screen.queryByRole("tab", { name: "Changes" })).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(threadTasksPanelRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project_1" })
    );
    expect(
      screen.queryByRole("button", { name: "Open thread sidebar" })
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close thread sidebar" })
    );
    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open thread sidebar" })
    ).toBeDefined();
  });

  test("toggles the Tasks panel sidebar from the T shortcut", () => {
    render(<NewThreadPage />);

    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();

    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();

    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();
  });

  test("does not toggle the Tasks panel sidebar from the T shortcut while typing", () => {
    render(<NewThreadPage />);

    expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
      expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();
    } finally {
      input.remove();
    }
  });

  test("dropping a task on the composer attaches it by ref", () => {
    const workspaceState = createThreadWorkspaceState();
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(workspaceState);

    render(<NewThreadPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Drop task on composer" })
    );
    expect(workspaceState.setAttachedTask).toHaveBeenCalledWith("OS-9");
  });
});
