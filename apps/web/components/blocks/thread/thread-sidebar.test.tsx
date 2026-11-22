/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadSidebar } from "./thread-sidebar";
import { ThreadListCollapseProvider } from "./thread-list-collapse-context";
import { expectEmptyState } from "@/test-utils/empty-state";

const setTaskMock = vi.fn();

// Functional useHotkey mock: registers handlers so tests can simulate keys
// while respecting the `enabled` option.
const { hotkeys } = vi.hoisted(() => ({
  hotkeys: {} as Record<string, { handler: () => void; enabled: boolean }>,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: (key: string, handler: () => void, options?: { enabled?: boolean }) => {
    hotkeys[key] = { handler, enabled: options?.enabled !== false };
  },
}));

// Counts how often the sidebar renders its list. The stub is deliberately not
// memoized, so it re-renders exactly when the sidebar does; the real row (and
// its own memo) still does the rendering underneath.
const { rowRenders } = vi.hoisted(() => ({ rowRenders: { count: 0 } }));

vi.mock("./thread-list-item", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./thread-list-item")>();
  return {
    ...actual,
    ThreadListItem: (props: ComponentProps<typeof actual.ThreadListItem>) => {
      rowRenders.count += 1;
      return <actual.ThreadListItem {...props} />;
    },
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useThreadNavigationState: () => ({
      openTask: setTaskMock,
      taskHref: (taskRefId: string | null) =>
        taskRefId ? `/o/acme/WEB/threads/thread_1?task=${taskRefId}` : "/o/acme/WEB/threads/thread_1",
    }),
  };
});

