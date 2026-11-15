/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { clearLastResolvedValueCacheForTests } from "@/hooks/react/use-last-resolved-value";
import { DEFAULT_THREAD_TASKS_PANEL_FILTERS, ThreadTasksPanel } from "./thread-tasks-panel";
import { withProjectRole } from "@/test-utils/project-role";
import type { ProjectRole } from "@/lib/authz/roles";

const useTasksMock = vi.fn();
const useSelectedTaskListMock = vi.fn();
const useTaskTableControllerMock = vi.fn();
const useQueryMock = vi.hoisted(() => vi.fn());
const usePaginatedQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));
const taskTableMock = vi.fn();
const projectTaskListDropdownMock = vi.fn();
const filterDropdownMock = vi.fn();
const useIsMobileMock = vi.fn(() => false);

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: () => useIsMobileMock(),
}));

vi.mock("@/components/blocks/tasks/mobile-task-list", () => ({
  MobileTaskList: () => <div data-testid="mobile-task-list" />,
}));

vi.mock("@/lib/tasks/hooks/use-tasks", () => ({
  useTasks: (...args: unknown[]) => useTasksMock(...args),
}));

vi.mock("@/components/blocks/project/task-lists/use-selected-task-list", () => ({
  useSelectedTaskList: (...args: unknown[]) => useSelectedTaskListMock(...args),
}));

vi.mock("@/components/blocks/tasks/task-table/hooks/use-task-table-controller", () => ({
  useTaskTableController: (...args: unknown[]) =>
    useTaskTableControllerMock(...args),
}));

