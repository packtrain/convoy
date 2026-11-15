/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProjectPage from "./page";
import {
  ARCHIVE_COMPLETED_TASKS_HOTKEY,
  CREATE_TASK_AT_TOP_HOTKEY,
  CREATE_TASK_DIALOG_HOTKEY,
  MOVE_CLOSED_TASKS_BOTTOM_HOTKEY,
} from "@/lib/browser/hotkeys";
import { clearLastResolvedRouteValueCacheForTests } from "@/lib/routing/use-last-resolved-route-value";
import { clearLastResolvedValueCacheForTests } from "@/hooks/react/use-last-resolved-value";

type HotkeyCallback = (
  event: KeyboardEvent,
  context: { hotkey: string }
) => void;

const hotkeyRegistrations = new Map<
  string,
  {
    callback: HotkeyCallback;
    options?: { enabled?: boolean };
  }
>();

const useQueryMock = vi.fn();
const useConvexAuthMock = vi.fn();
const useTasksMock = vi.fn();
const useArchivedTasksMock = vi.fn();
const useProjectNavigationStateMock = vi.fn();
const useProjectTaskViewsMock = vi.fn();
const useShowTaskListRankMock = vi.fn();
const projectHeaderMock = vi.fn();
const taskTableMock = vi.fn();
const mobileNavBarMock = vi.fn();
const setDetailSurfaceOpenMock = vi.fn();
const openCreateTaskDialogMock = vi.hoisted(() => vi.fn());
const taskSidebarNavigationState = vi.hoisted(() => ({
  detailsTask: null as ReturnType<typeof makeTask> | null,
  isSidebarOpen: false,
  openTaskSidebar: vi.fn(),
  closeTaskSidebar: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn<((message: string, options?: unknown) => string)>(
    () => "toast-1"
  ),
  dismiss: vi.fn(),
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: (
    hotkey: string,
    callback: HotkeyCallback,
    options?: { enabled?: boolean }
  ) => {
    hotkeyRegistrations.set(hotkey, { callback, options });
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
  usePathname: () => "/o/acme/WEB",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "user-1" }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => useConvexAuthMock(),
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(),
}));

vi.mock("@/lib/tasks/hooks/use-tasks", () => ({
  useTasks: (...args: unknown[]) => useTasksMock(...args),
}));

vi.mock("@/lib/tasks/hooks/use-archived-tasks", () => ({
  useArchivedTasks: (...args: unknown[]) => useArchivedTasksMock(...args),
}));

vi.mock("@/components/blocks/tasks/create-task-dialog-context", () => ({
  useCreateTaskDialog: () => ({
    openCreateTaskDialog: openCreateTaskDialogMock,
  }),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useProjectNavigationState: () => ({
      normalizedListTarget: () => actual.routeTarget("/o/acme/WEB"),
      listViewTarget: () => actual.routeTarget("/o/acme/WEB"),
      boardViewTarget: () => actual.routeTarget("/o/acme/WEB/kanban"),
      selectedListHref: () => "/o/acme/WEB",
      backlogHref: () => "/o/acme/WEB?status=backlog",
      archivedHref: () => "/o/acme/WEB?archived=true",
      boardPreferredTarget: () =>
        actual.routeTarget("/o/acme/WEB", { query: { view: "board" } }),
      taskWithArchiveHref: (taskRefId: string) => `/o/acme/WEB?task=${taskRefId}`,
      openTask: vi.fn(),
      openTaskWithArchive: vi.fn(),
      openTaskInBoard: vi.fn(),
      taskInBoardHref: (taskRefId: string, archiveFilter: "active" | "archived") =>
        archiveFilter === "archived"
          ? `/o/acme/WEB?task=${taskRefId}&archived=true&view=board`
          : `/o/acme/WEB?task=${taskRefId}&view=board`,
      selectArtifact: vi.fn(),
      selectTaskArtifact: vi.fn(),
      ...useProjectNavigationStateMock(),
    }),
  };
});

vi.mock("@/lib/dev-mode/use-dev-mode", () => ({
  useShowTaskListRank: () => useShowTaskListRankMock(),
}));

vi.mock("./project-task-views-context", () => ({
  useProjectTaskViews: () => useProjectTaskViewsMock(),
}));

