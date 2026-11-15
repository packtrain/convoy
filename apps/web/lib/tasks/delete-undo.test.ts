import { describe, expect, test, vi } from "vitest";
import { getDeleteUndoToastMessage, restoreDeletedTasks } from "./delete-undo";

describe("getDeleteUndoToastMessage", () => {
  test("returns single-task message with task title", () => {
    expect(getDeleteUndoToastMessage(1, "Write docs")).toBe(
      'Task "Write docs" deleted.'
    );
  });

  test("returns fallback single-task message when title is missing", () => {
    expect(getDeleteUndoToastMessage(1)).toBe("Task deleted.");
  });

  test("trims long task titles", () => {
    expect(
      getDeleteUndoToastMessage(
        1,
        "This title is intentionally long to trigger trimming in the toast"
      )
    ).toBe('Task "This title is int..." deleted.');
  });

  test("returns multi-task message", () => {
    expect(getDeleteUndoToastMessage(3)).toBe("3 tasks deleted.");
  });
});

describe("restoreDeletedTasks", () => {
  test("restores all deleted tasks", async () => {
    const restoreTask = vi
      .fn<((id: string) => Promise<void>)>()
      .mockResolvedValue(undefined);

    const result = await restoreDeletedTasks(["a", "b"], restoreTask);

    expect(restoreTask).toHaveBeenCalledTimes(2);
    expect(restoreTask).toHaveBeenNthCalledWith(1, "a");
    expect(restoreTask).toHaveBeenNthCalledWith(2, "b");
    expect(result).toEqual({ succeeded: 2, failed: 0 });
  });

  test("reports failed restores", async () => {
    const restoreTask = vi
      .fn<((id: string) => Promise<void>)>()
      .mockImplementation(async (id: string) => {
        if (id === "b") {
          throw new Error("boom");
        }
      });

    const result = await restoreDeletedTasks(["a", "b", "c"], restoreTask);

    expect(result).toEqual({ succeeded: 2, failed: 1 });
  });
});
