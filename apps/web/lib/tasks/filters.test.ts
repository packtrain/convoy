import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { filterTaskByFilters, isClosedOnlyStatusFilter } from "./filters";
import { Status, type Task } from "./types";
import { getDefaultTaskTypeSummary } from "./task-types";

function makeTask(overrides: Partial<Task>): Task {
  return {
    delegatedToAgent: null,
    _id: "task_1" as Task["_id"],
    clientId: "client_1",
    refNumber: 1,
    refId: "WEB-1",
    name: "Task",
    description: null,
    taskType: getDefaultTaskTypeSummary(),
    priority: "None",
    dueDate: null,
    status: Status.TODO,
    tags: [],
    rank: "0|hzzzzz:",
    parentId: null,
    createdAt: Date.now(),
    isArchived: false,
    ...overrides,
    assignee: overrides.assignee ?? null,
  };
}

describe("filterTaskByFilters", () => {
  test("active excludes done and canceled", () => {
    expect(filterTaskByFilters(makeTask({ status: Status.DONE }), "active", null)).toBe(false);
    expect(filterTaskByFilters(makeTask({ status: Status.CANCELED }), "active", null)).toBe(false);
    expect(filterTaskByFilters(makeTask({ status: Status.TODO }), "active", null)).toBe(true);
    expect(filterTaskByFilters(makeTask({ status: Status.PLANNING }), "active", null)).toBe(true);
  });

  test("all includes workflow statuses", () => {
    expect(filterTaskByFilters(makeTask({ status: Status.DONE }), "all", null)).toBe(true);
    expect(filterTaskByFilters(makeTask({ status: Status.IN_PROGRESS }), "all", null)).toBe(true);
  });

  test("combines status filters with assignee filters", () => {
    const task = makeTask({
      status: Status.TODO,
      assignee: {
        type: "user",
        userId: "user_1" as Id<"users">,
        name: "Ada",
        avatarUrl: null,
      },
    });
    expect(
      filterTaskByFilters(task, "active", {
        type: "user",
        userId: "user_1" as Id<"users">,
      })
    ).toBe(true);
    expect(
      filterTaskByFilters(task, "active", {
        type: "user",
        userId: "user_2" as Id<"users">,
      })
    ).toBe(false);
  });

  test("split assignment (OS-1335): owner filters match delegated tasks, agent filters match delegation", () => {
    const delegatedTask = makeTask({
      status: Status.TODO,
      assignee: {
        type: "user",
        userId: "user_1" as Id<"users">,
        name: "Ada",
        avatarUrl: null,
      },
      delegatedToAgent: {
        type: "projectAgent",
        projectAgentId: "agent_1" as Id<"projectAgents">,
        name: "Planner",
        appearance: { color: "#3b82f6" },
        isDeleted: false,
      },
    });

    // A delegated task still shows up for its human owner.
    expect(
      filterTaskByFilters(delegatedTask, "active", {
        type: "user",
        userId: "user_1" as Id<"users">,
      })
    ).toBe(true);
    // Agent filters match the delegation.
    expect(
      filterTaskByFilters(delegatedTask, "active", {
        type: "projectAgent",
        projectAgentId: "agent_1" as Id<"projectAgents">,
      })
    ).toBe(true);
    expect(
      filterTaskByFilters(delegatedTask, "active", {
        type: "projectAgent",
        projectAgentId: "agent_2" as Id<"projectAgents">,
      })
    ).toBe(false);
    // "unassigned" means no human owner — ownerless delegated tasks count.
    expect(filterTaskByFilters(delegatedTask, "active", { type: "unassigned" })).toBe(false);
    const ownerlessDelegated = makeTask({
      status: Status.TODO,
      assignee: null,
      delegatedToAgent: delegatedTask.delegatedToAgent,
    });
    expect(filterTaskByFilters(ownerlessDelegated, "active", { type: "unassigned" })).toBe(true);
  });
});

describe("filterTaskByFilters closed-only root-only rule", () => {
  test("done view keeps root done tasks but excludes done subtasks", () => {
    const rootDone = makeTask({ status: Status.DONE, parentId: null });
    const doneSubtask = makeTask({
      _id: "task_2" as Task["_id"],
      status: Status.DONE,
      parentId: "task_1" as Task["_id"],
    });
    expect(filterTaskByFilters(rootDone, "done", null)).toBe(true);
    expect(filterTaskByFilters(doneSubtask, "done", null)).toBe(false);
  });

  test("canceled view excludes canceled subtasks", () => {
    const canceledSubtask = makeTask({
      status: Status.CANCELED,
      parentId: "task_1" as Task["_id"],
    });
    expect(filterTaskByFilters(canceledSubtask, "canceled", null)).toBe(false);
  });

  test("non-closed views keep matching subtasks", () => {
    const subtask = makeTask({
      status: Status.TODO,
      parentId: "task_1" as Task["_id"],
    });
    expect(filterTaskByFilters(subtask, "all", null)).toBe(true);
    expect(filterTaskByFilters(subtask, "active", null)).toBe(true);
  });
});

describe("isClosedOnlyStatusFilter", () => {
  test("true only for done and canceled", () => {
    expect(isClosedOnlyStatusFilter("done")).toBe(true);
    expect(isClosedOnlyStatusFilter("canceled")).toBe(true);
    expect(isClosedOnlyStatusFilter("all")).toBe(false);
    expect(isClosedOnlyStatusFilter("active")).toBe(false);
  });
});