vi.mock("@/lib/tasks/status-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tasks/status-policy")>();
  return {
    ...actual,
    getAllowedTaskStatuses: () => ["To Do", "Done", "Canceled"],
  };
});

vi.mock("@/lib/tasks/hooks/use-task-sidebar-navigation", () => ({
  useTaskSidebarNavigation: () => ({
    detailsTask: taskSidebarNavigationState.detailsTask,
    isSidebarOpen: taskSidebarNavigationState.isSidebarOpen,
    openTaskSidebar: taskSidebarNavigationState.openTaskSidebar,
    closeTaskSidebar: taskSidebarNavigationState.closeTaskSidebar,
  }),
}));

vi.mock("@/hooks/ui/use-resize-panel", () => ({
  useResizePanel: () => ({
    width: 320,
    handleMouseDown: vi.fn(),
    adjustWidthBy: vi.fn(),
  }),
}));

vi.mock("@/components/blocks/project/project-header", () => ({
  ProjectHeader: (props: Record<string, unknown>) => {
    projectHeaderMock(props);
    return <div data-testid="project-header" />;
  },
}));

vi.mock("@/components/blocks/tasks/task-table", () => ({
  TaskTable: (props: Record<string, unknown>) => {
    taskTableMock(props);
    return <div data-testid="task-table" data-task-table-scroll-container />;
  },
}));

vi.mock("@/components/blocks/tasks/archive-completed-dialog", () => ({
  ArchiveCompletedDialog: ({
    open,
    completedTaskCount,
    onConfirm,
  }: {
    open: boolean;
    completedTaskCount: number;
    onConfirm: () => void;
  }) =>
    open ? (
      <div data-testid="archive-completed-dialog">
        Archive {completedTaskCount} completed tasks
        <button type="button" onClick={onConfirm}>
          Confirm archive
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/blocks/tasks/task-detail-sidebar", () => ({
  TaskDetailSidebar: () => null,
}));

vi.mock("@/components/blocks/tasks/task-sidebar-overlay", () => ({
  TaskSidebarOverlay: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/blocks/tasks/multi-select-toolbar", () => ({
  MultiSelectToolbar: () => null,
}));

vi.mock("@/components/blocks/tasks/bulk-delete-dialog", () => ({
  BulkDeleteDialog: ({ open, onDeleteAll }: { open: boolean; onDeleteAll: () => void }) =>
    open ? (
      <button type="button" data-testid="bulk-delete-dialog" onClick={onDeleteAll}>
        Confirm delete
      </button>
    ) : null,
}));

vi.mock("@/components/blocks/mobile/mobile-nav-bar", () => ({
  MobileNavBar: (props: Record<string, unknown>) => {
    mobileNavBarMock(props);
    return <div data-testid="mobile-nav-bar" />;
  },
}));

vi.mock("@/components/blocks/mobile/mobile-menu-panel", () => ({
  MobileMenuPanel: () => null,
}));

vi.mock("@/components/blocks/mobile/mobile-search-panel", () => ({
  MobileSearchPanel: () => null,
}));

vi.mock("@/components/blocks/mobile/mobile-toolbar-panel", () => ({
  MobileToolbarPanel: () => null,
}));

vi.mock("@/components/blocks/mobile/mobile-create-task-panel", () => ({
  MobileCreateTaskPanel: () => null,
}));

vi.mock("@/components/blocks/no-access", () => ({
  NoAccess: () => <div data-testid="no-access" />,
}));


vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMock.success,
    error: toastMock.error,
    message: toastMock.message,
    dismiss: toastMock.dismiss,
  },
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: "task-1",
    clientId: "client-1",
    name: "Task",
    rank: "0|i0000:",
    status: "To Do",
    parentId: null,
    priority: "None",
    isArchived: false,
    updatedAt: 0,
    createdAt: 0,
    tags: [],
    ...overrides,
  };
}

