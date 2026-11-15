/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { FunctionReference } from "convex/server";
import { LexoRank } from "lexorank";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { clearLastResolvedValueCacheForTests } from "@/hooks/react/use-last-resolved-value";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { Status } from "@/lib/tasks/status";
import { useArchivedTasks } from "./use-archived-tasks";
import { useTasks } from "./use-tasks";

const useQueryMock = vi.fn();
const usePaginatedQueryMock = vi.fn();
const useMutationMock = vi.fn();
const toastMutationRejectionMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@/lib/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/errors")>()),
  toastMutationRejection: toastMutationRejectionMock,
}));

function createMutationMock() {
  const mutation = vi.fn().mockResolvedValue(null);
  return Object.assign(mutation, {
    withOptimisticUpdate: vi.fn(() => mutation),
  });
}

type AnyMutationReference = FunctionReference<"mutation">;

function createTrackedMutationMock(mutationRef: AnyMutationReference) {
  const mutation = vi.fn().mockResolvedValue(null);
  const tracked = Object.assign(mutation, {
    mutationRef,
    optimisticUpdate: undefined as
      | ((localStore: {
          getQuery?: (query: unknown, args: unknown) => ReturnType<typeof makeTask>[] | undefined;
          getAllQueries?: (query: unknown) => Array<{ args: Record<string, unknown>; value: unknown }>;
          setQuery: (query: unknown, args: unknown, value: unknown) => void;
        }, args: Record<string, unknown>) => void)
      | undefined,
    withOptimisticUpdate: vi.fn((callback) => {
      tracked.optimisticUpdate = callback;
      return mutation;
    }),
  });

  return tracked;
}

function getTrackedMutation(
  trackedMutations: ReturnType<typeof createTrackedMutationMock>[],
  mutationRef: AnyMutationReference
) {
  const mutationName = getFunctionName(mutationRef);
  const mutation = trackedMutations.find(
    (tracked) => getFunctionName(tracked.mutationRef) === mutationName
  );
  expect(mutation).toBeDefined();
  return mutation!;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    _id: "task-1",
    _creationTime: 0,
    clientId: "client-1",
    refNumber: 1,
    refId: "WEB-1",
    name: "Task",
    description: null,
    taskType: {
      key: "task",
      name: "Task",
      icon: "Circle",
      color: "#3b82f6",
      isSystem: true,
    },
    priority: "None",
    dueDate: null,
    status: Status.TODO,
    list: null,
    tags: [],
    rank: "0|i0000:",
    parentId: null,
    createdBy: "user-1",
    createdByName: "User",
    createdAt: 0,
    updatedAt: 0,
    isArchived: false,
    archivedAt: undefined,
    archivedBy: undefined,
    ...overrides,
  };
}

