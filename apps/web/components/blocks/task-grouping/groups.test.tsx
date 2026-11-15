// @vitest-environment jsdom
import { Status } from "@/lib/tasks/status";
import {
  BUILT_IN_TASK_TYPES,
  resolveTaskTypeSummary,
} from "@/lib/tasks/task-types";
import { describe, expect, test } from "vitest";
import {
  buildBoardCells,
  buildBoardTaskColumns,
  NO_LABEL_COLUMN_ID,
  buildAssigneeBoardColumns,
  buildLabelBoardColumns,
  buildPriorityBoardColumns,
  buildStatusBoardColumns,
  buildStatusTaskColumns,
  buildTaskTypeBoardColumns,
  getVisibleBoardColumns,
  resolveStatusGroupTarget,
  type BoardAssignableUser,
  type BoardLabel,
} from "./groups";
import { groupRows } from "./rows";
import { createDefaultTask } from "@/lib/tasks/defaults";
import type { Id } from "@/convex/_generated/dataModel";
import type { Task, TaskTreeNode } from "@/lib/tasks/types";

function node(id: string, overrides: Partial<TaskTreeNode> = {}): TaskTreeNode {
  return {
    ...createDefaultTask(),
    _id: id as Id<"tasks">,
    clientId: id,
    depth: 0,
    children: [],
    hasChildren: false,
    isExpanded: false,
    childCount: 0,
    completedChildCount: 0,
    ...overrides,
  };
}
const alice = { _id: "alice" as Id<"users">, name: "Alice" };
const owner = {
  type: "user" as const,
  userId: alice._id,
  name: "Alice",
  avatarUrl: null,
};

describe("board cells", () => {
  const agent = {
    type: "projectAgent" as const,
    projectAgentId: "agent" as Id<"projectAgents">,
    name: "Agent",
    isDeleted: false,
    appearance: { color: "blue" },
  };
  const projectAgents = [
    {
      type: "projectAgent" as const,
      value: { type: "projectAgent" as const, projectAgentId: agent.projectAgentId },
      label: "Agent",
      details: agent,
    },
  ] as never;
  const bob = { _id: "bob" as Id<"users">, name: "Bob" };
  const sections = [
    { _id: "s1", name: "Backend", rank: "a" },
  ] as never;

  test("cells hold the intersection and keep status presentation from either axis", () => {
    const review = node("review", { status: Status.PLAN_REVIEW, sectionId: "s1" as never });
    const todo = node("todo", { status: Status.TODO });
    for (const [boardGroupBy, boardRowGroupBy] of [["status", "section"], ["section", "status"]] as const) {
      const { cells } = buildBoardCells({ boardGroupBy, boardRowGroupBy, sections, tasks: [review, todo] });
      const cell = (statusId: string, sectionId: string) => cells.find((candidate) =>
        [candidate.rowId, candidate.columnId].sort().join() === [statusId, sectionId].sort().join());
      expect(cell("planning", "section:s1")?.cards.map((card) => card.task.clientId)).toEqual(["review"]);
      expect(cell("planning", "section:s1")?.cards[0].presentation).toEqual({ emphasizeStatus: true });
      expect(cell("todo", "section:none")?.cards.map((card) => card.task.clientId)).toEqual(["todo"]);
      expect(cell("todo", "section:s1")?.cards).toEqual([]);
      expect(cell("planning", "section:s1")?.createDefaults).toEqual({ status: Status.PLANNING, sectionId: "s1" });
    }
  });

  test("Owner × Assignee cells allow only consistent owners, in both orientations", () => {
    for (const [boardGroupBy, boardRowGroupBy] of [["owner", "assignee"], ["assignee", "owner"]] as const) {
      const { cells } = buildBoardCells({
        boardGroupBy, boardRowGroupBy, assignableUsers: [alice, bob], projectAgents, tasks: [],
      });
      const cell = (ownerId: string, assigneeId: string) => cells.find((candidate) =>
        [candidate.rowId, candidate.columnId].sort().join() === [`owner:${ownerId}`, `assignee:${assigneeId}`].sort().join())!;

      for (const [ownerId, assigneeId, reason] of [
        ["alice", "bob", "Assigning Bob makes them the owner"],
        ["unassigned", "alice", "Assigning Alice makes them the owner"],
        ["alice", "unassigned", "No assignee means no owner"],
      ]) {
        const impossible = cell(ownerId, assigneeId);
        expect(impossible.dropTarget).toBeUndefined();
        expect(impossible.createDefaults).toBeUndefined();
        expect(impossible.createDisabledReason).toBe(reason);
        expect(impossible.axes.map((axis) => axis.dropTarget)).toEqual([undefined, undefined]);
      }

      const ownerless = cell("unassigned", "projectAgent:agent");
      expect(ownerless.dropTarget).toMatchObject({ assigneeId: null, delegatedToAgentId: "agent" });
      // Both axes write the joint value, so a column-only move can't trigger auto-owner.
      expect(ownerless.axes.map((axis) => axis.dropTarget)).toEqual([ownerless.dropTarget, ownerless.dropTarget]);
      expect(ownerless.createOptions).toEqual({ assigneeId: null });
      expect(ownerless.createDefaults).toMatchObject({ assignee: null, delegatedToAgent: agent });

      expect(cell("alice", "alice").dropTarget).toMatchObject({ assigneeId: "alice", delegatedToAgentId: null });
      expect(cell("alice", "projectAgent:agent").createOptions).toEqual({ assigneeId: "alice" });
    }
  });

  test("independent axes keep their own payloads", () => {
    const { cells } = buildBoardCells({ boardGroupBy: "priority", boardRowGroupBy: "label", tasks: [] });
    const cell = cells.find((candidate) => candidate.id === "label:none|priority:high")!;
    expect(cell.axes).toEqual([
      { groupId: "label:none", dropTarget: { labelId: null } },
      { groupId: "priority:high", dropTarget: { priority: "High" } },
    ]);
  });
});

