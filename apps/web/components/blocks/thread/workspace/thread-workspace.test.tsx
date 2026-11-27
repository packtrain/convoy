/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createContext,
  isValidElement,
  forwardRef,
  useContext,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import { getFunctionName } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { THREAD_TASKS_SIDEBAR_HOTKEY, THREAD_TOGGLE_DONE_HOTKEY } from "@/lib/browser/hotkeys";
import type { ThreadStatus } from "@/lib/threads/types";
import { api } from "@/convex/_generated/api";
import { useOpenThreadWorkspaceTask } from "@/lib/threads/hooks/use-open-thread-workspace-task";
import { DetailThreadComposerMock } from "@/test-utils/mocks/thread-composer";
import { createThreadWorkspaceState } from "@/test-utils/mocks/thread-workspace";
import { DEFAULT_THREAD_TASKS_PANEL_FILTERS } from "@/components/blocks/thread/thread-tasks-panel";
import type { ThreadWorkspaceTab } from "@/components/blocks/thread/thread-sidebar-tabs";
import { ThreadTaskPane } from "./thread-task-pane";
import { ThreadWorkspace } from "./thread-workspace";
import { useThreadShellState } from "./use-thread-shell-state";

const useParamsMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const convexMutationMock = vi.fn();
const convexQueryMock = vi.fn();
const useCliThreadMock = vi.fn();
const useCliMessagesMock = vi.fn();
const useThreadDraftMock = vi.fn();
const useThreadMessageAttachmentUploadMock = vi.fn();
const useThreadReadStateMock = vi.fn();
const useThreadWorkspaceTaskSidebarMock = vi.fn();
const toastErrorMock = vi.fn();
const detailThreadComposerRenderMock = vi.fn();
const assistantCliMessageRenderMock = vi.fn();
const useThreadHandoffArgsMock = vi.fn();
const threadTasksPanelRenderMock = vi.fn();
const taskArtifactPanelRenderMock = vi.fn();
const scrollToBottomMock = vi.fn();
const sidebarHighlightMock = vi.fn();

const EMPTY_RUNTIME_CATALOGS: Array<never> = [];

const sendMessageMock = vi.fn();
const retryMessageMock = vi.fn();
const cancelProcessingMock = vi.fn();
const loadOlderChunksMock = vi.fn();
const updateTitleMutationMock = vi.fn();
const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const setDraftMock = vi.fn();
const prepareAttachmentsForSubmitMock = vi.fn();
const clearAfterSubmitMock = vi.fn();
const syncFilePartsMock = vi.fn();
const alertDialogOpenContext = createContext(false);
const DESKTOP_VIEWPORT_WIDTH = typeof window === "undefined" ? 1024 : window.innerWidth;

let draftValue:
  | {
      text: string;
      mode?: string;
      cliModel?:
        | "default"
        | "sonnet"
        | "sonnet-1m"
        | "opus"
        | "opus-1m"
        | "opus-4-7"
        | "opus-4-7-1m"
        | "haiku";
      attachments?: { pending: boolean };
      updatedAt: number;
    }
  | undefined;
let defaultUseQueryResult: {
  _id: string;
  name: string;
  isOnline: boolean;
  availableClis: Array<{ type: string; version: string }>;
  paths: Array<{
    id: string;
    path: string;
    label: string;
  }>;
};
let groupQueryResult:
  | {
      children: Array<{
        _id: string;
        title: string;
        lastActivityAt: number;
        associatedTaskId?: string;
        isDone?: boolean;
        doneAt?: number;
        // The tab indicator's inputs (OS-1618); omitted where a test is about
        // something else, which reads as a settled, already-read thread.
        status?: ThreadStatus;
        hasPendingInteraction?: boolean;
        requiresAttention?: boolean;
        hasUnread?: boolean;
      }>;
      totalRowCount: number;
    }
  | null
  | undefined;
const SELECTED_TASK_FIXTURE = {
  _id: "task_1" as Id<"tasks">,
  clientId: "task_1",
  refNumber: 1,
  refId: "OS-1",
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
  status: "To Do",
  tags: [],
  rank: "a0",
  parentId: null,
  createdAt: 1_700_000_000_000,
};

let taskSummariesQueryResult: Array<Record<string, unknown>> | undefined;
/**
 * The created thread's first envelope page, read only by the create hold
 * (`useCreatedThreadReady`). `undefined` parks a send inside the hold with its
 * group already warm — the window OS-907 is about.
 */
let createdThreadEnvelopesResult: Array<Record<string, unknown>> | undefined;
let threadArtifactQueryResult: Record<string, unknown> | null | undefined;
let threadArtifactOwningTaskResult: {
  task: Record<string, unknown> | null | undefined;
  isReadOnly: boolean | undefined;
};
let capturedOptimisticUpdates: Record<string, (localStore: unknown, args: unknown) => void>;

// jsdom has no scrollTo; the Run rail centers its focus step with it.
Element.prototype.scrollTo = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: (...args: unknown[]) => useParamsMock(...args),
  usePathname: () => "/o/org/ABC/threads/thread-1",
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useConvex: () => ({
    mutation: (...args: unknown[]) => convexMutationMock(...args),
    query: (...args: unknown[]) => convexQueryMock(...args),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const pullRequestReaderMounts = vi.fn();
const pullRequestReaderProps = vi.fn();
vi.mock("@/components/blocks/integrations", async (importOriginal) => {
  const { useEffect } = await import("react");
  return {
    ...(await importOriginal<object>()),
    AttachedPullRequestReader: (props: { canWatch: boolean; watchDisabledReason?: string }) => {
      pullRequestReaderProps(props);
      useEffect(() => pullRequestReaderMounts(), []);
      return <p>Pull request reader</p>;
    },
  };
});

vi.mock("@/lib/threads/hooks/use-cli-thread", () => ({
  useCliThread: (...args: unknown[]) => useCliThreadMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-cli-messages", () => ({
  useCliMessages: (...args: unknown[]) => useCliMessagesMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: (...args: unknown[]) =>
    useThreadMessageAttachmentUploadMock(...args),
  isThreadAttachmentSubmitError: (error: unknown) =>
    error instanceof Error && error.message === "Attachment upload failed",
}));

vi.mock("@/components/blocks/thread/thread-read-state-context", () => ({
  useThreadReadState: (...args: unknown[]) => useThreadReadStateMock(...args),
}));

vi.mock("@/lib/threads/hooks/use-thread-handoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/threads/hooks/use-thread-handoff")>();
  return {
    useThreadHandoff: (args: Parameters<typeof actual.useThreadHandoff>[0]) => {
      useThreadHandoffArgsMock(args);
      return actual.useThreadHandoff(args);
    },
  };
});

vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  buildThreadDraftKey: (threadId: string) => `thread:${threadId}`,
  useThreadDraft: (...args: unknown[]) => useThreadDraftMock(...args),
  getNewThreadDraftKey: () => "new",
  useThreadDraftProvider: () => ({ getDraftSnapshot: vi.fn(), seedDraft: vi.fn() }),
}));

vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: (props: React.ComponentProps<typeof DetailThreadComposerMock>) => {
    detailThreadComposerRenderMock(props);
    return <DetailThreadComposerMock {...props} />;
  },
}));

vi.mock("@/components/blocks/tasks/task-detail-sidebar", () => ({
  TaskDetailSidebar: ({ task }: { task: { refId: string } }) => (
    <div data-testid="thread-task-detail-sidebar">{task.refId}</div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-artifact-panel", () => ({
  TaskArtifactPanel: (props: Record<string, unknown>) => {
    taskArtifactPanelRenderMock(props);
    return (
      <div data-testid="thread-artifact-panel">
        {String(props.selectedArtifactId)}
      </div>
    );
  },
}));

vi.mock("@/lib/tasks/hooks/use-task-artifacts", () => ({
  useTaskArtifact: (artifactId: string | null) =>
    artifactId ? threadArtifactQueryResult : undefined,
  useUpdateTaskArtifact: () => vi.fn(),
  useArtifactOwningTask: () => threadArtifactOwningTaskResult,
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
    return <div data-testid="thread-tasks-panel">Tasks panel</div>;
  },
}));


vi.mock("@/lib/threads/hooks/use-thread-workspace-task-sidebar", () => ({
  useThreadWorkspaceTaskSidebar: (...args: unknown[]) =>
    useThreadWorkspaceTaskSidebarMock(...args),
}));

