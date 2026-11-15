import { describe, test, expect } from "vitest";
import {
  buildTaskTree,
  flattenTree,
  getAncestorIds,
  getDescendantIds,
  findTaskInTree,
  getSiblings,
  getChildren,
} from "./tree";

import type { Task, TaskTreeNode } from "./types";
import { isAddTaskPlaceholder } from "./types";
import type { Id } from "@/convex/_generated/dataModel";
import { getDefaultTaskTypeSummary } from "./task-types";

// Helper to filter out add-task placeholders from flattened results for testing
function getTasks(result: ReturnType<typeof flattenTree>): TaskTreeNode[] {
  return result.filter((row): row is TaskTreeNode => !isAddTaskPlaceholder(row));
}

// Helper to create mock tasks
function createTask(overrides: Partial<Task> = {}): Task {
  const id = overrides._id ?? (crypto.randomUUID() as Id<"tasks">);
  const { createdAt, ...rest } = overrides;
  return {
    delegatedToAgent: null,
    _id: id,
    clientId: crypto.randomUUID(),
    refNumber: 1,
    refId: "TST-1",
    name: "Test Task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: "None",
    dueDate: null,
    status: "To Do",
    tags: [],
    rank: "0|aaaaaa:",
    parentId: null,
    createdAt: createdAt ?? Date.now(),
    isArchived: false,
    ...rest,
    assignee: rest.assignee ?? null,
  };
}

describe("buildTaskTree", () => {
  test("should return empty array for empty input", () => {
    const result = buildTaskTree([]);
    expect(result).toEqual([]);
  });

  test("should handle flat list (no parents)", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "A", rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "B", rank: "0|b:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result).toHaveLength(2);
    expect(result[0].depth).toBe(0);
    expect(result[1].depth).toBe(0);
    expect(result[0].hasChildren).toBe(false);
    expect(result[1].hasChildren).toBe(false);
  });

  test("should build parent-child relationships", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|b:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result).toHaveLength(1); // Only root
    expect(result[0].name).toBe("Parent");
    expect(result[0].hasChildren).toBe(true);
    expect(result[0].childCount).toBe(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].name).toBe("Child");
    expect(result[0].children![0].depth).toBe(1);
  });

  test("should handle deep nesting", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Level 0", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Level 1", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Level 2", parentId: "2", rank: "0|a:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Level 3", parentId: "3", rank: "0|a:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(0);
    expect(result[0].children![0].depth).toBe(1);
    expect(result[0].children![0].children![0].depth).toBe(2);
    expect(result[0].children![0].children![0].children![0].depth).toBe(3);
  });

  test("should handle multiple children per parent", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child A", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child B", parentId: "1", rank: "0|b:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Child C", parentId: "1", rank: "0|c:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].childCount).toBe(3);
    expect(result[0].children).toHaveLength(3);
  });

  test("should handle orphaned children (parent not in list)", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Orphan", parentId: "nonexistent", rank: "0|a:" }),
    ];
    const result = buildTaskTree(tasks);

    // Orphan should be treated as root
    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(0);
  });

  test("should sort children by rank", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child C", parentId: "1", rank: "0|c:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child A", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Child B", parentId: "1", rank: "0|b:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].children![0].name).toBe("Child A");
    expect(result[0].children![1].name).toBe("Child B");
    expect(result[0].children![2].name).toBe("Child C");
  });

  test("should sort roots by rank", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "C", parentId: null, rank: "0|c:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "A", parentId: null, rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "B", parentId: null, rank: "0|b:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].name).toBe("A");
    expect(result[1].name).toBe("B");
    expect(result[2].name).toBe("C");
  });

  test("should count completedChildCount for Done children", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child Done", parentId: "1", rank: "0|a:", status: "Done" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child To Do", parentId: "1", rank: "0|b:", status: "To Do" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].childCount).toBe(2);
    expect(result[0].completedChildCount).toBe(1);
  });

  test("should count Canceled children as completed for progress", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child Canceled", parentId: "1", rank: "0|a:", status: "Canceled" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child Done", parentId: "1", rank: "0|b:", status: "Done" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].childCount).toBe(2);
    expect(result[0].completedChildCount).toBe(2);
  });

  test("should handle mixed statuses in children", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Done 1", parentId: "1", rank: "0|a:", status: "Done" }),
      createTask({ _id: "3" as Id<"tasks">, name: "In Progress", parentId: "1", rank: "0|b:", status: "In Progress" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Done 2", parentId: "1", rank: "0|c:", status: "Done" }),
      createTask({ _id: "5" as Id<"tasks">, name: "To Do", parentId: "1", rank: "0|d:", status: "To Do" }),
      createTask({ _id: "6" as Id<"tasks">, name: "Done 3", parentId: "1", rank: "0|e:", status: "Done" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].childCount).toBe(5);
    expect(result[0].completedChildCount).toBe(3);
  });

  test("should initialize completedChildCount to 0 for tasks without children", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Leaf", parentId: null, rank: "0|a:" }),
    ];
    const result = buildTaskTree(tasks);

    expect(result[0].childCount).toBe(0);
    expect(result[0].completedChildCount).toBe(0);
  });
});