function createTaskHookResult(tasks: ReturnType<typeof makeTask>[]) {
  return {
    tasks,
    taskTree: [],
    isLoading: false,
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    addTask: vi.fn(),
    reorderTasks: vi.fn(),
    reorderMultiple: vi.fn(),
    setParent: vi.fn(),
    setParentMultiple: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkUpdateAssignee: vi.fn(),
    bulkUpdatePriority: vi.fn(),
    bulkUpdateDueDate: vi.fn(),
    bulkUpdateTaskType: vi.fn(),
    bulkDelete: vi.fn(),
    bulkDeleteWithChildren: vi.fn(),
    bulkArchive: vi.fn(async (ids: string[]) => ids),
    bulkUnarchive: vi.fn(async () => undefined),
    moveClosedToBottom: vi.fn(),
    duplicateTask: vi.fn(),
    archiveTask: vi.fn(async (id: string) => [id]),
    unarchiveTask: vi.fn(async () => undefined),
    restoreTask: vi.fn(),
    inputRefs: { current: new Map() },
    focusInput: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    isLoadingMore: false,
  };
}

function setProjectUrlState({
  archiveFilter = "active",
  statusFilter = "all",
  assigneeFilter = null,
  selectedListRef = null,
  listGroupBy = "none",
  isListGroupingLoading = false,
}: {
  archiveFilter?: "active" | "archived";
  statusFilter?: string;
  assigneeFilter?: string | null;
  selectedListRef?: string | null;
  listGroupBy?: string;
  isListGroupingLoading?: boolean;
} = {}) {
  const navigationState = {
    viewMode: "list",
    listGroupBy,
    listViewTarget: () => ({ pathname: "/o/acme/WEB" }),
    boardViewTarget: () => ({ pathname: "/o/acme/WEB/kanban" }),
    buildListViewUrl: () => "/o/acme/WEB",
    buildBoardViewUrl: () => "/o/acme/WEB/kanban",
    statusFilter,
    assigneeFilter,
    archiveFilter,
    selectedListRef,
    taskRefId: null,
    artifactId: null,
    selectArtifact: vi.fn(),
    selectTaskArtifact: vi.fn(),
    openTask: vi.fn(),
    openTaskWithArchive: vi.fn(),
    taskWithArchiveHref: (taskRefId: string) => `/o/acme/WEB?task=${taskRefId}`,
    setArtifact: vi.fn(),
    setTaskArtifact: vi.fn(),
    setTask: vi.fn(),
    setTaskWithArchive: vi.fn(),
    setStatusFilter: vi.fn(),
    setAssigneeFilter: vi.fn(),
    setArchiveFilter: vi.fn(),
  };

  useProjectNavigationStateMock.mockReturnValue(navigationState);
  useProjectTaskViewsMock.mockReturnValue({
    organizationSlug: "acme",
    projectAlias: "WEB",
    org: { _id: "org-1" },
    project: { _id: "project-1", name: "Project", defaultListId: null },
    allowedStatuses: ["To Do", "Done", "Canceled"],
    navigationState,
    selectedList: null,
    taskListResultsController: {
      query: "",
      setQuery: vi.fn(),
      resetQuery: vi.fn(),
      results: [],
      isLoading: false,
      isLoadingMore: false,
      activeListLimitReached: false,
      hasMore: false,
      loadMore: vi.fn(),
    },
    get activeTaskResult() {
      const readActiveTaskResult = useTasksMock;
      return readActiveTaskResult();
    },
    currentMoveSourceListRef: selectedListRef,
    currentUserId: "user-1",
    isListGroupingLoading,
    showTaskRank: Boolean(useShowTaskListRankMock.getMockImplementation()?.()),
    openMembersSettings: vi.fn(),
    setHeaderAddTaskAction: vi.fn(),
    setDetailSurfaceOpen: setDetailSurfaceOpenMock,
  });
}

function renderPage() {
  return render(<ProjectPage />);
}

function triggerHotkey(hotkey: string, target?: EventTarget) {
  const registration = hotkeyRegistrations.get(hotkey);
  if (!registration) {
    throw new Error(`No hotkey registered for ${hotkey}`);
  }

  const event = {
    preventDefault: vi.fn(),
    target: target ?? null,
  } as unknown as KeyboardEvent;

  act(() => {
    registration.callback(event, { hotkey });
  });

  return event;
}

