import { describe, expect, test } from "vitest";
import { LIST_DEFAULT_VIEW_GROUPS, defaultViewTriggerLabel } from "./default-view-options";

describe("List default view options", () => {
  test("List and Board are group headers, not selectable options", () => {
    expect(LIST_DEFAULT_VIEW_GROUPS.map((group) => group.label)).toEqual(["List", "Board"]);
    const optionLabels = LIST_DEFAULT_VIEW_GROUPS.flatMap((group) => group.options.map((option) => option.label));
    expect(optionLabels).toContain("by Status");
    expect(optionLabels.filter((label) => /^(List|Board)/.test(label))).toEqual([]);
  });

  test("the trigger keeps the view name for context", () => {
    expect(defaultViewTriggerLabel("inherit")).toBe("Project default");
    expect(defaultViewTriggerLabel("list")).toBe("List");
    expect(defaultViewTriggerLabel("list:assignee")).toBe("List (by Assignee)");
    expect(defaultViewTriggerLabel("board:status")).toBe("Board (by Status)");
  });
});
