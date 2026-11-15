import { describe, expect, test } from "vitest";
import { Priority, Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import {
  TASK_DRAG_MIME,
  dragHasTasksForProject,
  getRootDragTasks,
  readTaskDragPayload,
  setTaskDragPayload,
} from "./task-drag";

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

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "client-1",
    refNumber: 1,
    refId: "OS-1",
    name: "Test task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: Priority.NONE,
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|a",
    parentId: null,
    createdAt: 1,
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

describe("task drag payload", () => {
  test("round-trips the payload and gates by project", () => {
    const dataTransfer = createDataTransfer();
    setTaskDragPayload(dataTransfer, {
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
    });

    expect(dragHasTasksForProject(dataTransfer, "project_1")).toBe(true);
    expect(dragHasTasksForProject(dataTransfer, "project_2")).toBe(false);
    expect(readTaskDragPayload(dataTransfer)).toEqual({
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
    });
  });

  test("rejects missing, malformed, and empty payloads", () => {
    expect(readTaskDragPayload(createDataTransfer())).toBeNull();

    const malformed = createDataTransfer();
    malformed.setData(TASK_DRAG_MIME, "{not json");
    expect(readTaskDragPayload(malformed)).toBeNull();

    const wrongShape = createDataTransfer();
    wrongShape.setData(TASK_DRAG_MIME, JSON.stringify({ projectId: 1 }));
    expect(readTaskDragPayload(wrongShape)).toBeNull();

    const emptyIds = createDataTransfer();
    emptyIds.setData(
      TASK_DRAG_MIME,
      JSON.stringify({ projectId: "project_1", taskIds: [] })
    );
    expect(readTaskDragPayload(emptyIds)).toBeNull();

    const nonStringIds = createDataTransfer();
    nonStringIds.setData(
      TASK_DRAG_MIME,
      JSON.stringify({ projectId: "project_1", taskIds: ["a", 2] })
    );
    expect(readTaskDragPayload(nonStringIds)).toBeNull();
  });

  test("round-trips taskRefIds", () => {
    const dataTransfer = createDataTransfer();
    setTaskDragPayload(dataTransfer, {
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
      taskRefIds: ["OS-1", "OS-2"],
    });

    expect(readTaskDragPayload(dataTransfer)).toEqual({
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
      taskRefIds: ["OS-1", "OS-2"],
    });
  });

  test("drops invalid taskRefIds but keeps the payload", () => {
    const mismatchedLength = createDataTransfer();
    mismatchedLength.setData(
      TASK_DRAG_MIME,
      JSON.stringify({
        projectId: "project_1",
        taskIds: ["task_1", "task_2"],
        taskRefIds: ["OS-1"],
      })
    );
    expect(readTaskDragPayload(mismatchedLength)).toEqual({
      projectId: "project_1",
      taskIds: ["task_1", "task_2"],
    });

    const nonStringRefs = createDataTransfer();
    nonStringRefs.setData(
      TASK_DRAG_MIME,
      JSON.stringify({
        projectId: "project_1",
        taskIds: ["task_1"],
        taskRefIds: [1],
      })
    );
    expect(readTaskDragPayload(nonStringRefs)).toEqual({
      projectId: "project_1",
      taskIds: ["task_1"],
    });
  });
});

describe("getRootDragTasks", () => {
  test("keeps only tasks whose parent is not also dragged", () => {
    const parent = createTask();
    const child = createTask({
      _id: "task_2" as Task["_id"],
      clientId: "client-2",
      parentId: "task_1",
    });
    const other = createTask({
      _id: "task_3" as Task["_id"],
      clientId: "client-3",
    });
    const tasks = [parent, child, other];

    expect(
      getRootDragTasks(
        tasks,
        new Set(["client-1", "client-2", "client-3"])
      ).map((task) => task._id)
    ).toEqual(["task_1", "task_3"]);

    // A dragged child whose parent is NOT dragged is itself a root.
    expect(
      getRootDragTasks(tasks, new Set(["client-2"])).map((task) => task._id)
    ).toEqual(["task_2"]);
  });
});