describe("ProjectPage archive completed shortcut", () => {
  beforeEach(() => {
    hotkeyRegistrations.clear();
    useQueryMock.mockReset();
    useConvexAuthMock.mockReset();
    useTasksMock.mockReset();
    useArchivedTasksMock.mockReset();
    useProjectNavigationStateMock.mockReset();
    useProjectTaskViewsMock.mockReset();
    useShowTaskListRankMock.mockReset();
    projectHeaderMock.mockReset();
    taskTableMock.mockReset();
    mobileNavBarMock.mockReset();
    setDetailSurfaceOpenMock.mockReset();
    openCreateTaskDialogMock.mockReset();
    taskSidebarNavigationState.detailsTask = null;
    taskSidebarNavigationState.isSidebarOpen = false;
    taskSidebarNavigationState.openTaskSidebar.mockReset();
    taskSidebarNavigationState.closeTaskSidebar.mockReset();
    useConvexAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    useShowTaskListRankMock.mockReturnValue(false);

    useQueryMock.mockImplementation((query: unknown, args?: Record<string, unknown> | "skip") => {
      if (args === "skip") {
        return undefined;
      }

      if (getFunctionName(query as never) === "tasks/labels:list") {
        return [];
      }

      if (args && "slug" in args) {
        return { _id: "org-1" };
      }

      if (args && "organizationId" in args) {
        return { _id: "project-1", name: "Project" };
      }

      return { _id: "user-1" };
    });
  });

  afterEach(() => {
    clearLastResolvedRouteValueCacheForTests();
    clearLastResolvedValueCacheForTests();
    cleanup();
    vi.clearAllMocks();
  });

  test("opens the archive completed dialog from the active list view", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "done-1", clientId: "done-1", status: "Done" }),
        makeTask({ _id: "todo-1", clientId: "todo-1", status: "To Do" }),
      ])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    expect(screen.queryByTestId("archive-completed-dialog")).toBeNull();

    triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);

    expect(screen.getByTestId("archive-completed-dialog")).toBeTruthy();
  });

  test("moves closed tasks to bottom from the active list shortcut", () => {
    setProjectUrlState();
    const activeTasks = createTaskHookResult([
      makeTask({
        _id: "done-1",
        clientId: "done-1",
        status: "Done",
        rank: "0|a:",
      }),
      makeTask({
        _id: "todo-1",
        clientId: "todo-1",
        status: "To Do",
        rank: "0|b:",
      }),
    ]);
    useTasksMock.mockReturnValue(activeTasks);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const event = triggerHotkey(MOVE_CLOSED_TASKS_BOTTOM_HOTKEY);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(activeTasks.moveClosedToBottom).toHaveBeenCalledWith([
      "done-1",
      "todo-1",
    ]);
  });

  test("opens the create task dialog request from the task list N shortcut", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const event = triggerHotkey(CREATE_TASK_DIALOG_HOTKEY);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(openCreateTaskDialogMock).toHaveBeenCalledOnce();
  });

  test("starts a top draft and scrolls the task table to top from the C shortcut", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));
    const scrollToMock = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToMock;

    renderPage();

    const event = triggerHotkey(CREATE_TASK_AT_TOP_HOTKEY);
    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      tasks: Array<{ rowType?: string; beforeClientId?: string; parentId?: string | null }>;
    };

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(scrollToMock).toHaveBeenCalledWith({ top: 0 });
    expect(latestTaskTableProps.tasks[0]).toEqual(
      expect.objectContaining({
        rowType: "draft-task",
        beforeClientId: "client-1",
        parentId: null,
      })
    );
  });

  test("does not open the create task dialog request while an editable field is focused", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      renderPage();

      const event = triggerHotkey(CREATE_TASK_DIALOG_HOTKEY);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(openCreateTaskDialogMock).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  test("does not open the create task dialog when the N key originated in a search input", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    document.body.appendChild(searchInput);

    try {
      renderPage();

      const event = triggerHotkey(CREATE_TASK_DIALOG_HOTKEY, searchInput);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(openCreateTaskDialogMock).not.toHaveBeenCalled();
    } finally {
      searchInput.remove();
    }
  });

  test("disables moving closed tasks to bottom when task filters are active", () => {
    setProjectUrlState({ statusFilter: "active" });
    const activeTasks = createTaskHookResult([
      makeTask({
        _id: "done-1",
        clientId: "done-1",
        status: "Done",
        rank: "0|a:",
      }),
      makeTask({
        _id: "todo-1",
        clientId: "todo-1",
        status: "To Do",
        rank: "0|b:",
      }),
    ]);
    useTasksMock.mockReturnValue(activeTasks);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      canMoveClosedToBottom: boolean;
    };
    const event = triggerHotkey(MOVE_CLOSED_TASKS_BOTTOM_HOTKEY);

    expect(latestTaskTableProps.canMoveClosedToBottom).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(activeTasks.moveClosedToBottom).not.toHaveBeenCalled();
  });

  test("disables moving closed tasks to bottom when assignee filter is active", () => {
    setProjectUrlState({ assigneeFilter: "user-1" });
    const activeTasks = createTaskHookResult([
      makeTask({
        _id: "done-1",
        clientId: "done-1",
        status: "Done",
        rank: "0|a:",
      }),
      makeTask({
        _id: "todo-1",
        clientId: "todo-1",
        status: "To Do",
        rank: "0|b:",
      }),
    ]);
    useTasksMock.mockReturnValue(activeTasks);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      canMoveClosedToBottom: boolean;
    };
    const event = triggerHotkey(MOVE_CLOSED_TASKS_BOTTOM_HOTKEY);

    expect(latestTaskTableProps.canMoveClosedToBottom).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(activeTasks.moveClosedToBottom).not.toHaveBeenCalled();
  });

  test("reports an open task sidebar to the shared shell", () => {
    setProjectUrlState();
    taskSidebarNavigationState.isSidebarOpen = true;
    taskSidebarNavigationState.detailsTask = makeTask({ refId: "WEB-1" });
    useTasksMock.mockReturnValue(
      createTaskHookResult([taskSidebarNavigationState.detailsTask])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    expect(setDetailSurfaceOpenMock).toHaveBeenLastCalledWith(true);
    // The shared shell owns the mobile nav bar; the page no longer renders it.
    expect(mobileNavBarMock).not.toHaveBeenCalled();
  });

  test("J, K and Escape drive the open task panel in table order", () => {
    setProjectUrlState();
    const first = makeTask({ refId: "WEB-1" });
    const second = makeTask({ _id: "task-2", clientId: "client-2", refId: "WEB-2", rank: "0|i0001:" });
    taskSidebarNavigationState.isSidebarOpen = true;
    taskSidebarNavigationState.detailsTask = first;
    useTasksMock.mockReturnValue(createTaskHookResult([first, second]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    fireEvent.keyDown(document.body, { key: "j" });
    expect(taskSidebarNavigationState.openTaskSidebar).toHaveBeenCalledWith("client-2");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(taskSidebarNavigationState.closeTaskSidebar).toHaveBeenCalledTimes(1);
  });

  test("reports a closed task sidebar to the shared shell", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    expect(setDetailSurfaceOpenMock).toHaveBeenLastCalledWith(false);
    expect(mobileNavBarMock).not.toHaveBeenCalled();
  });

  test("opens task details when tapping the task name on mobile", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });

    setProjectUrlState();
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const input = document.createElement("input");
    input.setAttribute("data-task-input", "true");
    document.body.appendChild(input);

    try {
      renderPage();

      const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
        onRowClick: (event: React.MouseEvent, taskId: string) => void;
      };

      act(() => {
        latestTaskTableProps.onRowClick(
          {
            target: input,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
          } as unknown as React.MouseEvent,
          "client-1"
        );
      });

      expect(taskSidebarNavigationState.openTaskSidebar).toHaveBeenCalledWith(
        "client-1"
      );
    } finally {
      input.remove();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  test("shows task table skeleton while a newly selected List is loading stale cached tasks", () => {
    setProjectUrlState({ selectedListRef: "SPRINT-1" });
    useTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "task-sprint-1", clientId: "client-sprint-1" }),
      ])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const { rerender } = renderPage();

    expect(screen.getByTestId("task-table")).toBeTruthy();
    expect(screen.queryByTestId("skeleton")).toBeNull();

    setProjectUrlState({ selectedListRef: "SPRINT-2" });
    useTasksMock.mockReturnValue({
      ...createTaskHookResult([
        makeTask({ _id: "task-sprint-1", clientId: "client-sprint-1" }),
      ]),
      isLoading: true,
    });

    rerender(<ProjectPage />);

    expect(screen.queryByTestId("task-table")).toBeNull();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  test("shows the skeleton, not ungrouped tasks, while a List's derived grouping loads", () => {
    setProjectUrlState({ isListGroupingLoading: true });
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    expect(screen.queryByTestId("task-table")).toBeNull();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  test("shows the skeleton while sections load under listGroupBy=section", () => {
    setProjectUrlState({ listGroupBy: "section" });
    const defaultQuery = useQueryMock.getMockImplementation()!;
    useQueryMock.mockImplementation((query: unknown, args?: unknown) =>
      getFunctionName(query as never) === "tasks/sections:list"
        ? undefined
        : defaultQuery(query, args)
    );
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    expect(screen.queryByTestId("task-table")).toBeNull();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  test("does nothing when there are no eligible top-level completed tasks", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "todo-1", clientId: "todo-1", status: "To Do" }),
        makeTask({
          _id: "subtask-done-1",
          clientId: "subtask-done-1",
          status: "Done",
          parentId: "todo-1",
        }),
      ])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();
    triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);

    expect(screen.queryByTestId("archive-completed-dialog")).toBeNull();
  });

  test("does nothing in archived view", () => {
    setProjectUrlState({ archiveFilter: "archived" });
    useTasksMock.mockReturnValue(createTaskHookResult([]));
    useArchivedTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "done-1", clientId: "done-1", status: "Done" }),
      ])
    );

    renderPage();
    triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);

    expect(screen.queryByTestId("archive-completed-dialog")).toBeNull();
  });

  test("does nothing while an editable field is focused", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "done-1", clientId: "done-1", status: "Done" }),
      ])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    try {
      triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);
      expect(screen.queryByTestId("archive-completed-dialog")).toBeNull();
    } finally {
      input.remove();
    }
  });
});

