/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ProjectPage from "./page";
import { Status, type StatusFilterKey, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";

const useQueryMock = vi.fn();
const useTasksMock = vi.fn();
const useArchivedTasksMock = vi.fn();
const useProjectNavigationStateMock = vi.fn();
const useProjectTaskViewsMock = vi.fn();
const pushMock = vi.fn();

interface TaskTableCaptureProps {
  expandedIds: Set<string>;
  focusRequest?: { id: string; focus?: boolean };
  selectedIds: Set<string>;
  taskClientIds: string[];
}

let lastTaskTableProps: TaskTableCaptureProps | null = null;

vi.mock("@/lib/authz/use-project-permissions", () => ({ useProjectPermissions: () => ({ myRole: "project-admin" }) }));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ organizationSlug: "acme", projectAlias: "WEB" }),
  usePathname: () => "/o/acme/WEB",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
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
    openCreateTaskDialog: vi.fn(),
  }),
}));

vi.mock("./project-task-views-context", () => ({
  useProjectTaskViews: () => useProjectTaskViewsMock(),
}));

vi.mock("@/lib/navigation", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("@/lib/navigation");
  return {
    ...actual,
    useProjectNavigationState: () => ({
      normalizedListTarget: () => actual.routeTarget("/o/acme/WEB"),
      listViewTarget: () => actual.routeTarget("/o/acme/WEB"),
      boardViewTarget: () => actual.routeTarget("/o/acme/WEB/kanban"),
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
      selectedListHref: (listRef: string | null) =>
        listRef ? `/o/acme/WEB?list=${listRef}` : "/o/acme/WEB",
      backlogHref: () => "/o/acme/WEB?list=BACKLOG",
      archivedHref: () => "/o/acme/WEB?archived=true",
      selectArtifact: vi.fn(),
      selectTaskArtifact: vi.fn(),
      ...useProjectNavigationStateMock(),
    }),
  };
});

vi.mock("@/hooks/ui/use-resize-panel", () => ({
  useResizePanel: () => ({
    width: 320,
    handleMouseDown: vi.fn(),
    adjustWidthBy: vi.fn(),
  }),
}));

vi.mock("@/components/blocks/project/project-header", () => ({
  ProjectHeader: () => <div data-testid="project-header" />,
}));

vi.mock("@/components/blocks/tasks/task-table", () => ({
  TaskTable: (props: {
    expandedIds?: Set<string>;
    focusRequest?: { id: string; focus?: boolean };
    selectedIds: Set<string>;
    tasks: Array<{ clientId: string }>;
  }) => {
    lastTaskTableProps = {
      expandedIds: new Set(props.expandedIds ?? []),
      focusRequest: props.focusRequest,
      selectedIds: new Set(props.selectedIds),
      taskClientIds: props.tasks.map((task) => task.clientId),
    };

    return <div data-testid="task-table" />;
  },
}));

vi.mock("@/components/blocks/tasks/archive-completed-dialog", () => ({
  ArchiveCompletedDialog: () => null,
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
  BulkDeleteDialog: () => null,
}));

vi.mock("@/components/blocks/no-access", () => ({
  NoAccess: () => <div data-testid="no-access" />,
}));


vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task-1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1,
    refId: "WEB-1",
    name: "Task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: "None",
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|hzzzzz:",
    parentId: null,
    createdAt: Date.now(),
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

function createTaskHookResult(tasks: Task[]) {
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
    bulkArchive: vi.fn(),
    bulkUnarchive: vi.fn(),
    duplicateTask: vi.fn(),
    archiveTask: vi.fn(),
    unarchiveTask: vi.fn(),
    restoreTask: vi.fn(),
    inputRefs: { current: new Map() },
    focusInput: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    isLoadingMore: false,
  };
}