vi.mock("@/components/blocks/thread/thread-header", () => ({
  ThreadHeader: ({
    title,
    leading,
    tabs,
    titleTrailing,
    actions,
    onTitleCommit,
  }: {
    title: string;
    leading?: ReactNode;
    tabs?: ReactNode;
    titleTrailing?: ReactNode;
    actions?: ReactNode;
    onTitleCommit?: (nextTitle: string) => Promise<void> | void;
  }) => (
    // The real header derives `isEditable` from `onTitleCommit` being a
    // function; surface that here so the read-only case is observable.
    <div
      data-testid="thread-header"
      data-title-editable={typeof onTitleCommit === "function"}
    >
      {leading ? <div data-testid="thread-header-leading">{leading}</div> : null}
      {tabs ? (
        <div data-testid="thread-header-tabs">{tabs}</div>
      ) : (
        <div>
          {title}
          {titleTrailing}
        </div>
      )}
      {actions ? <div data-testid="thread-header-actions">{actions}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/blocks/thread/assistant-cli-thread-message", () => ({
  AssistantCliMessage: (
    props: Record<string, unknown>
  ) => {
    assistantCliMessageRenderMock(props);
    return <div>Assistant message</div>;
  },
}));

vi.mock("@/components/blocks/thread/response-attachments", () => ({
  ResponseAttachments: ({
    attachments,
  }: {
    attachments: Array<{ fileName: string }>;
  }) => (
    <div data-testid="thread-message-attachments">
      {attachments.map((attachment) => attachment.fileName).join(",")}
    </div>
  ),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: forwardRef<
    { scrollToBottom: typeof scrollToBottomMock },
    { children: ReactNode }
  >(function MockConversation({ children }, ref) {
    useImperativeHandle(
      ref,
      () => ({ scrollToBottom: scrollToBottomMock }),
      []
    );
    return <div>{children}</div>;
  }),
  ConversationContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationEmptyState: ({ title }: { title?: ReactNode }) => (
    <div data-testid="conversation-empty-state">{title}</div>
  ),
  ConversationScrollButton: () => null,
}));

// The mocked Conversation renders no StickToBottom provider (OS-2170).
vi.mock("use-stick-to-bottom", () => ({
  useStickToBottomContext: () => ({
    scrollRef: { current: null },
    contentRef: { current: null },
  }),
}));

vi.mock("@/components/ai-elements/message", () => ({
  Message: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MessageContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ai-elements/shimmer", () => ({
  Shimmer: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
  }) => (
    <alertDialogOpenContext.Provider value={open === true}>
      <div>{children}</div>
    </alertDialogOpenContext.Provider>
  ),
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => {
    const open = useContext(alertDialogOpenContext);
    return open ? <div role="alertdialog">{children}</div> : null;
  },
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildCliMessagesResult(args: {
  messages?: Array<Record<string, unknown>>;
  isLoading?: boolean;
  hasOlderChunks?: boolean;
  loadedChunkCount?: number;
  isLoadingOlderChunks?: boolean;
  loadOlderChunks?: () => void;
  sendMessage?: typeof sendMessageMock;
  retryMessage?: typeof retryMessageMock;
  cancelProcessing?: typeof cancelProcessingMock;
  assistantRenderById?: Map<string, unknown>;
  latestContextWindow?: unknown;
  latestUsageLimits?: unknown[];
}) {
  const messages = (args.messages ?? []) as Array<{
    _id: Id<"cliMessages">;
    role: "user" | "assistant";
    content?: Array<{ data: string }>;
    attachments?: Array<unknown>;
    task?: unknown;
    status?: string;
    chunkCount?: number;
  } & Record<string, unknown>>;
  const assistantRenderById =
    args.assistantRenderById ?? new Map<string, unknown>();
  const envelopes = messages.map((message) => ({
    ...message,
    attachments: message.attachments ?? [],
    chunkCount:
      message.chunkCount ??
      (message.role === "assistant" && assistantRenderById.has(message._id)
        ? 1
        : 0),
    hasLegacyContent: false,
  }));

  return {
    envelopes,
    envelopesById: new Map(envelopes.map((message) => [message._id, message])),
    visibleMessageIds: envelopes.map((message) => message._id),
    renderStateByMessageId: assistantRenderById,
    userTextById: new Map(
      messages
        .filter((message) => message.role === "user")
        .map((message) => [
          message._id,
          message.content?.map((block) => block.data).join("\n") ?? "",
        ])
    ),
    loadedChunkCount:
      args.loadedChunkCount ??
      envelopes.reduce((count, message) => count + (message.chunkCount ?? 0), 0),
    isLoading: args.isLoading ?? false,
    hasOlderChunks: args.hasOlderChunks ?? false,
    isLoadingOlderChunks: args.isLoadingOlderChunks ?? false,
    loadOlderChunks: args.loadOlderChunks ?? loadOlderChunksMock,
    sendMessage: args.sendMessage ?? sendMessageMock,
    retryMessage: args.retryMessage ?? retryMessageMock,
    cancelProcessing: args.cancelProcessing ?? cancelProcessingMock,
    assistantRenderById,
    latestContextWindow: args.latestContextWindow ?? null,
    latestUsageLimits: args.latestUsageLimits ?? [],
  };
}

function buildCliMessagesResultWithHiddenOlderEnvelope() {
  const olderMessage = {
    _id: "message_older" as Id<"cliMessages">,
    role: "user" as const,
    status: "completed",
    cliType: "codex",
    cliMode: "plan",
    createdAt: Date.now() - 1000,
    content: [],
    attachments: [],
    chunkCount: 0,
    hasLegacyContent: false,
  };
  const latestMessage = {
    _id: "message_latest" as Id<"cliMessages">,
    role: "user" as const,
    status: "completed",
    cliType: "codex",
    cliMode: "plan",
    createdAt: Date.now(),
    content: [{ type: "text", data: "Latest only" }],
    attachments: [],
    chunkCount: 1,
    hasLegacyContent: false,
  };
  const envelopes = [olderMessage, latestMessage];

  return {
    envelopes,
    envelopesById: new Map(envelopes.map((message) => [message._id, message])),
    visibleMessageIds: [latestMessage._id],
    renderStateByMessageId: new Map<string, unknown>(),
    userTextById: new Map([[latestMessage._id, "Latest only"]]),
    loadedChunkCount: 1,
    isLoading: false,
    hasOlderChunks: true,
    isLoadingOlderChunks: false,
    loadOlderChunks: loadOlderChunksMock,
    sendMessage: sendMessageMock,
    retryMessage: retryMessageMock,
    cancelProcessing: cancelProcessingMock,
    assistantRenderById: new Map<string, unknown>(),
    latestContextWindow: null,
    latestUsageLimits: [],
  };
}

function getMobileThreadActions(): HTMLElement {
  const slot = screen
    .getByTestId("thread-header-actions")
    .querySelector<HTMLElement>('[data-slot="mobile-thread-actions"]');
  if (!slot) {
    throw new Error("mobile thread actions slot is missing");
  }

  return slot;
}

/**
 * `useIsMobile` reads `window.innerWidth` (jsdom defaults to a desktop width),
 * so a phone viewport is one property away — no module mock needed.
 */
function setMobileViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
}

/**
 * Stands in for `ThreadWorkspaceHost`: the shell state and the task-sidebar hook
 * now live one level up (OS-1660), so the workspace is only renderable with them
 * supplied. Real `useThreadShellState`, so the sidebar toggles and the `T`
 * shortcut still exercise the code that owns them.
 */
function ThreadWorkspaceHarness({
  threadId,
  handedOverPanel,
  autoFocusComposer,
}: {
  threadId?: Id<"cliThreads">;
  autoFocusComposer?: boolean;
  /** A panel pick inherited from the new-thread pane, as a send hands it over. */
  handedOverPanel?: ThreadWorkspaceTab;
}) {
  const params = useParamsMock() as { threadId?: string };
  const shell = useThreadShellState();
  const project = useQueryMock(api.projects.core.getById, { id: "project_1" });
  const { setChosenPanel, openSidebar } = shell;
  const threadWorkspace = useThreadWorkspaceTaskSidebarMock({
    projectId: "project_1",
    projectStatusConfig: project,
    onOpenTask: shell.revealTaskTab,
  }) as ReturnType<typeof createThreadWorkspaceState>;
  const openTaskInSidebar = useOpenThreadWorkspaceTask(threadWorkspace.setTask);
  // The handover the host performs on a send: the pane arrives already open on
  // whatever panel the new-thread view recorded (OS-1660).
  const [seeded, setSeeded] = useState(false);
  if (handedOverPanel && !seeded) {
    setSeeded(true);
    setChosenPanel(handedOverPanel);
    openSidebar();
  }

  return (
    <ThreadWorkspace
      threadId={threadId ?? (params.threadId as Id<"cliThreads">)}
      projectId={"project_1" as Id<"projects">}
      project={project}
      shell={shell}
      threadWorkspace={threadWorkspace}
      openTaskInSidebar={openTaskInSidebar}
      // The real shared pane, as the host renders it — its two branches are
      // what the panel-tab assertions below observe.
      renderTaskPane={(panel) => (
        <ThreadTaskPane
          panel={panel}
          projectId={"project_1" as Id<"projects">}
          project={project}
          threadWorkspace={threadWorkspace}
          openTaskInSidebar={openTaskInSidebar}
          selectedTask={threadWorkspace.detailsTask ?? null}
          organizationSlug="contoso"
          projectAlias="OS"
          tasksFilters={DEFAULT_THREAD_TASKS_PANEL_FILTERS}
          onTasksFiltersChange={() => {}}
        />
      )}
      onSidebarHighlightChange={sidebarHighlightMock}
      autoFocusComposer={autoFocusComposer}
    />
  );
}

function workspaceElement() {
  return <ThreadWorkspaceHarness />;
}

function renderWorkspace() {
  return render(workspaceElement());
}

function getThreadColumn(): HTMLElement {
  const column = document.querySelector<HTMLElement>(
    '[data-slot="thread-column"]'
  );
  if (!column) {
    throw new Error("thread column is missing");
  }

  return column;
}

describe("ThreadWorkspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    detailThreadComposerRenderMock.mockClear();
    assistantCliMessageRenderMock.mockClear();
    threadTasksPanelRenderMock.mockClear();
    draftValue = {
      text: "Persisted draft",
      mode: "auto",
      attachments: { pending: false },
      updatedAt: Date.now(),
    };

    useParamsMock.mockReturnValue({
      organizationSlug: "contoso",
      projectAlias: "OS",
      threadId: "thread_1",
    });
    capturedOptimisticUpdates = {};
    // One stable wrapper per function (matching Convex's stable useMutation
    // identity — the page's memoized handlers depend on it). The page wraps
    // mutations with withOptimisticUpdate inside a useMemo, after every
    // useMutation call ran, so a wrapper per function — not a mutated shared
    // base — is what keys the captured callbacks correctly.
    const mutationWrappers: Record<string, unknown> = {};
    useMutationMock.mockImplementation((mutation) => {
      const functionName = getFunctionName(mutation);
      const base = updateTitleMutationMock;
      if (!mutationWrappers[functionName]) {
        const call = (...args: Parameters<typeof base>) => base(...args);
        mutationWrappers[functionName] = Object.assign(call, {
          withOptimisticUpdate: (callback: (localStore: unknown, args: unknown) => void) => {
            capturedOptimisticUpdates[functionName] = callback;
            return call;
          },
        });
      }
      return mutationWrappers[functionName];
    });
    defaultUseQueryResult = {
      _id: "profile_1",
      name: "Primary profile",
      isOnline: true,
      availableClis: [{ type: "claude-code", version: "2.1.52" }],
      paths: [
        {
          id: "path_1",
          path: "/tmp/project",
          label: "project",
        },
      ],
    };
    groupQueryResult = undefined;
    taskSummariesQueryResult = [];
    // Warm by default, so a send that isn't about the hold sails through it.
    createdThreadEnvelopesResult = [];
    threadArtifactQueryResult = {
      _id: "artifact_1",
      name: "Implementation Plan",
      taskId: "task_1",
    };
    threadArtifactOwningTaskResult = {
      task: {
        _id: "task_1",
        projectId: "project_1",
        refId: "OS-7",
        isArchived: false,
      },
      isReadOnly: false,
    };
    // List-shaped subscriptions return lists, the group subscription returns
    // the per-test fixture, and everything else falls back to the profile
    // shape. Skipped subscriptions resolve to undefined like the real client.
    useQueryMock.mockImplementation(
      (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
        if (args === "skip") {
          return undefined;
        }
        const functionName = getFunctionName(query);
        if (functionName === "cli/interactionRequests:listPendingByThread") {
          return [];
        }
        if (functionName === "cli/threads/groups:getGroup") {
          return groupQueryResult;
        }
        if (functionName === "cli/messages:listEnvelopesByThread") {
          return createdThreadEnvelopesResult;
        }
        if (functionName === "tasks/core:getSummariesByIds") {
          return taskSummariesQueryResult;
        }
        if (functionName === "cli/profiles:listByProject") {
          return [defaultUseQueryResult];
        }
        // Advertised catalogs ride in their own subscription (OS-1721). Stable
        // identity like the real `useQuery`, or the pane would rerender.
        if (functionName === "cli/profiles:listRuntimeCatalogs") {
          return EMPTY_RUNTIME_CATALOGS;
        }
        if (functionName === "agents/projectAgents:listByProject") {
          return [];
        }
        if (functionName === "cli/messages:listAgentAttachmentsByThread") {
          return [];
        }
        if (functionName === "checks/checklists:getForTask" || functionName === "checks/checklists:getForThread") {
          return null;
        }
        if (functionName === "projects/members:getMyRole") {
          return "member";
        }
        if (functionName === "integrations/github/pullRequestWatches:getForThread") {
          return null;
        }
        return defaultUseQueryResult;
      }
    );
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
        hasUnread: true,
        requiresAttention: false,
        isDone: false,
        isPinned: false,
        lastActivityAt: Date.now(),
        // Always present on the real `cli.threads.get` payload; without it the
        // owner path is indistinguishable from a still-loading thread.
        isOwner: true,
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));
    useThreadDraftMock.mockReturnValue({
      draft: draftValue,
      setDraft: setDraftMock,
    });
    useThreadMessageAttachmentUploadMock.mockReturnValue({
      pendingAttachments: [],
      syncFileParts: syncFilePartsMock,
      prepareAttachmentsForSubmit: prepareAttachmentsForSubmitMock,
      clearAfterSubmit: clearAfterSubmitMock,
    });
    useThreadReadStateMock.mockReturnValue(undefined);
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState()
    );
    sendMessageMock.mockReset();
    retryMessageMock.mockReset();
    cancelProcessingMock.mockReset();
    loadOlderChunksMock.mockReset();
    updateTitleMutationMock.mockReset();
    routerPushMock.mockReset();
    routerReplaceMock.mockReset();
    setDraftMock.mockReset();
    prepareAttachmentsForSubmitMock.mockReset();
    clearAfterSubmitMock.mockReset();
    syncFilePartsMock.mockReset();
    scrollToBottomMock.mockReset();
    sidebarHighlightMock.mockReset();
    toastErrorMock.mockReset();
    convexMutationMock.mockReset();
    convexQueryMock.mockReset();

    prepareAttachmentsForSubmitMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: DESKTOP_VIEWPORT_WIDTH,
    });
  });

  test("renders not found without querying thread hooks when the route id is invalid", () => {
    useParamsMock.mockReturnValue({
      organizationSlug: "contoso",
      projectAlias: "OS",
      threadId: "ms7c05dyhscwygj7bc0dp9rad5850dq4",
    });
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: null,
    });

    renderWorkspace();

    expect(useCliThreadMock).toHaveBeenCalledWith(
      "ms7c05dyhscwygj7bc0dp9rad5850dq4",
      {
        suppressAutoReadThreadId: undefined,
      }
    );
    expect(useCliMessagesMock).not.toHaveBeenCalled();
    const heading = screen.getByRole("heading", { level: 1, name: "Thread not found" });
    expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /back to threads/i }).getAttribute("href")
    ).toBe("/o/contoso/OS/threads");
  });

  test("keeps the header and composer mounted while the first message page loads", () => {
    // Swapping the whole page for a skeleton (composer included) made opening
    // a freshly created thread look like a page reload (OS-1434).
    useCliMessagesMock.mockReturnValue(
      buildCliMessagesResult({
        messages: [],
        isLoading: true,
        isLoadingOlderChunks: false,
        loadOlderChunks: loadOlderChunksMock,
        sendMessage: sendMessageMock,
        retryMessage: retryMessageMock,
        cancelProcessing: cancelProcessingMock,
        assistantRenderById: new Map(),
        latestContextWindow: null,
        latestUsageLimits: [],
      })
    );

    renderWorkspace();

    expect(screen.getByRole("button", { name: "Composer submit" })).toBeDefined();
    expect(screen.getByText("Existing thread")).toBeDefined();
    expect(screen.getByTestId("messages-loading-skeleton")).toBeDefined();
  });

  test("moves pull-request info from the header into the composer", () => {
    const pullRequest = {
      provider: "github" as const,
      number: 1438,
      title: "Move PR info into the composer",
      url: "https://github.com/contoso/contoso/pull/1438",
      state: "open" as const,
      headBranch: "feat/os-1438-pr-info",
      baseBranch: "main",
      capturedAt: Date.now(),
    };
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
        hasUnread: true,
        requiresAttention: false,
        isDone: false,
        isPinned: false,
        lastActivityAt: Date.now(),
        pullRequest,
      },
    });

    renderWorkspace();

    expect(
      within(screen.getByTestId("thread-header-leading")).queryByLabelText(
        "PR #1438 · Open — Move PR info into the composer"
      )
    ).toBeNull();
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pullRequest })
    );
  });

  test("passes execution branch updates to the locked follow-up composer", () => {
    const base = useCliThreadMock();
    useCliThreadMock.mockReturnValue({ ...base, thread: { ...base.thread, branch: "feat/current" } });
    const view = renderWorkspace();
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      readOnlyWorkspace: { kind: "local", branch: "feat/current" },
      selectorsProps: expect.objectContaining({ lockAgentContext: true }),
    }));

    useCliThreadMock.mockReturnValue({ ...base, thread: { ...base.thread, branch: "feat/updated" } });
    view.rerender(workspaceElement());
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      readOnlyWorkspace: { kind: "local", branch: "feat/updated" },
    }));

    useCliThreadMock.mockReturnValue(base);
    view.rerender(workspaceElement());
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      readOnlyWorkspace: { kind: "local", branch: undefined },
    }));
  });

  test("passes stored worktree metadata to the composer when its profile path is gone", () => {
    const base = useCliThreadMock();
    useCliThreadMock.mockReturnValue({ ...base, thread: {
      ...base.thread,
      pathId: "removed-worktree",
      branch: "feat/actual",
      worktree: { parentPathId: "path_1", branch: "feat/original", status: "created" },
    } });
    renderWorkspace();
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({
      readOnlyWorkspace: { kind: "worktree", branch: "feat/actual" },
    }));
  });

  test("disables the existing-thread composer immediately while send is pending", async () => {
    const deferred = createDeferred<void>();
    sendMessageMock.mockReturnValue(deferred.promise);

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "thread_1",
        {
          content: "Follow up",
          cliMode: "auto",
          cliModel: "default",
          cliEffort: "default",
          attachments: undefined,
          taskId: undefined,
        }
      );
      expect(screen.getByTestId("textarea-disabled").textContent).toBe("true");
      expect(screen.getByTestId("submit-disabled").textContent).toBe("true");
      expect(screen.getByTestId("selectors-disabled").textContent).toBe("true");
    });

    deferred.resolve(undefined);
    await deferred.promise;
  });

  // A just-created thread's composer takes the focus the sending one lost.
  test.each([true, false])("passes autoFocusComposer=%s to the thread composer", (autoFocusComposer) => {
    render(<ThreadWorkspaceHarness autoFocusComposer={autoFocusComposer} />);
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({ autoFocus: autoFocusComposer }));
  });

  // Later sends follow the composer's own refocus rule, which respects a click elsewhere.
  test("drops autoFocusComposer once the created thread sends again", async () => {
    const deferred = createDeferred<void>();
    sendMessageMock.mockReturnValue(deferred.promise);
    render(<ThreadWorkspaceHarness autoFocusComposer />);

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));
    await vi.waitFor(() => expect(screen.getByTestId("textarea-disabled").textContent).toBe("true"));
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({ autoFocus: false }));

    await act(async () => {
      deferred.resolve(undefined);
      await deferred.promise;
    });
    expect(detailThreadComposerRenderMock).toHaveBeenLastCalledWith(expect.objectContaining({ autoFocus: false }));
  });

  test("scrolls to a successfully sent user message (OS-1339)", async () => {
    sendMessageMock.mockResolvedValue(
      "message_sent" as Id<"cliMessages">
    );

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(scrollToBottomMock).toHaveBeenCalledWith();
    });
  });

  test("scrolls after a successful send while the thread is streaming (OS-1339)", async () => {
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "streaming",
        processingState: "streaming",
        hasPendingUserMessages: true,
      },
    });
    sendMessageMock.mockResolvedValue(
      "message_sent" as Id<"cliMessages">
    );

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(scrollToBottomMock).toHaveBeenCalledTimes(1);
    });
  });

  test("passes latest context-window usage into the shared composer", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: {
        usedTokens: 100_000,
        maxTokens: 300_000,
        remainingTokens: 200_000,
        usedPercentage: 33.3333333333,
        remainingPercentage: 66.6666666667,
        inputTokens: 1_000,
        cachedInputTokens: 90_000,
        outputTokens: 9_000,
      },
    }));

    renderWorkspace();

    expect(screen.getByTestId("context-window-usage").textContent).toContain(
      "\"maxTokens\":300000"
    );
  });

  test("fills a live max-less snapshot's max from the thread's persisted snapshot (OS-1900)", () => {
    const base = useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      ...base,
      thread: {
        ...base.thread,
        metadata: { contextWindow: { usedTokens: 120_000, maxTokens: 200_000 } },
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      latestContextWindow: { usedTokens: 150_000 },
    }));

    renderWorkspace();

    const text = screen.getByTestId("context-window-usage").textContent;
    expect(text).toContain("\"usedTokens\":150000");
    expect(text).toContain("\"maxTokens\":200000");
  });

  test("falls back to the thread's persisted context-window snapshot when the loaded chunks have none", () => {
    // Bounded window (OS-1889): a long streaming turn pushes the last snapshot
    // chunk out of the bootstrap page, so the thread doc is the fallback.
    const base = useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      ...base,
      thread: {
        ...base.thread,
        metadata: { contextWindow: { usedTokens: 120_000, maxTokens: 200_000 } },
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(screen.getByTestId("context-window-usage").textContent).toContain(
      "\"usedTokens\":120000"
    );
  });

  test("merges the thread's persisted usage limits under the loaded stream's", () => {
    const base = useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      ...base,
      thread: {
        ...base.thread,
        metadata: {
          usageLimits: [
            { window: "5h", utilization: 0.5, resetsAt: 1_000 },
            { window: "weekly", utilization: 0.85, resetsAt: 2_000 },
          ],
        },
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      latestUsageLimits: [
        { window: "5h", utilization: 0.9, resetsAt: 1_500, isUsingOverage: false, severity: "warning" },
      ],
    }));

    renderWorkspace();

    const usageLimits = JSON.parse(screen.getByTestId("usage-limits").textContent ?? "[]");
    expect(usageLimits).toEqual([
      expect.objectContaining({ window: "5h", utilization: 0.9 }),
      expect.objectContaining({ window: "weekly", utilization: 0.85, severity: "warning" }),
    ]);
  });

  test("ignores duplicate submits while the send promise is still pending", async () => {
    const deferred = createDeferred<void>();
    sendMessageMock.mockReturnValue(deferred.promise);

    renderWorkspace();

    const submitButton = screen.getByRole("button", { name: "Composer submit" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    deferred.resolve(undefined);
    await deferred.promise;
  });

  test("clears the draft only after a successful send resolves", async () => {
    const deferred = createDeferred<void>();
    sendMessageMock.mockReturnValue(deferred.promise);

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
    expect(clearAfterSubmitMock).not.toHaveBeenCalled();
    expect(setDraftMock).not.toHaveBeenCalledWith({
      text: "",
      attachments: { pending: false },
    });

    deferred.resolve(undefined);
    await deferred.promise;

    await vi.waitFor(() => {
      expect(clearAfterSubmitMock).toHaveBeenCalledTimes(1);
      expect(setDraftMock).toHaveBeenCalledWith({
        text: "",
        attachments: { pending: false },
      });
    });
  });

  test("keeps draft state and shows a toast when send fails", async () => {
    sendMessageMock.mockRejectedValue(new Error("Failed to send message"));

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to send message");
    });
    expect(clearAfterSubmitMock).not.toHaveBeenCalled();
    expect(setDraftMock).not.toHaveBeenCalledWith({
      text: "",
      attachments: { pending: false },
    });
    expect(screen.getByTestId("textarea-disabled").textContent).toBe("false");
    expect(screen.getByTestId("submit-disabled").textContent).toBe("false");
    expect(screen.getByTestId("selectors-disabled").textContent).toBe("false");
    expect(scrollToBottomMock).not.toHaveBeenCalled();
  });

  test("keeps lockAgentContext enabled while allowing mode changes for follow-up messages", () => {
    renderWorkspace();

    expect(screen.getByTestId("selectors-lock-agent-context").textContent).toBe(
      "true"
    );
    expect(screen.getByTestId("selectors-mode").textContent).toBe("auto");

    fireEvent.click(screen.getByRole("button", { name: "Change mode" }));

    expect(setDraftMock).toHaveBeenCalledWith({ mode: "agent" });
  });

  test("binds the thread composer's attachments to the thread draft (OS-2141)", () => {
    const attachments = { pending: true, uploaded: [{ filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png" }] };
    draftValue = { text: "", attachments, updatedAt: Date.now() };
    useThreadDraftMock.mockReturnValue({ draft: draftValue, setDraft: setDraftMock });

    renderWorkspace();

    const binding = useThreadMessageAttachmentUploadMock.mock.calls.at(-1)?.[1] as
      | { attachments: unknown; save: (value: { pending: boolean }) => void }
      | undefined;
    expect(binding?.attachments).toBe(attachments);
    binding?.save({ pending: false });
    expect(setDraftMock).toHaveBeenCalledWith({ attachments: { pending: false } });
  });

  test("keeps model changes thread-local for existing-thread interactions", async () => {
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "claude-code",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
      },
    });
    draftValue = {
      text: "Persisted draft",
      mode: "plan",
      cliModel: "opus",
      attachments: { pending: false },
      updatedAt: Date.now(),
    };
    useThreadDraftMock.mockReturnValue({
      draft: draftValue,
      setDraft: setDraftMock,
    });

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Change model" }));
    fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "thread_1",
        {
          content: "Follow up",
          cliMode: "plan",
          cliModel: "opus",
          cliEffort: "default",
          attachments: undefined,
          taskId: undefined,
        }
      );
    });

    expect(setDraftMock).toHaveBeenCalledWith({ cliModel: "haiku" });
  });

  test("accepts task-only existing-thread submit and forwards taskId", async () => {
    renderWorkspace();

    fireEvent.click(
      screen.getByRole("button", { name: "Composer task-only submit" })
    );

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("thread_1", {
        content: "",
        cliMode: "auto",
        cliModel: "default",
        cliEffort: "default",
        attachments: undefined,
        taskId: "task_1",
      });
    });

    expect(clearAfterSubmitMock).toHaveBeenCalledTimes(1);
    expect(setDraftMock).toHaveBeenCalledWith({
      text: "",
      attachments: { pending: false },
    });
  });

  test("the Changes tab opens on the latest run, not the cumulative range (OS-1882)", () => {
    const run = (name: string, createdAt: number) => ({
      _id: `message_${name}` as Id<"cliMessages">,
      role: "assistant" as const,
      status: "completed",
      cliType: "codex",
      createdAt,
      content: [],
      attachments: [],
      diffSummary: {
        preRef: `refs/pre-${name}`,
        postRef: `refs/post-${name}`,
        files: [],
        fileCount: 1,
        additions: 1,
        deletions: 0,
      },
    });
    useCliMessagesMock.mockReturnValue(
      buildCliMessagesResult({ messages: [run("old", 1), run("new", 2)] })
    );
    updateTitleMutationMock.mockResolvedValue("op_1");
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

    expect(screen.getByRole("button", { name: "Latest run" })).toBeDefined();
    expect(updateTitleMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "diffFile",
        preRef: "refs/pre-new",
        postRef: "refs/post-new",
      })
    );
  });

  test("a multi-repo thread's Changes tab shows one repo, switched in front of the view selector", () => {
    (defaultUseQueryResult as { paths: unknown[] }).paths = [
      { id: "path_1", path: "/code/acme", label: "acme" },
      { id: "r-new", path: "/code/acme/new-app", label: "new-app", kind: "repo", parentPathId: "path_1" },
      { id: "r-old", path: "/code/acme/old-app", label: "old-app", kind: "repo", parentPathId: "path_1" },
    ];
    const run = (name: string, createdAt: number, repo: string, pathId: string) => ({
      _id: `message_${name}` as Id<"cliMessages">,
      role: "assistant" as const,
      status: "completed",
      cliType: "codex",
      createdAt,
      content: [],
      attachments: [],
      diffSummary: {
        preRef: `refs/pre-${name}`,
        postRef: `refs/post-${name}`,
        files: [{ path: "a.ts", kind: "modified" as const, additions: 1, deletions: 0, repo }],
        fileCount: 1,
        additions: 1,
        deletions: 0,
        repos: [{ path: repo, pathId, fileCount: 1, additions: 1, deletions: 0 }],
      },
    });
    useCliMessagesMock.mockReturnValue(
      buildCliMessagesResult({ messages: [run("old", 1, "old-app", "r-old"), run("new", 2, "new-app", "r-new")] })
    );
    updateTitleMutationMock.mockResolvedValue("op_1");
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

    // The newest run's repo, and its latest run in that repo.
    expect(updateTitleMutationMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "diffFile", pathId: "r-new", preRef: "refs/pre-new", postRef: "refs/post-new" })
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Repository: new-app" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "old-app" }));
    expect(updateTitleMutationMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "diffFile", pathId: "r-old", preRef: "refs/pre-old", postRef: "refs/post-old" })
    );
  });

  test("opens and closes the in-flow thread sidebar from the header action", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", {
      name: "Open thread sidebar",
    }));

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    const headerActions = screen.getByTestId("thread-header-actions");
    expect(sidebar).toBeDefined();
    expect(
      screen.getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Latest run" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Open thread sidebar" })
    ).toBeNull();
    expect(
      within(headerActions).queryByRole("button", {
        name: "Close thread sidebar",
      })
    ).toBeNull();

    fireEvent.click(
      within(sidebar).getByRole("button", { name: "Close thread sidebar" })
    );

    expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open thread sidebar" })
    ).toBeDefined();
  });

  test("uses the shared overflow menu for thread actions on mobile", () => {
    renderWorkspace();

    const headerActions = screen.getByTestId("thread-header-actions");
    const mobileActions = getMobileThreadActions();
    const desktopActions = headerActions.querySelector(
      '[data-slot="desktop-thread-actions"]'
    );

    // The desktop action row carries its own `...` menu, so scope to the
    // mobile slot rather than the whole header.
    expect(
      within(mobileActions).getByRole("button", { name: "Thread actions" })
    ).toBeDefined();
    expect(mobileActions.classList.contains("md:hidden")).toBe(true);
    expect(desktopActions?.classList.contains("hidden")).toBe(true);
    expect(desktopActions?.classList.contains("md:flex")).toBe(true);
  });

  test("exposes the complete sidebar action set in the mobile overflow menu", async () => {
    renderWorkspace();

    fireEvent.pointerDown(
      within(getMobileThreadActions()).getByRole("button", {
        name: "Thread actions",
      }),
      { button: 0, ctrlKey: false }
    );

    for (const name of [
      "Rename",
      "Mark as read",
      "Mark as done",
      "Continue locally",
      "Pin",
      "Export to Markdown",
      "Delete",
    ]) {
      expect(await screen.findByRole("menuitem", { name })).toBeDefined();
    }
  });

  test("dropping a task on the composer attaches it by ref", () => {
    const setAttachedTask = vi.fn();
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({ setAttachedTask })
    );

    renderWorkspace();

    fireEvent.click(
      screen.getByRole("button", { name: "Drop task on composer" })
    );
    expect(setAttachedTask).toHaveBeenCalledWith("OS-9");
  });

  // OS-1660: the pane is one shared component now, so it must follow the active
  // panel — picking its branch from the task selection alone rendered task
  // details under the Tasks tab.
  test("Tasks tab shows the task list while a task is still selected", () => {
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({ detailsTask: SELECTED_TASK_FIXTURE, allTasks: [] })
    );

    renderWorkspace();
    // The selection reveals the pane on the task tab (OS-1663).
    expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));

    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    expect(screen.queryByTestId("thread-task-detail-sidebar")).toBeNull();
    // The task tab stays in the strip — its `task=<REF>` is untouched.
    expect(screen.getByRole("tab", { name: "OS-1" })).toBeDefined();
  });

  test("a run-bound thread gets a Workflow tab hosting the run panel", () => {
    const baseThread = (useCliThreadMock() as { thread: Record<string, unknown> }).thread;
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: { ...baseThread, workflowRunId: "run_1" },
    });
    const priorQueryImpl = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args !== "skip" && getFunctionName(query) === "workflows/runs/core:get") {
        return {
          _id: "run_1",
          workflowId: "wf_1",
          workflowName: "Release Train",
          status: "running",
          versionNumber: 1,
          startedAt: 1,
          lastActivityAt: 1,
          stages: [
            {
              stageId: "stage-1",
              name: "Plan",
              steps: [
                {
                  _id: "step_1",
                  definitionStepId: "s1",
                  laneId: "lane-1",
                  laneName: "Executor",
                  title: "Plan it",
                  type: "prompt",
                  status: "pending",
                },
              ],
            },
          ],
        };
      }
      return priorQueryImpl(query, args);
    });

    renderWorkspace();
    // The Run rail docks on the transcript before any tab opens (OS-1368).
    expect(screen.getByRole("complementary", { name: "Workflow run progress" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
    fireEvent.click(screen.getByRole("tab", { name: "Workflow" }));

    expect(screen.getByText("Cancel run")).toBeDefined();
    expect(screen.getByText("Plan it")).toBeDefined();
  });

  test("the Checks tab is listed before its files load, so the tabs don't shift (OS-2293)", () => {
    let evidence: unknown[] | undefined = undefined;
    const priorQueryImpl = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args !== "skip" && getFunctionName(query) === "cli/messages:listAgentAttachmentsByThread") {
        return evidence;
      }
      return priorQueryImpl(query, args);
    });

    const { rerender } = renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
    fireEvent.click(screen.getByRole("tab", { name: "Checks" }));

    evidence = [
      {
        messageId: "message_1",
        attachments: [{ storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 }],
      },
    ];
    rerender(workspaceElement());

    expect(screen.getByTestId("thread-message-attachments").textContent).toBe("shot.png");
  });

  test("opens the Tasks panel from the fixed tab", () => {
    const setTask = vi.fn();
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({ setTask })
    );

    renderWorkspace();

    fireEvent.click(
      screen.getByRole("button", { name: "Open thread sidebar" })
    );
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));

    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    expect(
      screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(threadTasksPanelRenderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        currentUserId: "user_1",
      })
    );

    const latestPanelProps = threadTasksPanelRenderMock.mock.calls.at(-1)?.[0] as {
      onOpenTask: (task: { refId: string; isArchived?: boolean }) => void;
    };
    latestPanelProps.onOpenTask({ refId: "OS-2", isArchived: true });

    expect(setTask).toHaveBeenCalledWith("OS-2", "archived");
  });

  // OS-1687: the new-thread pane records "task" as the panel pick whenever a task
  // is opened, but its own tab follows `task=<REF>` — so closing the task clears
  // the param and leaves the pick behind. A send hands that over, and the
  // workspace has no task tab to hold it: nothing is `aria-selected` in the
  // strip, and the pane falls to the task branch's placeholder — a sidebar stuck
  // on skeletons until the user closes and reopens it.
  test("a handed-over task panel with no task param rests on a real panel", () => {
    render(<ThreadWorkspaceHarness handedOverPanel="task" />);

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(
      within(sidebar).getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")
    ).toBe("true");
    // The panel body agrees with the highlight — placeholders are what the user
    // saw instead.
    expect(within(sidebar).getByText("No changes yet.")).toBeDefined();
  });

  test("a pull request panel pick on a thread without an Attached pull request rests on a real panel (OS-2193)", () => {
    render(<ThreadWorkspaceHarness handedOverPanel="pullRequest" />);

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(within(sidebar).getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")).toBe("true");
    expect(within(sidebar).getByText("No changes yet.")).toBeDefined();
  });

  test("the pull request tab keeps its reader across tab switches, so GitHub isn't re-read (OS-2193)", () => {
    const { thread } = useCliThreadMock.getMockImplementation()?.() ?? useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: { ...thread, attachedPullRequest: { owner: "acme", name: "web", number: 7, ref: "acme/web#7" } },
    });
    render(<ThreadWorkspaceHarness handedOverPanel="pullRequest" />);
    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(within(sidebar).getByText("Pull request reader")).toBeDefined();

    fireEvent.click(within(sidebar).getByRole("tab", { name: "Changes" }));
    expect(within(sidebar).getByText("No changes yet.")).toBeDefined();
    fireEvent.click(within(sidebar).getByRole("tab", { name: "#7" }));

    expect(within(sidebar).getByText("Pull request reader")).toBeDefined();
    expect(pullRequestReaderMounts).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["a workflow lane thread has no eye, since the server refuses it", { workflowRunId: "run_1" }, { canWatch: false, watchDisabledReason: undefined }],
    ["a Done thread's eye says how to watch", { isDone: true }, { canWatch: true, watchDisabledReason: "Mark this thread not done to watch its pull request" }],
    ["an open thread's eye is live", {}, { canWatch: true, watchDisabledReason: undefined }],
  ])("%s (OS-2541)", (_name, patch, expected) => {
    const { thread } = useCliThreadMock.getMockImplementation()?.() ?? useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: { ...thread, ...patch, attachedPullRequest: { owner: "acme", name: "web", number: 7, ref: "acme/web#7" } },
    });
    const priorQueryImpl = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) =>
      getFunctionName(query) === "workflows/runs/core:get" ? null : priorQueryImpl(query, args)
    );
    pullRequestReaderProps.mockClear();
    render(<ThreadWorkspaceHarness handedOverPanel="pullRequest" />);
    expect(pullRequestReaderProps).toHaveBeenLastCalledWith(expect.objectContaining(expected));
  });

  test("a watched pull request's tab says so to screen readers, not only with the eye (OS-2541)", () => {
    const { thread } = useCliThreadMock.getMockImplementation()?.() ?? useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: { ...thread, attachedPullRequest: { owner: "acme", name: "web", number: 7, ref: "acme/web#7" } },
    });
    const priorQueryImpl = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) =>
      args !== "skip" && getFunctionName(query) === "integrations/github/pullRequestWatches:getForThread"
        ? { startedAt: 1 }
        : priorQueryImpl(query, args)
    );
    render(<ThreadWorkspaceHarness handedOverPanel="pullRequest" />);
    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(within(sidebar).getByRole("tab", { name: "Watched #7" })).toBeDefined();
  });

  test("the header's pull request ref opens the sidebar on the pull request tab (OS-2405)", () => {
    const { thread } = useCliThreadMock.getMockImplementation()?.() ?? useCliThreadMock();
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: { ...thread, attachedPullRequest: { owner: "acme", name: "web", number: 7, ref: "acme/web#7" } },
    });
    renderWorkspace();
    expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Attached pull request acme/web#7" }));

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(within(sidebar).getByRole("tab", { name: "#7" }).getAttribute("aria-selected")).toBe("true");
    expect(within(sidebar).getByText("Pull request reader")).toBeDefined();
  });

  test("opens and toggles the Tasks panel from the T shortcut", () => {
    renderWorkspace();

    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });

    expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    expect(
      screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
    ).toBe("true");

    fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });

    expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
  });

  test("does not open the Tasks panel from the T shortcut while typing", () => {
    renderWorkspace();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
      expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
    } finally {
      input.remove();
    }
  });

  test("marks the thread done from the D shortcut", () => {
    renderWorkspace();
    updateTitleMutationMock.mockClear();

    fireEvent.keyDown(document, { key: THREAD_TOGGLE_DONE_HOTKEY });

    expect(updateTitleMutationMock).toHaveBeenCalledWith({ threadIds: ["thread_1"] });
  });

  test("does not mark the thread done from the D shortcut while typing", () => {
    renderWorkspace();
    updateTitleMutationMock.mockClear();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      fireEvent.keyDown(document, { key: THREAD_TOGGLE_DONE_HOTKEY });
      expect(updateTitleMutationMock).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  describe("R read/unread shortcut", () => {
    const markRead = vi.fn();
    const markUnread = vi.fn();
    const clearSuppressionIfMatches = vi.fn();
    const setSuppressedAutoReadThreadId = vi.fn();

    beforeEach(() => {
      markRead.mockReset().mockResolvedValue(undefined);
      markUnread.mockReset().mockResolvedValue(undefined);
      clearSuppressionIfMatches.mockReset();
      setSuppressedAutoReadThreadId.mockReset();
      useThreadReadStateMock.mockReturnValue({
        clearSuppressionIfMatches,
        setSuppressedAutoReadThreadId,
      });
      const original = useMutationMock.getMockImplementation()!;
      useMutationMock.mockImplementation((mutation) => {
        const name = getFunctionName(mutation);
        const mock = name === "cli/threads/core:markRead" ? markRead
          : name === "cli/threads/core:markUnread" ? markUnread : undefined;
        return mock ? Object.assign(mock, { withOptimisticUpdate: () => mock }) : original(mutation);
      });
    });

    test.each([
      { hasUnread: true, requiresAttention: false, status: "completed" },
      { hasUnread: false, requiresAttention: true, status: "failed" },
      { hasUnread: true, requiresAttention: false, status: "streaming" },
    ])("marks read for $status with unread=$hasUnread and attention=$requiresAttention", (state) => {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...useCliThreadMock().thread, ...state },
      });
      renderWorkspace();

      fireEvent.keyDown(document, { key: "r" });

      expect(markRead).toHaveBeenCalledWith({ threadId: "thread_1", acknowledgeAttention: state.requiresAttention });
      expect(clearSuppressionIfMatches).toHaveBeenCalledWith("thread_1");
      expect(markUnread).not.toHaveBeenCalled();
    });

    test("marks unread and suppresses auto-read before the mutation", () => {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...useCliThreadMock().thread, hasUnread: false },
      });
      markUnread.mockImplementation(() => {
        expect(setSuppressedAutoReadThreadId).toHaveBeenCalledWith("thread_1");
        return Promise.resolve();
      });
      renderWorkspace();

      fireEvent.keyDown(document, { key: "r" });

      expect(markUnread).toHaveBeenCalledWith({ threadId: "thread_1" });
      expect(markRead).not.toHaveBeenCalled();
    });

    test("rolls back suppression when marking unread fails", async () => {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...useCliThreadMock().thread, hasUnread: false },
      });
      markUnread.mockRejectedValue(new Error("Failed"));
      renderWorkspace();

      fireEvent.keyDown(document, { key: "r" });

      await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Failed to update read state"));
      expect(clearSuppressionIfMatches).toHaveBeenCalledWith("thread_1");
    });

    test.each(["input", "textarea", "select", "contenteditable"])("ignores focused %s", (tag) => {
      renderWorkspace();
      const editable = document.createElement(tag === "contenteditable" ? "div" : tag);
      if (tag === "contenteditable") {
        editable.contentEditable = "true";
        editable.setAttribute("contenteditable", "true");
        editable.tabIndex = 0;
      }
      document.body.appendChild(editable);
      editable.focus();
      try {
        fireEvent.keyDown(document, { key: "r" });
        expect(markRead).not.toHaveBeenCalled();
        expect(markUnread).not.toHaveBeenCalled();
      } finally {
        editable.remove();
      }
    });

    test.each(["viewer", "loading"])("does nothing for a %s thread", (state) => {
      useCliThreadMock.mockReturnValue({
        isLoading: state === "loading",
        thread: state === "loading" ? undefined : { ...useCliThreadMock().thread, isOwner: false },
      });
      renderWorkspace();

      fireEvent.keyDown(document, { key: "r" });

      expect(markRead).not.toHaveBeenCalled();
      expect(markUnread).not.toHaveBeenCalled();
    });
  });

  // OS-1396 full-width layout. Seeding the stored mode is enough: jsdom's
  // viewport is desktop-width, so the page starts in full view.
  describe("full-width layout", () => {
    beforeEach(() => {
      window.localStorage.setItem("convoy.thread-layout-mode", "full");
    });

    test("opens on the thread tab and keeps the thread actions in its own row", () => {
      renderWorkspace();

      const tabs = screen.getByTestId("thread-header-tabs");
      expect(
        within(tabs)
          .getByRole("tab", { name: "Existing thread" })
          .getAttribute("aria-selected")
      ).toBe("true");
      expect(within(tabs).getByRole("tab", { name: "Changes" })).toBeDefined();
      expect(within(tabs).getByRole("tab", { name: "Tasks" })).toBeDefined();
      // Split-view chrome is gone: no sidebar pane, no header action row.
      expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
      expect(
        screen
          .getByTestId("thread-header-actions")
          .querySelector('[data-slot="desktop-thread-actions"]')
      ).toBeNull();
      expect(getThreadColumn().hasAttribute("inert")).toBe(false);
      expect(
        within(getThreadColumn()).getByRole("button", { name: "Thread actions" })
      ).toBeDefined();
      expect(getThreadColumn().firstElementChild?.className).toContain("bg-card");
    });

    test("a panel tab covers the thread instead of unmounting it", () => {
      renderWorkspace();

      fireEvent.click(screen.getByRole("tab", { name: "Changes" }));

      expect(screen.getByRole("button", { name: "Latest run" })).toBeDefined();
      // Still mounted (scroll position survives), just inert behind the panel.
      const column = getThreadColumn();
      expect(column.hasAttribute("inert")).toBe(true);
      expect(
        within(column).getByRole("button", { name: "Thread actions" })
      ).toBeDefined();
    });

    test("the thread tab's pull request ref selects the pull request tab (OS-2405)", () => {
      const { thread } = useCliThreadMock.getMockImplementation()?.() ?? useCliThreadMock();
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...thread, attachedPullRequest: { owner: "acme", name: "web", number: 7, ref: "acme/web#7" } },
      });
      renderWorkspace();

      fireEvent.click(screen.getByRole("link", { name: "Attached pull request acme/web#7" }));

      expect(screen.getByRole("tab", { name: "#7" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Pull request reader")).toBeDefined();
    });

    test("the T shortcut swaps between Tasks and the thread", () => {
      renderWorkspace();

      fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
      expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
      expect(
        screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
      ).toBe("true");

      fireEvent.keyDown(document, { key: THREAD_TASKS_SIDEBAR_HOTKEY });
      expect(screen.queryByTestId("thread-tasks-panel")).toBeNull();
      expect(getThreadColumn().hasAttribute("inert")).toBe(false);
    });

    test("switching back to split from the thread opens the pane on Changes", () => {
      renderWorkspace();

      fireEvent.click(
        screen.getByRole("button", { name: "Switch to split view" })
      );

      expect(window.localStorage.getItem("convoy.thread-layout-mode")).toBe(
        "split"
      );
      expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
      // The panel tabs only live in the sidebar here, so it has to open.
      const sidebar = screen.getByTestId("thread-detail-sidebar");
      expect(
        within(sidebar)
          .getByRole("tab", { name: "Changes" })
          .getAttribute("aria-selected")
      ).toBe("true");
      expect(
        screen
          .getByTestId("thread-header-actions")
          .querySelector('[data-slot="desktop-thread-actions"]')
      ).not.toBeNull();
    });

    test("the layout toggle keeps keyboard focus across the switch (UX OS-2535 round 2 #2)", () => {
      renderWorkspace();
      const toggle = screen.getByRole("button", { name: "Switch to split view" });
      toggle.focus();

      fireEvent.click(toggle);

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Switch to full-width tabs" }));
    });

    test("switching to split from a panel keeps that panel on screen", () => {
      renderWorkspace();

      fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to split view" })
      );

      const sidebar = screen.getByTestId("thread-detail-sidebar");
      expect(
        within(sidebar)
          .getByRole("tab", { name: "Tasks" })
          .getAttribute("aria-selected")
      ).toBe("true");
      expect(within(sidebar).getByTestId("thread-tasks-panel")).toBeDefined();
    });
  });

  test("sidebar toggles do not rerender the conversation pane when thread data is unchanged", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_assistant_1" as Id<"cliMessages">,
          role: "assistant",
          status: "completed",
          cliType: "codex",
          createdAt: Date.now(),
          content: [],
          attachments: [],
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map([
        [
          "message_assistant_1",
          {
            parts: [{ type: "text", text: "Rendered assistant content" }],
            metadata: {},
            normalizedEvents: [],
            warnings: [],
          },
        ],
      ]),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(1);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
    fireEvent.click(
      within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
        name: "Close thread sidebar",
      })
    );

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(1);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(1);
  });

  test("unrelated chat refreshes do not rerender the conversation pane", () => {
    const messagesResult = buildCliMessagesResult({
      messages: [
        {
          _id: "message_assistant_1" as Id<"cliMessages">,
          role: "assistant",
          status: "completed",
          cliType: "codex",
          createdAt: Date.now(),
          content: [],
          attachments: [],
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map([
        [
          "message_assistant_1",
          {
            parts: [{ type: "text", text: "Rendered assistant content" }],
            metadata: {},
            normalizedEvents: [],
            warnings: [],
          },
        ],
      ]),
      latestContextWindow: null,
      latestUsageLimits: [],
    });
    const baseThread = {
      _id: "thread_1" as Id<"cliThreads">,
      projectId: "project_1" as Id<"projects">,
      profileId: "profile_1" as Id<"cliProfiles">,
      profileName: "Primary profile",
      pathId: "path_1",
      pathLabel: "project",
      pathString: "/tmp/project",
      cliType: "codex" as const,
      title: "Existing thread",
      status: "completed" as const,
      processingState: "idle" as const,
      hasPendingUserMessages: false,
    };

    useCliMessagesMock.mockReturnValue(messagesResult);
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: baseThread,
    });

    const view = renderWorkspace();

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(1);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(1);

    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        ...baseThread,
        title: "Renamed thread",
      },
    });

    view.rerender(workspaceElement());

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(1);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(1);
  });

  test("pane-relevant chat changes still rerender the conversation pane", () => {
    const messagesResult = buildCliMessagesResult({
      messages: [
        {
          _id: "message_assistant_1" as Id<"cliMessages">,
          role: "assistant",
          status: "completed",
          cliType: "codex",
          createdAt: Date.now(),
          content: [],
          attachments: [],
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map([
        [
          "message_assistant_1",
          {
            parts: [{ type: "text", text: "Rendered assistant content" }],
            metadata: {},
            normalizedEvents: [],
            warnings: [],
          },
        ],
      ]),
      latestContextWindow: null,
      latestUsageLimits: [],
    });
    const baseThread = {
      _id: "thread_1" as Id<"cliThreads">,
      projectId: "project_1" as Id<"projects">,
      profileId: "profile_1" as Id<"cliProfiles">,
      profileName: "Primary profile",
      pathId: "path_1",
      pathLabel: "project",
      pathString: "/tmp/project",
      cliType: "codex" as const,
      title: "Existing thread",
      status: "completed" as const,
      processingState: "idle" as const,
      hasPendingUserMessages: false,
    };

    useCliMessagesMock.mockReturnValue(messagesResult);
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: baseThread,
    });

    const view = renderWorkspace();

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(1);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(1);

    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        ...baseThread,
        cliType: "claude-code",
      },
    });

    view.rerender(workspaceElement());

    expect(detailThreadComposerRenderMock).toHaveBeenCalledTimes(2);
    expect(assistantCliMessageRenderMock).toHaveBeenCalledTimes(2);
  });

  test("thread message rows opt into layout containment", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_user_1" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "codex",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Contained row" }],
          attachments: [],
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    const { container } = renderWorkspace();
    const messageRow = container.querySelector("[data-thread-message-row]");

    expect(messageRow).not.toBeNull();
    expect(messageRow?.getAttribute("style")).toContain("content-visibility: auto");
    expect(messageRow?.getAttribute("style")).toContain("contain-intrinsic-size: 240px");
  });

  test("restores the remembered thread detail sidebar width from local storage", () => {
    window.localStorage.setItem("thread-detail-sidebar-width", "512");

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

    expect(
      screen.getByRole("separator", { name: "Resize thread detail sidebar" })
        .getAttribute("aria-valuenow")
    ).toBe("512");
  });

  test("falls back to the default width when the stored sidebar width is invalid", () => {
    window.localStorage.setItem("thread-detail-sidebar-width", "9999");

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

    expect(
      screen.getByRole("separator", { name: "Resize thread detail sidebar" })
        .getAttribute("aria-valuenow")
    ).toBe("400");
  });

  test("supports keyboard resize and persists the updated width", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

    const handle = screen.getByRole("separator", {
      name: "Resize thread detail sidebar",
    });

    expect(handle.getAttribute("aria-valuenow")).toBe("400");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });

    expect(handle.getAttribute("aria-valuenow")).toBe("416");
    expect(window.localStorage.getItem("thread-detail-sidebar-width")).toBe("416");
  });

  test("task details keep the tab header instead of the default shell header", () => {
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({ detailsTask: SELECTED_TASK_FIXTURE })
    );

    renderWorkspace();

    const sidebar = screen.getByTestId("thread-detail-sidebar");

    expect(
      within(sidebar).getByRole("button", { name: "Close thread sidebar" })
    ).toBeDefined();
    expect(
      within(sidebar).getByRole("tab", { name: "OS-1" }).getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();
  });

  // The mirror below is edge-triggered on the `task` param, and re-opening the
  // already-selected task builds an identical URL the navigation layer discards.
  // So revealing the pane is the opener's job, not the mirror's (OS-1663).
  test("re-opening the already-selected task reveals a manually collapsed sidebar", () => {
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
        isOwner: true,
        lastActivityAt: Date.now(),
        associatedTask: {
          _id: "task_1" as Id<"tasks">,
          refId: "OS-1",
          name: "Selected task",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        },
      },
    });
    useThreadWorkspaceTaskSidebarMock.mockImplementation((...args: unknown[]) =>
      createThreadWorkspaceState(
        { detailsTask: SELECTED_TASK_FIXTURE },
        args[0] as { onOpenTask?: () => void }
      )
    );

    render(workspaceElement());
    expect(screen.getByTestId("thread-detail-sidebar")).toBeDefined();

    // The task param deliberately survives a manual collapse.
    fireEvent.click(
      within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
        name: "Close thread sidebar",
      })
    );
    expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();

    // Clicking that same task again must bring the pane back.
    fireEvent.click(screen.getByRole("link", { name: /OS-1/i }));

    const sidebar = screen.getByTestId("thread-detail-sidebar");
    expect(
      within(sidebar).getByRole("tab", { name: "OS-1" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();
  });

  describe("closing the task tab", () => {
    // Opening a task writes `task=<REF>` and reveals the pane, as the real opener
    // does; closing the tab clears the param.
    function mockTaskOpener() {
      let taskParam: string | null = null;
      const setTask = vi.fn();
      useThreadWorkspaceTaskSidebarMock.mockImplementation((...args: unknown[]) => {
        const hookArgs = args[0] as { onOpenTask?: () => void };
        setTask.mockImplementation((refId: string | null) => {
          taskParam = refId;
          hookArgs.onOpenTask?.();
        });
        return createThreadWorkspaceState(
          {
            ...(taskParam ? { detailsTask: SELECTED_TASK_FIXTURE } : {}),
            closeTaskSidebar: vi.fn(() => {
              taskParam = null;
            }),
          },
          hookArgs
        );
      });
      return setTask;
    }

    test("closes a sidebar that was closed when the task opened", () => {
      const setTask = mockTaskOpener();
      const { rerender } = render(workspaceElement());

      act(() => setTask("OS-1"));
      expect(screen.getByTestId("thread-detail-sidebar")).toBeDefined();

      fireEvent.click(
        within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
          name: "Close OS-1 tab",
        })
      );
      rerender(workspaceElement());

      expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
    });

    test("keeps a sidebar that was open when the task opened, on its panel", () => {
      const setTask = mockTaskOpener();
      const { rerender } = render(workspaceElement());

      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      act(() => setTask("OS-1"));
      fireEvent.click(
        within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
          name: "Close OS-1 tab",
        })
      );
      rerender(workspaceElement());

      const sidebar = screen.getByTestId("thread-detail-sidebar");
      expect(
        within(sidebar).getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")
      ).toBe("true");
    });

    test("re-opening the task from a collapsed pane closes the pane again", () => {
      const setTask = mockTaskOpener();
      const { rerender } = render(workspaceElement());

      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      act(() => setTask("OS-1"));
      fireEvent.click(
        within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
          name: "Close thread sidebar",
        })
      );

      // Same task, so the param does not change; the click itself reveals the pane.
      act(() => setTask("OS-1"));
      fireEvent.click(
        within(screen.getByTestId("thread-detail-sidebar")).getByRole("button", {
          name: "Close OS-1 tab",
        })
      );
      rerender(workspaceElement());

      expect(screen.queryByTestId("thread-detail-sidebar")).toBeNull();
    });
  });

  describe("attached task tab (OS-2067)", () => {
    function mockThreadWithAttachedTask(threadId: string) {
      const { thread } = useCliThreadMock.getMockImplementation()?.() as {
        thread: Record<string, unknown>;
      };
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          ...thread,
          _id: threadId as Id<"cliThreads">,
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-1",
            name: "Selected task",
            taskType: SELECTED_TASK_FIXTURE.taskType,
            isArchived: false,
          },
        },
      });
    }

    // `setTask` writes `task=<REF>` like the real hook, so the tab appears.
    function mockTaskParamState() {
      let taskParam: string | null = null;
      const setTask = vi.fn();
      useThreadWorkspaceTaskSidebarMock.mockImplementation((...args: unknown[]) => {
        const hookArgs = args[0] as { onOpenTask?: () => void };
        setTask.mockImplementation((refId: string | null) => {
          taskParam = refId;
          hookArgs.onOpenTask?.();
        });
        return createThreadWorkspaceState(
          { ...(taskParam ? { detailsTask: SELECTED_TASK_FIXTURE } : {}), setTask },
          hookArgs
        );
      });
      return setTask;
    }

    test("opening the sidebar lands on the attached task's tab", () => {
      mockThreadWithAttachedTask("thread_1");
      const setTask = mockTaskParamState();
      renderWorkspace();

      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

      const sidebar = screen.getByTestId("thread-detail-sidebar");
      expect(
        within(sidebar).getByRole("tab", { name: "OS-1" }).getAttribute("aria-selected")
      ).toBe("true");
      expect(setTask).toHaveBeenCalledExactlyOnceWith("OS-1", "active", { history: "replace" });

      // Offered once per visit: reopening keeps whatever the user left.
      fireEvent.click(within(sidebar).getByRole("button", { name: "Close thread sidebar" }));
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      expect(setTask).toHaveBeenCalledTimes(1);
    });

    test("switching to a thread with an attached task while the sidebar is open shows that task", () => {
      const setTask = mockTaskParamState();
      const view = renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      expect(setTask).not.toHaveBeenCalled();

      useParamsMock.mockReturnValue({
        organizationSlug: "contoso",
        projectAlias: "OS",
        threadId: "thread_2",
      });
      mockThreadWithAttachedTask("thread_2");
      view.rerender(workspaceElement());

      expect(setTask).toHaveBeenCalledExactlyOnceWith("OS-1", "active", { history: "replace" });
      expect(
        within(screen.getByTestId("thread-detail-sidebar"))
          .getByRole("tab", { name: "OS-1" })
          .getAttribute("aria-selected")
      ).toBe("true");
    });

    function groupChildDoc(threadId: string) {
      const { thread } = useCliThreadMock.getMockImplementation()?.() as {
        thread: Record<string, unknown>;
      };
      return { ...thread, _id: threadId, parentThreadId: "container_1" };
    }

    test("a Group child's task tab shows before its own doc lands", () => {
      const loaded = { isLoading: false, thread: groupChildDoc("thread_1") };
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2" ? { isLoading: true, thread: null } : loaded
      );
      groupQueryResult = {
        children: [
          { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
          { _id: "thread_2", title: "Group child thread", lastActivityAt: 1, associatedTaskId: "task_7" },
        ],
        totalRowCount: 2,
      };
      taskSummariesQueryResult = [
        { _id: "task_7", refId: "OS-77", name: "Group child task", taskType: SELECTED_TASK_FIXTURE.taskType, isArchived: false },
      ];
      const setTask = mockTaskParamState();
      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", { name: "Group child thread" })
      );

      expect(setTask).toHaveBeenCalledExactlyOnceWith("OS-77", "active", { history: "replace" });
    });

    test("a run's Workflow tab holds through the container's redirect to a lane", () => {
      const container = {
        ...groupChildDoc("container_1"),
        parentThreadId: undefined,
        kind: "group",
        workflowRunId: "run_1",
        childCount: 1,
      };
      useCliThreadMock.mockImplementation((id: string) =>
        id === "container_1" ? { isLoading: false, thread: container } : { isLoading: true, thread: null }
      );
      groupQueryResult = {
        children: [{ _id: "thread_1", title: "Lane thread", lastActivityAt: 1 }],
        totalRowCount: 1,
      };
      useParamsMock.mockReturnValue({ organizationSlug: "contoso", projectAlias: "OS", threadId: "container_1" });
      const view = renderWorkspace();

      // The redirect lands on the lane while its own doc is still loading.
      useParamsMock.mockReturnValue({ organizationSlug: "contoso", projectAlias: "OS", threadId: "thread_1" });
      view.rerender(workspaceElement());
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

      expect(screen.getByRole("tab", { name: "Workflow" })).toBeDefined();
    });

    test("a lane opened through its container's redirect shows the run's task at once", () => {
      const container = {
        ...groupChildDoc("container_1"),
        parentThreadId: undefined,
        kind: "group",
        workflowRunId: "run_1",
        childCount: 1,
        associatedTask: {
          _id: "task_1",
          refId: "OS-1",
          name: "Selected task",
          taskType: SELECTED_TASK_FIXTURE.taskType,
          isArchived: false,
        },
      };
      useCliThreadMock.mockImplementation((id: string) =>
        id === "container_1" ? { isLoading: false, thread: container } : { isLoading: true, thread: null }
      );
      groupQueryResult = {
        children: [{ _id: "thread_1", title: "Lane thread", lastActivityAt: 1, associatedTaskId: "task_1" }],
        totalRowCount: 1,
      };
      // Neither the strip's task refs nor the lane's own doc have landed yet.
      taskSummariesQueryResult = undefined;
      const setTask = mockTaskParamState();
      useParamsMock.mockReturnValue({ organizationSlug: "contoso", projectAlias: "OS", threadId: "container_1" });
      const view = render(<ThreadWorkspaceHarness handedOverPanel="changes" />);

      useParamsMock.mockReturnValue({ organizationSlug: "contoso", projectAlias: "OS", threadId: "thread_1" });
      view.rerender(<ThreadWorkspaceHarness handedOverPanel="changes" />);

      expect(setTask).toHaveBeenCalledExactlyOnceWith("OS-1", "active", { history: "replace" });
    });

    test("a deep-linked task keeps its tab over the attached task", () => {
      mockThreadWithAttachedTask("thread_1");
      const setTask = vi.fn();
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ detailsTask: { ...SELECTED_TASK_FIXTURE, refId: "OS-7" }, setTask })
      );
      renderWorkspace();

      expect(screen.getByTestId("thread-detail-sidebar")).toBeDefined();
      expect(setTask).not.toHaveBeenCalled();
    });
  });

  describe("artifact tab (OS-1569)", () => {
    /** One rendered assistant message, so the transcript exposes its props. */
    function withOneAssistantMessage() {
      useCliMessagesMock.mockReturnValue(
        buildCliMessagesResult({
          messages: [
            {
              _id: "message_assistant_1" as Id<"cliMessages">,
              role: "assistant",
              status: "completed",
              cliType: "codex",
              createdAt: Date.now(),
              content: [],
              attachments: [],
            },
          ],
          isLoading: false,
          isLoadingOlderChunks: false,
          loadOlderChunks: loadOlderChunksMock,
          sendMessage: sendMessageMock,
          retryMessage: retryMessageMock,
          cancelProcessing: cancelProcessingMock,
          assistantRenderById: new Map([
            [
              "message_assistant_1",
              {
                parts: [{ type: "text", text: "Wrote the plan" }],
                metadata: {},
                normalizedEvents: [],
                warnings: [],
              },
            ],
          ]),
          latestContextWindow: null,
          latestUsageLimits: [],
        })
      );
    }

    function getOpenArtifactHandler() {
      const props = assistantCliMessageRenderMock.mock.calls.at(-1)?.[0] as
        | { onOpenArtifact?: (artifactId: string) => void }
        | undefined;
      if (!props?.onOpenArtifact) {
        throw new Error("the transcript received no onOpenArtifact handler");
      }
      return props.onOpenArtifact;
    }

    test("opens the artifact panel in its own tab, labelled with the artifact name", () => {
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );

      renderWorkspace();

      const sidebar = screen.getByTestId("thread-detail-sidebar");
      expect(
        within(sidebar)
          .getByRole("tab", { name: "Implementation Plan" })
          .getAttribute("aria-selected")
      ).toBe("true");
      expect(screen.getByTestId("thread-artifact-panel").textContent).toBe(
        "artifact_1"
      );
      // Owning-task context reaches the panel, so comments can hand off.
      expect(taskArtifactPanelRenderMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          compact: true,
          disabled: false,
          taskRefId: "OS-7",
          taskId: "task_1",
        })
      );
    });

    test("falls back to a generic label until the artifact resolves", () => {
      threadArtifactQueryResult = undefined;
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );

      renderWorkspace();

      expect(screen.getByRole("tab", { name: "Artifact" })).toBeDefined();
    });

    test("stays read-only until the owning task resolves", () => {
      threadArtifactOwningTaskResult = { task: undefined, isReadOnly: undefined };
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );

      renderWorkspace();

      expect(taskArtifactPanelRenderMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ disabled: true })
      );
    });

    test("closing the tab clears the param and returns to the prior panel", () => {
      const closeThreadArtifact = vi.fn();
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          threadArtifactId: "artifact_1",
          closeThreadArtifact,
        })
      );

      const { rerender } = render(workspaceElement());

      fireEvent.click(
        screen.getByRole("button", { name: "Close Implementation Plan tab" })
      );
      expect(closeThreadArtifact).toHaveBeenCalledTimes(1);

      // The param clearing is what actually closes the tab.
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: null })
      );
      rerender(workspaceElement());

      expect(screen.queryByTestId("thread-artifact-panel")).toBeNull();
      expect(
        screen.getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")
      ).toBe("true");
    });

    // Two independent mirrors used to race: this one fired on first paint, the
    // task one waited for `getByRefs`, so the task tab stole the selection a
    // round trip later with no user input.
    test("a deep link with both params keeps the artifact tab when the task resolves", () => {
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          threadArtifactId: "artifact_1",
          taskRefId: "OS-1",
          detailsTask: undefined,
        })
      );

      const { rerender } = render(workspaceElement());

      expect(
        screen
          .getByRole("tab", { name: "Implementation Plan" })
          .getAttribute("aria-selected")
      ).toBe("true");

      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          threadArtifactId: "artifact_1",
          detailsTask: SELECTED_TASK_FIXTURE,
        })
      );
      rerender(workspaceElement());

      expect(
        screen
          .getByRole("tab", { name: "Implementation Plan" })
          .getAttribute("aria-selected")
      ).toBe("true");
      expect(screen.getByTestId("thread-artifact-panel")).toBeDefined();
    });

    test("closing both conditional tabs lands on a tab that still exists", () => {
      // task open, then artifact opened on top of it
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ detailsTask: SELECTED_TASK_FIXTURE })
      );
      const { rerender } = render(workspaceElement());
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          detailsTask: SELECTED_TASK_FIXTURE,
          threadArtifactId: "artifact_1",
        })
      );
      rerender(workspaceElement());

      // task tab closed while the artifact is active, then the artifact too
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );
      rerender(workspaceElement());
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({})
      );
      rerender(workspaceElement());

      expect(
        screen.getByRole("tab", { name: "Changes" }).getAttribute("aria-selected")
      ).toBe("true");
    });

    test("closing the artifact tab falls back to a still-open task tab", () => {
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          detailsTask: SELECTED_TASK_FIXTURE,
          threadArtifactId: "artifact_1",
        })
      );
      const { rerender } = render(workspaceElement());

      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ detailsTask: SELECTED_TASK_FIXTURE })
      );
      rerender(workspaceElement());

      expect(
        screen.getByRole("tab", { name: "OS-1" }).getAttribute("aria-selected")
      ).toBe("true");
      expect(screen.getByTestId("thread-task-detail-sidebar")).toBeDefined();
    });

    // A push would let Back return to the invalid entry, which re-corrects and
    // re-pushes — trapping Back on it.
    test("clears an invalid artifact id with replace, not push", () => {
      const closeThreadArtifact = vi.fn();
      threadArtifactQueryResult = null;
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({
          threadArtifactId: "artifact_bogus",
          closeThreadArtifact,
        })
      );

      renderWorkspace();

      const props = taskArtifactPanelRenderMock.mock.calls.at(-1)?.[0] as {
        onInvalidSelection: () => void;
        onClose: () => void;
      };
      props.onInvalidSelection();
      expect(closeThreadArtifact).toHaveBeenLastCalledWith({
        history: "replace",
      });

      // The user-initiated close still pushes.
      props.onClose();
      expect(closeThreadArtifact).toHaveBeenLastCalledWith();
    });

    test("re-opening an already-open artifact brings its tab forward", () => {
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );
      withOneAssistantMessage();

      renderWorkspace();

      // The user switches away; the tab stays in the strip, unselected.
      fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
      expect(
        screen
          .getByRole("tab", { name: "Implementation Plan" })
          .getAttribute("aria-selected")
      ).toBe("false");

      // Clicking the same link again builds an identical URL, so the param
      // never changes and the mirror never fires — the opener must do it.
      act(() => getOpenArtifactHandler()("artifact_1"));

      expect(
        screen
          .getByRole("tab", { name: "Implementation Plan" })
          .getAttribute("aria-selected")
      ).toBe("true");
    });

    test("hands the transcript the opener that pushes threadArtifact", () => {
      const selectThreadArtifact = vi.fn();
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ selectThreadArtifact })
      );
      withOneAssistantMessage();

      renderWorkspace();

      getOpenArtifactHandler()("artifact_9");

      expect(selectThreadArtifact).toHaveBeenCalledWith("artifact_9");
    });

  });

  test("failed Claude messages hide failed actions after Continue is clicked", async () => {
    const deferred = createDeferred<void>();
    sendMessageMock.mockReturnValue(deferred.promise);

    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "claude-code",
        title: "Existing thread",
        status: "failed",
        processingState: "idle",
        hasPendingUserMessages: false,
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_failed_1" as Id<"cliMessages">,
          role: "assistant",
          status: "failed",
          cliType: "claude-code",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Partial response" }],
          attachments: [],
          errorMessage: "Claude failed",
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    await vi.waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("thread_1", {
        content: "continue",
        cliMode: "auto",
        cliModel: "default",
        cliEffort: "default",
      });
    });
    expect(retryMessageMock).not.toHaveBeenCalled();

    deferred.resolve(undefined);
    await deferred.promise;
  });

  test("retry requires confirmation before requeueing a failed assistant message", async () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_failed_1" as Id<"cliMessages">,
          role: "assistant",
          status: "failed",
          cliType: "claude-code",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Partial response" }],
          attachments: [],
          errorMessage: "Claude failed",
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retryMessageMock).not.toHaveBeenCalled();
    expect(screen.getByText("Retry this run?")).toBeDefined();
    expect(screen.getByText(/run your last message again/i)).toBeDefined();

    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Retry",
      })
    );

    await vi.waitFor(() => {
      expect(retryMessageMock).toHaveBeenCalledWith("message_failed_1");
    });
  });

  test("retry failure keeps the confirmation dialog open and shows a toast", async () => {
    retryMessageMock.mockRejectedValue(new Error("Retry failed"));
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_failed_1" as Id<"cliMessages">,
          role: "assistant",
          status: "failed",
          cliType: "claude-code",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Partial response" }],
          attachments: [],
          errorMessage: "Claude failed",
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Retry",
      })
    );

    await vi.waitFor(() => {
      expect(retryMessageMock).toHaveBeenCalledWith("message_failed_1");
      expect(toastErrorMock).toHaveBeenCalledWith("Retry failed");
    });

    expect(screen.getByText("Retry this run?")).toBeDefined();
  });

  test("failed-message actions are hidden once newer messages exist", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_failed_1" as Id<"cliMessages">,
          role: "assistant",
          status: "failed",
          cliType: "claude-code",
          createdAt: Date.now() - 1000,
          content: [{ type: "text", data: "Partial response" }],
          attachments: [],
          errorMessage: "Claude failed",
        },
        {
          _id: "message_user_2" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "claude-code",
          createdAt: Date.now(),
          content: [{ type: "text", data: "continue" }],
          attachments: [],
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("renders task links in the header and before message attachments", () => {
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
        associatedTask: {
          _id: "task_2" as Id<"tasks">,
          refId: "OS-99",
          name: "Header task",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        },
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_1" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "codex",
          cliMode: "plan",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Need this linked" }],
          attachments: [
            {
              storageId: "storage_1",
              fileName: "notes.txt",
              fileSize: 128,
              contentType: "text/plain",
              uploadedAt: Date.now(),
              url: "https://example.test/notes.txt",
            },
          ],
          task: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
    }));

    renderWorkspace();

    expect(
      screen.getByRole("link", { name: /OS-99/i }).getAttribute("href")
    ).toBe("/o/contoso/OS/threads/thread_1?task=OS-99");

    const taskLink = screen.getByRole("link", { name: /OS-42.*Fix login/i });
    const attachments = screen.getByTestId("thread-message-attachments");

    expect(taskLink.getAttribute("href")).toBe(
      "/o/contoso/OS/threads/thread_1?task=OS-42"
    );
    // Verify task link appears before attachments in DOM order.
    expect(
      taskLink.compareDocumentPosition(attachments) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0);
  });

  test("thread task links update the sidebar in place on normal clicks", () => {
    const setTask = vi.fn();
    useThreadWorkspaceTaskSidebarMock.mockReturnValue(
      createThreadWorkspaceState({ setTask })
    );
    useCliThreadMock.mockReturnValue({
      isLoading: false,
      thread: {
        _id: "thread_1" as Id<"cliThreads">,
        projectId: "project_1" as Id<"projects">,
        profileId: "profile_1" as Id<"cliProfiles">,
        profileName: "Primary profile",
        pathId: "path_1",
        pathLabel: "project",
        pathString: "/tmp/project",
        cliType: "codex",
        title: "Existing thread",
        status: "completed",
        processingState: "idle",
        hasPendingUserMessages: false,
        associatedTask: {
          _id: "task_2" as Id<"tasks">,
          refId: "OS-99",
          name: "Header task",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        },
      },
    });
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_1" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "codex",
          cliMode: "plan",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Need this linked" }],
          attachments: [],
          task: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
        },
      ],
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    fireEvent.click(screen.getByRole("link", { name: /OS-99/i }));
    fireEvent.click(screen.getByRole("link", { name: /OS-42.*Fix login/i }));

    expect(setTask).toHaveBeenNthCalledWith(1, "OS-99", "active");
    expect(setTask).toHaveBeenNthCalledWith(2, "OS-42", "active");
  });

  test("uses the generic 'show more' cut when the backend has older chunk pages", () => {
    useCliMessagesMock.mockReturnValue(
      buildCliMessagesResultWithHiddenOlderEnvelope()
    );

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /^show more$/i }));

    expect(loadOlderChunksMock).toHaveBeenCalledTimes(1);
  });

  test("shows a local 'show more messages' cut when only the render budget is hiding loaded messages", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: Array.from({ length: 101 }, (_, index) => ({
        _id: `message_${index + 1}` as Id<"cliMessages">,
        role: "user",
        status: "completed",
        cliType: "codex",
        cliMode: "plan",
        createdAt: Date.now() + index,
        content: [{ type: "text", data: `Message ${index + 1}` }],
        attachments: [],
      })),
      isLoading: false,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(
      screen.getByRole("button", { name: /show more messages/i })
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /show older messages/i })).toBeNull();
  });

  test("shows a generic 'show more' cut when only older chunks remain for the earliest message", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_1" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "codex",
          cliMode: "plan",
          createdAt: Date.now(),
          content: [],
          attachments: [
            {
              fileName: "spec.md",
              storageId: "storage_1",
              fileSize: 42,
              contentType: "text/markdown",
            },
          ],
        },
      ],
      isLoading: false,
      hasOlderChunks: true,
      isLoadingOlderChunks: false,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(screen.getByRole("button", { name: /^show more$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /show more messages/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /show older messages/i })).toBeNull();
  });

  test("shows the skeleton immediately after clicking the history cut", () => {
    useCliMessagesMock.mockReturnValue(
      buildCliMessagesResultWithHiddenOlderEnvelope()
    );

    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /^show more$/i }));

    expect(screen.getByTestId("older-messages-skeleton")).toBeDefined();
    expect(screen.getByTestId("older-messages-skeleton-row")).toBeDefined();
  });

  test("replaces the older-messages cut with a skeleton while loading", () => {
    useCliMessagesMock.mockReturnValue(buildCliMessagesResult({
      messages: [
        {
          _id: "message_1" as Id<"cliMessages">,
          role: "user",
          status: "completed",
          cliType: "codex",
          cliMode: "plan",
          createdAt: Date.now(),
          content: [{ type: "text", data: "Latest only" }],
          attachments: [],
        },
      ],
      isLoading: false,
      hasOlderChunks: true,
      isLoadingOlderChunks: true,
      loadOlderChunks: loadOlderChunksMock,
      sendMessage: sendMessageMock,
      retryMessage: retryMessageMock,
      cancelProcessing: cancelProcessingMock,
      assistantRenderById: new Map(),
      latestContextWindow: null,
      latestUsageLimits: [],
    }));

    renderWorkspace();

    expect(screen.getByTestId("older-messages-skeleton")).toBeDefined();
    expect(screen.getByTestId("older-messages-skeleton-row")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /^show more$/i })
    ).toBeNull();
  });

  describe("group tabs (OS-1477)", () => {
    function useGroupChildThread(totalRowCount = 2) {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          _id: "thread_1" as Id<"cliThreads">,
          projectId: "project_1" as Id<"projects">,
          profileId: "profile_1" as Id<"cliProfiles">,
          profileName: "Primary profile",
          pathId: "path_1",
          pathLabel: "project",
          pathString: "/tmp/project",
          cliType: "codex",
          title: "Existing thread",
          status: "completed",
          processingState: "idle",
          hasPendingUserMessages: false,
          hasUnread: true,
          requiresAttention: false,
          isDone: false,
          isPinned: false,
          lastActivityAt: Date.now(),
          parentThreadId: "container_1" as Id<"cliThreads">,
        },
      });
      groupQueryResult = {
        children: [
          { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
          { _id: "thread_2", title: "Group child thread", lastActivityAt: 1 },
        ],
        totalRowCount,
      };
    }

    test("renders one tab per group child and navigates on tab click", () => {
      useGroupChildThread();

      const view = renderWorkspace();

      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();

      fireEvent.click(within(tabs).getByRole("tab", { name: "Group child thread" }));
      expect(routerPushMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/contoso/OS/threads/thread_2"),
        expect.anything()
      );

      // The label button is content-sized — the padding and the task ref
      // beside it must select the tab too. Remount first: the tab click made
      // thread_2 the optimistically active tab (OS-1558) and the mocked
      // router never commits the URL, so re-clicking it is a no-op.
      view.unmount();
      routerPushMock.mockClear();
      renderWorkspace();
      const remountedTabs = screen.getByTestId("thread-header-tabs");
      fireEvent.click(
        within(remountedTabs).getByRole("tab", { name: "Group child thread" })
          .parentElement!
      );
      expect(routerPushMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/contoso/OS/threads/thread_2"),
        expect.anything()
      );
    });

    test("switching tabs keeps the workspace and reloads only the transcript", () => {
      // OS-1558: the tab click swaps the active thread optimistically, so the
      // incoming Group child's messages start loading before the route commits
      // and the strip/header keep rendering from the group's child row.
      useGroupChildThread();
      const loaded = useCliThreadMock();
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2" ? { isLoading: true, thread: null } : loaded
      );

      renderWorkspace();
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
      expect(within(tabs).getByRole("tab", { name: "Group child thread" })).toBeDefined();
      // The incoming tab's title comes from the group child, so the header is
      // right before that thread's own `get` lands.
      expect(document.title).toBe("Group child thread · Convoy");
      // Messages are fetched in parallel with the thread doc, not behind it.
      // `canWrite` is false only because ownership is unknown until that doc
      // lands — the legacy backfill is deferred a render, never skipped.
      expect(useCliMessagesMock).toHaveBeenCalledWith("thread_2", {
        canWrite: false,
      });
      // Only the transcript reloads.
      expect(screen.queryByRole("button", { name: "Composer submit" })).toBeNull();
      // The header actions hold their place (inert until the row lands) rather
      // than blinking out and back.
      const actions = document.querySelector("[data-slot='desktop-thread-actions']")!;
      expect(within(actions as HTMLElement).getByRole("button", { name: "Thread actions" })).toBeDefined();
      expect(actions.querySelector("[inert]")).not.toBeNull();
      // The mobile menu has nothing to make it inert, so it drops out instead:
      // its toggles read the rendered row but mutate the active thread.
      expect(
        document.querySelector("[data-slot='mobile-thread-actions']")?.children
      ).toHaveLength(0);
    });

    test("keeps the Group child draft mounted across a tab switch", () => {
      // OS-1558: unmounting it would drop the draft's uploaded attachments.
      useGroupChildThread();
      const loaded = useCliThreadMock();

      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2" ? { isLoading: true, thread: null } : loaded
      );
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      // Hidden (the Group child's tab is active now), but still mounted — the
      // transcript is a skeleton here, so this empty state is the draft's.
      expect(screen.getByTestId("conversation-empty-state")).toBeDefined();
    });

    test("switching tabs leaves the split pane's panel alone", () => {
      // OS-1558: split view has its own thread column, so a tab click must not
      // send the pane back to Changes.
      useGroupChildThread();

      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      expect(screen.getByTestId("thread-tasks-panel")).toBeDefined();
    });

    function useRunQuery() {
      const prior = useQueryMock.getMockImplementation()!;
      useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
        if (args !== "skip" && getFunctionName(query) === "workflows/runs/core:get") {
          return { _id: "run_1", workflowName: "Release Train", status: "running", stages: [], versionNumber: 1 };
        }
        return prior(query, args);
      });
    }

    test.each([
      { sourceKind: "group", outcome: "ready", layout: "split" },
      { sourceKind: "standalone", outcome: "ready", layout: "split" },
      { sourceKind: "group", outcome: "ready", layout: "full" },
      { sourceKind: "standalone", outcome: "ready", layout: "full" },
      { sourceKind: "group", outcome: "canceled", layout: "split" },
      { sourceKind: "standalone", outcome: "needs_attention", layout: "full" },
      { sourceKind: "group", outcome: "waiting", layout: "full" },
      { sourceKind: "standalone", outcome: "select-original", layout: "split" },
      { sourceKind: "group", outcome: "close-draft", layout: "split" },
    ])("workflow handoff: $sourceKind / $outcome / $layout", async ({ sourceKind, outcome, layout }) => {
      if (layout === "full") window.localStorage.setItem("convoy.thread-layout-mode", "full");
      if (sourceKind === "group") useGroupChildThread();
      const source = useCliThreadMock();
      let started = false;
      let containerLoaded = false;
      let workflowThreadCreated = false;
      let runStatus = "running";
      let stepStatus = "running";
      createdThreadEnvelopesResult = undefined;
      useCliThreadMock.mockImplementation((id: string) => {
        if (id === "container_1") return containerLoaded
          ? { isLoading: false, thread: { ...source.thread, _id: id, kind: "group", workflowRunId: "run_1", childCount: 1 } }
          : { isLoading: true, thread: null };
        if (id === "thread_new") return { isLoading: false, thread: { ...source.thread, _id: id, title: "Workflow thread", parentThreadId: "container_1", containerKind: "group", workflowRunId: "run_1" } };
        return { ...source, thread: started
          ? { ...source.thread, parentThreadId: "container_1", containerKind: "group", containerWorkflowRunId: "run_1" }
          : source.thread };
      });
      useRunQuery();
      const prior = useQueryMock.getMockImplementation()!;
      useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
        if (args !== "skip" && getFunctionName(query) === "workflows/runs/core:get") return {
          _id: "run_1", workflowName: "Review", status: runStatus, versionNumber: 1,
          stages: [{ stageId: "stage", name: "Review", steps: [{ _id: "step_1", definitionStepId: "step", laneId: "lane", laneName: "Review", title: "Review", type: "prompt", status: stepStatus, threadId: workflowThreadCreated ? "thread_new" : undefined }] }],
        };
        if (args !== "skip" && getFunctionName(query) === "workflows/core:get") return {
          _id: "workflow_1", name: "Review", draftDefinition: {
            lanes: [{ laneId: "lane", name: "Review", type: "single", defaults: { cliType: "claude-code" } }],
            stages: [{ stageId: "stage", name: "Review", steps: [{ stepId: "step", laneId: "lane", action: { type: "prompt", content: { displayContent: "Review changes" } } }] }],
          },
        };
        return prior(query, args);
      });
      updateTitleMutationMock.mockImplementation(async () => {
        started = true;
        if (sourceKind === "standalone") groupQueryResult = undefined;
        return { runId: "run_1", containerThreadId: "container_1" };
      });
      const view = renderWorkspace();
      if (layout === "split") fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
      const header = screen.getByTestId("thread-header");
      const threadTabs = screen.getByTestId("thread-header-tabs");
      const changesTab = screen.getByRole("tab", { name: "Changes" });
      const tasksTab = screen.getByRole("tab", { name: "Tasks" });
      const composerProps = detailThreadComposerRenderMock.mock.calls.at(-1)![0] as React.ComponentProps<typeof import("@/components/blocks/thread/thread-composer").ThreadComposer>;
      const selector = composerProps.workflowSelector;
      if (!isValidElement<{ onChange: (value: { _id: Id<"workflows">; name: string }) => void }>(selector)) throw new Error("Missing workflow selector");
      await act(async () => { selector.props.onChange({ _id: "workflow_1" as Id<"workflows">, name: "Review" }); });
      const draft = document.querySelector<HTMLElement>('[data-slot="add-to-group-draft"]')!;
      fireEvent.click(within(draft).getByRole("button", { name: "Composer submit" }));
      await vi.waitFor(() => expect(updateTitleMutationMock).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "workflow_1" })));
      await act(async () => {});
      expect(header.isConnected).toBe(true);
      expect(screen.getByTestId("thread-header")).toBe(header);
      expect(screen.getByTestId("thread-header-tabs")).toBe(threadTabs);
      expect(screen.getByRole("tab", { name: "Changes" })).toBe(changesTab);
      expect(screen.getByRole("tab", { name: "Tasks" })).toBe(tasksTab);
      expect(routerPushMock).not.toHaveBeenCalled();
      containerLoaded = true;
      groupQueryResult = {
        children: [{ _id: "thread_1", title: "Existing thread", lastActivityAt: 2 }],
        totalRowCount: 1,
      };
      view.rerender(workspaceElement());
      expect(screen.getByTestId("thread-header")).toBe(header);
      expect(screen.getByTestId("thread-header-tabs")).toBe(threadTabs);
      expect(screen.getByRole("tab", { name: "Changes" })).toBe(changesTab);
      expect(screen.getByRole("tab", { name: "Tasks" })).toBe(tasksTab);
      expect(document.querySelector('[data-slot="add-to-group-draft"]')).toBe(draft);
      expect(within(threadTabs).getByRole("tab", { name: "New thread" }).getAttribute("aria-selected")).toBe("true");
      expect(routerPushMock).not.toHaveBeenCalled();

      if (["canceled", "needs_attention", "waiting"].includes(outcome)) {
        if (outcome === "waiting") stepStatus = "waiting";
        else runStatus = outcome;
        view.rerender(workspaceElement());
        await vi.waitFor(() => expect(document.querySelector('[data-slot="add-to-group-draft"]')).toBeNull());
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(screen.getByRole("tab", { name: "Workflow" }).getAttribute("aria-selected")).toBe("true");
        expect(screen.getByTestId("thread-header")).toBe(header);
        return;
      }
      const abandoned = outcome === "select-original" || outcome === "close-draft";
      if (outcome === "select-original") fireEvent.click(within(threadTabs).getByRole("tab", { name: "Existing thread" }));
      if (outcome === "close-draft") fireEvent.click(within(threadTabs).getByRole("button", { name: "Close New thread tab" }));

      workflowThreadCreated = true;
      groupQueryResult = {
        children: [
          { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
          { _id: "thread_new", title: "Workflow thread", lastActivityAt: 3 },
        ],
        totalRowCount: 2,
      };
      view.rerender(workspaceElement());
      expect(document.querySelector('[data-slot="add-to-group-draft"]')).toBe(abandoned ? null : draft);
      if (!abandoned) expect(within(threadTabs).queryByRole("tab", { name: "Workflow thread" })).toBeNull();
      expect(routerPushMock).not.toHaveBeenCalled();

      createdThreadEnvelopesResult = [];
      view.rerender(workspaceElement());
      if (abandoned) {
        await act(async () => {});
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(within(threadTabs).getByRole("tab", { name: "Existing thread" }).getAttribute("aria-selected")).toBe("true");
        return;
      }
      await vi.waitFor(() => expect(routerPushMock).toHaveBeenCalledWith(expect.stringContaining("/threads/thread_new"), expect.anything()));
      expect(routerPushMock).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[data-slot="add-to-group-draft"]')).toBeNull();
      expect(within(threadTabs).getByRole("tab", { name: "Workflow thread" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("thread-header")).toBe(header);
      expect(screen.getByTestId("thread-header-tabs")).toBe(threadTabs);
      expect(screen.getByRole("tab", { name: "Changes" })).toBe(changesTab);
      expect(screen.getByRole("tab", { name: "Tasks" })).toBe(tasksTab);
      if (layout === "split") expect(screen.getByText("Cancel run")).toBeDefined();
    });

    test.each([true, false])("keeps the Workflow panel across mixed tabs, starting manual=%s", (startManual) => {
      useGroupChildThread();
      useRunQuery();
      const base = useCliThreadMock().thread;
      let loading = true;
      useCliThreadMock.mockImplementation((id: string) => id === "thread_2" && loading
        ? { isLoading: true, thread: null }
        : { isLoading: false, thread: {
          ...base, _id: id, containerWorkflowRunId: "run_1",
          workflowRunId: (id === "thread_1" ? !startManual : startManual) ? "run_1" : undefined,
        } });
      const view = renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      fireEvent.click(screen.getByRole("tab", { name: "Workflow" }));
      expect(screen.queryByRole("complementary", { name: "Workflow run progress" }) !== null).toBe(!startManual);
      fireEvent.click(within(screen.getByTestId("thread-header-tabs")).getByRole("tab", { name: "Group child thread" }));
      expect(screen.getByRole("tab", { name: "Workflow" })).toBeDefined();
      expect(screen.getByText("Cancel run")).toBeDefined();
      loading = false;
      view.rerender(workspaceElement());
      expect(screen.getByRole("tab", { name: "Workflow" })).toBeDefined();
      expect(screen.getByText("Cancel run")).toBeDefined();
      expect(screen.queryByRole("complementary", { name: "Workflow run progress" }) !== null).toBe(startManual);
    });

    test.each([false, true])("removal from a workflow container depends on the thread's run binding, lane=%s", async (lane) => {
      useGroupChildThread();
      useRunQuery();
      useCliThreadMock.mockReturnValue({ isLoading: false, thread: {
        ...useCliThreadMock().thread, containerWorkflowRunId: "run_1", workflowRunId: lane ? "run_1" : undefined,
      } });
      renderWorkspace();
      fireEvent.pointerDown(within(getMobileThreadActions()).getByRole("button", { name: "Thread actions" }), { button: 0, ctrlKey: false });
      await screen.findByRole("menuitem", { name: "Delete" });
      expect(screen.queryByRole("menuitem", { name: "Remove thread from group" }) !== null).toBe(!lane);
    });

    test("an empty workflow container opens a manual composer that survives a lane arriving", async () => {
      useGroupChildThread();
      useRunQuery();
      const container = { ...useCliThreadMock().thread, parentThreadId: undefined, kind: "group", workflowRunId: "run_1", childCount: 0 };
      useCliThreadMock.mockReturnValue({ isLoading: false, thread: container });
      groupQueryResult = { children: [], totalRowCount: 0 };
      const view = renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
      expect(screen.getByRole("button", { name: "Composer submit" })).toBeDefined();
      useCliThreadMock.mockReturnValue({ isLoading: false, thread: { ...container, childCount: 1 } });
      view.rerender(workspaceElement());
      createdThreadEnvelopesResult = undefined;
      updateTitleMutationMock.mockResolvedValue({ threadId: "thread_new", containerId: "thread_1" });
      fireEvent.click(screen.getByRole("button", { name: "Composer submit" }));
      await vi.waitFor(() => expect(updateTitleMutationMock).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "thread_1" })));
    });

    test("an empty-container draft does not carry over to a different run", () => {
      useGroupChildThread();
      useRunQuery();
      const container = { ...useCliThreadMock().thread, parentThreadId: undefined, kind: "group", workflowRunId: "run_1", childCount: 0 };
      useCliThreadMock.mockReturnValue({ isLoading: false, thread: container });
      groupQueryResult = { children: [], totalRowCount: 0 };
      const view = renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
      expect(screen.getByRole("button", { name: "Composer submit" })).toBeDefined();
      useCliThreadMock.mockReturnValue({ isLoading: false, thread: { ...container, _id: "container_other", workflowRunId: "run_other" } });
      view.rerender(workspaceElement());
      expect(screen.queryByRole("button", { name: "Composer submit" })).toBeNull();
      expect(screen.getByRole("button", { name: "New thread in group" })).toBeDefined();
    });

    test("a workflow lane offers a manual thread draft in its existing container", () => {
      useGroupChildThread();
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...useCliThreadMock().thread, workflowRunId: "run_1", workflowLaneId: "lane-1" },
      });
      const priorQueryImpl = useQueryMock.getMockImplementation()!;
      useQueryMock.mockImplementation((query: Parameters<typeof getFunctionName>[0], args: unknown) => {
        if (args !== "skip" && getFunctionName(query) === "workflows/runs/core:get") {
          return { _id: "run_1", status: "running", stages: [] };
        }
        return priorQueryImpl(query, args);
      });
      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
      expect(document.querySelector('[data-slot="add-to-group-draft"]')).not.toBeNull();
      expect(within(screen.getByTestId("thread-header-tabs")).getByRole("tab", { name: "New thread" })).toBeDefined();
    });

    test("a run lane's Workflow tab survives a tab switch", () => {
      // OS-1880: `workflowRunId` is identical on every lane of a run, so the
      // outgoing row answers while the incoming doc loads — the tab must not
      // blink out and back, nor the panel fall back to Changes.
      useGroupChildThread();
      const loaded = useCliThreadMock() as {
        isLoading: boolean;
        thread: Record<string, unknown>;
      };
      const laneThread = {
        ...loaded.thread,
        workflowRunId: "run_1",
      };
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2"
          ? { isLoading: true, thread: null }
          : { isLoading: false, thread: laneThread }
      );
      const priorQueryImpl = useQueryMock.getMockImplementation()!;
      useQueryMock.mockImplementation(
        (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
          if (args !== "skip" && getFunctionName(query) === "workflows/runs/core:get") {
            return {
              _id: "run_1",
              workflowId: "wf_1",
              workflowName: "Release Train",
              status: "running",
              versionNumber: 1,
              startedAt: 1,
              lastActivityAt: 1,
              stages: [],
            };
          }
          return priorQueryImpl(query, args);
        }
      );

      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));
      fireEvent.click(screen.getByRole("tab", { name: "Workflow" }));
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      expect(screen.getByRole("tab", { name: "Workflow" })).toBeDefined();
      expect(screen.getByText("Cancel run")).toBeDefined();
    });

    test("publishes the group container as the sidebar's highlighted row", () => {
      useGroupChildThread();

      renderWorkspace();

      // Stamped with the route it came from — it lands in an effect, so the
      // layout has to be able to drop it once the route moves on.
      expect(sidebarHighlightMock).toHaveBeenLastCalledWith({
        route: "thread_1",
        threadId: "container_1",
      });
    });

    test("the '+' seeds an empty Group child draft from the thread and closing the draft tab is a no-op", () => {
      const addToGroupSetDraftMock = vi.fn();
      useThreadDraftMock.mockImplementation((key: string) =>
        key.startsWith("sibling:")
          ? { draft: undefined, setDraft: addToGroupSetDraftMock }
          : { draft: draftValue, setDraft: setDraftMock }
      );

      renderWorkspace();

      // Plain thread in split view: no strip yet, the "+" rides the title.
      expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));

      expect(addToGroupSetDraftMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
          profileId: "profile_1",
          pathId: "path_1",
          cliType: "codex",
        })
      );
      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
      expect(within(tabs).getByRole("tab", { name: "New thread" })).toBeDefined();

      fireEvent.click(within(tabs).getByRole("button", { name: "Close New thread tab" }));
      expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
      expect(updateTitleMutationMock).not.toHaveBeenCalled();
    });

    test("handoff in a new tab targets the group's draft and opens its tab without re-seeding it", () => {
      const addToGroupSetDraftMock = vi.fn();
      useThreadDraftMock.mockImplementation((key: string) =>
        key.startsWith("sibling:")
          ? { draft: undefined, setDraft: addToGroupSetDraftMock }
          : { draft: draftValue, setDraft: setDraftMock }
      );

      renderWorkspace();
      const { newTab } = useThreadHandoffArgsMock.mock.calls.at(-1)![0] as {
        newTab?: { draftKey: string; open: () => void };
      };
      expect(newTab?.draftKey).toBe("sibling:thread_1");
      act(() => newTab?.open());

      // The handoff already seeded the draft; the "+" seed (stamped `seededFrom`) would wipe its text.
      expect(addToGroupSetDraftMock).not.toHaveBeenCalledWith(expect.objectContaining({ seededFrom: "thread_1" }));
      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByRole("tab", { name: "New thread" }).getAttribute("aria-selected")).toBe("true");
    });

    test("renders each tab's task ref from the separate task-summary query", () => {
      useGroupChildThread();
      groupQueryResult!.children[1].associatedTaskId = "task_7";
      taskSummariesQueryResult = [
        {
          _id: "task_7",
          refId: "OS-77",
          name: "Group child task",
          taskType: {
            key: "task",
            name: "Task",
            icon: "SquareCheckBig",
            color: "#64748b",
            isSystem: true,
          },
        },
      ];

      renderWorkspace();

      // The chip rides inside the Group child's own tab, not the active one.
      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByText("OS-77")).toBeDefined();
    });

    test("holds the strip's shape with one placeholder per known child", () => {
      // OS-1558: clicking a group lands on the container first, and its
      // `childCount` sizes the strip before `getGroup` resolves — the tabs
      // then arrive together instead of one-now-rest-later.
      useGroupChildThread();
      const childThread = useCliThreadMock();
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          ...childThread.thread,
          _id: "container_1" as Id<"cliThreads">,
          kind: "group",
          childCount: 2,
          parentThreadId: undefined,
        },
      });
      groupQueryResult = undefined;

      // Render the container URL (which redirects), then the child it lands on.
      const view = renderWorkspace();
      useCliThreadMock.mockReturnValue(childThread);
      view.rerender(workspaceElement());

      expect(screen.getByTestId("thread-header-tabs-pending").children).toHaveLength(2);
      expect(screen.queryByRole("tab", { name: "Existing thread" })).toBeNull();
    });

    test("sizes the placeholder from the child's own doc on a cold load", () => {
      // OS-1558: a page load straight onto a child URL never reads the
      // container, so the count rides on the child (`containerChildCount`) —
      // without it the header shows title mode, then the whole strip.
      useGroupChildThread();
      const childThread = useCliThreadMock();
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: { ...childThread.thread, containerChildCount: 2 },
      });
      groupQueryResult = undefined;

      renderWorkspace();

      expect(screen.getByTestId("thread-header-tabs-pending").children).toHaveLength(2);
    });

    test("holds the strip back until the task refs load", () => {
      // OS-1558: tabs sized without their refs resize when the refs land.
      useGroupChildThread();
      groupQueryResult!.children[1].associatedTaskId = "task_7";
      taskSummariesQueryResult = undefined;

      renderWorkspace();

      expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
    });

    describe("branch from here in a new tab (OS-2224)", () => {
      function withOneAssistantReply() {
        useCliMessagesMock.mockReturnValue(
          buildCliMessagesResult({
            messages: [
              {
                _id: "message_assistant_1" as Id<"cliMessages">,
                role: "assistant",
                status: "completed",
                cliType: "claude-code",
                createdAt: Date.now(),
                content: [],
                attachments: [],
              },
            ],
            isLoading: false,
            isLoadingOlderChunks: false,
            assistantRenderById: new Map([
              ["message_assistant_1", { parts: [{ type: "text", text: "Done" }], metadata: {}, normalizedEvents: [], warnings: [] }],
            ]),
          })
        );
      }

      function lastAssistantProps() {
        return assistantCliMessageRenderMock.mock.calls.at(-1)?.[0] as {
          onBranchFromHere?: (messageId: string) => void;
          onBranchIntoTab?: (messageId: string) => void;
          onHandoffToNewThread?: (messageId: string) => void;
          onHandoffToNewTab?: (messageId: string) => void;
        };
      }

      afterEach(() => {
        window.history.replaceState(null, "", "/");
      });

      test("adopts the new group and opens the tab with the current query string", async () => {
        // A plain source: nothing names the container until the fork returns it.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );
        withOneAssistantReply();
        window.history.replaceState(null, "", "/o/contoso/OS/threads/thread_1?task=OS-7");
        updateTitleMutationMock.mockResolvedValue({ threadId: "thread_new", containerId: "container_1" });

        renderWorkspace();
        lastAssistantProps().onBranchIntoTab?.("message_assistant_1");

        await vi.waitFor(() => expect(routerPushMock).toHaveBeenCalled());
        expect(updateTitleMutationMock).toHaveBeenCalledWith({
          messageId: "message_assistant_1",
          groupWithThreadId: "thread_1",
        });
        const [pushed] = routerPushMock.mock.calls.at(-1)!;
        expect(pushed).toContain("/o/contoso/OS/threads/thread_new");
        expect(pushed).toContain("task=OS-7");
        expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), { containerId: "container_1" });
        expect(screen.getByTestId("thread-header")).toBeDefined();
        expect(screen.queryByTestId("thread-detail-skeleton")).toBeNull();
      });

      test("withholds handoff while a fork is still copying its run", () => {
        const source = useCliThreadMock();
        const forkedFrom = {
          threadId: "thread_parent",
          runStart: { messageId: "message_p1", createdAt: 1 },
          reply: { messageId: "message_p2", createdAt: 2 },
        };
        useCliThreadMock.mockReturnValue({ ...source, thread: { ...source.thread, forkedFrom: { ...forkedFrom, copiesInFlight: 1 } } });
        withOneAssistantReply();
        const { unmount } = renderWorkspace();
        expect(lastAssistantProps().onHandoffToNewThread).toBeUndefined();
        unmount();

        useCliThreadMock.mockReturnValue({ ...source, thread: { ...source.thread, forkedFrom } });
        renderWorkspace();
        expect(lastAssistantProps().onHandoffToNewThread).toBeDefined();
      });

      test("withholds the new-tab branch when the group is full", () => {
        useGroupChildThread(100);
        withOneAssistantReply();

        renderWorkspace();

        expect(lastAssistantProps().onBranchFromHere).toBeDefined();
        expect(lastAssistantProps().onBranchIntoTab).toBeUndefined();
        expect(lastAssistantProps().onHandoffToNewThread).toBeDefined();
        expect(lastAssistantProps().onHandoffToNewTab).toBeUndefined();
      });
    });

    describe("sending the first draft message keeps the workspace mounted (OS-1615)", () => {
      /**
       * Send the draft tab's first message. `addThreadToGroup` resolves with the
       * group it landed in — the value the workspace adopts as its scope — and
       * the new child's own doc stays loading, which is the beat under test.
       */
      async function submitAddToGroupDraft(containerId: string) {
        updateTitleMutationMock.mockResolvedValue({
          containerId,
          threadId: "thread_new",
        });
        const draft = document.querySelector<HTMLElement>('[data-slot="add-to-group-draft"]');
        if (!draft) {
          throw new Error("Group child draft is missing");
        }
        fireEvent.click(within(draft).getByRole("button", { name: "Composer submit" }));
        // The submit pipeline awaits the mutation, then calls `onCreated`;
        // both land in microtasks.
        await vi.waitFor(() => expect(routerPushMock).toHaveBeenCalled());
      }

      /**
       * The same send, but stopping where the hold does (OS-1665): the mutation
       * has resolved and the created thread's data has not, so the navigation
       * has deliberately not happened yet.
       */
      async function submitAddToGroupDraftWithoutNavigating(containerId: string) {
        // The created thread's envelopes never land, so the hold stays open —
        // that is the whole point of stopping here.
        createdThreadEnvelopesResult = undefined;
        updateTitleMutationMock.mockResolvedValue({
          containerId,
          threadId: "thread_new",
        });
        const draft = document.querySelector<HTMLElement>('[data-slot="add-to-group-draft"]');
        if (!draft) {
          throw new Error("Group child draft is missing");
        }
        fireEvent.click(within(draft).getByRole("button", { name: "Composer submit" }));
        await vi.waitFor(() =>
          expect(updateTitleMutationMock).toHaveBeenCalledWith(
            expect.objectContaining({ sourceThreadId: "thread_1" })
          )
        );
      }

      test("holds the draft — text and all — until the created thread's data lands (OS-1665)", async () => {
        // The rule: no empty or placeholder transitions in the create flow. The
        // new thread has no doc, no messages and (before the first group addition) no group, so
        // swapping now could only render placeholders. The draft stays instead.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");

        // Neither placeholder the ticket names.
        expect(screen.queryByTestId("thread-header-tabs-pending")).toBeNull();
        expect(screen.queryByTestId("thread-transcript-skeleton")).toBeNull();
        // The draft is still the visible tab, and its composer still on screen —
        // the text stays put until the send is accepted.
        const draft = document.querySelector<HTMLElement>('[data-slot="add-to-group-draft"]');
        expect(draft?.classList.contains("hidden")).toBe(false);
        expect(within(draft!).getByRole("button", { name: "Composer submit" })).toBeDefined();
        // And the URL has not moved yet: committing it is what would mount the
        // workspace onto data that isn't there.
        expect(routerPushMock).not.toHaveBeenCalled();
      });

      test("swaps to the new Group child once its data has landed (OS-1665)", async () => {
        // The other half of the hold: it releases, and releases only once. The
        // created thread's doc, messages and group are all warm here, so the
        // navigation commits onto real data.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );
        groupQueryResult = {
          children: [
            { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3 },
          ],
          totalRowCount: 2,
        };

        renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraft("container_1");

        expect(routerPushMock).toHaveBeenCalledWith(
          expect.stringContaining("/o/contoso/OS/threads/thread_new"),
          expect.anything()
        );
        expect(document.querySelector('[data-slot="add-to-group-draft"]')).toBeNull();
      });

      test("leaves the draft open and sendable when addThreadToGroup fails (OS-1665)", async () => {
        // The group filled up from another device. No rollback machinery: the
        // draft never closed, so re-enabling the composer is the whole retry.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );
        updateTitleMutationMock.mockRejectedValue(new Error("group is full"));

        renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        const draft = document.querySelector<HTMLElement>('[data-slot="add-to-group-draft"]');
        fireEvent.click(within(draft!).getByRole("button", { name: "Composer submit" }));
        await vi.waitFor(() => expect(updateTitleMutationMock).toHaveBeenCalled());

        await vi.waitFor(() => {
          const submit = within(draft!).getByRole("button", {
            name: "Composer submit",
          }) as HTMLButtonElement;
          expect(submit.disabled).toBe(false);
        });
        expect(draft!.classList.contains("hidden")).toBe(false);
        expect(routerPushMock).not.toHaveBeenCalled();
      });

      /**
       * The reparent `addThreadToGroup` commits in the same transaction as the new
       * child (OS-907): the source thread's own subscription gains
       * `parentThreadId`, which is what makes the workspace subscribe to the
       * brand-new group — and the group already holds both children.
       */
      function useFirstSplitGroupPublished() {
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new"
            ? { isLoading: true, thread: null }
            : {
                ...source,
                thread: { ...source.thread, parentThreadId: "container_1" },
              }
        );
        groupQueryResult = {
          children: [
            { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3 },
          ],
          totalRowCount: 2,
        };
      }

      /**
       * The beat *before* the one above (OS-1718). `getGroup` on a brand-new
       * container is a new subscription, so it answers a round trip after the
       * reparent it learns about the container from: the source's `get` already
       * carries `parentThreadId` — and the container's `childCount`, mirrored as
       * `containerChildCount` — while the group itself is still `undefined`.
       *
       * Not a race: the client applies the transition carrying those writes
       * before it resolves the mutation promise, so this beat is on every group addition.
       */
      function useFirstSplitReparentedBeforeGroup() {
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new"
            ? { isLoading: true, thread: null }
            : {
                ...source,
                thread: {
                  ...source.thread,
                  parentThreadId: "container_1",
                  containerChildCount: 2,
                },
              }
        );
        groupQueryResult = undefined;
      }

      test("the reparent beat keeps the strip's tabs instead of collapsing to placeholders (OS-1718)", async () => {
        // The reported "all tabs show skeleton". The strip has real tabs on
        // screen and the draft open over the thread; adopting a container whose
        // group has not answered must not swap them for placeholders. Those are
        // for cold entry onto a child URL, which has nothing else to show.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        useFirstSplitReparentedBeforeGroup();
        view.rerender(workspaceElement());

        expect(screen.queryByTestId("thread-header-tabs-pending")).toBeNull();
        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
        expect(within(tabs).getByRole("tab", { name: "New thread" })).toBeDefined();
      });

      test("the reparent beat keeps the '+' on screen (OS-1718)", async () => {
        // Same beat, second consumer of the same half-known scope: a container
        // whose group is still loading is not a reason to withhold the add-to-group action —
        // only an unavailable container is, and that answers `null`, not
        // `undefined`.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        useFirstSplitReparentedBeforeGroup();
        view.rerender(workspaceElement());

        expect(screen.getByRole("button", { name: "New thread in group" })).toBeDefined();
      });

      test("the draft tab stands in for the created Group child instead of sitting beside it (OS-907)", async () => {
        // `addThreadToGroup` commits the container, the reparented source and the
        // new child in one transaction, so the strip learns about the child
        // while the hold still has the draft tab open. Both at once is the
        // reported "Thread 1, Thread 2, New thread".
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        useFirstSplitGroupPublished();
        view.rerender(workspaceElement());

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
        expect(within(tabs).getByRole("tab", { name: "New thread" })).toBeDefined();
        // The tab the draft is standing in for must not render twice.
        expect(within(tabs).queryByRole("tab", { name: "New Group child" })).toBeNull();
        expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
      });

      test("a Group child send in an existing group shows no third tab while the hold is open (OS-907)", async () => {
        // Same overlap with a group that already exists: `getGroup` is
        // subscribed from the start, so the third child's tab appears the
        // instant the mutation commits.
        useGroupChildThread();
        const child = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : child
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        groupQueryResult = {
          children: [
            ...groupQueryResult!.children,
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3 },
          ],
          totalRowCount: 3,
        };
        view.rerender(workspaceElement());

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "New thread" })).toBeDefined();
        expect(within(tabs).queryByRole("tab", { name: "New Group child" })).toBeNull();
        // The two real Group children plus the draft standing in for the third.
        expect(within(tabs).getAllByRole("tab")).toHaveLength(3);
      });

      test("swaps the draft tab for the created Group child's in one commit (OS-907)", async () => {
        // The other side of the stand-in: the hold releases, the label changes,
        // the draft tab goes — never three tabs, never two of the same thread.
        useFirstSplitGroupPublished();

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraft("container_1");
        view.rerender(workspaceElement());

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "New Group child" })).toBeDefined();
        expect(within(tabs).queryByRole("tab", { name: "New thread" })).toBeNull();
        expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
      });

      test("closing the draft mid-hold gives the created Group child its tab back (OS-907)", async () => {
        // The stand-in must not outlive the draft: abandoning the send while the
        // hold is open would otherwise hide that child from the strip for good.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        useFirstSplitGroupPublished();
        view.rerender(workspaceElement());
        fireEvent.click(
          within(screen.getByTestId("thread-header-tabs")).getByRole("button", {
            name: "Close New thread tab",
          })
        );

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "New Group child" })).toBeDefined();
        expect(within(tabs).queryByRole("tab", { name: "New thread" })).toBeNull();
      });

      test("only the created Group child is stood in for, not one that arrived elsewhere (OS-907)", async () => {
        // A Group child created from another device (or by an agent over MCP) lands
        // in the same `getGroup` mid-hold. It has its own tab — the stand-in is
        // one id, not "the newest child".
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraftWithoutNavigating("container_1");
        useFirstSplitGroupPublished();
        groupQueryResult = {
          children: [
            ...groupQueryResult!.children,
            { _id: "thread_other", title: "Elsewhere Group child", lastActivityAt: 4 },
          ],
          totalRowCount: 3,
        };
        view.rerender(workspaceElement());

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "Elsewhere Group child" })).toBeDefined();
        expect(within(tabs).queryByRole("tab", { name: "New Group child" })).toBeNull();
      });

      test("the first group addition adopts the new group's scope before navigating", async () => {
        // The reported bug at its worst: the source is a plain thread, so
        // before the send there is no container at all and no `getGroup`
        // subscription. Without the adopted scope the workspace saw neither a
        // `chat` nor a `groupChild` and unmounted everything.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );
        // The send waits for this group before swapping (OS-1665) — the
        // container the mutation just created, with both children in it.
        groupQueryResult = {
          children: [
            { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3 },
          ],
          totalRowCount: 2,
        };

        renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraft("container_1");

        expect(screen.getByTestId("thread-header")).toBeDefined();
        // The scope is adopted from the mutation's return value, so `getGroup`
        // is subscribed before either doc lands.
        expect(useQueryMock).toHaveBeenCalledWith(
          expect.anything(),
          { containerId: "container_1" }
        );
        // No placeholder strip: the send waits for the group (OS-1665), so the
        // adopted scope now holds a *warm* subscription rather than covering a
        // cold one. The hold and the scope are belt and braces — the scope still
        // matters for the beat after the swap, where `chat` has yet to land.
        expect(screen.queryByTestId("thread-header-tabs-pending")).toBeNull();
      });

      test("a Group child send in an existing group keeps every tab through the new child's task-ref round trip", async () => {
        // The new Group child carries a task id the summaries query hasn't seen, so
        // its args change and it goes `undefined` for a round trip. The refs
        // gate must not reopen there — that would blank the whole strip, which
        // is the blink this ticket is about.
        useGroupChildThread();
        const child = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : child
        );

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraft("container_1");

        // The group now reports the third child, whose task the summaries
        // query hasn't resolved yet.
        groupQueryResult = {
          children: [
            ...groupQueryResult!.children,
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3, associatedTaskId: "task_7" },
          ],
          totalRowCount: 3,
        };
        taskSummariesQueryResult = undefined;
        view.rerender(workspaceElement());

        const tabs = screen.getByTestId("thread-header-tabs");
        expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
        expect(within(tabs).getByRole("tab", { name: "Group child thread" })).toBeDefined();
        expect(within(tabs).getByRole("tab", { name: "New Group child" })).toBeDefined();
      });

      test("abandons the adopted scope when the user navigates away before the doc lands", async () => {
        // The hold is keyed on the new thread staying active: a sidebar click or
        // Back during the loading window must not carry the group scope onto an
        // unrelated thread.
        const source = useCliThreadMock();
        useCliThreadMock.mockImplementation((id: string) =>
          id === "thread_new" ? { isLoading: true, thread: null } : source
        );

        groupQueryResult = {
          children: [
            { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
            { _id: "thread_new", title: "New Group child", lastActivityAt: 3 },
          ],
          totalRowCount: 2,
        };

        const view = renderWorkspace();
        fireEvent.click(screen.getByRole("button", { name: "New thread in group" }));
        await submitAddToGroupDraft("container_1");

        // An unrelated root thread commits in the URL, its own doc already
        // resolved — so nothing here has a group.
        groupQueryResult = undefined;
        useParamsMock.mockReturnValue({
          organizationSlug: "contoso",
          projectAlias: "OS",
          threadId: "thread_other",
        });
        useCliThreadMock.mockImplementation(() => ({
          isLoading: false,
          thread: { ...source.thread, _id: "thread_other", title: "Unrelated thread" },
        }));
        view.rerender(workspaceElement());

        // No group strip and no leftover placeholders on a thread that has no
        // group of its own.
        expect(screen.queryByTestId("thread-header-tabs-pending")).toBeNull();
        expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
      });
    });

    test("the '+' disables when the group's row count is at the cap", () => {
      useGroupChildThread(100);

      renderWorkspace();

      const plus = screen.getByRole("button", {
        name: "New thread in group",
      }) as HTMLButtonElement;
      expect(plus.disabled).toBe(true);
    });

    test("rename optimistically patches both the detail and the group subscriptions", () => {
      useGroupChildThread();

      renderWorkspace();

      const optimistic = capturedOptimisticUpdates["cli/threads/core:updateTitle"];
      expect(optimistic).toBeDefined();

      const setQuery = vi.fn();
      const getQuery = vi.fn((query: Parameters<typeof getFunctionName>[0]) => {
        const functionName = getFunctionName(query);
        if (functionName === "cli/threads/core:get") {
          return { _id: "thread_1", title: "Existing thread" };
        }
        if (functionName === "cli/threads/groups:getGroup") {
          return groupQueryResult;
        }
        return undefined;
      });
      optimistic({ getQuery, setQuery }, { threadId: "thread_1", title: "Renamed" });

      expect(setQuery).toHaveBeenCalledWith(
        expect.anything(),
        { threadId: "thread_1" },
        expect.objectContaining({ title: "Renamed" })
      );
      expect(setQuery).toHaveBeenCalledWith(
        expect.anything(),
        { containerId: "container_1" },
        expect.objectContaining({
          children: [
            expect.objectContaining({ _id: "thread_1", title: "Renamed" }),
            expect.objectContaining({ _id: "thread_2", title: "Group child thread" }),
          ],
        })
      );
    });

    test("mark done clears unread optimistically, since the server stamps readAt with doneAt", () => {
      useGroupChildThread();

      renderWorkspace();

      const optimistic = capturedOptimisticUpdates["cli/threads/batch:batchMarkDone"];
      expect(optimistic).toBeDefined();

      const setQuery = vi.fn();
      const getQuery = vi.fn((query: Parameters<typeof getFunctionName>[0]) => {
        const functionName = getFunctionName(query);
        if (functionName === "cli/threads/core:get") {
          return { _id: "thread_1", title: "Existing thread", hasUnread: true };
        }
        if (functionName === "cli/threads/groups:getGroup") {
          return groupQueryResult;
        }
        return undefined;
      });
      optimistic({ getQuery, setQuery }, { threadIds: ["thread_1"] });

      // Read the captured values rather than matching on them: the query refs
      // these mocks hand back are not serializable, so a `toHaveBeenCalledWith`
      // mismatch fails inside the diff printer instead of reporting itself.
      const written = setQuery.mock.calls.map(([query, args, value]) => ({
        name: getFunctionName(query as Parameters<typeof getFunctionName>[0]),
        args,
        value,
      }));
      const detailWrite = written.find((write) => write.name === "cli/threads/core:get");
      const groupWrite = written.find((write) => write.name === "cli/threads/groups:getGroup");

      // `patchThreadDone` stamps `readAt` alongside `doneAt`, so a done tab that
      // kept its unread dot until the round trip would be the one glyph the
      // user sees not settle (OS-1618) — done is the only state where the dot is
      // the *only* thing the indicator can render.
      expect(detailWrite?.value).toMatchObject({ isDone: true, hasUnread: false });
      expect(groupWrite?.value).toMatchObject({
        children: [
          { _id: "thread_1", isDone: true, hasUnread: false },
          { _id: "thread_2" },
        ],
      });
    });

    describe("tab states, overflow cut and remove from group (OS-1478)", () => {
      function headerTabs() {
        return within(screen.getByTestId("thread-header-tabs")).getAllByRole("tab");
      }

      /** What the overflow chevron adds to the tab that hosts it. */
      const CHEVRON_WIDTH = 22;
      const stubbedLayoutProps: Array<[string, PropertyDescriptor | undefined]> = [];

      /**
       * jsdom lays nothing out, so the strip's measurements come from here:
       * every tab the same width, the strip a fixed one, and the tab holding
       * the chevron wider by it — the strip has to converge on a cut despite
       * its own trigger moving between tabs.
       */
      function stubStripLayout(stripWidth: number, tabWidth: number) {
        vi.stubGlobal(
          "ResizeObserver",
          class {
            observe() {}
            unobserve() {}
            disconnect() {}
          }
        );
        for (const [property, slot, value, chevronCounts] of [
          ["clientWidth", "thread-tab-strip", stripWidth, false],
          ["offsetWidth", "thread-tab", tabWidth, true],
        ] as const) {
          stubbedLayoutProps.push([
            property,
            Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
          ]);
          Object.defineProperty(HTMLElement.prototype, property, {
            configurable: true,
            get(this: HTMLElement) {
              if (this.dataset.slot !== slot) {
                return 0;
              }
              return chevronCounts && this.querySelector('[aria-label="More threads"]')
                ? value + CHEVRON_WIDTH
                : value;
            },
          });
        }
      }

      afterEach(() => {
        vi.unstubAllGlobals();
        for (const [property, descriptor] of stubbedLayoutProps.splice(0)) {
          if (descriptor) {
            Object.defineProperty(HTMLElement.prototype, property, descriptor);
            continue;
          }
          Reflect.deleteProperty(HTMLElement.prototype, property);
        }
      });

      const doneGroupChildren = () => ({
        children: [
          { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, isDone: false },
          { _id: "thread_2", title: "Older done", lastActivityAt: 1, isDone: true, doneAt: 5 },
          { _id: "thread_3", title: "Newest done", lastActivityAt: 2, isDone: true, doneAt: 9 },
        ],
        totalRowCount: 3,
      });

      test.each(["split", "mobile", "full"])("places Done after thread actions in %s view", (mode) => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        if (mode === "mobile") {
          setMobileViewport();
        } else if (mode === "full") {
          window.localStorage.setItem("convoy.thread-layout-mode", "full");
        }
        renderWorkspace();

        const done = screen.getByRole("button", { name: "Done threads" });
        const actions = mode === "full"
          ? getThreadColumn()
          : document.querySelector<HTMLElement>(`[data-slot="${mode === "mobile" ? "mobile" : "desktop"}-thread-actions"]`)!;
        const menu = within(actions).getByRole("button", { name: "Thread actions" });
        expect(actions.contains(done)).toBe(true);
        expect(menu.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(done.closest('[data-slot="thread-tab-strip"]')).toBeNull();
        if (mode === "full") {
          fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
          const headerDone = screen.getByRole("button", { name: "Done threads" });
          expect(screen.getByTestId("thread-header-actions").contains(headerDone)).toBe(true);
          expect(headerDone.closest("[inert]")).toBeNull();
        }
      });

      test("does not reserve status space in Done menu rows", async () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        renderWorkspace();
        fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
          button: 0, ctrlKey: false,
        });
        const items = await screen.findAllByRole("menuitem");
        for (const item of items) {
          expect(item.querySelector('[data-slot="thread-tab-indicator"]')).toBeNull();
        }
      });

      test("shows the unread dot on a done thread with activity since it was read", async () => {
        useGroupChildThread();
        const base = doneGroupChildren();
        groupQueryResult = {
          ...base,
          children: base.children.map((child, index) => index === 1 ? { ...child, hasUnread: true } : child),
        };
        renderWorkspace();
        fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
          button: 0, ctrlKey: false,
        });
        const unread = await screen.findByRole("menuitem", { name: /Older done/ });
        const read = screen.getByRole("menuitem", { name: /Newest done/ });
        expect(unread.querySelector('[data-slot="thread-tab-indicator"] [title="Unread"]')).not.toBeNull();
        expect(read.querySelector('[data-slot="thread-tab-indicator"]')).toBeNull();
      });

      test("hides unselected done tabs behind a separate Done menu", async () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        renderWorkspace();

        expect(headerTabs().map((tab) => tab.textContent)).toEqual(["Existing thread"]);
        fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
          button: 0, ctrlKey: false,
        });
        const items = await screen.findAllByRole("menuitem");
        expect(items.map((item) => item.textContent)).toEqual(["Newest done", "Older done"]);
        fireEvent.click(items[1]);
        expect(routerPushMock).toHaveBeenCalledWith(
          expect.stringContaining("/threads/thread_2"), expect.anything()
        );
        expect(headerTabs().map((tab) => tab.textContent)).toEqual(["Existing thread", "Older done"]);
        expect(groupQueryResult.children[1].isDone).toBe(true);
        fireEvent.click(headerTabs()[0]);
        expect(headerTabs().map((tab) => tab.textContent)).toEqual(["Existing thread"]);
      });

      test("keeps the final thread visible when marked done without opening a draft", () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        const view = renderWorkspace();
        groupQueryResult = {
          ...groupQueryResult,
          children: groupQueryResult.children.map((child, index) => index === 0 ? { ...child, isDone: true, doneAt: 20 } : child),
        };
        view.rerender(workspaceElement());

        const tabs = headerTabs();
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Existing thread"]);
        expect(tabs[0].getAttribute("aria-selected")).toBe("true");
        expect(within(tabs[0]).getByText("Existing thread").className).toContain("line-through");
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(routerReplaceMock).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Done threads" }).title).toBe("Done threads (3)");
      });

      test("returns a done thread to its creation-order position on new activity", () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        const view = renderWorkspace();
        groupQueryResult = {
          ...groupQueryResult,
          children: groupQueryResult.children.map((child, index) => index === 1 ? { ...child, isDone: false, lastActivityAt: 30 } : child),
        };
        view.rerender(workspaceElement());

        expect(headerTabs().map((tab) => tab.textContent)).toEqual(["Existing thread", "Older done"]);
        expect(within(headerTabs()[1]).getByText("Older done").className).not.toContain("line-through");
        expect(screen.getByRole("button", { name: "Done threads" }).title).toBe("Done threads (1)");
      });

      test("keeps a done thread that is still running in the strip with its spinner", () => {
        useGroupChildThread();
        const base = doneGroupChildren();
        groupQueryResult = {
          ...base,
          children: base.children.map((child, index) => index === 1 ? { ...child, status: "streaming" } : child),
        };
        renderWorkspace();

        const tabs = headerTabs();
        expect(tabs.map((tab) => tab.textContent)).toEqual(["Existing thread", "Older done"]);
        expect(within(tabs[1]).getByText("Older done").className).toContain("line-through");
        const slot = tabs[1].closest('[data-slot="thread-tab"]')!.querySelector('[data-slot="thread-tab-indicator"]');
        expect(slot?.firstElementChild?.getAttribute("title")).toBe("Streaming response");
        expect(screen.getByRole("button", { name: "Done threads" }).title).toBe("Done threads (1)");
      });

      test.each(["full", "read-only"])("keeps done threads accessible in %s view", async (mode) => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        if (mode === "full") {
          window.localStorage.setItem("convoy.thread-layout-mode", "full");
        } else {
          useCliThreadMock.mockReturnValue({
            isLoading: false,
            thread: { ...useCliThreadMock().thread, isOwner: false, containerKind: "group" },
          });
        }
        renderWorkspace();

        fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
          button: 0, ctrlKey: false,
        });
        fireEvent.click(await screen.findByRole("menuitem", { name: "Newest done" }));
        expect(routerPushMock).toHaveBeenCalledWith(
          expect.stringContaining("/threads/thread_3"), expect.anything()
        );
        const selected = within(screen.getByTestId("thread-header-tabs"))
          .getByRole("tab", { name: "Newest done" });
        expect(selected.getAttribute("aria-selected")).toBe("true");
        if (mode === "read-only") {
          expect(screen.queryByRole("button", { name: "New thread in group" })).toBeNull();
          expect(screen.queryByRole("button", { name: "Composer submit" })).toBeNull();
        }
        fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
          button: 0, ctrlKey: false,
        });
        expect((await screen.findByRole("menuitem", { name: "Newest done" })).getAttribute("aria-current")).toBe("true");
      });

      test("omits the Done menu when every thread is unfinished", () => {
        useGroupChildThread();
        renderWorkspace();
        expect(screen.queryByRole("button", { name: "Done threads" })).toBeNull();
      });

      describe("status indicators (OS-1618)", () => {
        /** The glyph slot the tab paints into its leading padding. */
        function indicatorSlot(tab: HTMLElement) {
          return tab
            .closest('[data-slot="thread-tab"]')!
            .querySelector('[data-slot="thread-tab-indicator"]');
        }

        /** What that glyph says it is — the status, in the tooltip. */
        function tabStatus(tab: HTMLElement) {
          return indicatorSlot(tab)?.firstElementChild?.getAttribute("title") ?? null;
        }

        test("shows each Group child's own status, from the strip's subscription", () => {
          useGroupChildThread();
          // Read, explicitly: the shared fixture's thread doc is unread, and an
          // unread settled tab now shows a dot (below) rather than nothing.
          useCliThreadMock.mockReturnValue({
            isLoading: false,
            thread: { ...useCliThreadMock().thread, hasUnread: false },
          });
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              { _id: "thread_2", title: "Working", lastActivityAt: 2, status: "streaming" },
              { _id: "thread_3", title: "Broken", lastActivityAt: 1, status: "failed", requiresAttention: true },
            ],
            totalRowCount: 3,
          };

          renderWorkspace();

          const [active, working, broken] = headerTabs();
          expect(tabStatus(working)).toBe("Streaming response");
          expect(tabStatus(broken)).toBe("Error");
          // A settled, read tab leaves the slot empty rather than parking a dot
          // in it: nothing to say, and the strip is tight on width.
          expect(tabStatus(active)).toBeNull();
        });

        test("folds a parked run into waiting, like the thread list does", () => {
          useGroupChildThread();
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              {
                _id: "thread_2",
                title: "Parked",
                lastActivityAt: 2,
                // Still streaming on the row, but it is the user's turn.
                status: "streaming",
                hasPendingInteraction: true,
              },
            ],
            totalRowCount: 2,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[1])).toBe("Awaiting input");
        });

        test("the active tab reads its own status from its thread doc, not the strip's copy", () => {
          useGroupChildThread();
          useCliThreadMock.mockReturnValue({
            isLoading: false,
            thread: {
              ...useCliThreadMock().thread,
              status: "streaming",
            },
          });
          // The strip's copy still says settled — the fresher `get` wins.
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              { _id: "thread_2", title: "Group child thread", lastActivityAt: 1, status: "completed" },
            ],
            totalRowCount: 2,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[0])).toBe("Streaming response");
        });

        test("a done tab shows no glyph, and the indicator never resizes a tab", () => {
          useGroupChildThread();
          groupQueryResult = doneGroupChildren();
          groupQueryResult.children[1].status = "completed";

          useParamsMock.mockReturnValue({ organizationSlug: "contoso", projectAlias: "OS", threadId: "thread_2" });
          useCliThreadMock.mockReturnValue({
            isLoading: false,
            thread: { ...useCliThreadMock().thread, _id: "thread_2", isDone: true, hasUnread: false },
          });
          renderWorkspace();

          const done = headerTabs()[1];
          expect(tabStatus(done)).toBeNull();
          // Out of flow, so a status change cannot move the overflow cut.
          expect(indicatorSlot(done)?.className).toContain("absolute");
        });

        // The reported bug: a Group child finishes while the user is on another
        // tab, and its tab showed nothing at all. On a settled tab the unread
        // dot is the *only* glyph left, so without it the tab is silent about
        // having new output.
        test("a finished tab the user has not opened shows the unread dot", () => {
          useGroupChildThread();
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              {
                _id: "thread_2",
                title: "Just finished",
                lastActivityAt: 2,
                status: "completed",
                hasUnread: true,
              },
            ],
            totalRowCount: 2,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[1])).toBe("Unread");
        });

        test("a finished tab the user has opened stays silent", () => {
          useGroupChildThread();
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              {
                _id: "thread_2",
                title: "Read already",
                lastActivityAt: 2,
                status: "completed",
                hasUnread: false,
              },
            ],
            totalRowCount: 2,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[1])).toBeNull();
        });

        // Live state outranks read state: a running tab says it is running, and
        // the dot waits until there is nothing more urgent to show.
        test("a live status wins over unread on the same tab", () => {
          useGroupChildThread();
          groupQueryResult = {
            children: [
              { _id: "thread_1", title: "Existing thread", lastActivityAt: 3, status: "completed" },
              {
                _id: "thread_2",
                title: "Still working",
                lastActivityAt: 2,
                status: "streaming",
                hasUnread: true,
              },
            ],
            totalRowCount: 2,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[1])).toBe("Streaming response");
        });

        test("the active tab takes unread from its own doc, like its status", () => {
          useGroupChildThread();
          useCliThreadMock.mockReturnValue({
            isLoading: false,
            thread: {
              ...useCliThreadMock().thread,
              status: "completed",
              hasUnread: true,
            },
          });
          groupQueryResult = {
            children: [
              {
                _id: "thread_1",
                title: "Existing thread",
                lastActivityAt: 3,
                status: "completed",
                hasUnread: false,
              },
            ],
            totalRowCount: 1,
          };

          renderWorkspace();

          expect(tabStatus(headerTabs()[0])).toBe("Unread");
        });

        test("omits status indicators from Done rows even when status data is present", async () => {
          useGroupChildThread();
          groupQueryResult = doneGroupChildren();
          groupQueryResult.children[1].status = "failed";
          groupQueryResult.children[1].requiresAttention = true;
          stubStripLayout(250, 100);

          renderWorkspace();

          fireEvent.pointerDown(screen.getByRole("button", { name: "Done threads" }), {
            button: 0,
            ctrlKey: false,
          });
          const item = await screen.findByRole("menuitem", { name: /Older done/ });
          expect(within(item).queryByTitle("Error")).toBeNull();
          expect(item.querySelector('[data-slot="thread-tab-indicator"]')).toBeNull();
        });
      });

      test("keeps a done tab muted even while it is the active one", () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        useParamsMock.mockReturnValue({
          organizationSlug: "contoso",
          projectAlias: "OS",
          threadId: "thread_3",
        });

        renderWorkspace();

        const [live, activeDone] = headerTabs().map((tab) => tab.closest('[data-slot="thread-tab"]')!);
        expect(activeDone.className).toContain("border-foreground");
        expect(activeDone.className).toContain("text-muted-foreground");
        expect(activeDone.className).not.toContain("font-medium");
        expect(live.className).not.toContain("border-foreground");
      });

      test("cuts the tabs that do not fit into the last tab's dropdown", async () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        groupQueryResult.children = [groupQueryResult.children[0], groupQueryResult.children[2], groupQueryResult.children[1]]
          .map((child) => ({ ...child, isDone: false }));
        groupQueryResult.children[2].associatedTaskId = "task_7";
        taskSummariesQueryResult = [
          {
            _id: "task_7",
            refId: "OS-77",
            name: "Cut Group child task",
            taskType: { key: "task", name: "Task", icon: "SquareCheckBig", color: "#64748b", isSystem: true },
          },
        ];
        // Two of the three 100px tabs fit once the trigger is reserved.
        stubStripLayout(250, 100);

        renderWorkspace();

        expect(headerTabs().map((tab) => tab.textContent)).toEqual([
          "Existing thread",
          "Newest done",
        ]);
        // The trigger rides inside the last visible tab, not beside the strip.
        const trigger = screen.getByRole("button", { name: "More threads" });
        expect(trigger.closest('[data-slot="thread-tab"]')).toBe(
          headerTabs()[1].closest('[data-slot="thread-tab"]')
        );

        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        const item = await screen.findByRole("menuitem", { name: /Older done/ });
        // Cut tabs keep their task ref in the menu — the only place they show.
        expect(within(item).getByText("OS-77")).toBeDefined();
        // Unfinished overflow rows keep their ordinary title styling.
        expect(within(item).getByText("Older done").className).not.toContain("line-through");

        fireEvent.click(item);
        expect(routerPushMock).toHaveBeenCalledWith(
          expect.stringContaining("/o/contoso/OS/threads/thread_2"),
          expect.anything()
        );
      });

      test("settles when the trigger's own width pushes the cut down a tab", () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        groupQueryResult.children = [groupQueryResult.children[0], groupQueryResult.children[2], groupQueryResult.children[1]]
          .map((child) => ({ ...child, isDone: false }));
        // Two 100px tabs fit — until the chevron lands in the second one and
        // takes it over budget. Moving the chevron to the first tab must not
        // free the second again, or the measure/cut loop never converges.
        stubStripLayout(215, 100);

        renderWorkspace();

        expect(headerTabs().map((tab) => tab.textContent)).toEqual(["Existing thread"]);
        expect(
          screen
            .getByRole("button", { name: "More threads" })
            .closest('[data-slot="thread-tab"]')
        ).toBe(headerTabs()[0].closest('[data-slot="thread-tab"]'));
      });

      test("keeps the active tab in the strip when the cut would drop it", async () => {
        useGroupChildThread();
        groupQueryResult = doneGroupChildren();
        groupQueryResult.children = [groupQueryResult.children[0], groupQueryResult.children[2], groupQueryResult.children[1]]
          .map((child) => ({ ...child, isDone: false }));
        useParamsMock.mockReturnValue({
          organizationSlug: "contoso",
          projectAlias: "OS",
          threadId: "thread_2",
        });
        useCliThreadMock.mockReturnValue({
          isLoading: false,
          thread: {
            ...useCliThreadMock().thread,
            _id: "thread_2" as Id<"cliThreads">,
            title: "Older done",
          },
        });
        stubStripLayout(250, 100);

        renderWorkspace();

        // Last in strip order, cut — so it takes the slot before the trigger
        // instead of vanishing, and the dropdown holds the rest.
        const tabs = headerTabs();
        expect(tabs.map((tab) => tab.textContent)).toEqual([
          "Existing thread",
          "Older done",
        ]);
        expect(tabs[1].getAttribute("aria-selected")).toBe("true");
        // The slot tab hosts the trigger, and clicking the tab it is already
        // on opens the same menu rather than doing nothing.
        const host = tabs[1].closest('[data-slot="thread-tab"]')!;
        expect(within(host as HTMLElement).getByRole("button", { name: "More threads" })).toBeDefined();

        fireEvent.click(tabs[1]);
        expect(await screen.findByRole("menuitem", { name: /Newest done/ })).toBeDefined();
      });

      test("moves the thread out of the group without navigating away", async () => {
        useGroupChildThread();

        renderWorkspace();

        fireEvent.pointerDown(
          within(getMobileThreadActions()).getByRole("button", { name: "Thread actions" }),
          { button: 0, ctrlKey: false }
        );
        fireEvent.click(await screen.findByRole("menuitem", { name: "Remove thread from group" }));

        expect(updateTitleMutationMock).toHaveBeenCalledWith({ threadId: "thread_1" });
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(capturedOptimisticUpdates["cli/threads/groups:moveChildOut"]).toBeDefined();
      });

      test("offers remove from group only to Group children", async () => {
        renderWorkspace();

        fireEvent.pointerDown(
          within(getMobileThreadActions()).getByRole("button", { name: "Thread actions" }),
          { button: 0, ctrlKey: false }
        );
        await screen.findByRole("menuitem", { name: "Delete" });

        expect(screen.queryByRole("menuitem", { name: "Remove thread from group" })).toBeNull();
      });

      describe("mobile (OS-1479)", () => {
        test("opens done threads in a separate bottom sheet", async () => {
          setMobileViewport();
          useGroupChildThread();
          groupQueryResult = doneGroupChildren();
          renderWorkspace();

          expect(screen.queryByRole("button", { name: "More threads" })).toBeNull();
          fireEvent.click(screen.getByRole("button", { name: "Done threads" }));
          const sheet = await screen.findByRole("dialog", { name: "Done threads" });
          const rows = within(sheet).getAllByRole("button");
          expect(rows.map((row) => row.textContent)).toEqual(["Newest done", "Older done"]);
          expect(sheet.querySelector('[data-slot="thread-tab-indicator"]')).toBeNull();
          fireEvent.click(rows[0]);
          expect(routerPushMock).toHaveBeenCalledWith(
            expect.stringContaining("/threads/thread_3"), expect.anything()
          );
          expect(sheet.getAttribute("data-state")).toBe("closed");
          // jsdom leaves the sheet mounted during its CSS exit animation.
          const selected = within(screen.getByTestId("thread-header-tabs"))
            .getByRole("tab", { selected: true, hidden: true });
          expect(selected.textContent).toBe("Newest done");
          expect(selected.closest('[data-slot="thread-tab"]')?.getAttribute("aria-hidden")).toBeNull();
          expect(groupQueryResult.children[2].isDone).toBe(true);
        });

        test("collapses the strip to the active tab, Group children in a bottom sheet", async () => {
          setMobileViewport();
          useGroupChildThread();
          groupQueryResult = doneGroupChildren();
          groupQueryResult.children = [groupQueryResult.children[0], groupQueryResult.children[2], groupQueryResult.children[1]]
            .map((child) => ({ ...child, isDone: false }));

          renderWorkspace();

          // No measurement involved: a phone header keeps one tab, whatever
          // the tabs measure.
          const tabs = headerTabs();
          expect(tabs.map((tab) => tab.textContent)).toEqual(["Existing thread"]);
          // It reads as the header's title: no underline, and it spans the row
          // so the chevron and "+" sit at the far right.
          const activeTab = tabs[0].closest('[data-slot="thread-tab"]')!;
          expect(activeTab.className).toContain("border-b-0");
          expect(activeTab.className).not.toContain("border-b-2");
          expect(activeTab.className).toContain("flex-1");
          const trigger = screen.getByRole("button", { name: "More threads" });
          expect(trigger.closest('[data-slot="thread-tab"]')).toBe(
            tabs[0].closest('[data-slot="thread-tab"]')
          );
          // The add-to-group affordance stays beside it — the strip's trailing slot.
          expect(screen.getByRole("button", { name: "New thread in group" })).toBeDefined();

          // A drawer, not the header-anchored dropdown (OS-1670).
          fireEvent.click(trigger);
          const sheet = await vi.waitFor(() => {
            const content = document.querySelector('[data-slot="drawer-content"]');
            if (!content) {
              throw new Error("thread overflow sheet is missing");
            }
            return content as HTMLElement;
          });
          expect(sheet.getAttribute("data-vaul-drawer-direction")).toBe("bottom");
          expect(screen.queryByRole("menu")).toBeNull();

          // The whole group in strip order — the active thread included and
          // marked selected, not left out as "the others" (OS-1670).
          const rows = within(sheet).getAllByRole("button");
          expect(rows.map((row) => row.textContent)).toEqual([
            "Existing thread",
            "Newest done",
            "Older done",
          ]);
          expect(rows[0].getAttribute("aria-current")).toBe("true");
          expect(rows[0].className).toContain("bg-muted");
          expect(rows[1].getAttribute("aria-current")).toBeNull();

          fireEvent.click(within(sheet).getByRole("button", { name: /Newest done/ }));

          expect(routerPushMock).toHaveBeenCalledWith(
            expect.stringContaining("/o/contoso/OS/threads/thread_3"),
            expect.anything()
          );
        });

        test("keeps the strip out of a plain thread's header, split button aside", () => {
          setMobileViewport();

          renderWorkspace();

          expect(screen.queryByTestId("thread-header-tabs")).toBeNull();
          expect(screen.getByRole("button", { name: "New thread in group" })).toBeDefined();
        });
      });
    });
  });

  // A project teammate opening a shared thread (`isOwner: false`) watches the
  // transcript and can do nothing else — docs/specs/cli-thread-sharing.md.
  describe("read-only viewer of a shared thread (OS-1575)", () => {
    function useSharedThreadAsViewer() {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          _id: "thread_1" as Id<"cliThreads">,
          projectId: "project_1" as Id<"projects">,
          profileId: "profile_1" as Id<"cliProfiles">,
          profileName: "Primary profile",
          pathId: "path_1",
          pathLabel: "project",
          pathString: "/tmp/project",
          cliType: "codex",
          title: "Existing thread",
          status: "completed",
          processingState: "idle",
          hasPendingUserMessages: false,
          hasUnread: true,
          requiresAttention: false,
          isDone: false,
          isPinned: false,
          lastActivityAt: Date.now(),
          sharedAt: Date.now() - 1_000,
          isOwner: false,
        },
      });
    }

    // Opening an artifact is a read, so the tab is available — but every write
    // affordance inside the panel is gated (OS-1569).
    test("can open the artifact tab, read-only", () => {
      useSharedThreadAsViewer();
      useThreadWorkspaceTaskSidebarMock.mockReturnValue(
        createThreadWorkspaceState({ threadArtifactId: "artifact_1" })
      );

      renderWorkspace();

      expect(screen.getByTestId("thread-artifact-panel")).toBeDefined();
      expect(taskArtifactPanelRenderMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ disabled: true })
      );
    });

    test("drops the composer and every thread action", () => {
      useSharedThreadAsViewer();

      renderWorkspace();

      expect(screen.getByText("Existing thread")).toBeDefined();
      expect(
        screen.queryByRole("button", { name: "Composer submit" })
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Thread actions" })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    });

    test("says the thread is read-only in the header", () => {
      renderWorkspace();
      expect(screen.queryByText("Read-only")).toBeNull();
      cleanup();

      useSharedThreadAsViewer();
      renderWorkspace();

      expect(screen.getByText("Read-only")).toBeDefined();
    });

    test("makes the title read-only", () => {
      renderWorkspace();
      expect(
        screen.getByTestId("thread-header").getAttribute("data-title-editable")
      ).toBe("true");
      cleanup();

      useSharedThreadAsViewer();
      renderWorkspace();

      expect(
        screen.getByTestId("thread-header").getAttribute("data-title-editable")
      ).toBe("false");
    });

    test("keeps the Changes tab visible but inert, opening on Tasks instead", () => {
      useSharedThreadAsViewer();

      renderWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "Open thread sidebar" }));

      const changesTab = screen.getByRole("tab", { name: "Changes" });
      expect(changesTab.getAttribute("aria-disabled")).toBe("true");
      expect(changesTab.getAttribute("aria-selected")).toBe("false");
      expect(
        screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
      ).toBe("true");

      fireEvent.click(changesTab);
      expect(
        screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")
      ).toBe("true");
    });

    test("reads messages without claiming write access", () => {
      renderWorkspace();
      expect(useCliMessagesMock).toHaveBeenCalledWith("thread_1", {
        canWrite: true,
      });
      cleanup();
      useCliMessagesMock.mockClear();

      useSharedThreadAsViewer();
      renderWorkspace();

      expect(useCliMessagesMock).toHaveBeenCalledWith("thread_1", {
        canWrite: false,
      });
      expect(useCliMessagesMock).not.toHaveBeenCalledWith("thread_1", {
        canWrite: true,
      });
    });
  });

  // A shared group is read-only per *child* — the strip is the only thing a
  // viewer gains over a shared standalone thread (OS-1579).
  describe("read-only viewer of a shared group (OS-1579)", () => {
    function useSharedGroupChildAsViewer(
      overrides: { isOwner?: boolean; shared?: boolean } = {}
    ) {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          _id: "thread_1" as Id<"cliThreads">,
          projectId: "project_1" as Id<"projects">,
          profileId: "profile_1" as Id<"cliProfiles">,
          profileName: "Primary profile",
          pathId: "path_1",
          pathLabel: "project",
          pathString: "/tmp/project",
          cliType: "codex",
          title: "Existing thread",
          status: "completed",
          processingState: "idle",
          hasPendingUserMessages: false,
          hasUnread: true,
          requiresAttention: false,
          isDone: false,
          isPinned: false,
          lastActivityAt: Date.now(),
          parentThreadId: "container_1" as Id<"cliThreads">,
          // The child never carries `sharedAt` — the container does.
          ...(overrides.shared === false
            ? {}
            : { containerSharedAt: Date.now() - 1_000 }),
          isOwner: overrides.isOwner ?? false,
        },
      });
      groupQueryResult = {
        children: [
          { _id: "thread_1", title: "Existing thread", lastActivityAt: 2 },
          { _id: "thread_2", title: "Group child thread", lastActivityAt: 1 },
        ],
        totalRowCount: 2,
      };
    }

    test("renders the tab strip so every run in the group is reachable", () => {
      useSharedGroupChildAsViewer();

      renderWorkspace();

      const tabs = screen.getByTestId("thread-header-tabs");
      expect(within(tabs).getByRole("tab", { name: "Existing thread" })).toBeDefined();
      expect(within(tabs).getByRole("tab", { name: "Group child thread" })).toBeDefined();
    });

    test("switching tabs stays read-only", () => {
      useSharedGroupChildAsViewer();

      renderWorkspace();
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      expect(useCliMessagesMock).toHaveBeenCalledWith("thread_2", {
        canWrite: false,
      });
      expect(screen.queryByRole("button", { name: "Composer submit" })).toBeNull();
    });

    test("offers no add-to-group action and no per-tab actions", () => {
      useSharedGroupChildAsViewer();

      renderWorkspace();

      expect(
        screen.queryByRole("button", { name: "New thread in group" })
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Thread actions" })).toBeNull();
      fireEvent.contextMenu(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Existing thread",
        })
      );
      expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    });

    test("the read-only badge covers the whole group", () => {
      useSharedGroupChildAsViewer();

      renderWorkspace();

      expect(screen.getByText("Read-only")).toBeDefined();
    });

    // The owner's side of the same fixture: the badge reads the group's state,
    // which is the only place it exists.
    test("the owner of a shared group sees Shared on every tab", () => {
      useSharedGroupChildAsViewer({ isOwner: true });

      renderWorkspace();

      expect(screen.getByText("Shared")).toBeDefined();
    });

    test("an unshared group shows no badge", () => {
      useSharedGroupChildAsViewer({ isOwner: true, shared: false });

      renderWorkspace();

      expect(screen.queryByText("Shared")).toBeNull();
      expect(screen.queryByText("Read-only")).toBeNull();
    });

    // The share lives on the container, so every tab shows the same state.
    // Gating the pill on the incoming thread's own doc blinked it out for the
    // round trip after each tab click; the outgoing row answers for the
    // Group child, since both read the same container.
    test.each([
      ["Shared", true],
      ["Read-only", false],
    ] as const)("holds the %s badge across a tab switch", (label, isOwner) => {
      useSharedGroupChildAsViewer({ isOwner });
      const loaded = useCliThreadMock();
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2" ? { isLoading: true, thread: null } : loaded
      );

      renderWorkspace();
      expect(screen.getByText(label)).toBeDefined();

      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      expect(screen.getByText(label)).toBeDefined();
    });

    // `isOwner` is unknown while the incoming tab's doc loads, and an unknown
    // owner reads as *not* read-only — so the owner-only cluster flashed in for
    // that beat before the doc landed and took it away again.
    test("never flashes owner-only actions mid-switch", () => {
      useSharedGroupChildAsViewer();
      const loaded = useCliThreadMock();
      useCliThreadMock.mockImplementation((id: string) =>
        id === "thread_2" ? { isLoading: true, thread: null } : loaded
      );

      renderWorkspace();
      fireEvent.click(
        within(screen.getByTestId("thread-header-tabs")).getByRole("tab", {
          name: "Group child thread",
        })
      );

      expect(screen.queryByRole("button", { name: "Thread actions" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Mark as (not )?done/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
      expect(screen.queryByRole("button", { name: "New thread in group" })).toBeNull();
      expect(screen.getByText("Read-only")).toBeDefined();
    });
  });

  describe("group container redirect (OS-1477)", () => {
    const LAST_TAB_KEY = "convoy.thread-group-last-tab.container_1";

    function useGroupContainer(
      children:
        | Array<{ _id: string; title: string; lastActivityAt: number; isDone?: boolean; doneAt?: number }>
        | null
    ) {
      useCliThreadMock.mockReturnValue({
        isLoading: false,
        thread: {
          _id: "container_1" as Id<"cliThreads">,
          projectId: "project_1" as Id<"projects">,
          profileId: "profile_1" as Id<"cliProfiles">,
          profileName: "Primary profile",
          pathId: "path_1",
          pathLabel: "project",
          pathString: "/tmp/project",
          cliType: "codex",
          kind: "group",
          title: "Group title",
          status: "completed",
          processingState: "idle",
          hasPendingUserMessages: false,
          hasUnread: false,
          requiresAttention: false,
          isDone: false,
          isPinned: false,
          lastActivityAt: Date.now(),
        },
      });
      groupQueryResult = children === null ? null : { children, totalRowCount: children.length };
    }

    beforeEach(() => {
      window.localStorage.removeItem(LAST_TAB_KEY);
    });

    test("replaces the container URL with the stored last-viewed tab", () => {
      window.localStorage.setItem(LAST_TAB_KEY, "thread_2");
      useGroupContainer([
        { _id: "thread_1", title: "First", lastActivityAt: 9 },
        { _id: "thread_2", title: "Second", lastActivityAt: 1 },
      ]);

      renderWorkspace();

      expect(routerReplaceMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/contoso/OS/threads/thread_2"),
        expect.anything()
      );
    });

    test("opens the most recently completed child even when an older done tab is remembered", () => {
      window.localStorage.setItem(LAST_TAB_KEY, "thread_1");
      useGroupContainer([
        { _id: "thread_1", title: "Older done", lastActivityAt: 9, isDone: true, doneAt: 10 },
        { _id: "thread_2", title: "Newest done", lastActivityAt: 1, isDone: true, doneAt: 20 },
      ]);

      renderWorkspace();

      expect(routerReplaceMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/contoso/OS/threads/thread_2"), expect.anything()
      );
    });

    test("falls back to the most recently active child when the stored tab is gone", () => {
      window.localStorage.setItem(LAST_TAB_KEY, "thread_gone");
      useGroupContainer([
        { _id: "thread_1", title: "Older", lastActivityAt: 2 },
        { _id: "thread_2", title: "Newest", lastActivityAt: 5 },
      ]);

      renderWorkspace();

      expect(routerReplaceMock).toHaveBeenCalledWith(
        expect.stringContaining("/o/contoso/OS/threads/thread_2"),
        expect.anything()
      );
    });

    test("renders the not-found state instead of redirecting when the group is gone or empty", () => {
      useGroupContainer(null);
      const { unmount } = renderWorkspace();
      expect(screen.getByText("Thread not found")).toBeDefined();
      expect(routerReplaceMock).not.toHaveBeenCalled();
      unmount();

      useGroupContainer([]);
      renderWorkspace();
      expect(screen.getByText("Thread not found")).toBeDefined();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });
});