describe("ProjectPage archive undo toast", () => {
  beforeEach(() => {
    hotkeyRegistrations.clear();
    useQueryMock.mockReset();
    useConvexAuthMock.mockReset();
    useTasksMock.mockReset();
    useArchivedTasksMock.mockReset();
    useProjectNavigationStateMock.mockReset();
    useProjectTaskViewsMock.mockReset();
    useShowTaskListRankMock.mockReset();
    projectHeaderMock.mockReset();
    taskTableMock.mockReset();
    toastMock.message.mockReturnValue("toast-1");

    useConvexAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    useShowTaskListRankMock.mockReturnValue(false);
    useQueryMock.mockImplementation((_, args?: Record<string, unknown> | "skip") => {
      if (args === "skip") {
        return undefined;
      }

      if (args && "slug" in args) {
        return { _id: "org-1" };
      }

      if (args && "organizationId" in args) {
        return { _id: "project-1", name: "Project" };
      }

      return { _id: "user-1" };
    });
    setProjectUrlState();
  });

  afterEach(() => {
    clearLastResolvedRouteValueCacheForTests();
    cleanup();
    vi.clearAllMocks();
  });

  test("shows an undo toast after archiving a single task", async () => {
    const taskHookResult = createTaskHookResult([
      makeTask({ _id: "task-1", clientId: "task-1", name: "Write docs" }),
    ]);
    useTasksMock.mockReturnValue(taskHookResult);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      archiveTask: (id: string) => void;
    };
    latestTaskTableProps.archiveTask("task-1");

    await waitFor(() =>
      expect(toastMock.message).toHaveBeenCalledWith(
        'Task "Write docs" archived.',
        expect.objectContaining({
          duration: 5000,
          action: expect.objectContaining({ label: "Undo" }),
        })
      )
    );
  });

  test("undo unarchives the archived root IDs", async () => {
    const taskHookResult = createTaskHookResult([
      makeTask({ _id: "task-1", clientId: "task-1", name: "Write docs" }),
    ]);
    useTasksMock.mockReturnValue(taskHookResult);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      archiveTask: (id: string) => void;
    };
    latestTaskTableProps.archiveTask("task-1");

    await waitFor(() => expect(toastMock.message).toHaveBeenCalled());
    const toastOptions = toastMock.message.mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void };
    };
    toastOptions.action.onClick();

    await waitFor(() => {
      expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1");
      expect(taskHookResult.bulkUnarchive).toHaveBeenCalledWith(["task-1"]);
      expect(toastMock.success).toHaveBeenCalledWith("Task unarchived");
    });
  });

  test("archive completed shows one undo toast for the batch", async () => {
    const taskHookResult = createTaskHookResult([
      makeTask({ _id: "done-1", clientId: "done-1", status: "Done" }),
      makeTask({ _id: "canceled-1", clientId: "canceled-1", status: "Canceled" }),
      makeTask({ _id: "todo-1", clientId: "todo-1", status: "To Do" }),
    ]);
    useTasksMock.mockReturnValue(taskHookResult);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();
    triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);
    fireEvent.click(screen.getByText("Confirm archive"));

    await waitFor(() => {
      expect(taskHookResult.bulkArchive).toHaveBeenCalledWith([
        "done-1",
        "canceled-1",
      ]);
      expect(toastMock.message).toHaveBeenCalledTimes(1);
      expect(toastMock.message).toHaveBeenCalledWith(
        "2 tasks archived.",
        expect.objectContaining({
          duration: 5000,
          action: expect.objectContaining({ label: "Undo" }),
        })
      );
    });
  });

  test("does not show an undo toast for no-op archive results", async () => {
    const taskHookResult = createTaskHookResult([
      makeTask({ _id: "task-1", clientId: "task-1" }),
    ]);
    taskHookResult.archiveTask.mockResolvedValue([]);
    useTasksMock.mockReturnValue(taskHookResult);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    renderPage();

    const latestTaskTableProps = taskTableMock.mock.calls.at(-1)?.[0] as {
      archiveTask: (id: string) => void;
    };
    latestTaskTableProps.archiveTask("task-1");

    await waitFor(() => expect(taskHookResult.archiveTask).toHaveBeenCalled());
    expect(toastMock.message).not.toHaveBeenCalled();
  });
});