vi.mock("./thread-connected-clis-section", () => ({
  ThreadConnectedClisSection: () => <div>Connected CLIs</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/thread/thread-sidebar-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/blocks/thread/thread-sidebar-settings")>()),
  ThreadSidebarSettings: ({
    onEnableMultiSelect,
    onOpenView,
    onHideList,
  }: {
    onEnableMultiSelect?: () => void;
    onOpenView?: (view: "shared" | "background") => void;
    onHideList?: () => void;
  }) => (
    <div>
      Settings
      {onHideList ? (
        <button type="button" onClick={onHideList}>
          Hide thread list
        </button>
      ) : null}
      {onEnableMultiSelect ? (
        <button type="button" onClick={onEnableMultiSelect}>
          Select multiple
        </button>
      ) : null}
      {onOpenView ? (
        <>
          <button type="button" onClick={() => onOpenView("shared")}>
            Shared threads
          </button>
          <button type="button" onClick={() => onOpenView("background")}>
            Background threads
          </button>
        </>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, className }: { children: ReactNode; onClick?: (event: unknown) => void; className?: string }) => (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("./rename-thread-dialog", () => ({
  RenameThreadDialog: ({
    open,
    currentTitle,
    threadId,
    onRename,
  }: {
    open: boolean;
    currentTitle: string;
    threadId?: Id<"cliThreads">;
    onRename: (threadId: Id<"cliThreads">, title: string) => Promise<void>;
  }) =>
    open ? (
      <div>
        <p>Rename dialog</p>
        <p>{currentTitle}</p>
        <button type="button" onClick={() => threadId && onRename(threadId, "Renamed thread")}>
          Confirm rename
        </button>
      </div>
    ) : null,
}));

const threadId = "chat_1" as Id<"cliThreads">;

function buildThreadSidebarProps(
  overrides: Partial<ComponentProps<typeof ThreadSidebar>> & Pick<ComponentProps<typeof ThreadSidebar>, "threads">
): ComponentProps<typeof ThreadSidebar> {
  return {
    projectId: "project_1" as Id<"projects">,
    doneThreads: [],
    pinnedThreads: [],
    currentThreadId: undefined,
    organizationSlug: "org",
    projectAlias: "ABC",
    projectName: "My Project",
    width: 320,
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    onSelectThread: vi.fn(),
    onToggleRead: vi.fn().mockResolvedValue(undefined),
    onToggleDone: vi.fn().mockResolvedValue(undefined),
    onPinToggle: vi.fn(),
    onBatchMarkRead: vi.fn().mockResolvedValue(undefined),
    onBatchMarkDone: vi.fn().mockResolvedValue(undefined),
    onBatchMarkNotDone: vi.fn().mockResolvedValue(undefined),
    onBatchDelete: vi.fn().mockResolvedValue(undefined),
    sortBy: "created",
    compactLayout: false,
    groupDone: false,
    onSortByChange: vi.fn(),
    onCompactLayoutChange: vi.fn(),
    onGroupDoneChange: vi.fn(),
    hasMoreDone: false,
    isLoadingMoreDone: false,
    onLoadMoreDone: vi.fn(),
    isLoading: false,
    hasMore: false,
    isLoadingMore: false,
    onLoadMore: vi.fn(),
    view: null,
    viewThreads: [],
    isLoadingView: false,
    hasMoreView: false,
    isLoadingMoreView: false,
    onLoadMoreView: vi.fn(),
    onOpenView: vi.fn(),
    onCloseView: vi.fn(),
    onResizeMouseDown: vi.fn(),
    onResizeByStep: vi.fn(),
    ...overrides,
    // Explicit assignment keeps `threads` non-optional after spreading overrides.
    threads: overrides.threads,
  };
}

function renderThreadSidebar(
  overrides: Partial<ComponentProps<typeof ThreadSidebar>> & Pick<ComponentProps<typeof ThreadSidebar>, "threads">
) {
  return render(<ThreadSidebar {...buildThreadSidebarProps(overrides)} />);
}

describe("ThreadSidebar", () => {
  afterEach(() => {
    cleanup();
    setTaskMock.mockReset();
  });

  test("uses the normal compact thread surface for the sidebar background", () => {
    const { container } = renderThreadSidebar({
      threads: [],
      compactLayout: true,
    });

    expect(container.querySelector("aside")?.className).toContain("bg-card");
  });

  test("an empty project list is the shared empty state", () => {
    renderThreadSidebar({ threads: [] });

    expectEmptyState("No threads yet");
  });

  test("shows connected CLIs between New thread and Pinned (OS-1993)", () => {
    renderThreadSidebar({ threads: [], pinnedThreads: [makeThread(1)] });

    const text = document.body.textContent ?? "";
    expect(text.indexOf("New thread")).toBeLessThan(text.indexOf("Connected CLIs"));
    expect(text.indexOf("Connected CLIs")).toBeLessThan(text.indexOf("Pinned"));
  });

  test("shows Rename action in chat item menu", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Original chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
    });

    expect(screen.getByText("Rename")).toBeDefined();
  });

  test.each([
    { isDone: false, label: "Mark as done" },
    { isDone: true, label: "Mark as not done" },
  ])("toggles the sidebar row done state from $label", ({ isDone, label }) => {
    const onToggleDone = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Review thread",
          status: "completed",
          cliType: "codex",
          hasUnread: false,
          requiresAttention: false,
          isDone,
          lastActivityAt: Date.now(),
        },
      ],
      compactLayout: true,
      onToggleDone,
    });

    const doneShortcut = screen.getAllByRole("button", { name: label }).find((button) => button.getAttribute("title") === label);
    if (!doneShortcut) {
      throw new Error(`Expected ${label} sidebar shortcut`);
    }
    fireEvent.click(doneShortcut);

    expect(onToggleDone).toHaveBeenCalledWith(threadId, isDone);
  });

  test("renders Active and Done sections when done grouping is on (OS-1394)", () => {
    const row = (id: string, isDone: boolean) => ({
      _id: id as Id<"cliThreads">,
      title: id,
      status: "completed" as const,
      cliType: "codex" as const,
      hasUnread: false,
      requiresAttention: false,
      isDone,
      lastActivityAt: Date.now(),
    });

    renderThreadSidebar({
      threads: [row("Active thread", false)],
      doneThreads: [row("Done thread", true)],
      groupDone: true,
    });

    expect(screen.getByText("Active")).toBeDefined();
    // Collapsed by default, so only the section header is mounted.
    const doneSection = screen.getByRole("button", { name: "Done" });
    expect(screen.queryByText("Done thread")).toBeNull();
    fireEvent.click(doneSection);
    expect(screen.getByText("Done thread")).toBeDefined();
  });

  test("does not render a page-level sidebar toggle in the thread header", () => {
    renderThreadSidebar({ threads: [] });

    expect(screen.queryByRole("button", { name: /toggle sidebar/i })).toBeNull();
  });

  test("opens rename dialog and calls onRename", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Original chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      onRename,
    });

    fireEvent.click(screen.getAllByText("Rename")[0]);
    expect(screen.getByText("Rename dialog")).toBeDefined();
    expect(screen.getAllByText("Original chat").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Confirm rename"));
    await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith(threadId, "Renamed thread"));
  });

  test("shows read state action labels", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Read chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
        {
          _id: "chat_2" as Id<"cliThreads">,
          title: "Unread chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: true,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
    });

    expect(screen.getByText("Mark as unread")).toBeDefined();
    expect(screen.getByText("Mark as read")).toBeDefined();
  });

  test("read failed and waiting-input threads still offer mark as read", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Failed read thread",
          status: "failed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: true,
          lastActivityAt: Date.now(),
        },
        {
          _id: "chat_2" as Id<"cliThreads">,
          title: "Waiting read thread",
          status: "waiting_input",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: true,
          lastActivityAt: Date.now() - 1000,
        },
      ],
    });

    expect(screen.getAllByText("Mark as read")).toHaveLength(2);
    expect(screen.queryByText("Mark as unread")).toBeNull();
  });

  test("active chat can trigger mark as unread", async () => {
    const onToggleRead = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Active read chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      currentThreadId: threadId,
      onToggleRead,
    });

    fireEvent.click(screen.getByText("Mark as unread"));

    await vi.waitFor(() => expect(onToggleRead).toHaveBeenCalledWith(threadId, false, false, true));
  });

  test("forwards chat selection with active-state flag", () => {
    const onSelectThread = vi.fn();
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Selected chat",
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      currentThreadId: threadId,
      onSelectThread,
    });

    fireEvent.click(screen.getByRole("link", { name: "Open thread Selected chat" }));
    expect(onSelectThread).toHaveBeenCalledWith(threadId, true);
  });

  test("renders associated task refs as project links, including archived tasks", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Selected chat",
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            isArchived: true,
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      organizationSlug: "contoso",
      projectAlias: "OS",
    });

    expect(screen.getByRole("link", { name: /OS-42/i }).getAttribute("href")).toBe(
      "/o/contoso/OS/threads/chat_1?task=OS-42&archived=true"
    );
  });

  test("active thread associated task opens in place instead of navigating", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Selected chat",
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            isArchived: true,
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      currentThreadId: threadId,
      organizationSlug: "contoso",
      projectAlias: "OS",
    });

    fireEvent.click(screen.getByRole("link", { name: /OS-42/i }));

    expect(setTaskMock).toHaveBeenCalledWith("OS-42", "archived");
  });

  test("keeps task ref and title inline in full layout", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Selected chat",
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            isArchived: false,
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      organizationSlug: "contoso",
      projectAlias: "OS",
    });

    const taskLink = screen.getByRole("link", { name: /OS-42/i });
    const title = screen.getByTitle("Selected chat");

    expect(taskLink.parentElement).toBe(title.parentElement);
  });

  test("keeps task ref and title inline in compact layout", () => {
    renderThreadSidebar({
      threads: [
        {
          _id: threadId,
          title: "Selected chat",
          associatedTask: {
            _id: "task_1" as Id<"tasks">,
            refId: "OS-42",
            name: "Fix login",
            isArchived: false,
            taskType: {
              key: "task",
              name: "Task",
              icon: "SquareCheckBig",
              color: "#64748b",
              isSystem: true,
            },
          },
          status: "completed",
          cliType: "claude-code",
          hasUnread: false,
          requiresAttention: false,
          lastActivityAt: Date.now(),
        },
      ],
      organizationSlug: "contoso",
      projectAlias: "OS",
      compactLayout: true,
    });

    const taskLink = screen.getByRole("link", { name: /OS-42/i });
    const title = screen.getByTitle("Selected chat");

    expect(taskLink.parentElement).toBe(title.parentElement);
  });

  test("matches section headers to thread row surfaces only in compact layout", () => {
    const pinnedThread = makeThread(1, {
      title: "Pinned thread",
      isPinned: true,
    });
    const regularThread = makeThread(2, { title: "Regular thread" });

    renderThreadSidebar({
      pinnedThreads: [pinnedThread],
      threads: [regularThread],
      compactLayout: true,
    });

    expect(screen.getByRole("button", { name: "Pinned" }).className).toContain("bg-card");
    expect(screen.getByText("Threads").className).toContain("bg-card");

    cleanup();

    renderThreadSidebar({
      pinnedThreads: [pinnedThread],
      threads: [regularThread],
      compactLayout: false,
    });

    expect(screen.getByRole("button", { name: "Pinned" }).className).not.toContain("bg-card");
    expect(screen.getByText("Threads").className).not.toContain("bg-card");
  });

  test("applies width and keyboard resizing through the separator", () => {
    const onResizeByStep = vi.fn();

    renderThreadSidebar({
      threads: [],
      width: 384,
      onResizeByStep,
    });

    const sidebar = screen.getByRole("separator", {
      name: "Resize thread sidebar",
    });

    expect(sidebar.getAttribute("aria-valuenow")).toBe("384");
    expect(sidebar.parentElement?.getAttribute("style")).toContain("width: 384px");

    fireEvent.keyDown(sidebar, { key: "ArrowRight" });
    fireEvent.keyDown(sidebar, { key: "ArrowLeft", shiftKey: true });

    expect(onResizeByStep).toHaveBeenNthCalledWith(1, 16, { persist: true });
    expect(onResizeByStep).toHaveBeenNthCalledWith(2, -48, { persist: true });
  });
});

