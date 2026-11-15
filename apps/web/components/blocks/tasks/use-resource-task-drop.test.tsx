/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  setResourceDragPayload,
  type ResourceDragPayload,
} from "@/lib/tasks/resource-drag";
import { useResourceTaskDrop } from "./use-resource-task-drop";

const { moveMock, toastErrorMock, optimisticUpdates } = vi.hoisted(() => ({
  moveMock: vi.fn(),
  toastErrorMock: vi.fn(),
  // Captured per mutation so tests can run the update against a fake store.
  optimisticUpdates: new Map<string, (localStore: never, args: never) => void>(),
}));

// Keyed by function name: the `api` proxy hands out a fresh object per property
// access, so identity comparison never matches.
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference);
      const mutate = (args: unknown) => moveMock(name, args);
      mutate.withOptimisticUpdate = (update: (localStore: never, args: never) => void) => {
        optimisticUpdates.set(name, update);
        return mutate;
      };
      return mutate;
    },
  };
});

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? "",
  } as unknown as DataTransfer;
}

function dragging(overrides: Partial<ResourceDragPayload> = {}): DataTransfer {
  const dataTransfer = createDataTransfer();
  setResourceDragPayload(dataTransfer, {
    kind: "artifact",
    projectId: "project_1",
    resourceId: "resource_1",
    taskId: "task_source",
    name: "Plan",
    ...overrides,
  });
  return dataTransfer;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  optimisticUpdates.clear();
});

/** Runs a mutation's registered optimistic update against a fake local store. */
function applyOptimisticUpdate(
  mutationName: string,
  args: Record<string, string>,
  cached: Array<{ args: Record<string, string>; value: Array<{ _id: string }> | undefined }>
) {
  const update = optimisticUpdates.get(mutationName);
  if (!update) {
    throw new Error(`No optimistic update registered for ${mutationName}`);
  }
  const setQuery = vi.fn();
  const localStore = { getAllQueries: () => cached, setQuery };
  update(localStore as never, args as never);
  return setQuery;
}

describe("useResourceTaskDrop", () => {
  test("accepts resource drags from the same project only", () => {
    const { result } = renderHook(() => useResourceTaskDrop("project_1"));

    expect(result.current.hasResourceDrag(dragging())).toBe(true);
    expect(
      result.current.hasResourceDrag(dragging({ projectId: "project_2" }))
    ).toBe(false);
    expect(result.current.hasResourceDrag(createDataTransfer())).toBe(false);
  });

  test("accepts nothing without a project", () => {
    const { result } = renderHook(() => useResourceTaskDrop(undefined));

    expect(result.current.hasResourceDrag(dragging())).toBe(false);
  });

  test("routes each kind to its own mutation", () => {
    moveMock.mockResolvedValue(null);
    const { result } = renderHook(() => useResourceTaskDrop("project_1"));

    result.current.dropResource(dragging(), "task_target");
    expect(moveMock).toHaveBeenCalledWith("tasks/artifacts:moveTaskArtifact", {
      artifactId: "resource_1",
      taskId: "task_target",
    });

    result.current.dropResource(
      dragging({ kind: "attachment", resourceId: "file_1" }),
      "task_target"
    );
    expect(moveMock).toHaveBeenCalledWith(
      "tasks/attachments:moveTaskAttachment",
      { attachmentId: "file_1", taskId: "task_target" }
    );
  });

  test("ignores a drop on the resource's own task and on foreign payloads", () => {
    const { result } = renderHook(() => useResourceTaskDrop("project_1"));

    result.current.dropResource(dragging({ taskId: "task_target" }), "task_target");
    result.current.dropResource(dragging({ projectId: "project_2" }), "task_target");
    result.current.dropResource(createDataTransfer(), "task_target");

    expect(moveMock).not.toHaveBeenCalled();
  });

  test("drops the resource from the source list before the server answers", () => {
    renderHook(() => useResourceTaskDrop("project_1"));

    const setQuery = applyOptimisticUpdate(
      "tasks/artifacts:moveTaskArtifact",
      { artifactId: "resource_1", taskId: "task_target" },
      [
        {
          args: { taskId: "task_source" },
          value: [{ _id: "resource_1" }, { _id: "resource_2" }],
        },
      ]
    );

    expect(setQuery).toHaveBeenCalledWith(
      expect.anything(),
      { taskId: "task_source" },
      [{ _id: "resource_2" }]
    );
  });

  test("attachment moves patch their own list the same way", () => {
    renderHook(() => useResourceTaskDrop("project_1"));

    const setQuery = applyOptimisticUpdate(
      "tasks/attachments:moveTaskAttachment",
      { attachmentId: "file_1", taskId: "task_target" },
      [{ args: { taskId: "task_source" }, value: [{ _id: "file_1" }] }]
    );

    expect(setQuery).toHaveBeenCalledWith(expect.anything(), { taskId: "task_source" }, []);
  });

  test("leaves lists that do not hold the resource untouched", () => {
    renderHook(() => useResourceTaskDrop("project_1"));

    const setQuery = applyOptimisticUpdate(
      "tasks/artifacts:moveTaskArtifact",
      { artifactId: "resource_1", taskId: "task_target" },
      [
        { args: { taskId: "task_other" }, value: [{ _id: "resource_9" }] },
        { args: { taskId: "task_loading" }, value: undefined },
      ]
    );

    expect(setQuery).not.toHaveBeenCalled();
  });

  test("surfaces a failed move as a toast", async () => {
    moveMock.mockRejectedValue(new Error("Tasks must be in the same project"));
    const { result } = renderHook(() => useResourceTaskDrop("project_1"));

    result.current.dropResource(dragging(), "task_target");
    await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());

    expect(toastErrorMock.mock.calls[0][0]).toContain("same project");
  });
});
