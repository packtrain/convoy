import { describe, expect, test } from "vitest";
import { getHiddenTaskTableColumns } from "./task-table-columns";

describe("getHiddenTaskTableColumns", () => {
  test.each([undefined, null])("hides Tags by default when the project has no saved setting (%s)", (saved) => {
    expect(getHiddenTaskTableColumns(saved)).toEqual(["tags"]);
  });

  test("keeps an explicitly saved setting, including one that shows every column", () => {
    expect(getHiddenTaskTableColumns([])).toEqual([]);
    expect(getHiddenTaskTableColumns(["priority"])).toEqual(["priority"]);
    expect(getHiddenTaskTableColumns(["tags", "priority"])).toEqual(["priority", "tags"]);
  });
});