function makeThread(
  n: number,
  overrides: Partial<ComponentProps<typeof ThreadSidebar>["threads"][number]> = {}
): ComponentProps<typeof ThreadSidebar>["threads"][number] {
  return {
    _id: `chat_${n}` as Id<"cliThreads">,
    title: `Thread ${n}`,
    status: "completed",
    cliType: "claude-code",
    hasUnread: false,
    requiresAttention: false,
    lastActivityAt: Date.now(),
    ...overrides,
  };
}

function enableMultiSelect() {
  fireEvent.click(screen.getByText("Select multiple"));
}

describe("ThreadSidebar shared-threads view (OS-1576)", () => {
  afterEach(() => {
    cleanup();
  });

  test("the settings entry asks the container to open the view", () => {
    const onOpenView = vi.fn();
    renderThreadSidebar({ threads: [makeThread(1)], onOpenView });

    fireEvent.click(screen.getByText("Shared threads"));

    expect(onOpenView).toHaveBeenCalledWith("shared");
  });

  test("replaces the thread list rather than mixing shared rows into it", () => {
    renderThreadSidebar({
      threads: [makeThread(1)],
      pinnedThreads: [makeThread(2)],
      viewThreads: [makeThread(3, { sharedAt: 1000 })],
      view: "shared",
    });

    expect(screen.getByText("Thread 3")).toBeDefined();
    expect(screen.queryByText("Thread 1")).toBeNull();
    expect(screen.queryByText("Thread 2")).toBeNull();
    // The view is a read-out of what's shared, not a place to start work.
    expect(screen.queryByText("New thread")).toBeNull();
    expect(screen.queryByText("Connected CLIs")).toBeNull();
  });

  test("the header names the view and the settings gear steps aside", () => {
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [makeThread(3, { sharedAt: 1000 })],
      view: "shared",
    });

    expect(screen.getByText("Shared threads")).toBeDefined();
    // The gear would offer sort/density/multiselect that this view doesn't
    // honour, and re-entering the view it's already in.
    expect(screen.queryByText("Settings")).toBeNull();
  });

  test("X exits the view", () => {
    const onCloseView = vi.fn();
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [makeThread(3, { sharedAt: 1000 })],
      view: "shared",
      onCloseView,
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit shared threads" }));

    expect(onCloseView).toHaveBeenCalledTimes(1);
  });

  test("Escape exits the view", () => {
    const onCloseView = vi.fn();
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [],
      view: "shared",
      onCloseView,
    });

    pressEscape();

    expect(onCloseView).toHaveBeenCalledTimes(1);
  });

  test("pages the rest in with Load more", () => {
    const onLoadMoreView = vi.fn();
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [makeThread(3, { sharedAt: 1000 })],
      view: "shared",
      hasMoreView: true,
      onLoadMoreView,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(onLoadMoreView).toHaveBeenCalledTimes(1);
  });

  test("offers no Load more once the last page is in", () => {
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [makeThread(3, { sharedAt: 1000 })],
      view: "shared",
      hasMoreView: false,
    });

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  test("says nothing is shared instead of reading as an empty project", () => {
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [],
      view: "shared",
    });

    expectEmptyState("No shared threads");
    expect(screen.queryByText("No threads yet")).toBeNull();
  });

  test("holds the empty state back while the shared query is still loading", () => {
    renderThreadSidebar({
      threads: [makeThread(1)],
      viewThreads: [],
      isLoadingView: true,
      view: "shared",
    });

    expect(screen.queryByText("No shared threads")).toBeNull();
  });
});