describe("task hook loading stability", () => {
  afterEach(() => {
    cleanup();
    clearLastResolvedValueCacheForTests();
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    useMutationMock.mockReset();
  });

  test("useTasks preserves active tasks during a transient query loading gap", () => {
    const projectId = "project-1" as Id<"projects">;
    let tasks: ReturnType<typeof makeTask>[] | undefined = [makeTask()];
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      args === "skip" ? undefined : tasks
    );
    useMutationMock.mockImplementation(() => createMutationMock());

    const { result, rerender } = renderHook(() => useTasks(projectId, "active"));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.tasks.map((task) => task.refId)).toEqual(["WEB-1"]);

    tasks = undefined;
    rerender();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.tasks.map((task) => task.refId)).toEqual(["WEB-1"]);
  });

  test("useTasks requests Backlog tasks by system List ref", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    useMutationMock.mockImplementation(() => createMutationMock());

    renderHook(() => useTasks(projectId, "active", "all", "BACKLOG"));

    expect(useQueryMock).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId,
      archiveFilter: "active",
      listRef: "BACKLOG",
    });
  });

  test("useTasks omits statuses for non-backlog views (one full-container subscription)", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    useMutationMock.mockImplementation(() => createMutationMock());

    // Every non-backlog view shares a single full-container subscription; the
    // status filter is applied client-side, so no `statuses` arg is sent.
    for (const statusFilter of ["all", "active", "done", "canceled"] as const) {
      cleanup();
      useQueryMock.mockClear();
      renderHook(() => useTasks(projectId, "active", statusFilter));
      expect(useQueryMock).toHaveBeenCalledWith(api.tasks.core.listByProject, {
        projectId,
        archiveFilter: "active",
      });
    }
  });

  test("useTasks passes selected List ref to query and create mutation", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() =>
      useTasks(projectId, "active", "all", "SPRINT-1")
    );

    expect(useQueryMock).toHaveBeenCalledWith(api.tasks.core.listByProject, {
      projectId,
      archiveFilter: "active",
      listRef: "SPRINT-1",
    });

    act(() => {
      result.current.addTask({
        delegatedToAgent: null,
        refNumber: 1,
        refId: "WEB-1",
        name: "Task",
        description: null,
        taskType: {
          key: "task",
          name: "Task",
          icon: "SquareCheckBig",
          color: "#3b82f6",
          isSystem: true,
        },
        priority: "None",
        dueDate: null,
        status: Status.TODO,
        list: null,
        assignee: null,
        tags: [],
        rank: "0|i0000:",
        parentId: null,
        createdAt: 0,
        isArchived: false,
      });
    });

    const createMutation = getTrackedMutation(trackedMutations, api.tasks.core.create);
    expect(createMutation).toHaveBeenCalledWith(
      expect.objectContaining({ listRef: "SPRINT-1" })
    );
  });

  test("useTasks routes bulk metadata callbacks through the unified bulkUpdate mutation", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));
    const bulkUpdateMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.bulk.update
    );

    act(() => {
      result.current.bulkUpdateStatus(["task-1"], Status.DONE);
      result.current.bulkUpdateAssignee(["task-1"], {
        assigneeId: "user-2" as never,
      });
      result.current.bulkUpdatePriority(["task-1"], "High");
      result.current.bulkUpdateDueDate(["task-1"], 12345);
      result.current.bulkUpdateTaskType(["task-1"], "bug");
    });

    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(1, {
      ids: ["task-1"],
      status: Status.DONE,
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(2, {
      ids: ["task-1"],
      assigneeId: "user-2",
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(3, {
      ids: ["task-1"],
      priority: "High",
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(4, {
      ids: ["task-1"],
      dueDate: 12345,
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(5, {
      ids: ["task-1"],
      taskTypeKey: "bug",
    });
  });

  test("useTasks optimistically applies combined bulk metadata updates", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    renderHook(() => useTasks(projectId, "active"));
    const bulkUpdateMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.bulk.update
    );
    const task = makeTask({ _id: "task-1", updatedAt: 10 });
    const otherTask = makeTask({ _id: "task-2", updatedAt: 10 });
    let currentTasks = [task, otherTask];
    const localStore = {
      getQuery: vi.fn(() => currentTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        currentTasks = value as typeof currentTasks;
      }),
    };

    bulkUpdateMutation.optimisticUpdate?.(localStore, {
      ids: ["task-1"],
      status: Status.IN_PROGRESS,
      assigneeId: "user-2" as Id<"users">,
      priority: "High",
      dueDate: 12345,
      taskTypeKey: "bug",
    });

    expect(currentTasks[0]).toMatchObject({
      status: Status.IN_PROGRESS,
      assignee: {
        type: "user",
        userId: "user-2",
        name: null,
        avatarUrl: null,
      },
      priority: "High",
      dueDate: 12345,
      taskType: expect.objectContaining({ key: "bug" }),
    });
    expect(currentTasks[0].updatedAt).toBeGreaterThan(10);
    expect(currentTasks[1]).toEqual(otherTask);
  });

  test("useTasks optimistically applies selected Project-agent details", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));
    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    const task = makeTask({
      _id: "task-1",
      updatedAt: 10,
      assignee: {
        type: "projectAgent",
        projectAgentId: "agent-1",
        name: "Code Reviewer",
        appearance: { color: "#3b82f6" },
        isDeleted: false,
      },
    });
    let currentTasks = [task];
    const localStore = {
      getQuery: vi.fn(() => currentTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        currentTasks = value as typeof currentTasks;
      }),
    };

    act(() => {
      result.current.updateTask("task-1", {
        delegatedToAgentId: "agent-2" as Id<"projectAgents">,
        delegatedToAgentDetails: {
          type: "projectAgent",
          projectAgentId: "agent-2" as Id<"projectAgents">,
          name: "QA Agent",
          appearance: { color: "#f97316" },
          isDeleted: false,
        },
      });
    });

    const mutationArgs = updateMutation.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    updateMutation.optimisticUpdate?.(localStore, mutationArgs);

    expect(mutationArgs).toEqual({
      id: "task-1",
      delegatedToAgentId: "agent-2",
    });
    expect(currentTasks[0]).toMatchObject({
      delegatedToAgent: {
        type: "projectAgent",
        projectAgentId: "agent-2",
        name: "QA Agent",
        appearance: { color: "#f97316" },
        isDeleted: false,
      },
    });
  });

  test("useTasks optimistically moves a task's checks to its new type's checklist", () => {
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });
    const { result } = renderHook(() => useTasks("project-1" as Id<"projects">, "active"));
    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    const taskChecks = {
      checklists: [
        { _id: "feature", name: "Feature", isDefault: true, checkKeys: ["ui"], taskTypeKeys: ["feature"] },
        { _id: "bug", name: "Bug fix", isDefault: false, checkKeys: ["regression"], taskTypeKeys: ["bug"] },
      ],
      checklistId: "feature",
      followsTypeDefault: true,
      catalog: [
        { key: "regression", label: "Regression test", instruction: "" },
        { key: "ui", label: "UI verified", instruction: "" },
      ],
      checks: [{ key: "ui", label: "UI verified", instruction: "", added: false, results: [] }],
    };
    const isChecks = (query: unknown) => getFunctionName(query as never) === getFunctionName(api.checks.checklists.getForTask);
    const localStore = {
      getQuery: vi.fn((query: unknown) => (isChecks(query) ? taskChecks : [makeTask()])) as never,
      setQuery: vi.fn(),
    };

    act(() => result.current.updateTask("task-1", { taskTypeKey: "bug" }));
    updateMutation.optimisticUpdate?.(localStore, updateMutation.mock.calls.at(-1)?.[0] as Record<string, unknown>);

    const patched = localStore.setQuery.mock.calls.find(([query]) => isChecks(query));
    expect(patched?.[1]).toEqual({ taskId: "task-1" });
    expect(patched?.[2]).toMatchObject({ checklistId: "bug", checks: [{ key: "regression" }] });
  });

  test("useTasks optimistically removes moved subtrees from the current List view", () => {
    const projectId = "project-1" as Id<"projects">;
    useQueryMock.mockReturnValue([]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    renderHook(() => useTasks(projectId, "active", "all", "SPRINT-1"));

    const moveToListMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.move.toList
    );
    const parent = makeTask({ _id: "parent-1", clientId: "client-parent-1" });
    const child = makeTask({
      _id: "child-1",
      clientId: "client-child-1",
      parentId: "parent-1",
    });
    const sibling = makeTask({ _id: "sibling-1", clientId: "client-sibling-1" });
    let currentTasks = [parent, child, sibling];
    const queryArgs = {
      projectId,
      archiveFilter: "active",
      listRef: "SPRINT-1",
    };
    const localStore = {
      getQuery: vi.fn(() => currentTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        currentTasks = value as typeof currentTasks;
      }),
    };

    moveToListMutation.optimisticUpdate?.(localStore, {
      rootIds: ["parent-1"],
      listRef: "OTHER",
    });

    expect(currentTasks.map((task) => task._id)).toEqual(["sibling-1"]);
    expect(localStore.getQuery).toHaveBeenCalledWith(
      api.tasks.core.listByProject,
      queryArgs
    );
  });

  test("useTasks optimistically moves closed roots to the bottom", () => {
    const projectId = "project-1" as Id<"projects">;
    const baseRank = LexoRank.middle();
    const done = makeTask({
      _id: "task-done",
      clientId: "client-done",
      status: Status.DONE,
      rank: baseRank.toString(),
    });
    const canceled = makeTask({
      _id: "task-canceled",
      clientId: "client-canceled",
      status: Status.CANCELED,
      rank: baseRank.genNext().toString(),
    });
    const open = makeTask({
      _id: "task-open",
      clientId: "client-open",
      status: Status.TODO,
      rank: baseRank.genNext().genNext().toString(),
    });
    const child = makeTask({
      _id: "task-child",
      clientId: "client-child",
      parentId: "task-done",
      status: Status.TODO,
      rank: baseRank.genNext().genNext().genNext().toString(),
    });
    useQueryMock.mockReturnValue([done, canceled, open, child]);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active", "all"));
    act(() => {
      result.current.moveClosedToBottom(["task-done", "task-canceled", "task-open"]);
    });

    const mutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.batchUpdate);
    expect(mutation).toHaveBeenCalledWith({
      updates: [
        {
          id: "task-open",
          rank: expect.any(String),
        },
      ],
    });

    let currentTasks = [done, canceled, open, child];
    const localStore = {
      getQuery: vi.fn(() => currentTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        currentTasks = value as typeof currentTasks;
      }),
    };

    const calledWith = mutation.mock.calls.at(-1)?.[0] as {
      updates: Array<{ id: string; rank: string }>;
    };
    mutation.optimisticUpdate?.(localStore, calledWith);

    expect(currentTasks.map((task) => task._id)).toEqual([
      "task-open",
      "task-done",
      "task-canceled",
      "task-child",
    ]);
    expect(currentTasks.find((task) => task._id === "task-child")?.rank).toBe(
      child.rank
    );
    expect(
      currentTasks.find((task) => task._id === "task-open")?.updatedAt
    ).toBeGreaterThan(open.updatedAt);
  });

  test("useArchivedTasks preserves archived tasks during a transient first-page loading gap", () => {
    const projectId = "project-1" as Id<"projects">;
    let paginatedResult = {
      results: [makeTask({ isArchived: true, archivedAt: 1 })],
      status: "Exhausted",
      loadMore: vi.fn(),
    };
    usePaginatedQueryMock.mockImplementation(() => paginatedResult);
    useMutationMock.mockImplementation(() => createMutationMock());

    const { result, rerender } = renderHook(() => useArchivedTasks(projectId));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.tasks.map((task) => task.refId)).toEqual(["WEB-1"]);

    paginatedResult = {
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    };
    rerender();

    expect(result.current.isLoading).toBe(false);
    expect(result.current.tasks.map((task) => task.refId)).toEqual(["WEB-1"]);
  });

  test("useArchivedTasks optimistically removes unarchived roots and visible descendants", () => {
    const projectId = "project-1" as Id<"projects">;
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    renderHook(() => useArchivedTasks(projectId));

    const bulkUnarchiveMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.bulk.unarchive
    );
    expect(bulkUnarchiveMutation.optimisticUpdate).toBeTypeOf("function");

    const parent = makeTask({
      _id: "parent-1",
      clientId: "client-parent-1",
      refId: "WEB-10",
      isArchived: true,
      archivedAt: 2,
    });
    const child = makeTask({
      _id: "child-1",
      clientId: "client-child-1",
      refId: "WEB-11",
      parentId: "parent-1",
      isArchived: true,
      archivedAt: 1,
    });
    const sibling = makeTask({
      _id: "sibling-1",
      clientId: "client-sibling-1",
      refId: "WEB-12",
      isArchived: true,
      archivedAt: 3,
    });
    let pageResult = {
      page: [sibling, parent, child],
      isDone: true,
      continueCursor: "",
      pageStatus: null,
      splitCursor: null,
    };
    const pageArgs = {
      projectId,
      paginationOpts: { numItems: 50, cursor: null },
    };
    const localStore = {
      getAllQueries: vi.fn(() => [
        {
          args: pageArgs,
          value: pageResult,
        },
      ]),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        pageResult = value as typeof pageResult;
      }),
    };

    bulkUnarchiveMutation.optimisticUpdate?.(localStore, {
      ids: ["parent-1"],
    });

    expect(pageResult).toMatchObject({
      isDone: true,
      continueCursor: "",
      pageStatus: null,
      splitCursor: null,
    });
    expect(pageResult.page.map((task) => task._id)).toEqual(["sibling-1"]);
  });

  test("useArchivedTasks routes bulk metadata callbacks through the unified bulkUpdate mutation", () => {
    const projectId = "project-1" as Id<"projects">;
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: "Exhausted",
      loadMore: vi.fn(),
    });
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useArchivedTasks(projectId));
    const bulkUpdateMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.bulk.update
    );

    act(() => {
      result.current.bulkUpdateStatus(["task-1"], Status.DONE);
      result.current.bulkUpdateAssignee(["task-1"], {
        assigneeId: "user-2" as never,
      });
      result.current.bulkUpdatePriority(["task-1"], "High");
      result.current.bulkUpdateDueDate(["task-1"], null);
      result.current.bulkUpdateTaskType(["task-1"], "feature");
    });

    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(1, {
      ids: ["task-1"],
      status: Status.DONE,
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(2, {
      ids: ["task-1"],
      assigneeId: "user-2",
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(3, {
      ids: ["task-1"],
      priority: "High",
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(4, {
      ids: ["task-1"],
      dueDate: null,
    });
    expect(bulkUpdateMutation).toHaveBeenNthCalledWith(5, {
      ids: ["task-1"],
      taskTypeKey: "feature",
    });
  });

  test("useTasks keeps restored archive snapshots visible while bulk unarchive syncs", async () => {
    const projectId = "project-1" as Id<"projects">;
    const parent = makeTask({
      _id: "parent-1",
      clientId: "client-parent-1",
      refId: "WEB-10",
      rank: "0|h0000:",
    });
    const child = makeTask({
      _id: "child-1",
      clientId: "client-child-1",
      refId: "WEB-11",
      parentId: "parent-1",
      rank: "0|hzzzz:",
    });
    const sibling = makeTask({
      _id: "sibling-1",
      clientId: "client-sibling-1",
      refId: "WEB-12",
      rank: "0|i0000:",
    });
    let storedTasks = [parent, child, sibling];
    let serverTasks = storedTasks;
    useQueryMock.mockImplementation(() => serverTasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result, rerender } = renderHook(() => useTasks(projectId, "active"));

    const bulkArchiveMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.bulk.archive
    );
    const localStore = {
      getQuery: vi.fn(() => storedTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        storedTasks = value as typeof storedTasks;
      }),
    };

    act(() => {
      bulkArchiveMutation.optimisticUpdate?.(localStore, {
        ids: ["parent-1"],
      });
    });

    expect(storedTasks.map((task) => task._id)).toEqual(["sibling-1"]);

    serverTasks = [sibling];
    rerender();

    await act(async () => {
      await result.current.bulkUnarchive(["parent-1"]);
    });

    expect(storedTasks.map((task) => task._id)).toEqual(["sibling-1"]);
    expect(result.current.tasks.map((task) => task._id)).toEqual([
      "parent-1",
      "child-1",
      "sibling-1",
    ]);
    expect(result.current.tasks.find((task) => task._id === "parent-1")).toMatchObject({
      isArchived: false,
      archivedAt: undefined,
      archivedBy: undefined,
    });
    const restoredParent = result.current.tasks.find((task) => task._id === "parent-1");
    const activeSibling = result.current.tasks.find((task) => task._id === "sibling-1");
    expect(restoredParent?.rank).not.toBe(parent.rank);
    expect(restoredParent?.rank.localeCompare(activeSibling?.rank ?? "")).toBeLessThan(0);

    rerender();

    expect(result.current.tasks.map((task) => task._id)).toEqual([
      "parent-1",
      "child-1",
      "sibling-1",
    ]);
  });

  test("useTasks heals duplicate sibling ranks when reordering into a duplicate run", () => {
    const projectId = "project-1" as Id<"projects">;
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const sourceRank = LexoRank.parse(duplicateRank).genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: prevRank }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: duplicateRank }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: duplicateRank }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: sourceRank }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderTasks("task-d", "task-c");
    });

    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    const batchUpdateRanksMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.rank.batchUpdate
    );
    expect(updateRankMutation).not.toHaveBeenCalled();
    expect(batchUpdateRanksMutation).toHaveBeenCalledOnce();
    const updates = batchUpdateRanksMutation.mock.calls[0][0].updates;
    expect(updates.map((update: { id: string }) => update.id)).toEqual([
      "task-b",
      "task-d",
      "task-c",
    ]);
    expect(new Set(updates.map((update: { rank: string }) => update.rank)).size).toBe(3);
  });

  test("useTasks keeps single rank updates for non-duplicate reorders", () => {
    const projectId = "project-1" as Id<"projects">;
    const baseRank = LexoRank.middle();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: baseRank.toString() }),
      makeTask({
        _id: "task-b",
        clientId: "client-b",
        rank: baseRank.genNext().toString(),
      }),
      makeTask({
        _id: "task-c",
        clientId: "client-c",
        rank: baseRank.genNext().genNext().toString(),
      }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderTasks("task-c", "task-b");
    });

    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    const batchUpdateRanksMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.rank.batchUpdate
    );
    expect(updateRankMutation).toHaveBeenCalledOnce();
    expect(updateRankMutation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-c" })
    );
    expect(batchUpdateRanksMutation).not.toHaveBeenCalled();
  });

  test("useTasks preserves rank order for multi-reorder healing", () => {
    const projectId = "project-1" as Id<"projects">;
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const sourceRankA = LexoRank.parse(duplicateRank).genNext().toString();
    const sourceRankB = LexoRank.parse(sourceRankA).genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: prevRank }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: duplicateRank }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: duplicateRank }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: sourceRankA }),
      makeTask({ _id: "task-e", clientId: "client-e", rank: sourceRankB }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderMultiple(["task-e", "task-d"], "task-c");
    });

    const batchUpdateRanksMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.rank.batchUpdate
    );
    expect(batchUpdateRanksMutation).toHaveBeenCalledOnce();
    const updates = batchUpdateRanksMutation.mock.calls[0][0].updates;
    expect(updates.map((update: { id: string }) => update.id)).toEqual([
      "task-b",
      "task-d",
      "task-e",
      "task-c",
    ]);
  });

  test("useTasks reorder 'after' lands between target and its true next sibling", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankB = base.genNext().toString();
    const rankC = base.genNext().genNext().toString();
    const rankD = base.genNext().genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: rankB }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: rankC }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: rankD }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderTasks("task-d", "task-a", null, "after");
    });

    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    expect(updateRankMutation).toHaveBeenCalledOnce();
    const newRank: string = updateRankMutation.mock.calls[0][0].rank;
    expect(updateRankMutation.mock.calls[0][0].id).toBe("task-d");
    // Lands after A and before A's true next sibling B, not after B.
    expect(rankA.localeCompare(newRank)).toBeLessThan(0);
    expect(newRank.localeCompare(rankB)).toBeLessThan(0);
  });

  test("useTasks reorder 'after' the last sibling appends to the end", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankB = base.genNext().toString();
    const rankSource = base.genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: rankB }),
      makeTask({ _id: "task-s", clientId: "client-s", rank: rankSource }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderTasks("task-s", "task-b", null, "after");
    });

    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    expect(updateRankMutation).toHaveBeenCalledOnce();
    const newRank: string = updateRankMutation.mock.calls[0][0].rank;
    // Dropping after the last sibling places the task after it, not before it.
    expect(rankB.localeCompare(newRank)).toBeLessThan(0);
  });

  test("useTasks multi-reorder 'after' lands between target and its true next sibling", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankB = base.genNext().toString();
    const rankC = base.genNext().genNext().toString();
    const rankD = base.genNext().genNext().genNext().toString();
    const rankE = base.genNext().genNext().genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: rankB }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: rankC }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: rankD }),
      makeTask({ _id: "task-e", clientId: "client-e", rank: rankE }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.reorderMultiple(["task-d", "task-e"], "task-a", null, "after");
    });

    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    expect(updateRankMutation).toHaveBeenCalledTimes(2);
    const rankFor = (id: string): string =>
      updateRankMutation.mock.calls.find((call) => call[0].id === id)![0].rank;
    const newRankD = rankFor("task-d");
    const newRankE = rankFor("task-e");
    // Both moved tasks land between A and A's true next sibling B, in order.
    for (const rank of [newRankD, newRankE]) {
      expect(rankA.localeCompare(rank)).toBeLessThan(0);
      expect(rank.localeCompare(rankB)).toBeLessThan(0);
    }
    expect(newRankD.localeCompare(newRankE)).toBeLessThan(0);
  });

  test("useTasks moveTask applies field and rank in a single update mutation", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankB = base.genNext().toString();
    const rankC = base.genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: rankB }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: rankC }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.moveTask(
        "task-c",
        { status: Status.IN_PROGRESS },
        { targetTaskId: "task-a", position: "before" }
      );
    });

    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    const updateRankMutation = getTrackedMutation(trackedMutations, api.tasks.core.rank.update);
    expect(updateRankMutation).not.toHaveBeenCalled();
    expect(updateMutation).toHaveBeenCalledOnce();
    const args = updateMutation.mock.calls[0][0];
    expect(args.id).toBe("task-c");
    expect(args.status).toBe(Status.IN_PROGRESS);
    expect(args.rank.localeCompare(rankA)).toBeLessThan(0);
  });

  test("useTasks moveTask without a rank target sends a field-only update", () => {
    const projectId = "project-1" as Id<"projects">;
    const rankA = LexoRank.middle().toString();
    const tasks = [makeTask({ _id: "task-a", clientId: "client-a", rank: rankA })];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.moveTask("task-a", { status: Status.BLOCKED });
    });

    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    expect(updateMutation).toHaveBeenCalledOnce();
    const args = updateMutation.mock.calls[0][0];
    expect(args).toEqual({ id: "task-a", status: Status.BLOCKED });
    expect("rank" in args).toBe(false);
  });

  test("useTasks moveTask prefers typed assignee and applies Project-agent details optimistically", () => {
    const projectId = "project-1" as Id<"projects">;
    const tasks = [
      makeTask({
        _id: "task-a",
        clientId: "client-a",
        assignee: null,
      }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    let currentTasks = tasks;
    const localStore = {
      getQuery: vi.fn(() => currentTasks),
      setQuery: vi.fn((_query: unknown, _args: unknown, value: unknown) => {
        currentTasks = value as typeof currentTasks;
      }),
    };

    const { result } = renderHook(() => useTasks(projectId, "active"));
    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    act(() => {
      result.current.moveTask("task-a", {
        delegatedToAgentId: "agent-1" as Id<"projectAgents">,
        delegatedToAgentDetails: {
          type: "projectAgent",
          projectAgentId: "agent-1" as Id<"projectAgents">,
          name: "Code Review",
          appearance: { color: "#3b82f6" },
          isDeleted: false,
        },
      });
    });

    const args = updateMutation.mock.calls.at(-1)?.[0];
    expect(args).toEqual({
      id: "task-a",
      delegatedToAgentId: "agent-1",
    });

    updateMutation.optimisticUpdate?.(localStore, args);
    expect(currentTasks[0]).toMatchObject({
      delegatedToAgent: {
        type: "projectAgent",
        projectAgentId: "agent-1",
        name: "Code Review",
      },
    });
  });

  test("useTasks moveTask resolves rank against true root neighbors, skipping subtasks", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankChild = base.genNext().toString();
    const rankC = base.genNext().genNext().toString();
    const rankD = base.genNext().genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({
        _id: "task-b",
        clientId: "client-b",
        rank: rankChild,
        parentId: "task-a",
      }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: rankC }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: rankD }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.moveTask(
        "task-d",
        { priority: "High" },
        { targetTaskId: "task-a", position: "after" }
      );
    });

    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    expect(updateMutation).toHaveBeenCalledOnce();
    const args = updateMutation.mock.calls[0][0];
    // Lands between root A and root C; the subtask between them is not a sibling.
    expect(rankA.localeCompare(args.rank)).toBeLessThan(0);
    expect(args.rank.localeCompare(rankC)).toBeLessThan(0);
  });

  test("useTasks moveTask heals duplicate sibling ranks and keeps field updates separate", () => {
    const projectId = "project-1" as Id<"projects">;
    const duplicateRank = LexoRank.middle().toString();
    const prevRank = LexoRank.parse(duplicateRank).genPrev().toString();
    const sourceRank = LexoRank.parse(duplicateRank).genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: prevRank }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: duplicateRank }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: duplicateRank }),
      makeTask({ _id: "task-d", clientId: "client-d", rank: sourceRank }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    const { result } = renderHook(() => useTasks(projectId, "active"));

    act(() => {
      result.current.moveTask(
        "task-d",
        { status: Status.IN_PROGRESS },
        { targetTaskId: "task-c", position: "before" }
      );
    });

    const batchUpdateRanksMutation = getTrackedMutation(
      trackedMutations,
      api.tasks.core.rank.batchUpdate
    );
    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    expect(batchUpdateRanksMutation).toHaveBeenCalledOnce();
    const updates = batchUpdateRanksMutation.mock.calls[0][0].updates;
    expect(updates.map((update: { id: string }) => update.id)).toEqual([
      "task-b",
      "task-d",
      "task-c",
    ]);
    // The healing batch carries the destination rank; the update is field-only.
    expect(updateMutation).toHaveBeenCalledOnce();
    expect(updateMutation.mock.calls[0][0]).toEqual({
      id: "task-d",
      status: Status.IN_PROGRESS,
    });
  });

  test("useTasks update optimistic update re-sorts tasks when rank changes", () => {
    const projectId = "project-1" as Id<"projects">;
    const base = LexoRank.middle();
    const rankA = base.toString();
    const rankB = base.genNext().toString();
    const rankC = base.genNext().genNext().toString();
    const tasks = [
      makeTask({ _id: "task-a", clientId: "client-a", rank: rankA }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: rankB }),
      makeTask({ _id: "task-c", clientId: "client-c", rank: rankC }),
    ];
    useQueryMock.mockReturnValue(tasks);
    const trackedMutations: ReturnType<typeof createTrackedMutationMock>[] = [];
    useMutationMock.mockImplementation((mutationRef: AnyMutationReference) => {
      const mutation = createTrackedMutationMock(mutationRef);
      trackedMutations.push(mutation);
      return mutation;
    });

    renderHook(() => useTasks(projectId, "active"));

    const updateMutation = getTrackedMutation(trackedMutations, api.tasks.core.update);
    const setQuery = vi.fn();
    updateMutation.optimisticUpdate?.(
      { getQuery: () => tasks, setQuery },
      {
        id: "task-c",
        status: Status.IN_PROGRESS,
        rank: LexoRank.parse(rankA).genPrev().toString(),
      }
    );

    expect(setQuery).toHaveBeenCalledOnce();
    const updatedTasks = setQuery.mock.calls[0][2] as ReturnType<typeof makeTask>[];
    expect(updatedTasks.map((task) => task._id)).toEqual([
      "task-c",
      "task-a",
      "task-b",
    ]);
    expect(
      updatedTasks.find((task) => task._id === "task-c")?.status
    ).toBe(Status.IN_PROGRESS);
  });
});