vi.mock("@/components/blocks/project/task-lists/project-task-list-dropdown", () => ({
  ProjectTaskListDropdown: (props: {
    selectedListRef: string | null;
    onSelectedListChange: (listRef: string | null) => void;
    onArchiveFilterChange: (filter: "active" | "archived") => void;
  }) => {
    projectTaskListDropdownMock(props);
    return (
      <div>
        <span data-testid="selected-list-ref">{props.selectedListRef ?? "default"}</span>
        <button type="button" onClick={() => props.onSelectedListChange("SPRINT-1")}>
          Select sprint
        </button>
        <button type="button" onClick={() => props.onSelectedListChange(null)}>
          Select default
        </button>
        <button type="button" onClick={() => props.onArchiveFilterChange("archived")}>
          Select archived
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/blocks/project/filter-dropdown", () => ({
  FilterDropdown: (props: {
    statusFilter: string;
    assigneeFilter: unknown;
    onStatusFilterChange: (filter: "active") => void;
    onAssigneeFilterChange: (filter: { type: "me" }) => void;
  }) => {
    filterDropdownMock(props);
    return (
      <div>
        <span data-testid="status-filter">{props.statusFilter}</span>
        <button type="button" onClick={() => props.onStatusFilterChange("active")}>
          Active status
        </button>
        <button type="button" onClick={() => props.onAssigneeFilterChange({ type: "me" })}>
          My tasks
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/blocks/tasks/task-table", () => ({
  TaskTable: (props: {
    tasks: Array<{ clientId: string; refId: string }>;
    onOpenDetails: (clientId: string) => void;
    maxHeight?: string;
  }) => {
    taskTableMock(props);
    return (
      <div data-testid="task-table">
        {props.tasks.map((task) => (
          <button
            key={task.clientId}
            type="button"
            onClick={() => props.onOpenDetails(task.clientId)}
          >
            {task.refId}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("@/components/blocks/tasks/multi-select-toolbar", () => ({
  MultiSelectToolbar: () => <div data-testid="multi-select-toolbar" />,
}));

vi.mock("@/components/blocks/tasks/task-table/task-list-move-context", () => ({
  TaskListMoveProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: "task_1" as Id<"tasks">,
    clientId: "client_1",
    refNumber: 1,
    refId: "OS-1",
    name: "First task",
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
    createdAt: Date.now(),
    isArchived: false,
    ...overrides,
  };
}

function createTaskResult(tasks = [makeTask()]) {
  return {
    tasks,
    isLoading: false,
    updateTask: vi.fn(),
    addTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    unarchiveTask: vi.fn(),
    reorderTasks: vi.fn(),
    reorderMultiple: vi.fn(),
    setParent: vi.fn(),
    setParentMultiple: vi.fn(),
    bulkUpdateStatus: vi.fn(),
    bulkUpdateAssignee: vi.fn(),
    bulkUpdatePriority: vi.fn(),
    bulkUpdateDueDate: vi.fn(),
    bulkUpdateTaskType: vi.fn(),
    moveToList: vi.fn(),
    moveActiveToList: vi.fn(),
    moveClosedToBottom: vi.fn(),
    bulkDelete: vi.fn(),
    bulkArchive: vi.fn(),
    bulkUnarchive: vi.fn(),
    duplicateTask: vi.fn(),
    inputRefs: { current: new Map() },
    focusInput: vi.fn(),
  };
}

function createTableController(args: Record<string, unknown>) {
  const allTasks = args.allTasks as Array<Record<string, unknown>>;
  return {
    flattenedTasks: allTasks,
    taskTree: [],
    registerRow: vi.fn(),
    rowSelection: {},
    setRowSelection: vi.fn(),
    sorting: [],
    setSorting: vi.fn(),
    statusFilter: args.statusFilter,
    assigneeFilter: args.assigneeFilter,
    selectedIds: new Set<string>(),
    handleRowClick: vi.fn(),
    handleSelectRow: vi.fn(),
    handleContextMenuSelection: vi.fn(),
    expandedIds: new Set<string>(),
    toggleExpanded: vi.fn(),
    isDndEnabled: true,
    addTaskValue: "",
    setAddTaskValue: vi.fn(),
    handleAddTaskKeyDown: vi.fn(),
    handleAddTaskBlur: vi.fn(),
    getAddTaskInputValue: vi.fn(),
    setAddTaskInputValue: vi.fn(),
    handleAddTaskInputKeyDown: vi.fn(),
    handleAddTaskInputBlur: vi.fn(),
    updateInlineTaskDraftValue: vi.fn(),
    commitInlineTaskDraft: vi.fn(),
    cancelInlineTaskDraft: vi.fn(),
    defaultParentId: undefined,
    beginInlineTaskDraft: vi.fn(),
    getAdjacentId: vi.fn(),
    getPreviousTaskId: vi.fn(),
    handleBulkStatusChange: vi.fn(),
    handleBulkArchive: vi.fn(),
    handleBulkUnarchive: vi.fn(),
    handleBulkDelete: vi.fn(),
    handleMoveClosedToBottom: vi.fn(),
    handleMoveSelectedToList: vi.fn(),
    handleBulkComplete: vi.fn(),
    handleBulkPriorityChange: vi.fn(),
    handleBulkAssigneeChange: vi.fn(),
    handleBulkDueDateChange: vi.fn(),
    clearSelection: vi.fn(),
    allowAddTask: args.allowAddTask,
    shortcutPalette: undefined,
  };
}

describe("ThreadTasksPanel", () => {
  beforeEach(() => {
    clearLastResolvedValueCacheForTests();
    useIsMobileMock.mockReturnValue(false);
    useTasksMock.mockReturnValue(createTaskResult());
    useSelectedTaskListMock.mockReturnValue(null);
    useQueryMock.mockImplementation(withProjectRole("member"));
    usePaginatedQueryMock.mockImplementation((_query: unknown, args: unknown) => ({
      results: args === "skip"
        ? []
        : [makeTask({ _id: "task_9", clientId: "client_9", refId: "OS-9", name: "Search hit in another list" })],
      status: "Exhausted",
      loadMore: vi.fn(),
    }));
    useTaskTableControllerMock.mockImplementation((args) =>
      createTableController(args as Record<string, unknown>)
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("uses the card surface for the secondary toolbar row", () => {
    const { container } = render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        onOpenTask={vi.fn()}
      />
    );

    expect(container.querySelector("header")?.className).toContain("bg-card");
  });

  test("renders cards instead of the table on mobile (OS-1911)", () => {
    useIsMobileMock.mockReturnValue(true);

    render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByTestId("mobile-task-list")).toBeTruthy();
    expect(screen.queryByTestId("task-table")).toBeNull();
  });

  test("uses cards in a narrow desktop pane and rows when the pane widens", () => {
    let width = 400;
    let resizePane = () => {};
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 0, width, 800)
    );
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizePane = callback; }
      observe() {}
      disconnect() {}
    });

    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);

    expect(useIsMobileMock()).toBe(false);
    expect(screen.getByTestId("mobile-task-list")).toBeTruthy();
    expect(screen.queryByTestId("task-table")).toBeNull();

    act(() => { width = 768; resizePane(); });
    expect(screen.getByTestId("task-table")).toBeTruthy();
    expect(screen.queryByTestId("mobile-task-list")).toBeNull();

    act(() => { width = 400; resizePane(); });
    expect(screen.getByTestId("mobile-task-list")).toBeTruthy();
    expect(screen.queryByTestId("task-table")).toBeNull();
  });

  test.each([
    ["member", true],
    ["viewer", false],
  ] as const)("passes the %s role's write and create access to the table controller", (role: ProjectRole, canWrite) => {
    useQueryMock.mockImplementation(withProjectRole(role));

    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);

    expect(useTaskTableControllerMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ canUpdateTask: canWrite, allowAddTask: canWrite })
    );
  });

  test("starts on the default active task list with all status filters", () => {
    render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        defaultListId={"list_1" as Id<"taskLists">}
        currentUserId="user_1"
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByTestId("selected-list-ref").textContent).toBe("default");
    expect(screen.getByTestId("status-filter").textContent).toBe("all");
    expect(useSelectedTaskListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        selectedListRef: null,
      })
    );
    expect(useTasksMock).toHaveBeenLastCalledWith(
      "project_1",
      "active",
      "all",
      null
    );
    expect(useTaskTableControllerMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        currentUserId: "user_1",
        statusFilter: "all",
        assigneeFilter: null,
        allowAddTask: true,
      })
    );
    expect(taskTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxHeight: "100%" })
    );
    expect(screen.queryByRole("heading", { name: "Tasks" })).toBeNull();
  });

  test("switches lists and opens selected tasks through the parent callback", async () => {
    const onOpenTask = vi.fn();
    render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        onOpenTask={onOpenTask}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select sprint" }));

    await waitFor(() => {
      expect(useTasksMock).toHaveBeenLastCalledWith(
        "project_1",
        "active",
        "all",
        "SPRINT-1"
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "OS-1" }));

    expect(onOpenTask).toHaveBeenCalledWith({
      refId: "OS-1",
      isArchived: false,
    });
  });

  test("shows the loading skeleton instead of stale rows while switching lists", async () => {
    const staleTask = makeTask({
      _id: "task_old" as Id<"tasks">,
      clientId: "client_old",
      refId: "OS-1",
      name: "Old default list task",
    });

    useTasksMock.mockImplementation(
      (
        _projectId: Id<"projects">,
        _archiveFilter: string,
        _statusFilter: string,
        selectedListRef: string | null
      ) => ({
        ...createTaskResult([staleTask]),
        isLoading: selectedListRef === "SPRINT-1",
      })
    );

    render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        onOpenTask={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "OS-1" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Select sprint" }));

    await waitFor(() => {
      expect(screen.getByTestId("task-view-skeleton-table")).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: "OS-1" })).toBeNull();
  });

  test("searches active tasks across every List and renders hits in the task table", async () => {
    const onOpenTask = vi.fn();
    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={onOpenTask} />);

    fireEvent.click(screen.getByRole("button", { name: "Select sprint" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " hit " } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "OS-9" })).toBeDefined();
    });
    expect(usePaginatedQueryMock).toHaveBeenLastCalledWith(
      expect.anything(),
      { projectId: "project_1", query: "hit" },
      expect.anything()
    );
    expect(screen.queryByRole("button", { name: "OS-1" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "OS-9" }));
    expect(onOpenTask).toHaveBeenCalledWith({ refId: "OS-9", isArchived: false });
  });

  test("search hits keep relevance order and cannot be reordered or added to", async () => {
    const taskResult = createTaskResult();
    useTasksMock.mockReturnValue(taskResult);
    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "OS-9" })).toBeDefined();
    });

    const controllerArgs = useTaskTableControllerMock.mock.lastCall?.[0] as {
      allowAddTask: boolean;
      preserveRootOrder: boolean;
      reorderTasks: (...args: unknown[]) => void;
      setParent: (...args: unknown[]) => void;
    };
    expect(controllerArgs).toMatchObject({ allowAddTask: false, preserveRootOrder: true });
    controllerArgs.reorderTasks("task_9", "task_1");
    controllerArgs.setParent("task_9", "task_1");
    expect(taskResult.reorderTasks).not.toHaveBeenCalled();
    expect(taskResult.setParent).not.toHaveBeenCalled();
  });

  test("clearing the search restores the List table", async () => {
    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "OS-9" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "OS-1" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "OS-9" })).toBeNull();
  });

  test("keeps the search query in the lifted filters", () => {
    const onFiltersChange = vi.fn();
    render(
      <ThreadTasksPanel
        projectId={"project_1" as Id<"projects">}
        filters={{ ...DEFAULT_THREAD_TASKS_PANEL_FILTERS, searchQuery: "kept" }}
        onFiltersChange={onFiltersChange}
        onOpenTask={vi.fn()}
      />
    );

    const input = screen.getByRole("searchbox") as HTMLInputElement;
    expect(input.value).toBe("kept");

    fireEvent.change(input, { target: { value: "kept2" } });
    expect(onFiltersChange).toHaveBeenCalledWith({ searchQuery: "kept2" });
  });

  test("shows the task table skeleton while a search is loading", () => {
    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });

    expect(screen.getByTestId("task-view-skeleton-table")).toBeDefined();
  });

  test("shows card skeletons instead of table rows while the card layout loads", () => {
    useIsMobileMock.mockReturnValue(true);
    render(<ThreadTasksPanel projectId={"project_1" as Id<"projects">} onOpenTask={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hit" } });

    expect(screen.getByTestId("task-view-skeleton-cards")).toBeDefined();
    expect(screen.queryByTestId("task-view-skeleton-table")).toBeNull();
  });
});
