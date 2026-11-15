import { describe, expect, test } from "vitest";
import { getArchiveUndoToastMessage } from "./archive-undo";

describe("getArchiveUndoToastMessage", () => {
  test("returns single-task message with task title", () => {
    expect(getArchiveUndoToastMessage(1, "Write docs")).toBe(
      'Task "Write docs" archived.'
    );
  });

  test("returns fallback single-task message when title is missing", () => {
    expect(getArchiveUndoToastMessage(1)).toBe("Task archived.");
  });

  test("trims long task titles", () => {
    expect(
      getArchiveUndoToastMessage(
        1,
        "This title is intentionally long to trigger trimming in the toast"
      )
    ).toBe('Task "This title is int..." archived.');
  });

  test("returns multi-task message", () => {
    expect(getArchiveUndoToastMessage(3)).toBe("3 tasks archived.");
  });
});