describe("flattenTree", () => {
  test("should return empty array for empty input", () => {
    const result = flattenTree([], new Set());
    expect(result).toEqual([]);
  });

  test("should flatten all nodes when all expanded", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    // 2 tasks + 1 add-task placeholder (after Child)
    expect(result).toHaveLength(3);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].name).toBe("Parent");
    expect(tasks[1].name).toBe("Child");
  });

  test("should hide children when parent collapsed", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set<string>(); // Nothing expanded
    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("Parent");
  });

  test("should handle partial expansion", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "A", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "A-1", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "A-1-1", parentId: "2", rank: "0|a:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "B", parentId: null, rank: "0|b:" }),
      createTask({ _id: "5" as Id<"tasks">, name: "B-1", parentId: "4", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]); // Only A expanded, not A-1 or B

    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    expect(tasks).toHaveLength(3); // A, A-1, B
    expect(tasks.map((n) => n.name)).toEqual(["A", "A-1", "B"]);
  });

  test("should preserve order within siblings", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child 1", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child 2", parentId: "1", rank: "0|b:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Child 3", parentId: "1", rank: "0|c:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    expect(tasks.map((n) => n.name)).toEqual(["Parent", "Child 1", "Child 2", "Child 3"]);
  });

  test("should create new objects with isExpanded set for memoization", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    // flattenTree creates new objects with isExpanded set so memo comparison detects changes
    // New object references (not toBe)
    expect(tasks[0]).not.toBe(tree[0]);
    expect(tasks[1]).not.toBe(tree[0].children![0]);
    // isExpanded is set based on expandedIds
    expect(tasks[0].isExpanded).toBe(true); // expanded because "1" is in expandedIds
    expect(tasks[1].isExpanded).toBe(false); // child "2" is not in expandedIds
  });

  test("should handle deeply nested expanded nodes", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "L0", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "L1", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "L2", parentId: "2", rank: "0|a:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "L3", parentId: "3", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1", "2", "3"]); // All expanded
    const result = flattenTree(tree, expandedIds);
    const tasks = getTasks(result);

    expect(tasks).toHaveLength(4);
    expect(tasks.map((n) => n.name)).toEqual(["L0", "L1", "L2", "L3"]);
    expect(tasks.map((n) => n.depth)).toEqual([0, 1, 2, 3]);
  });

  test("should insert add-task placeholders after last child of expanded parents", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds);

    // Should have: Parent, Child, add-task placeholder
    expect(result).toHaveLength(3);
    expect(isAddTaskPlaceholder(result[2])).toBe(true);
    if (isAddTaskPlaceholder(result[2])) {
      expect(result[2].parentId).toBe("1");
      expect(result[2].depth).toBe(1);
      expect(result[2].clientId).toBe("add-1");
    }
  });

  test("should not insert add-task placeholders for expanded childless parents", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds);

    expect(result).toHaveLength(1);
    expect(result.every((row) => !isAddTaskPlaceholder(row))).toBe(true);
  });

  test("should not insert add-task placeholders when allowAddTask is false", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds, false);

    // Should have: Parent, Child (no add-task placeholder)
    expect(result).toHaveLength(2);
    expect(result.every((row) => !isAddTaskPlaceholder(row))).toBe(true);
  });

  test("should insert add-task placeholders when allowAddTask is true (explicit)", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1", rank: "0|a:" }),
    ]);
    const expandedIds = new Set(["1"]);
    const result = flattenTree(tree, expandedIds, true);

    // Should have: Parent, Child, add-task placeholder
    expect(result).toHaveLength(3);
    expect(isAddTaskPlaceholder(result[2])).toBe(true);
  });
});