describe("shared task grouping", () => {
  test("Owner preserves delegation while Assignee uses the agent", () => {
    const task = node("task", {
      assignee: owner,
      delegatedToAgent: {
        type: "projectAgent",
        projectAgentId: "agent" as Id<"projectAgents">,
        name: "Agent",
        isDeleted: false,
        appearance: { color: "blue" },
      },
    });
    const owners = buildBoardTaskColumns({
      boardGroupBy: "owner",
      tasks: [task],
      assignableUsers: [alice],
    });
    expect(owners.find((group) => group.title === "Alice")?.cards[0].task).toBe(
      task,
    );
    expect(owners.find((group) => group.title === "Alice")?.dropTarget).toEqual(
      { assigneeId: "alice", assigneeDetails: owner },
    );
    expect(
      owners.find((group) => group.title === "No owner")?.dropTarget,
    ).toEqual({ assigneeId: null, assigneeDetails: null });
    const assignees = buildBoardTaskColumns({
      boardGroupBy: "assignee",
      tasks: [task],
      assignableUsers: [alice],
    });
    expect(
      assignees.find((group) => group.title === "Alice")?.cards,
    ).toHaveLength(0);
    expect(
      assignees.find((group) => group.title === "Agent")?.cards[0].task,
    ).toBe(task);
  });
  test("groups root trees without changing depth, and collapse removes descendants", () => {
    const parent = node("parent", { assignee: owner });
    const child = node("child", { parentId: parent._id, depth: 1 });
    const other = node("other");
    const tasks = [parent, child, other];
    const groups = buildBoardTaskColumns({
      boardGroupBy: "owner",
      tasks,
      assignableUsers: [alice],
    });
    const open = groupRows(tasks, groups, tasks, new Set());
    expect(open.visible.map((row) => row.clientId)).toEqual([
      "other",
      "parent",
      "child",
    ]);
    expect(open.visible[2]).toBe(child);
    const closed = groupRows(tasks, groups, tasks, new Set(["owner:alice"]));
    expect(closed.visible.map((row) => row.clientId)).toEqual(["other"]);
    expect(closed.presented.filter((row) => "rowType" in row)).toHaveLength(2);
  });
});