describe("ThreadSidebar background-threads view (OS-2513)", () => {
  afterEach(() => {
    cleanup();
  });

  test("the settings entry opens it", () => {
    const onOpenView = vi.fn();
    renderThreadSidebar({ threads: [makeThread(1)], onOpenView });

    fireEvent.click(screen.getByText("Background threads"));

    expect(onOpenView).toHaveBeenCalledWith("background");
  });

  test("names itself in the header and exit button, and says when it is empty", () => {
    const onCloseView = vi.fn();
    renderThreadSidebar({ threads: [makeThread(1)], viewThreads: [], view: "background", onCloseView });

    expect(screen.getByText("Background threads")).toBeDefined();
    expectEmptyState("No background threads");
    fireEvent.click(screen.getByRole("button", { name: "Exit background threads" }));
    expect(onCloseView).toHaveBeenCalledTimes(1);
  });
});

function selectThread(n: number) {
  fireEvent.click(screen.getByRole("checkbox", { name: `Select thread Thread ${n}` }));
}

function pressEscape() {
  const entry = hotkeys["Escape"];
  if (entry?.enabled) {
    act(() => entry.handler());
  }
}

describe("ThreadSidebar multiselect", () => {
  afterEach(() => {
    cleanup();
    delete hotkeys["Escape"];
  });

  test("settings entry enables the mode with persistent checkboxes and an icon toolbar", () => {
    renderThreadSidebar({ threads: [makeThread(1), makeThread(2)] });

    expect(screen.queryByRole("checkbox")).toBeNull();

    enableMultiSelect();

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.getByText("0 selected")).toBeDefined();

    const labels = ["Mark selected as read", "Mark selected as done", "Delete selected", "Exit multiselect"];
    const buttons = labels.map((label) => screen.getByRole("button", { name: label }) as HTMLButtonElement);
    // Fixed order: mark read, mark done, delete, then exit in the gear's slot.
    for (let index = 0; index < buttons.length - 1; index += 1) {
      expect(buttons[index].compareDocumentPosition(buttons[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Zero selection: actions disabled, exit stays enabled.
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[2].disabled).toBe(true);
    expect(buttons[3].disabled).toBe(false);
  });

  test("action enablement derives from the selected rows", () => {
    renderThreadSidebar({
      threads: [makeThread(1, { hasUnread: true }), makeThread(2)],
    });
    enableMultiSelect();

    // Already-read selection: mark-read disabled, done and delete enabled.
    selectThread(2);
    expect(
      (
        screen.getByRole("button", {
          name: "Mark selected as read",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Mark selected as done",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Delete selected",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);

    // Adding an unread row enables mark-read.
    selectThread(1);
    expect(screen.getByText("2 selected")).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "Mark selected as read",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  test("shift+click selects the visible range", () => {
    renderThreadSidebar({
      threads: [makeThread(1), makeThread(2), makeThread(3)],
    });
    enableMultiSelect();

    selectThread(1);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select thread Thread 3" }), { shiftKey: true });

    expect(screen.getByText("3 selected")).toBeDefined();
  });

  test("successful mark-read clears the selection but keeps the mode", async () => {
    const onBatchMarkRead = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [makeThread(1, { hasUnread: true })],
      onBatchMarkRead,
    });
    enableMultiSelect();
    selectThread(1);

    fireEvent.click(screen.getByRole("button", { name: "Mark selected as read" }));

    expect(onBatchMarkRead).toHaveBeenCalledWith(["chat_1"]);
    await vi.waitFor(() => expect(screen.getByText("0 selected")).toBeDefined());
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  test("done button marks done, and flips direction when every selected row is done", async () => {
    const onBatchMarkDone = vi.fn().mockResolvedValue(undefined);
    const onBatchMarkNotDone = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [makeThread(1), makeThread(2, { isDone: true })],
      onBatchMarkDone,
      onBatchMarkNotDone,
    });
    enableMultiSelect();

    // Mixed selection (one not done) → mark as done.
    selectThread(1);
    selectThread(2);
    fireEvent.click(screen.getByRole("button", { name: "Mark selected as done" }));
    expect(onBatchMarkDone).toHaveBeenCalledWith(["chat_1", "chat_2"]);
    await vi.waitFor(() => expect(screen.getByText("0 selected")).toBeDefined());

    // All-done selection → mark as not done.
    selectThread(2);
    fireEvent.click(screen.getByRole("button", { name: "Mark selected as not done" }));
    expect(onBatchMarkNotDone).toHaveBeenCalledWith(["chat_2"]);
  });

  test("failed batch action preserves the selection", async () => {
    const onBatchMarkDone = vi.fn().mockRejectedValue(new Error("nope"));
    renderThreadSidebar({
      threads: [makeThread(1)],
      onBatchMarkDone,
    });
    enableMultiSelect();
    selectThread(1);

    fireEvent.click(screen.getByRole("button", { name: "Mark selected as done" }));

    await vi.waitFor(() => expect(onBatchMarkDone).toHaveBeenCalled());
    // The selection clears optimistically and is restored when the call fails.
    await vi.waitFor(() => expect(screen.getByText("1 selected")).toBeDefined());
  });

  test("deleting a group row warns that all threads in the group are deleted (OS-1476)", () => {
    renderThreadSidebar({
      threads: [makeThread(1, { kind: "group" })],
    });

    // Mocked dropdowns render row items inline; the first Delete is the row action.
    fireEvent.click(screen.getAllByText("Delete").at(0)!);

    expect(screen.getByText("Delete group?")).toBeDefined();
    expect(screen.getByText(/and all threads in the group will be permanently deleted/)).toBeDefined();
  });

  test("batch delete warns about groups when the selection contains one (OS-1476)", () => {
    renderThreadSidebar({
      threads: [makeThread(1, { kind: "group" }), makeThread(2)],
    });
    enableMultiSelect();
    selectThread(1);
    selectThread(2);

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    expect(screen.getByText(/including every thread inside selected groups/)).toBeDefined();
  });

  test("delete confirms with a count-aware dialog and exact ids", async () => {
    const onBatchDelete = vi.fn().mockResolvedValue(undefined);
    renderThreadSidebar({
      threads: [makeThread(1), makeThread(2)],
      onBatchDelete,
    });
    enableMultiSelect();
    selectThread(1);
    selectThread(2);

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByText(/Delete\s*2 threads\s*\?/)).toBeDefined();

    // Row action menus also render a "Delete" item (mocked dropdowns are
    // always visible); the dialog's confirm button is the last one in the DOM.
    fireEvent.click(screen.getAllByText("Delete").at(-1)!);

    expect(onBatchDelete).toHaveBeenCalledWith(["chat_1", "chat_2"]);
    await vi.waitFor(() => expect(screen.getByText("0 selected")).toBeDefined());
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  test("X exits the mode and restores the settings header", () => {
    renderThreadSidebar({ threads: [makeThread(1)] });
    enableMultiSelect();
    selectThread(1);

    fireEvent.click(screen.getByRole("button", { name: "Exit multiselect" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Settings")).toBeDefined();
  });

  test("Escape exits the mode, but is disabled while the delete dialog is open", async () => {
    renderThreadSidebar({ threads: [makeThread(1)] });
    enableMultiSelect();
    selectThread(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    // Dialog owns Escape while open.
    expect(hotkeys["Escape"]?.enabled).toBe(false);
    pressEscape();
    expect(screen.getByText("1 selected")).toBeDefined();

    // Confirming closes the dialog; the mode survives the action.
    fireEvent.click(screen.getAllByText("Delete").at(-1)!);
    await vi.waitFor(() => expect(hotkeys["Escape"]?.enabled).toBe(true));

    pressEscape();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Settings")).toBeDefined();
  });
});

/**
 * The sidebar's memo gate (OS-1581). Its comparator decides field by field whether a
 * realtime update is worth a render, so anything a row renders that the comparator
 * doesn't read gets swallowed. These re-render with everything else held identical, so
 * only the comparator can be what lets the change through.
 */
describe("ThreadSidebar list memoization (OS-1581)", () => {
  afterEach(() => {
    cleanup();
  });

  test("holds when the list update changed nothing a row renders", () => {
    // Without this, every test below would pass on a sidebar with no memo at
    // all: they only prove changes get through, not that anything is gated.
    const { applyThreadPatch } = renderWithStableProps(makeThread(1));
    const rendersBefore = rowRenders.count;

    // A rebuilt list of structurally identical rows — what Convex sends when
    // something the sidebar doesn't render changed.
    applyThreadPatch({});

    expect(rowRenders.count).toBe(rendersBefore);
  });

  function renderWithStableProps(thread: ComponentProps<typeof ThreadSidebar>["threads"][number]) {
    // Built once: every handler prop keeps its identity across the re-render,
    // the way the container's memoized callbacks do.
    const props = buildThreadSidebarProps({ threads: [thread] });
    const { rerender } = render(<ThreadSidebar {...props} />);

    return {
      applyThreadPatch: (patch: Partial<ComponentProps<typeof ThreadSidebar>["threads"][number]>) => {
        rerender(<ThreadSidebar {...props} threads={[{ ...thread, ...patch }]} />);
      },
    };
  }

  test("a thread that gains a pull request shows its badge", () => {
    const { applyThreadPatch } = renderWithStableProps(makeThread(1, { branch: "feat/x" }));

    applyThreadPatch({
      pullRequest: {
        provider: "github",
        number: 7,
        title: "Add the thing",
        url: "https://github.com/acme/web/pull/7",
        state: "open",
        headBranch: "feat/x",
        baseBranch: "main",
        capturedAt: 1000,
      },
    });

    expect(screen.getAllByLabelText("PR #7 · Open — Add the thing").length).toBeGreaterThan(0);
  });

  test("keeps the done action enabled while a run streams (OS-2176)", () => {
    renderWithStableProps(makeThread(1, { status: "streaming" }));
    expect(screen.getAllByRole("button", { name: "Mark as done" })[0].hasAttribute("disabled")).toBe(false);
  });

  test("a thread reparented into a group loses its share action", () => {
    const { applyThreadPatch } = renderWithStableProps(makeThread(1));
    expect(screen.getAllByText("Share with project team").length).toBeGreaterThan(0);

    applyThreadPatch({ parentThreadId: "chat_9" as Id<"cliThreads"> });

    expect(screen.queryByText("Share with project team")).toBeNull();
  });

  test("a thread that becomes a group loses its thread-only actions", () => {
    const { applyThreadPatch } = renderWithStableProps(makeThread(1));
    expect(screen.getAllByText("Share with project team").length).toBeGreaterThan(0);

    applyThreadPatch({ kind: "group" });

    expect(screen.queryByText("Share with project team")).toBeNull();
  });
});

describe("ThreadSidebar collapse (thread list)", () => {
  afterEach(cleanup);

  function renderInCollapseProvider(
    overrides: Pick<ComponentProps<typeof ThreadSidebar>, "threads"> &
      Partial<ComponentProps<typeof ThreadSidebar>>
  ) {
    const value = { collapsed: false, toggle: vi.fn(), hasAttention: false, setHasAttention: vi.fn() };
    render(
      <ThreadListCollapseProvider value={value}>
        <ThreadSidebar {...buildThreadSidebarProps(overrides)} />
      </ThreadListCollapseProvider>
    );
    return value;
  }

  test("the settings entry collapses the list", () => {
    const { toggle } = renderInCollapseProvider({ threads: [] });
    fireEvent.click(screen.getByRole("button", { name: "Hide thread list" }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  test("reports unread or attention threads for the reopen badge", () => {
    const { setHasAttention } = renderInCollapseProvider({
      threads: [makeThread(1)],
      pinnedThreads: [makeThread(2, { requiresAttention: true })],
    });
    expect(setHasAttention).toHaveBeenLastCalledWith(true);
  });

  test("reports no attention when every thread is read", () => {
    const { setHasAttention } = renderInCollapseProvider({ threads: [makeThread(1)] });
    expect(setHasAttention).toHaveBeenLastCalledWith(false);
  });
});