describe("getDescendantIds", () => {
  test("should return empty array for task with no children", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Leaf", parentId: null }),
    ]);
    const result = getDescendantIds("1", tree);
    expect(result).toEqual([]);
  });

  test("should return direct children", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1" }),
    ]);
    const result = getDescendantIds("1", tree);
    expect(result).toEqual(["2"]);
  });

  test("should return all nested descendants", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Grandchild", parentId: "2" }),
    ]);
    const result = getDescendantIds("1", tree);
    expect(result).toContain("2");
    expect(result).toContain("3");
    expect(result).toHaveLength(2);
  });

  test("should return empty array for non-existent task", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
    ]);
    const result = getDescendantIds("nonexistent", tree);
    expect(result).toEqual([]);
  });
});

describe("getAncestorIds", () => {
  test("should return empty array for a root task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
    ];

    expect(getAncestorIds("1", tasks)).toEqual([]);
  });

  test("should return the direct parent for a child task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1" }),
    ];

    expect(getAncestorIds("2", tasks)).toEqual(["1"]);
  });

  test("should return the full visible ancestor chain from root to parent", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Parent", parentId: "1" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child", parentId: "2" }),
    ];

    expect(getAncestorIds("3", tasks)).toEqual(["1", "2"]);
  });

  test("should stop the chain when an intermediate parent is filtered out", () => {
    const tasks = [
      createTask({ _id: "2" as Id<"tasks">, name: "Visible parent", parentId: null }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child", parentId: "missing-parent" }),
    ];

    expect(getAncestorIds("3", tasks)).toEqual([]);
  });

  test("should return empty array when the task is not in the list", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1" }),
    ];

    expect(getAncestorIds("nonexistent", tasks)).toEqual([]);
  });
});

describe("findTaskInTree", () => {
  test("should find root-level task", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
    ]);
    const result = findTaskInTree("1", tree);
    expect(result).toBeDefined();
    expect(result?.name).toBe("Root");
  });

  test("should find nested task", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child", parentId: "1" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Grandchild", parentId: "2" }),
    ]);
    const result = findTaskInTree("3", tree);
    expect(result).toBeDefined();
    expect(result?.name).toBe("Grandchild");
  });

  test("should return undefined for non-existent task", () => {
    const tree = buildTaskTree([
      createTask({ _id: "1" as Id<"tasks">, name: "Root", parentId: null }),
    ]);
    const result = findTaskInTree("nonexistent", tree);
    expect(result).toBeUndefined();
  });
});

describe("getSiblings", () => {
  test("should return siblings of a root task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "A", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "B", parentId: null, rank: "0|b:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "C", parentId: null, rank: "0|c:" }),
    ];
    const result = getSiblings("1", tasks);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["B", "C"]);
  });

  test("should return siblings of a child task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child A", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child B", parentId: "1", rank: "0|b:" }),
    ];
    const result = getSiblings("2", tasks);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Child B");
  });

  test("should return empty array for non-existent task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "A", parentId: null }),
    ];
    const result = getSiblings("nonexistent", tasks);
    expect(result).toEqual([]);
  });

  test("should sort siblings by rank", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "A", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "C", parentId: null, rank: "0|c:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "B", parentId: null, rank: "0|b:" }),
    ];
    const result = getSiblings("1", tasks);

    expect(result.map((t) => t.name)).toEqual(["B", "C"]);
  });
});

describe("getChildren", () => {
  test("should return children of a task", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child A", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child B", parentId: "1", rank: "0|b:" }),
    ];
    const result = getChildren("1", tasks);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["Child A", "Child B"]);
  });

  test("should return root tasks when parentId is null", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Root A", parentId: null, rank: "0|a:" }),
      createTask({ _id: "2" as Id<"tasks">, name: "Root B", parentId: null, rank: "0|b:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child", parentId: "1" }),
    ];
    const result = getChildren(null, tasks);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["Root A", "Root B"]);
  });

  test("should return empty array for task with no children", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Leaf", parentId: null }),
    ];
    const result = getChildren("1", tasks);
    expect(result).toEqual([]);
  });

  test("should sort children by rank", () => {
    const tasks = [
      createTask({ _id: "1" as Id<"tasks">, name: "Parent", parentId: null }),
      createTask({ _id: "2" as Id<"tasks">, name: "Child C", parentId: "1", rank: "0|c:" }),
      createTask({ _id: "3" as Id<"tasks">, name: "Child A", parentId: "1", rank: "0|a:" }),
      createTask({ _id: "4" as Id<"tasks">, name: "Child B", parentId: "1", rank: "0|b:" }),
    ];
    const result = getChildren("1", tasks);

    expect(result.map((t) => t.name)).toEqual(["Child A", "Child B", "Child C"]);
  });
});
