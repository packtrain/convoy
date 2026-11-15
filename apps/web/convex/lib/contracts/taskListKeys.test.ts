import { describe, expect, test } from "vitest";
import type { Id } from "../../_generated/dataModel";
import { createPersistedTaskListKey, parsePersistedTaskListKey } from "./taskListKeys";

describe("task List keys", () => {
  test("round-trips persisted List keys", () => {
    const listId = "nx7b79ahee74yeq64gtx2wxbr1879rnv" as Id<"taskLists">;

    expect(parsePersistedTaskListKey(createPersistedTaskListKey(listId))).toBe(listId);
  });

  test("returns null for malformed persisted List keys", () => {
    expect(parsePersistedTaskListKey(undefined)).toBeNull();
    expect(parsePersistedTaskListKey("task:nx7b79ahee74yeq64gtx2wxbr1879rnv")).toBeNull();
    expect(parsePersistedTaskListKey("list:")).toBeNull();
    expect(parsePersistedTaskListKey("list:x")).toBeNull();
    expect(parsePersistedTaskListKey("list:not/a/convex/id")).toBeNull();
  });
});