describe("ProjectPage loading stability", () => {
  beforeEach(() => {
    hotkeyRegistrations.clear();
    useQueryMock.mockReset();
    useConvexAuthMock.mockReset();
    useTasksMock.mockReset();
    useArchivedTasksMock.mockReset();
    useProjectNavigationStateMock.mockReset();
    useProjectTaskViewsMock.mockReset();
    useShowTaskListRankMock.mockReset();
    projectHeaderMock.mockReset();
    taskTableMock.mockReset();

    useShowTaskListRankMock.mockReturnValue(false);
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));
    setProjectUrlState();
  });

  afterEach(() => {
    clearLastResolvedRouteValueCacheForTests();
    cleanup();
    vi.clearAllMocks();
  });

  test("keeps the rendered task table mounted through transient auth query loading", () => {
    let authState = {
      isLoading: false,
      isAuthenticated: true,
    };
    let shouldReturnLoadingQueries = false;

    useConvexAuthMock.mockImplementation(() => authState);
    useQueryMock.mockImplementation((_, args?: Record<string, unknown> | "skip") => {
      if (shouldReturnLoadingQueries || args === "skip") {
        return undefined;
      }

      if (args && "slug" in args) {
        return { _id: "org-1" };
      }

      if (args && "organizationId" in args) {
        return { _id: "project-1", name: "Project" };
      }

      return { _id: "user-1" };
    });

    const { rerender } = renderPage();

    expect(screen.getByTestId("task-table")).toBeTruthy();

    authState = {
      isLoading: true,
      isAuthenticated: false,
    };
    shouldReturnLoadingQueries = true;
    rerender(<ProjectPage />);

    expect(screen.getByTestId("task-table")).toBeTruthy();
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });
});

