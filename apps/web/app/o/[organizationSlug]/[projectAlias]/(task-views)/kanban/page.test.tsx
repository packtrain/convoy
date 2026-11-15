/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import KanbanPage from "./page";
import type { Task } from "@/lib/tasks/types";

const permissions = vi.hoisted(() => ({ role: "member" }));
const useProjectTaskViewsMock = vi.fn();
const setDetailSurfaceOpenMock = vi.fn();
const useQueryMock = vi.fn();
const useTaskSidebarNavigationMock = vi.fn();
const kanbanBoardMock = vi.fn();
const openTaskSidebarMock = vi.fn();
const closeTaskSidebarMock = vi.fn();
const selectArtifactFromDetailsMock = vi.fn();
const clearArtifactSelectionMock = vi.fn();

type KanbanBoardMockProps = {
  allowedStatuses: string[];
  tasks: Task[];
  boardGroupBy?: string;
  assignableUsers?: unknown[];
  onTaskCreate?: (...args: unknown[]) => unknown;
  onTaskClick?: (task: Task) => void;
  children?: ReactNode;
};

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => vi.fn(() => Promise.resolve()),
}));

// The page reads label-management permissions; the catch-all useQuery mock
// would otherwise feed task arrays into the role lookup.
vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => ({
    myRole: permissions.role,
    canEditProject: false,
    canManageMembers: false,
    canPinLists: false,
    canManageProjectAgents: false,
    isLoading: false,
  }),
}));

vi.mock("../project-task-views-context", () => ({
  useProjectTaskViews: () => useProjectTaskViewsMock(),
}));

