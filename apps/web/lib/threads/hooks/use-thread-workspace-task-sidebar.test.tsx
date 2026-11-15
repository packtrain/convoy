/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Priority, Status, type Task } from "@/lib/tasks/types";
import { useTasks } from "@/lib/tasks/hooks/use-tasks";
import { useThreadNavigationState } from "@/lib/navigation";
import { useThreadWorkspaceTaskSidebar } from "./use-thread-workspace-task-sidebar";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/lib/tasks/hooks/use-tasks", () => ({
  useTasks: vi.fn(),
}));

vi.mock("@/lib/navigation", () => ({
  useThreadNavigationState: vi.fn(),
}));

const useQueryMock = vi.mocked(useQuery);
const useTasksMock = vi.mocked(useTasks);
const useThreadNavigationStateMock = vi.mocked(useThreadNavigationState);

function createTask(refId: string): Task {
  const refNumber = Number.parseInt(refId.split("-")[1] ?? "1", 10);

  return {
    delegatedToAgent: null,
    _id: `task_${refId}` as Id<"tasks">,
    clientId: `client_${refId}`,
    refNumber,
    refId,
    name: `Task ${refId}`,
    description: null,
    taskType: {
      key: "task",
      name: "Task",
      icon: "SquareCheckBig",
      color: "#64748b",
      isSystem: true,
    },
    priority: Priority.NONE,
    dueDate: null,
    status: Status.TODO,
    assignee: null,
    tags: [],
    rank: "a0",
    parentId: null,
    createdAt: 1,
    isArchived: false,
  };
}