test("task creation passes an explicit owner override alongside agent-filter delegation", () => {
  useQueryMock.mockReturnValue([]);
  const mutations: ReturnType<typeof createTrackedMutationMock>[] = [];
  useMutationMock.mockImplementation((ref: AnyMutationReference) => {
    const mutation = createTrackedMutationMock(ref);
    mutations.push(mutation);
    return mutation;
  });
  const { result } = renderHook(() => useTasks("project" as Id<"projects">, "active"));
  const options = { assigneeId: null, beforeId: undefined };
  act(() => { result.current.addTask(createDefaultTask({ name: "Ownerless", assigneeInput: { type: "projectAgent", projectAgentId: "agent" as Id<"projectAgents"> } }), options); });
  expect(getTrackedMutation(mutations, api.tasks.core.create)).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null, delegatedToAgentId: "agent" }));
});

// A rejected write reverts its optimistic update; the toast says why
// (docs/specs/read-only-viewer-ux.md, Soft failures).
describe("fire-and-forget task writes", () => {
  afterEach(() => {
    cleanup();
    useQueryMock.mockReset();
    usePaginatedQueryMock.mockReset();
    useMutationMock.mockReset();
    toastMutationRejectionMock.mockReset();
  });

  const denial = new Error("Permission denied: task:update");
  type ActiveTasks = ReturnType<typeof useTasks>;
  type ArchivedTasks = ReturnType<typeof useArchivedTasks>;

  test.each<[string, (tasks: ActiveTasks) => void]>([
    ["updateTask", (tasks) => tasks.updateTask("task-a", { name: "Renamed" })],
    ["addTask", (tasks) => { tasks.addTask(createDefaultTask({ name: "New" })); }],
    ["duplicateTask", (tasks) => { tasks.duplicateTask("task-a"); }],
    ["reorderTasks", (tasks) => tasks.reorderTasks("task-b", "task-a")],
    ["reorderMultiple", (tasks) => tasks.reorderMultiple(["task-b"], "task-a")],
    ["moveTask", (tasks) => tasks.moveTask("task-b", { status: Status.DONE }, { targetTaskId: "task-a", position: "before" })],
    ["moveClosedToBottom", (tasks) => tasks.moveClosedToBottom(["task-a", "task-b"])],
    ["setParent", (tasks) => tasks.setParent("task-b", "task-a")],
    ["setParentMultiple", (tasks) => tasks.setParentMultiple(["task-b"], "task-a")],
    ["bulkUpdateStatus", (tasks) => tasks.bulkUpdateStatus(["task-a"], Status.DONE)],
    ["moveToList", (tasks) => tasks.moveToList(["task-a"], "BACKLOG")],
  ])("useTasks %s toasts a rejection", async (_name, act) => {
    useQueryMock.mockReturnValue([
      makeTask({ _id: "task-a", clientId: "client-a", rank: LexoRank.middle().toString(), status: Status.DONE }),
      makeTask({ _id: "task-b", clientId: "client-b", rank: LexoRank.middle().genNext().toString() }),
    ]);
    useMutationMock.mockImplementation(() => {
      const mutation = createMutationMock();
      mutation.mockRejectedValue(denial);
      return mutation;
    });
    const { result } = renderHook(() => useTasks("project-1" as Id<"projects">, "active"));

    act(result.current);

    await vi.waitFor(() => expect(toastMutationRejectionMock).toHaveBeenCalledWith(denial));
  });

  test.each<[string, (tasks: ArchivedTasks) => void]>([
    ["updateTask", (tasks) => tasks.updateTask("task-a", { name: "Renamed" })],
    ["bulkUpdatePriority", (tasks) => tasks.bulkUpdatePriority(["task-a"], "High")],
  ])("useArchivedTasks %s toasts a rejection", async (_name, act) => {
    usePaginatedQueryMock.mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() });
    useMutationMock.mockImplementation(() => {
      const mutation = createMutationMock();
      mutation.mockRejectedValue(denial);
      return mutation;
    });
    const { result } = renderHook(() => useArchivedTasks("project-1" as Id<"projects">));

    act(result.current);

    await vi.waitFor(() => expect(toastMutationRejectionMock).toHaveBeenCalledWith(denial));
  });
});