vi.mock("@/components/blocks/tasks/task-table/task-list-move-context", () => ({
  TaskListMoveProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));


vi.mock("./kanban-board", () => ({
  KanbanBoard: (props: KanbanBoardMockProps) => {
    kanbanBoardMock(props);
    return (
      <div data-statuses={props.allowedStatuses.join(",")} data-testid="kanban-board">
        <button type="button" onClick={() => props.onTaskClick?.(props.tasks[0])}>
          Open first card
        </button>
        {props.children}
      </div>
    );
  },
}));

vi.mock("@/components/blocks/tasks/task-detail-sidebar", () => ({
  TaskDetailSidebar: ({
    task,
    selectedArtifactId,
    onSelectArtifact,
    onClearArtifactSelection,
  }: {
    task: Task;
    selectedArtifactId?: string | null;
    onSelectArtifact?: (artifactId: string | null) => void;
    onClearArtifactSelection?: () => void;
  }) => (
    <div data-artifact-id={selectedArtifactId ?? ""} data-testid="task-detail-sidebar">
      {task.refId}
      <button type="button" onClick={() => onSelectArtifact?.("artifact-1")}>
        Select artifact
      </button>
      <button type="button" onClick={onClearArtifactSelection}>
        Clear artifact
      </button>
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-sidebar-overlay", () => ({
  TaskSidebarOverlay: ({
    children,
    isOpen,
    onClose,
  }: {
    children?: ReactNode;
    isOpen: boolean;
    onClose: () => void;
  }) => (
    <div data-open={String(isOpen)} data-testid="task-sidebar-overlay">
      <button type="button" onClick={onClose}>
        Close details
      </button>
      {children}
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/bulk-delete-dialog", () => ({
  BulkDeleteDialog: () => null,
}));

vi.mock("@/hooks/ui/use-resize-panel", () => ({
  useResizePanel: () => ({
    width: 420,
    handleMouseDown: vi.fn(),
    adjustWidthBy: vi.fn(),
  }),
}));

vi.mock("@/lib/tasks/hooks/use-task-sidebar-navigation", () => ({
  useTaskSidebarNavigation: (props: unknown) =>
    useTaskSidebarNavigationMock(props),
}));

vi.mock("@/lib/tasks/hooks/use-task-undo-actions", () => ({
  useTaskUndoActions: () => ({
    executeArchiveWithUndo: (operation: () => void) => operation(),
    executeDeleteWithUndo: (operation: () => void) => operation(),
  }),
}));

describe("KanbanPage", () => {
  const task = {
    _id: "task-1",
    clientId: "task-1",
    refId: "OS-1",
  } as Task;
  let activeTaskResult: ReturnType<typeof createTaskResult>;

  function createTaskResult() {
    return {
      tasks: [task],
      taskTree: [{ _id: "task-1", clientId: "task-1", childCount: 1 }],
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
      bulkDeleteWithChildren: vi.fn(),
      bulkArchive: vi.fn(),
      bulkUnarchive: vi.fn(),
      moveToList: vi.fn(),
      duplicateTask: vi.fn(),
      unarchiveTask: vi.fn(),
      restoreTask: vi.fn(),
      inputRefs: { current: new Map() },
      focusInput: vi.fn(),
    };
  }

  beforeEach(() => {
    permissions.role = "member";
    const openTask = vi.fn();
    const selectArtifact = vi.fn();
    const selectTaskArtifact = vi.fn();
    activeTaskResult = createTaskResult();
    useQueryMock.mockReturnValue([
      { _id: "user-1", name: "Ada Lovelace", avatarUrl: null },
    ]);
    useTaskSidebarNavigationMock.mockReturnValue({
      detailsTask: null,
      isSidebarOpen: false,
      openTaskSidebar: openTaskSidebarMock,
      closeTaskSidebar: closeTaskSidebarMock,
    });
    useProjectTaskViewsMock.mockReturnValue({
      organizationSlug: "acme",
      projectAlias: "WEB",
      allowedStatuses: ["To Do", "Done"],
      project: {
        _id: "project-1",
        hiddenTaskTableColumns: ["priority", "assignee", "dueDate"],
      },
      navigationState: {
        boardGroupBy: "assignee",
        statusFilter: "active",
        assigneeFilter: "me",
        taskRefId: null,
        artifactId: null,
        openTask,
        selectArtifact,
        selectTaskArtifact,
      },
      activeTaskResult,
      currentUserId: "user-1",
      openMembersSettings: vi.fn(),
      setDetailSurfaceOpen: setDetailSurfaceOpenMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows the board skeleton while tasks are still loading", () => {
    useProjectTaskViewsMock.mockReturnValue({
      ...useProjectTaskViewsMock(),
      activeTaskResult: {
        ...activeTaskResult,
        tasks: [],
        taskTree: [],
        isLoading: true,
      },
    });

    render(<KanbanPage />);

    expect(screen.getByTestId("task-view-skeleton-board")).toBeTruthy();
    expect(screen.queryByTestId("kanban-board")).toBeNull();
  });

  test("renders the board inside the shared task-view shell", () => {
    render(<KanbanPage />);

    expect(screen.getByTestId("kanban-board").getAttribute("data-statuses")).toBe(
      "To Do,Done"
    );
    expect(kanbanBoardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [task],
        taskTree: [{ _id: "task-1", clientId: "task-1", childCount: 1 }],
        boardGroupBy: "assignee",
        assignableUsers: [
          { _id: "user-1", name: "Ada Lovelace", avatarUrl: null },
        ],
        statusFilter: "active",
        assigneeFilter: "me",
        currentUserId: "user-1",
        projectId: "project-1",
        hiddenTaskTableColumns: ["priority", "assignee", "dueDate"],
        onTaskCreate: activeTaskResult.addTask,
      })
    );
  });

  test("keeps the board region constrained to the available route content width", () => {
    render(<KanbanPage />);

    const boardRegion = screen.getByTestId("kanban-board").parentElement;

    expect(boardRegion?.className).toContain("min-w-0");
    expect(boardRegion?.className).toContain("overflow-hidden");
  });

  test("opens task details from a board card click", () => {
    render(<KanbanPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open first card" }));

    expect(openTaskSidebarMock).toHaveBeenCalledWith("task-1");
  });

  test("renders the existing task detail surface when a task is selected", () => {
    useTaskSidebarNavigationMock.mockReturnValue({
      detailsTask: task,
      isSidebarOpen: true,
      openTaskSidebar: openTaskSidebarMock,
      closeTaskSidebar: closeTaskSidebarMock,
    });

    render(<KanbanPage />);

    expect(screen.getByTestId("task-sidebar-overlay").dataset.open).toBe("true");
    expect(screen.getByTestId("task-detail-sidebar").textContent).toContain("OS-1");
    // The page reports the open surface so the shared shell hides mobile chrome.
    expect(setDetailSurfaceOpenMock).toHaveBeenLastCalledWith(true);
  });

  test("K opens the card above in board order while the panel is open", () => {
    const other = { _id: "task-2", clientId: "client-2", refId: "OS-2" } as Task;
    activeTaskResult.tasks = [task, other];
    useTaskSidebarNavigationMock.mockReturnValue({
      detailsTask: task,
      isSidebarOpen: true,
      openTaskSidebar: openTaskSidebarMock,
      closeTaskSidebar: closeTaskSidebarMock,
    });
    // Board order comes from the rendered cards, not the task array.
    for (const id of ["task-2", "task-1"]) {
      const card = document.body.appendChild(document.createElement("div"));
      card.dataset.boardTaskId = id;
    }

    render(<KanbanPage />);
    fireEvent.keyDown(document.body, { key: "k" });

    expect(openTaskSidebarMock).toHaveBeenCalledWith("client-2");
    document.querySelectorAll("[data-board-task-id]").forEach((card) => card.remove());
  });

  test("reports a closed detail surface to the shared shell", () => {
    render(<KanbanPage />);

    expect(setDetailSurfaceOpenMock).toHaveBeenLastCalledWith(false);
  });

  test("closes task details through the sidebar navigation path", () => {
    render(<KanbanPage />);

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));

    expect(closeTaskSidebarMock).toHaveBeenCalledTimes(1);
  });

  test("passes artifact URL callbacks that keep board task state scoped to active tasks", () => {
    useProjectTaskViewsMock.mockReturnValue({
      ...useProjectTaskViewsMock(),
      navigationState: {
        ...useProjectTaskViewsMock().navigationState,
        artifactId: "artifact-current",
        selectArtifact: clearArtifactSelectionMock,
        selectTaskArtifact: selectArtifactFromDetailsMock,
      },
    });
    useTaskSidebarNavigationMock.mockReturnValue({
      detailsTask: task,
      isSidebarOpen: true,
      openTaskSidebar: openTaskSidebarMock,
      closeTaskSidebar: closeTaskSidebarMock,
    });

    render(<KanbanPage />);

    expect(screen.getByTestId("task-detail-sidebar").dataset.artifactId).toBe(
      "artifact-current"
    );
    fireEvent.click(screen.getByRole("button", { name: "Select artifact" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear artifact" }));

    expect(selectArtifactFromDetailsMock).toHaveBeenCalledWith(
      "OS-1",
      "artifact-1",
      "active"
    );
    expect(clearArtifactSelectionMock).toHaveBeenCalledWith(null);
  });
  test("Owner board viewers cannot create, edit or drag cards", () => {
    permissions.role = "viewer";
    const context = useProjectTaskViewsMock();
    useProjectTaskViewsMock.mockReturnValue({ ...context, navigationState: { ...context.navigationState, boardGroupBy: "owner" } });
    render(<KanbanPage />);
    const props = kanbanBoardMock.mock.calls.at(-1)?.[0];
    expect(props.onTaskCreate).toBeUndefined();
    expect(props.onTaskUpdate).toBeUndefined();
    expect(props.onTaskReorder).toBeUndefined();
    expect(props.onTaskMove).toBeUndefined();
    expect(props.onTaskMakeSubtask).toBeUndefined();
    expect(props.cardContextMenu?.onOpenDetails).toEqual(expect.any(Function));
    expect(props.cardContextMenu?.readOnly).toBe(true);
  });

});