describe("useThreadWorkspaceTaskSidebar", () => {
  let selectedTaskLookup:
    | {
        results: Array<{ task: Task | null }>;
      }
    | undefined;
  let attachedTaskLookup:
    | {
        results: Array<{ task: Task | null }>;
      }
    | undefined;
  let workspaceUrlState: {
    pathname: string;
    taskRefId: string | null;
    attachedTaskRefId: string | null;
    artifactId: string | null;
    archiveFilter: "active" | "archived";
    openTask: (
      taskRefId: string | null,
      archiveFilter?: "active" | "archived"
    ) => void;
    selectTaskArtifact: (
      taskRefId: string | null,
      artifactId: string | null,
      archiveFilter?: "active" | "archived"
    ) => void;
    selectArtifact: (artifactId: string | null) => void;
    threadArtifactId: string | null;
    threadArtifactTarget: (artifactId: string | null) => {
      pathname: string;
      query: URLSearchParams;
    };
    selectThreadArtifact: (artifactId: string | null) => void;
    closeThreadArtifact: () => void;
    closeTaskSidebar: () => void;
    taskHref: (
      taskRefId: string | null,
      archiveFilter?: "active" | "archived"
    ) => string;
    taskArtifactHref: (
      taskRefId: string | null,
      artifactId: string | null,
      archiveFilter?: "active" | "archived"
    ) => string;
    attachedTaskHref: (taskRefId: string | null) => string;
    taskTarget: (taskRefId: string | null) => {
      pathname: string;
      query: URLSearchParams;
    };
    taskArtifactTarget: (
      taskRefId: string | null,
      artifactId: string | null
    ) => { pathname: string; query: URLSearchParams };
    attachedTaskTarget: (taskRefId: string | null) => {
      pathname: string;
      query: URLSearchParams;
    };
    setAttachedTask: (taskRefId: string | null) => void;
  };
  beforeEach(() => {
    cleanup();
    selectedTaskLookup = {
      results: [{ task: createTask("OS-1") }],
    };
    attachedTaskLookup = undefined;
    workspaceUrlState = {
      pathname: "/o/contoso/OS/threads/thread_1",
      taskRefId: "OS-1",
      attachedTaskRefId: null,
      artifactId: null,
      archiveFilter: "active",
      openTask: vi.fn(),
      selectTaskArtifact: vi.fn(),
      selectArtifact: vi.fn(),
      threadArtifactId: null,
      threadArtifactTarget: vi.fn(() => ({
        pathname: "/o/contoso/OS/threads/thread_1",
        query: new URLSearchParams(),
      })),
      selectThreadArtifact: vi.fn(),
      closeThreadArtifact: vi.fn(),
      closeTaskSidebar: vi.fn(),
      taskHref: vi.fn(() => "/o/contoso/OS/threads/thread_1"),
      taskArtifactHref: vi.fn(() => "/o/contoso/OS/threads/thread_1"),
      attachedTaskHref: vi.fn(() => "/o/contoso/OS/threads/thread_1"),
      taskTarget: vi.fn(() => ({
        pathname: "/o/contoso/OS/threads/thread_1",
        query: new URLSearchParams(),
      })),
      taskArtifactTarget: vi.fn(() => ({
        pathname: "/o/contoso/OS/threads/thread_1",
        query: new URLSearchParams(),
      })),
      attachedTaskTarget: vi.fn(() => ({
        pathname: "/o/contoso/OS/threads/thread_1",
        query: new URLSearchParams(),
      })),
      setAttachedTask: vi.fn(),
    };
    useThreadNavigationStateMock.mockImplementation(() => workspaceUrlState);
    useTasksMock.mockReturnValue({
      tasks: [],
      isLoading: false,
      taskTree: [],
      flattenedTasks: [],
      expandedIds: new Set(),
      toggleExpanded: vi.fn(),
      expandAll: vi.fn(),
      collapseAll: vi.fn(),
      inputRefs: { current: new Map() },
      rowRefs: { current: new Map() },
      registerInput: vi.fn(),
      registerRow: vi.fn(),
      focusInput: vi.fn(),
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      archiveTask: vi.fn(),
      hasChildren: vi.fn(),
      getChildCount: vi.fn(),
      duplicateTask: vi.fn(),
      reorderTasks: vi.fn(),
      reorderMultiple: vi.fn(),
      moveTask: vi.fn(),
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
      bulkArchive: vi.fn(),
      bulkDelete: vi.fn(),
      unarchiveTask: vi.fn(),
      bulkDeleteWithChildren: vi.fn(),
      bulkUnarchive: vi.fn(),
      restoreTask: vi.fn(),
      getAdjacentId: vi.fn(),
    } as ReturnType<typeof useTasks>);
    useQueryMock.mockImplementation((...hookArgs) => {
      const [, args] = hookArgs;
      if (
        args &&
        args !== "skip" &&
        typeof args === "object" &&
        "refs" in args
      ) {
        const refs = Array.isArray(args.refs) ? args.refs : [];
        if (refs[0] === workspaceUrlState.taskRefId) {
          return selectedTaskLookup;
        }
        if (refs[0] === workspaceUrlState.attachedTaskRefId) {
          return attachedTaskLookup;
        }
      }

      if (args === undefined) {
        return { _id: "user_1" as Id<"users"> };
      }

      return undefined;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("keeps the current task visible while the next task lookup is pending", () => {
    const { result, rerender } = renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
      })
    );

    expect(result.current.detailsTask?.refId).toBe("OS-1");

    workspaceUrlState = {
      ...workspaceUrlState,
      taskRefId: "OS-2",
    };
    selectedTaskLookup = undefined;
    rerender();

    expect(result.current.detailsTask?.refId).toBe("OS-1");
    expect(workspaceUrlState.closeTaskSidebar).not.toHaveBeenCalled();

    selectedTaskLookup = {
      results: [{ task: createTask("OS-2") }],
    };
    rerender();

    expect(result.current.detailsTask?.refId).toBe("OS-2");
  });

  // The URL corrections below stop themselves by changing the URL. A write that
  // doesn't land (history throttling, a router-restored URL) leaves the
  // condition true, so retrying on every commit would trip React's
  // nested-update limit (#185).
  test("closes an unresolvable task sidebar once, not once per render", () => {
    const closeTaskSidebar = vi.fn();
    selectedTaskLookup = { results: [{ task: null }] };
    useThreadNavigationStateMock.mockImplementation(() => ({
      ...workspaceUrlState,
      // Fresh identity per render, as an unmemoized consumer would produce.
      closeTaskSidebar: (options?: { history?: "push" | "replace" }) => {
        closeTaskSidebar(options);
      },
    }));

    const { rerender } = renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
      })
    );
    rerender();
    rerender();

    expect(closeTaskSidebar).toHaveBeenCalledTimes(1);
    expect(closeTaskSidebar).toHaveBeenCalledWith({ history: "replace" });
  });

  test("rewrites a mismatched archive filter once, not once per render", () => {
    const openTask = vi.fn();
    selectedTaskLookup = {
      results: [{ task: { ...createTask("OS-1"), isArchived: true } }],
    };
    useThreadNavigationStateMock.mockImplementation(() => ({
      ...workspaceUrlState,
      openTask: (
        taskRefId: string | null,
        archiveFilter?: "active" | "archived",
        options?: { history?: "push" | "replace" }
      ) => {
        openTask(taskRefId, archiveFilter, options);
      },
    }));

    const { rerender } = renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
      })
    );
    rerender();
    rerender();

    expect(openTask).toHaveBeenCalledTimes(1);
    expect(openTask).toHaveBeenCalledWith("OS-1", "archived", {
      history: "replace",
    });
  });

  // Re-opening the task already in `task=<REF>` builds an identical URL that the
  // navigation layer discards, so a mirror keyed off the param cannot fire. The
  // opener has to reveal the surface itself (OS-1663).
  test("reveals the host surface on every open, including the already-selected task", () => {
    const onOpenTask = vi.fn();
    const { result } = renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
        onOpenTask,
      })
    );

    act(() => result.current.setTask("OS-1", "active"));

    expect(workspaceUrlState.openTask).toHaveBeenCalledWith("OS-1", "active", undefined);
    expect(onOpenTask).toHaveBeenCalledTimes(1);

    // Subtask opens go through the same path, so they reveal too.
    act(() => result.current.openTaskByClientId("client_OS-1"));

    expect(onOpenTask).toHaveBeenCalledTimes(2);
  });

  // A correction is not a user intent: re-showing a surface the user closed
  // would reopen it behind their back.
  test("does not reveal the host surface when correcting the URL", () => {
    const onOpenTask = vi.fn();
    selectedTaskLookup = {
      results: [{ task: { ...createTask("OS-1"), isArchived: true } }],
    };

    renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
        onOpenTask,
      })
    );

    expect(workspaceUrlState.openTask).toHaveBeenCalledWith("OS-1", "archived", {
      history: "replace",
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("scopes the task collection to the selected task's owning list (OS-1520)", () => {
    const task = {
      ...createTask("OS-1482"),
      list: {
        type: "list" as const,
        id: "list_refactoring" as Id<"taskLists">,
        ref: "REFACTORING",
        name: "Refactoring",
        isArchived: false,
      },
    };
    workspaceUrlState = { ...workspaceUrlState, taskRefId: "OS-1482" };
    selectedTaskLookup = { results: [{ task }] };

    renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
      })
    );

    expect(useTasksMock).toHaveBeenLastCalledWith(
      "project_1",
      "active",
      "all",
      "REFACTORING"
    );
  });

  test("preserves list, labelId, and resource fields from the lookup result", () => {
    const task = {
      ...createTask("OS-1"),
      list: {
        type: "list" as const,
        id: "list_1" as Id<"taskLists">,
        ref: "LIST-1",
        name: "Inbox",
        isArchived: false,
      },
      labelId: "label_1" as Id<"projectLabels">,
      externalLinks: [],
      attachmentCount: 2,
      artifactCount: 1,
    };
    selectedTaskLookup = { results: [{ task }] };

    const { result } = renderHook(() =>
      useThreadWorkspaceTaskSidebar({
        projectId: "project_1" as Id<"projects">,
      })
    );

    expect(result.current.detailsTask?.list).toEqual(task.list);
    expect(result.current.detailsTask?.labelId).toBe("label_1");
    expect(result.current.detailsTask?.externalLinks).toEqual([]);
    expect(result.current.detailsTask?.attachmentCount).toBe(2);
    expect(result.current.detailsTask?.artifactCount).toBe(1);
  });
});