function setProjectUrlState({
  taskRefId,
  statusFilter = "all",
  tasks = [],
}: {
  taskRefId: string | null;
  statusFilter?: StatusFilterKey;
  tasks?: Task[];
}) {
  const navigationState = {
    viewMode: "list",
    listViewTarget: () => ({ pathname: "/o/acme/WEB" }),
    boardViewTarget: () => ({ pathname: "/o/acme/WEB/kanban" }),
    buildListViewUrl: () => "/o/acme/WEB",
    buildBoardViewUrl: () => "/o/acme/WEB/kanban",
    statusFilter,
    assigneeFilter: null,
    archiveFilter: "active",
    selectedListRef: null,
    taskRefId,
    artifactId: null,
    selectArtifact: vi.fn(),
    selectTaskArtifact: vi.fn(),
    openTask: vi.fn(),
    openTaskWithArchive: vi.fn(),
    taskWithArchiveHref: (nextTaskRefId: string) =>
      `/o/acme/WEB?task=${nextTaskRefId}`,
    setArtifact: vi.fn(),
    setTaskArtifact: vi.fn(),
    setTask: vi.fn(),
    setTaskWithArchive: vi.fn(),
    setStatusFilter: vi.fn(),
    setAssigneeFilter: vi.fn(),
    setArchiveFilter: vi.fn(),
  };

  useProjectNavigationStateMock.mockReturnValue(navigationState);
  const activeTaskResult = createTaskHookResult(tasks);
  useProjectTaskViewsMock.mockReturnValue({
    organizationSlug: "acme",
    projectAlias: "WEB",
    org: { _id: "org-1" },
    project: { _id: "project-1", name: "Project", defaultListId: null },
    allowedStatuses: ["To Do", "Done", "Canceled"],
    navigationState,
    activeTaskResult,
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
    currentMoveSourceListRef: null,
    currentUserId: "user-1",
    showTaskRank: false,
    openMembersSettings: vi.fn(),
    setHeaderAddTaskAction: vi.fn(),
    setDetailSurfaceOpen: vi.fn(),
  });
}

describe("ProjectPage task deep links", () => {
  beforeEach(() => {
    cleanup();
    lastTaskTableProps = null;
    pushMock.mockReset();
    useQueryMock.mockReset();
    useTasksMock.mockReset();
    useArchivedTasksMock.mockReset();
    useProjectNavigationStateMock.mockReset();
    useProjectTaskViewsMock.mockReset();

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
  });

  afterEach(() => {
    cleanup();
  });

  test("highlights a visible root-level deep-linked task", async () => {
    const task = buildTask();
    useTasksMock.mockReturnValue(createTaskHookResult([task]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));
    setProjectUrlState({ taskRefId: task.refId, tasks: [task] });

    render(<ProjectPage />);

    await waitFor(() => {
      expect(lastTaskTableProps?.selectedIds).toEqual(new Set([task.clientId]));
    });
  });

  test("expands ancestor rows before highlighting a nested deep-linked task", async () => {
    const parent = buildTask({
      _id: "task-parent" as Task["_id"],
      clientId: "client-parent",
      refNumber: 10,
      refId: "WEB-10",
      name: "Parent task",
      rank: "0|hzzzzx:",
    });
    const child = buildTask({
      _id: "task-child" as Task["_id"],
      clientId: "client-child",
      refNumber: 11,
      refId: "WEB-11",
      name: "Child task",
      parentId: String(parent._id),
      rank: "0|hzzzzy:",
    });

    useTasksMock.mockReturnValue(createTaskHookResult([parent, child]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));
    setProjectUrlState({ taskRefId: child.refId, tasks: [parent, child] });

    render(<ProjectPage />);

    await waitFor(() => {
      expect(lastTaskTableProps?.expandedIds).toEqual(new Set([String(parent._id)]));
      expect(lastTaskTableProps?.selectedIds).toEqual(new Set([child.clientId]));
      expect(lastTaskTableProps?.taskClientIds).toContain(child.clientId);
      expect(lastTaskTableProps?.focusRequest).toEqual({ id: child.clientId, focus: false });
    });
  });

  test("does not highlight tasks filtered out of the current list view", async () => {
    const doneTask = buildTask({
      _id: "task-done" as Task["_id"],
      clientId: "client-done",
      refNumber: 20,
      refId: "WEB-20",
      name: "Done task",
      status: Status.DONE,
    });

    useTasksMock.mockReturnValue(createTaskHookResult([doneTask]));
    useArchivedTasksMock.mockReturnValue(createTaskHookResult([]));
    setProjectUrlState({
      taskRefId: doneTask.refId,
      statusFilter: "active",
      tasks: [doneTask],
    });

    render(<ProjectPage />);

    await waitFor(() => {
      expect(lastTaskTableProps).not.toBeNull();
    });

    expect(lastTaskTableProps?.selectedIds).toEqual(new Set());
    expect(lastTaskTableProps?.taskClientIds).not.toContain(doneTask.clientId);
    expect(lastTaskTableProps?.focusRequest).toBeUndefined();
  });
});
