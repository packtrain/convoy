import { describe, expect, test } from "vitest";
import { Status } from "./status";
import type { Task } from "./types";
import { getActiveRootTaskIds } from "./active-tasks";

function task(partial: {
  _id: string;
  status?: Status;
  parentId?: string | null;
}): Task {
  return {
    status: Status.TODO,
    parentId: null,
    ...partial,
  } as unknown as Task;
}

describe("getActiveRootTaskIds", () => {
  test("keeps non-closed top-level tasks", () => {
    const tasks = [
      task({ _id: "a", status: Status.TODO }),
      task({ _id: "b", status: Status.IN_PROGRESS }),
      task({ _id: "c", status: Status.BLOCKED }),
    ];

    expect(getActiveRootTaskIds(tasks)).toEqual(["a", "b", "c"]);
  });

  test("drops Done and Canceled top-level tasks", () => {
    const tasks = [
      task({ _id: "a", status: Status.TODO }),
      task({ _id: "done", status: Status.DONE }),
      task({ _id: "canceled", status: Status.CANCELED }),
    ];

    expect(getActiveRootTaskIds(tasks)).toEqual(["a"]);
  });

  test("drops subtasks regardless of status", () => {
    const tasks = [
      task({ _id: "root", status: Status.TODO }),
      task({ _id: "child-active", parentId: "root", status: Status.IN_PROGRESS }),
      task({ _id: "child-done", parentId: "root", status: Status.DONE }),
    ];

    expect(getActiveRootTaskIds(tasks)).toEqual(["root"]);
  });

  test("returns empty for no active roots", () => {
    expect(getActiveRootTaskIds([])).toEqual([]);
    expect(
      getActiveRootTaskIds([task({ _id: "x", status: Status.DONE })])
    ).toEqual([]);
  });
});
