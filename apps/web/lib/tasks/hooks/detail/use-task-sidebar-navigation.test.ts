/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { useTaskSidebarNavigation } from "./use-task-sidebar-navigation";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => undefined),
}));

function buildTask(overrides: Partial<Task>): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "client_1",
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

describe("useTaskSidebarNavigation", () => {
  test("opens sidebar by clientId when task has refId", () => {
    const setTaskRefId = vi.fn();
    const task = buildTask({});
    const { result } = renderHook(() =>
      useTaskSidebarNavigation({
        taskList: [task],
        taskRefId: null,
        setTaskRefId,
      })
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });

    expect(setTaskRefId).toHaveBeenCalledWith(task.refId);
    expect(result.current.detailsTask?._id).toBe(task._id);
    expect(result.current.isSidebarOpen).toBe(true);
  });

  test("does nothing when selected clientId has no task refId", () => {
    const setTaskRefId = vi.fn();
    const task = buildTask({ refId: undefined, clientId: "client_without_ref" });
    const { result } = renderHook(() =>
      useTaskSidebarNavigation({
        taskList: [task],
        taskRefId: null,
        setTaskRefId,
      })
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });

    expect(setTaskRefId).not.toHaveBeenCalled();
    expect(result.current.detailsTask).toBeUndefined();
    expect(result.current.isSidebarOpen).toBe(false);
  });

  test("does nothing when selected clientId only has an optimistic placeholder refId", () => {
    const setTaskRefId = vi.fn();
    const task = buildTask({ refId: "...", clientId: "client_with_placeholder_ref" });
    const { result } = renderHook(() =>
      useTaskSidebarNavigation({
        taskList: [task],
        taskRefId: null,
        setTaskRefId,
      })
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });

    expect(setTaskRefId).not.toHaveBeenCalled();
    expect(result.current.detailsTask).toBeUndefined();
    expect(result.current.isSidebarOpen).toBe(false);
  });

  test("previously rendered openTaskSidebar uses the latest client id to task ref lookup", () => {
    const setTaskRefId = vi.fn();
    const pendingTask = buildTask({
      refId: undefined,
      clientId: "client_pending_ref",
    });
    const readyTask = buildTask({
      refId: "WEB-42",
      refNumber: 42,
      clientId: "client_pending_ref",
    });
    const { result, rerender } = renderHook(
      ({ taskList }: { taskList: Task[] }) =>
        useTaskSidebarNavigation({
          taskList,
          taskRefId: null,
          setTaskRefId,
        }),
      { initialProps: { taskList: [pendingTask] } }
    );
    const previouslyRenderedOpenTaskSidebar = result.current.openTaskSidebar;

    rerender({ taskList: [readyTask] });

    act(() => {
      previouslyRenderedOpenTaskSidebar(readyTask.clientId);
    });

    expect(setTaskRefId).toHaveBeenCalledWith("WEB-42");
    expect(result.current.detailsTask?._id).toBe(readyTask._id);
    expect(result.current.isSidebarOpen).toBe(true);
  });

  test("closeTaskSidebar clears optimistic state and URL task ref", () => {
    const setTaskRefId = vi.fn();
    const task = buildTask({});
    const { result, rerender } = renderHook(
      ({ taskRefId }: { taskRefId: string | null }) =>
        useTaskSidebarNavigation({
          taskList: [task],
          taskRefId,
          setTaskRefId,
        }),
      { initialProps: { taskRefId: null as string | null } }
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });
    expect(result.current.isSidebarOpen).toBe(true);

    rerender({ taskRefId: task.refId ?? null });

    act(() => {
      result.current.closeTaskSidebar();
    });

    expect(setTaskRefId).toHaveBeenLastCalledWith(null);
    rerender({ taskRefId: null });
    expect(result.current.detailsTask).toBeUndefined();
    expect(result.current.isSidebarOpen).toBe(false);
  });

  test("clears optimistic state once URL catches up", async () => {
    vi.useFakeTimers();
    const setTaskRefId = vi.fn();
    const task = buildTask({});
    const { result, rerender } = renderHook(
      ({ taskRefId }: { taskRefId: string | null }) =>
        useTaskSidebarNavigation({
          taskList: [task],
          taskRefId,
          setTaskRefId,
        }),
      { initialProps: { taskRefId: null as string | null } }
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });
    expect(result.current.detailsTask?._id).toBe(task._id);

    rerender({ taskRefId: task.refId ?? null });
    expect(result.current.detailsTask?._id).toBe(task._id);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ taskRefId: null });
    expect(result.current.detailsTask).toBeUndefined();
    expect(result.current.isSidebarOpen).toBe(false);
    vi.useRealTimers();
  });

  test("keeps optimistic state while URL sync is delayed", async () => {
    vi.useFakeTimers();
    const setTaskRefId = vi.fn();
    const task = buildTask({});
    const { result } = renderHook(() =>
      useTaskSidebarNavigation({
        taskList: [task],
        taskRefId: null,
        setTaskRefId,
      })
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });
    expect(result.current.detailsTask?._id).toBe(task._id);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.detailsTask?._id).toBe(task._id);
    expect(result.current.isSidebarOpen).toBe(true);
    vi.useRealTimers();
  });

  test("clears optimistic state when the URL resolves to a different task", () => {
    const setTaskRefId = vi.fn();
    const task = buildTask({});
    const otherTask = buildTask({
      _id: "task_2" as Task["_id"],
      clientId: "client_2",
      refId: "WEB-2",
      refNumber: 2,
    });
    const { result, rerender } = renderHook(
      ({ taskRefId }: { taskRefId: string | null }) =>
        useTaskSidebarNavigation({
          taskList: [task, otherTask],
          taskRefId,
          setTaskRefId,
        }),
      { initialProps: { taskRefId: null as string | null } }
    );

    act(() => {
      result.current.openTaskSidebar(task.clientId);
    });

    rerender({ taskRefId: otherTask.refId ?? null });

    expect(result.current.detailsTask?._id).toBe(otherTask._id);
    expect(result.current.isSidebarOpen).toBe(true);
  });
});