describe("ProjectPage task-table wiring", () => {
  beforeEach(() => {
    hotkeyRegistrations.clear();
    useQueryMock.mockReset();
    useConvexAuthMock.mockReset();
    useTasksMock.mockReset();
    useArchivedTasksMock.mockReset();
    useProjectNavigationStateMock.mockReset();
    useProjectTaskViewsMock.mockReset();
    useShowTaskListRankMock.mockReset();
    projectHeaderMock.mockReset();
    taskTableMock.mockReset();

    useConvexAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    useShowTaskListRankMock.mockReturnValue(true);
    useQueryMock.mockImplementation((_, args?: Record<string, unknown> | "skip") => {
      if (args === "skip") {
        return undefined;
      }

      if (args && "slug" in args) {
        return { _id: "org-1" };
      }

      if (args && "organizationId" in args) {
        return { _id: "project-1", name: "Project" };
      }

      return { _id: "user-1" };
    });
    useTasksMock.mockReturnValue(createTaskHookResult([makeTask()]));
    useArchivedTasksMock.mockReturnValue(
      createTaskHookResult([
        makeTask({ _id: "archived-1", clientId: "archived-1", isArchived: true }),
      ])
    );
  });

  afterEach(() => {
    clearLastResolvedRouteValueCacheForTests();
    cleanup();
    vi.clearAllMocks();
  });

  test("passes the rank toggle through to the active project task table", () => {
    setProjectUrlState();

    renderPage();

    expect(taskTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showTaskRank: true,
      })
    );
  });

  test("hands a read-only table to viewers", () => {
    permissionsMock.canUpdateTask = false;
    setProjectUrlState();

    renderPage();

    expect(taskTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ canUpdateTask: false, isDndEnabled: false })
    );
    permissionsMock.canUpdateTask = true;
  });

  test("closes the archive completed dialog when write access goes away", () => {
    setProjectUrlState();
    useTasksMock.mockReturnValue(
      createTaskHookResult([makeTask({ _id: "done-1", clientId: "done-1", status: "Done" })])
    );
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const { rerender } = renderPage();
    triggerHotkey(ARCHIVE_COMPLETED_TASKS_HOTKEY);
    expect(screen.getByTestId("archive-completed-dialog")).toBeTruthy();

    permissionsMock.canUpdateTask = false;
    rerender(<ProjectPage />);

    expect(screen.queryByTestId("archive-completed-dialog")).toBeNull();
    permissionsMock.canUpdateTask = true;
  });

  test("closes an open bulk delete dialog when delete access goes away", () => {
    setProjectUrlState();
    const taskHookResult = createTaskHookResult([
      makeTask({ _id: "task-a", clientId: "task-a" }),
      makeTask({ _id: "task-b", clientId: "task-b" }),
    ]);
    useTasksMock.mockReturnValue(taskHookResult);
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));

    const { rerender } = renderPage();
    const tableProps = () => taskTableMock.mock.lastCall![0] as Record<string, (...args: unknown[]) => void>;
    act(() => tableProps().onSelectRow({ metaKey: true }, "task-a"));
    act(() => tableProps().onSelectRow({ metaKey: true }, "task-b"));
    act(() => tableProps().onBulkContextDelete());
    expect(screen.getByTestId("bulk-delete-dialog")).toBeTruthy();

    permissionsMock.canDeleteTask = false;
    rerender(<ProjectPage />);

    expect(screen.queryByTestId("bulk-delete-dialog")).toBeNull();
    expect(taskHookResult.bulkDeleteWithChildren).not.toHaveBeenCalled();
    permissionsMock.canDeleteTask = true;
  });

  test("gives viewers no add rows and no create or write hotkeys", () => {
    permissionsMock.canCreateTask = false;
    permissionsMock.canUpdateTask = false;
    setProjectUrlState();

    renderPage();

    expect(taskTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowAddTask: false })
    );
    for (const hotkey of [
      CREATE_TASK_AT_TOP_HOTKEY,
      CREATE_TASK_DIALOG_HOTKEY,
      ARCHIVE_COMPLETED_TASKS_HOTKEY,
      MOVE_CLOSED_TASKS_BOTTOM_HOTKEY,
    ]) {
      expect(hotkeyRegistrations.get(hotkey)?.options?.enabled, hotkey).toBe(false);
    }
    permissionsMock.canCreateTask = true;
    permissionsMock.canUpdateTask = true;
  });

  test("passes the rank toggle through to the archived project task table", () => {
    setProjectUrlState({ archiveFilter: "archived" });

    renderPage();

    expect(taskTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showTaskRank: true,
      })
    );
  });
});

const permissionsMock = vi.hoisted(() => ({ canCreateTask: true, canUpdateTask: true, canDeleteTask: true }));

vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({ myRole: "project-admin", ...permissionsMock }),
}));