test("Assignee user and Unassigned create defaults clear a delegated filter default", () => {
  const groups = buildBoardTaskColumns({
    boardGroupBy: "assignee",
    tasks: [],
    assignableUsers: [alice],
  });
  expect(groups[0].createDefaults).toMatchObject({
    assignee: null,
    delegatedToAgent: null,
  });
  expect(
    groups.find((group) => group.title === "Alice")?.createDefaults,
  ).toMatchObject({ assignee: owner, delegatedToAgent: null });
});

test("Assignee create defaults override the draft input inherited from an agent filter", () => {
  const groups = buildBoardTaskColumns({
    boardGroupBy: "assignee",
    tasks: [],
    assignableUsers: [alice],
  });
  const merged = {
    assigneeInput: { type: "projectAgent", projectAgentId: "agent" },
    ...groups.find((group) => group.title === "Alice")?.createDefaults,
  };
  expect(merged.assigneeInput).toBeUndefined();
});

test("priority groups run from Critical to None", () => {
  expect(
    buildBoardTaskColumns({ boardGroupBy: "priority", tasks: [] }).map(
      (g) => g.title,
    ),
  ).toEqual(["Critical", "High", "Medium", "Low", "None"]);
});
test("group headers use standard row height", () => {
  const groups = buildBoardTaskColumns({ boardGroupBy: "priority", tasks: [] });
  expect(groupRows([], groups, [], new Set()).presented[0]).toMatchObject({
    height: 44,
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  const id =
    overrides._id ?? (`task-${overrides.refNumber ?? 1}` as Id<"tasks">);

  return {
    _id: id,
    clientId: String(overrides.clientId ?? id),
    ...createDefaultTask({
      refNumber: overrides.refNumber ?? 1,
      refId: overrides.refId ?? "OS-1",
      name: overrides.name ?? "Task",
      description: overrides.description ?? null,
      status: overrides.status ?? Status.TODO,
      taskType: overrides.taskType ?? resolveTaskTypeSummary("task"),
      priority: overrides.priority ?? "None",
      rank: overrides.rank ?? "a0",
    }),
    ...overrides,
  };
}

function makeTaskTreeNode(overrides: Partial<TaskTreeNode> = {}): TaskTreeNode {
  return {
    ...makeTask(overrides),
    depth: overrides.depth ?? 0,
    childCount: overrides.childCount ?? 0,
    completedChildCount: overrides.completedChildCount ?? 0,
    hasChildren: overrides.hasChildren ?? false,
    isExpanded: overrides.isExpanded ?? false,
    children: overrides.children ?? [],
  };
}

function makeAssignableUser(
  overrides: Partial<BoardAssignableUser> = {},
): BoardAssignableUser {
  const id =
    overrides._id ?? (`user-${overrides.name ?? "one"}` as Id<"users">);

  return {
    _id: id,
    name: overrides.name ?? "User One",
    avatarUrl: overrides.avatarUrl ?? null,
  };
}

function userAssignee(
  userId: string,
  name: string | null = null,
): NonNullable<Task["assignee"]> {
  return {
    type: "user",
    userId: userId as Id<"users">,
    name,
    avatarUrl: null,
  };
}

describe("board grouping rules", () => {
  const labels: BoardLabel[] = [
    {
      _id: "label-b" as Id<"projectLabels">,
      name: "Beta",
      color: "#3b82f6",
      rank: "0|a",
    },
    {
      _id: "label-a" as Id<"projectLabels">,
      name: "Alpha",
      color: "#ef4444",
      rank: "0|b",
    },
  ];
  test("groups real root tasks by configured status membership", () => {
    const columns = buildStatusBoardColumns({
      tasks: [
        makeTask({ refId: "OS-1", status: Status.TODO }),
        makeTask({ refId: "OS-2", status: Status.TRIAGE }),
        makeTask({ refId: "OS-3", status: Status.PLANNING }),
        makeTask({ refId: "OS-4", status: Status.PLAN_REVIEW }),
        makeTask({ refId: "OS-5", status: Status.IN_PROGRESS }),
        makeTask({ refId: "OS-6", status: Status.IN_REVIEW }),
        makeTask({ refId: "OS-7", status: Status.BLOCKED }),
        makeTask({ refId: "OS-8", status: Status.DONE }),
        makeTask({ refId: "OS-9", status: Status.CANCELED }),
      ],
    });

    expect(columns.map((column) => column.id)).toEqual([
      "todo",
      "planning",
      "in-progress",
      "in-review",
      "blocked",
      "done",
    ]);
    expect(
      columns
        .find((column) => column.id === "todo")
        ?.cards.map((card) => card.task.status),
    ).toEqual([Status.TODO, Status.TRIAGE]);
    expect(
      columns
        .find((column) => column.id === "planning")
        ?.cards.map((card) => card.task.status),
    ).toEqual([Status.PLANNING, Status.PLAN_REVIEW]);
    expect(
      columns.find((column) => column.id === "in-progress")?.cards,
    ).toHaveLength(1);
    expect(
      columns.find((column) => column.id === "in-review")?.cards,
    ).toHaveLength(1);
    expect(
      columns.find((column) => column.id === "blocked")?.cards,
    ).toHaveLength(1);
    expect(columns.find((column) => column.id === "done")?.cards).toHaveLength(
      2,
    );
  });
  test("applies status-group card presentation rules", () => {
    const columns = buildStatusBoardColumns({
      tasks: [
        makeTask({ refId: "OS-1", status: Status.TODO }),
        makeTask({ refId: "OS-2", status: Status.TRIAGE }),
        makeTask({ refId: "OS-3", status: Status.PLAN_REVIEW }),
        makeTask({ refId: "OS-4", status: Status.DONE }),
        makeTask({ refId: "OS-5", status: Status.CANCELED }),
      ],
    });

    expect(
      columns
        .find((column) => column.id === "todo")
        ?.cards.map((card) => card.presentation),
    ).toEqual([{ hideStatus: true }, { emphasizeStatus: true }]);
    expect(
      columns.find((column) => column.id === "planning")?.cards[0].presentation,
    ).toEqual({
      emphasizeStatus: true,
    });
    expect(
      columns
        .find((column) => column.id === "done")
        ?.cards.map((card) => card.presentation),
    ).toEqual([{ hideStatus: true }, { hideStatus: true }]);
  });
  test("renders root tasks only and preserves incoming rank order within a group", () => {
    const columns = buildStatusBoardColumns({
      tasks: [
        makeTask({ refId: "OS-2", status: Status.TODO, rank: "b0" }),
        makeTask({ refId: "OS-1", status: Status.TODO, rank: "a0" }),
        makeTask({
          refId: "OS-3",
          status: Status.TODO,
          parentId: "task-parent" as Id<"tasks">,
        }),
      ],
    });

    expect(
      columns
        .find((column) => column.id === "todo")
        ?.cards.map((card) => card.task.refId),
    ).toEqual(["OS-2", "OS-1"]);
  });
  test("attaches direct subtask progress from the loaded task tree", () => {
    const parent = makeTask({
      _id: "task-parent" as Id<"tasks">,
      clientId: "task-parent",
      refId: "OS-1",
      status: Status.TODO,
    });
    const columns = buildStatusBoardColumns({
      tasks: [
        parent,
        makeTask({
          _id: "task-child" as Id<"tasks">,
          clientId: "task-child",
          refId: "OS-2",
          parentId: "task-parent",
          status: Status.DONE,
        }),
      ],
      taskTree: [
        makeTaskTreeNode({
          ...parent,
          childCount: 3,
          completedChildCount: 2,
          hasChildren: true,
        }),
      ],
    });

    expect(
      columns.find((column) => column.id === "todo")?.cards[0].subtaskProgress,
    ).toEqual({ completed: 2, total: 3 });
  });
  test("groups root tasks by assignee with unassigned, assignable users, and stale users", () => {
    const assignedUser = makeAssignableUser({
      _id: "user-1" as Id<"users">,
      name: "Ada Lovelace",
    });
    const emptyUser = makeAssignableUser({
      _id: "user-2" as Id<"users">,
      name: "Grace Hopper",
    });
    const columns = buildAssigneeBoardColumns({
      assignableUsers: [assignedUser, emptyUser],
      tasks: [
        makeTask({ refId: "OS-1", assignee: null }),
        makeTask({
          refId: "OS-2",
          assignee: userAssignee("user-1", "Ada Lovelace"),
        }),
        makeTask({
          refId: "OS-3",
          assignee: userAssignee("legacy-user", "Legacy User"),
        }),
        makeTask({
          refId: "OS-4",
          assignee: userAssignee("user-1", "Ada Lovelace"),
          parentId: "task-parent" as Id<"tasks">,
        }),
      ],
    });

    expect(columns.map((column) => column.title)).toEqual([
      "No assignee",
      "Ada Lovelace",
      "Grace Hopper",
      "Legacy User",
    ]);
    expect(
      columns.map((column) => column.cards.map((card) => card.task.refId)),
    ).toEqual([["OS-1"], ["OS-2"], [], ["OS-3"]]);
    expect(
      columns.every((column) =>
        column.cards.every((card) => !card.presentation),
      ),
    ).toBe(true);
  });
  test("keeps assignee filters card-only while rendering all assignee groups", () => {
    const columns = buildAssigneeBoardColumns({
      assignableUsers: [
        makeAssignableUser({ _id: "user-1" as Id<"users">, name: "Ada" }),
        makeAssignableUser({ _id: "user-2" as Id<"users">, name: "Grace" }),
      ],
      tasks: [
        makeTask({ refId: "OS-1", assignee: userAssignee("user-1", "Ada") }),
        makeTask({ refId: "OS-2", assignee: userAssignee("user-2", "Grace") }),
      ],
      assigneeFilter: { type: "me" },
      currentUserId: "user-1",
    });

    expect(columns.map((column) => column.title)).toEqual([
      "No assignee",
      "Ada",
      "Grace",
    ]);
    expect(
      columns.map((column) => column.cards.map((card) => card.task.refId)),
    ).toEqual([[], ["OS-1"], []]);
  });
  test("groups root tasks by priority in high-to-low order", () => {
    const columns = buildPriorityBoardColumns({
      tasks: [
        makeTask({ refId: "OS-1", priority: "High" }),
        makeTask({ refId: "OS-2", priority: "None" }),
        makeTask({ refId: "OS-3", priority: "Critical" }),
        makeTask({ refId: "OS-4", priority: "Low" }),
        makeTask({
          refId: "OS-5",
          priority: "Low",
          parentId: "task-parent" as Id<"tasks">,
        }),
      ],
    });

    expect(columns.map((column) => column.title)).toEqual([
      "Critical",
      "High",
      "Medium",
      "Low",
      "None",
    ]);
    expect(
      columns.map((column) => column.cards.map((card) => card.task.refId)),
    ).toEqual([["OS-3"], ["OS-1"], [], ["OS-4"], ["OS-2"]]);
  });
  test("groups root tasks by built-in task type catalog order", () => {
    const customType = {
      key: "custom",
      name: "Custom",
      icon: "Dot" as const,
      color: "#64748b",
      isSystem: false,
    };
    const columns = buildTaskTypeBoardColumns({
      tasks: [
        makeTask({ refId: "OS-1", taskType: resolveTaskTypeSummary("bug") }),
        makeTask({ refId: "OS-2", taskType: resolveTaskTypeSummary("task") }),
        makeTask({ refId: "OS-3", taskType: resolveTaskTypeSummary("idea") }),
        makeTask({ refId: "OS-4", taskType: customType }),
      ],
    });

    expect(columns.map((column) => column.title)).toEqual([
      ...BUILT_IN_TASK_TYPES.map((taskType) => taskType.name),
      "Custom",
    ]);
    expect(
      columns.map((column) => column.cards.map((card) => card.task.refId)),
    ).toEqual([["OS-2"], ["OS-1"], [], [], [], [], ["OS-3"], ["OS-4"]]);
  });
  test("exposes grouping-field drop targets on assignee, priority, and type groups", () => {
    const assigneeColumns = buildAssigneeBoardColumns({
      assignableUsers: [
        makeAssignableUser({ _id: "user-1" as Id<"users">, name: "Ada" }),
      ],
      tasks: [],
    });
    expect(assigneeColumns.map((column) => column.dropTarget)).toEqual([
      {
        assigneeId: null,
        delegatedToAgentId: null,
        assigneeDetails: null,
        delegatedToAgentDetails: null,
      },
      {
        assigneeId: "user-1",
        delegatedToAgentId: null,
        assigneeDetails: {
          type: "user",
          userId: "user-1",
          name: "Ada",
          avatarUrl: null,
        },
        delegatedToAgentDetails: null,
      },
    ]);

    const priorityColumns = buildPriorityBoardColumns({ tasks: [] });
    expect(priorityColumns.map((column) => column.dropTarget)).toEqual([
      { priority: "Critical" },
      { priority: "High" },
      { priority: "Medium" },
      { priority: "Low" },
      { priority: "None" },
    ]);

    const typeColumns = buildTaskTypeBoardColumns({ tasks: [] });
    expect(typeColumns.map((column) => column.dropTarget)).toEqual(
      BUILT_IN_TASK_TYPES.map((taskType) => ({ taskTypeKey: taskType.key })),
    );
  });
  test("applies filters to cards while keeping groups visible", () => {
    const columns = buildStatusBoardColumns({
      tasks: [
        makeTask({
          refId: "OS-1",
          status: Status.TODO,
          assignee: userAssignee("user-1"),
        }),
        makeTask({
          refId: "OS-2",
          status: Status.DONE,
          assignee: userAssignee("user-2"),
        }),
      ],
      allowedStatuses: [Status.TODO, Status.DONE, Status.CANCELED],
      statusFilter: "active",
      assigneeFilter: { type: "me" },
      currentUserId: "user-1",
    });

    expect(columns.map((column) => column.id)).toEqual(["todo", "done"]);
    expect(
      columns
        .find((column) => column.id === "todo")
        ?.cards.map((card) => card.task.refId),
    ).toEqual(["OS-1"]);
    expect(columns.find((column) => column.id === "done")?.cards).toHaveLength(
      0,
    );
  });
  test("keeps disabled column groups visible only when they still have cards", () => {
    const visibleColumns = getVisibleBoardColumns(
      [Status.TODO, Status.DONE],
      [
        {
          id: "todo",
          title: Status.TODO,
          primaryStatus: Status.TODO,
          statuses: [Status.TODO, Status.TRIAGE],
          cards: [{ task: makeTask({ status: Status.TODO }) }],
        },
        {
          id: "planning",
          title: Status.PLANNING,
          primaryStatus: Status.PLANNING,
          statuses: [Status.PLANNING, Status.PLAN_REVIEW],
          cards: [],
        },
        {
          id: "blocked",
          title: Status.BLOCKED,
          primaryStatus: Status.BLOCKED,
          statuses: [Status.BLOCKED],
          cards: [{ task: makeTask({ status: Status.BLOCKED }) }],
        },
        {
          id: "done",
          title: Status.DONE,
          primaryStatus: Status.DONE,
          statuses: [Status.DONE, Status.CANCELED],
          cards: [{ task: makeTask({ status: Status.DONE }) }],
        },
      ],
    );

    expect(visibleColumns.map((column) => column.id)).toEqual([
      "todo",
      "blocked",
      "done",
    ]);
  });
  test("keeps triage legacy cards in the To Do group when To Do is disabled", () => {
    const columns = buildStatusBoardColumns({
      tasks: [
        makeTask({ refId: "OS-1", status: Status.TRIAGE }),
        makeTask({ refId: "OS-2", status: Status.PLANNING }),
      ],
      allowedStatuses: [Status.PLANNING],
    });

    expect(columns.map((column) => column.id)).toEqual(["todo", "planning"]);
    expect(
      columns
        .find((column) => column.id === "todo")
        ?.cards.map((card) => card.task.status),
    ).toEqual([Status.TRIAGE]);
    expect(
      columns
        .find((column) => column.id === "planning")
        ?.cards.map((card) => card.task.status),
    ).toEqual([Status.PLANNING]);
  });
  test("resolves status group create defaults from the primary status", () => {
    const columns = buildStatusBoardColumns({
      tasks: [],
    });

    expect(columns.find((column) => column.id === "todo")?.createStatus).toBe(
      Status.TODO,
    );
    expect(
      columns.find((column) => column.id === "planning")?.createStatus,
    ).toBe(Status.PLANNING);
    expect(columns.find((column) => column.id === "done")?.createStatus).toBe(
      Status.DONE,
    );
  });
  test("falls back to the first allowed status and disables create when none are allowed", () => {
    const columns = buildStatusBoardColumns({
      tasks: [makeTask({ refId: "OS-1", status: Status.BLOCKED })],
      allowedStatuses: [Status.TRIAGE],
    });

    expect(columns.find((column) => column.id === "todo")?.createStatus).toBe(
      Status.TRIAGE,
    );
    expect(
      columns.find((column) => column.id === "blocked")?.createStatus,
    ).toBeNull();
    expect(
      resolveStatusGroupTarget(
        {
          id: "planning",
          title: Status.PLANNING,
          primaryStatus: Status.PLANNING,
          statuses: [Status.PLANNING, Status.PLAN_REVIEW],
          cardPresentation: "emphasize-status",
        },
        [Status.PLAN_REVIEW],
      ),
    ).toBe(Status.PLAN_REVIEW);
  });
  test("resolves status drop targets with disabled-status fallbacks", () => {
    const taskInDisabledStatus = makeTask({
      refId: "OS-1",
      status: Status.BLOCKED,
    });
    const columns = buildStatusTaskColumns({
      tasks: [taskInDisabledStatus],
      allowedStatuses: [Status.TRIAGE],
    });

    // Primary disabled, Triage allowed: the group target falls back to Triage
    // for both create and drop.
    const todoColumn = columns.find((column) => column.id === "todo");
    expect(todoColumn?.dropTarget).toEqual({ status: Status.TRIAGE });
    expect(todoColumn?.createDefaults).toEqual({ status: Status.TRIAGE });
    // No allowed status in membership: the group stays visible for its legacy
    // card but is not a drop target.
    const blockedColumn = columns.find((column) => column.id === "blocked");
    expect(blockedColumn?.cards).toHaveLength(1);
    expect(blockedColumn?.dropTarget).toBeUndefined();
    expect(blockedColumn?.dropDisabledReason).toBeTruthy();
  });
  test("status groups expose their primary status as the drop target when enabled", () => {
    const columns = buildStatusTaskColumns({ tasks: [] });

    expect(columns.map((column) => column.dropTarget)).toEqual([
      { status: Status.TODO },
      { status: Status.PLANNING },
      { status: Status.IN_PROGRESS },
      { status: Status.IN_REVIEW },
      { status: Status.BLOCKED },
      { status: Status.DONE },
    ]);
  });
  test("leads with No label, then columns by label rank (as provided), including empty columns", () => {
    const columns = buildLabelBoardColumns({
      labels,
      tasks: [
        makeTask({ refId: "OS-1", labelId: "label-a" as Id<"projectLabels"> }),
        makeTask({ refId: "OS-2", refNumber: 2, labelId: null }),
      ],
    });

    expect(columns.map((column) => column.id)).toEqual([
      NO_LABEL_COLUMN_ID,
      "label:label-b",
      "label:label-a",
    ]);
    expect(columns.map((column) => column.title)).toEqual([
      "No label",
      "Beta",
      "Alpha",
    ]);
    expect(columns[0].cards.map((card) => card.task.refId)).toEqual(["OS-2"]);
    // Empty label columns render.
    expect(columns[1].cards).toHaveLength(0);
    expect(columns[2].cards.map((card) => card.task.refId)).toEqual(["OS-1"]);
  });
  test("exposes exact createDefaults and dropTarget payloads", () => {
    const columns = buildLabelBoardColumns({ labels, tasks: [] });

    const noLabel = columns[0];
    expect(noLabel.createDefaults).toEqual({ labelId: null });
    expect(noLabel.dropTarget).toEqual({ labelId: null });

    expect(columns[1].createDefaults).toEqual({ labelId: "label-b" });
    expect(columns[1].dropTarget).toEqual({ labelId: "label-b" });
  });
  test("with zero labels degrades to a lone No label column collecting every task", () => {
    const columns = buildLabelBoardColumns({
      labels: [],
      tasks: [
        makeTask({ refId: "OS-1" }),
        makeTask({ refId: "OS-2", refNumber: 2 }),
      ],
    });

    expect(columns).toHaveLength(1);
    expect(columns[0].id).toBe(NO_LABEL_COLUMN_ID);
    expect(columns[0].cards).toHaveLength(2);
  });
});
