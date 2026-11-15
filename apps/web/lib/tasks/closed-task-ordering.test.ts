import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import { Status } from "./status";
import { planClosedTasksToBottom } from "./closed-task-ordering";

function rankedTasks(statuses: Status[]) {
  let rank = LexoRank.middle();
  return statuses.map((status, index) => {
    const task = {
      _id: `task-${index + 1}`,
      rank: rank.toString(),
      status,
    };
    rank = rank.genNext();
    return task;
  });
}

function applyUpdates<T extends { _id: string; rank: string }>(
  tasks: T[],
  updates: { id: string; rank: string }[]
) {
  const rankById = new Map(updates.map((update) => [update.id, update.rank]));
  return tasks
    .map((task) => ({
      ...task,
      rank: rankById.get(task._id) ?? task.rank,
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank));
}

describe("planClosedTasksToBottom", () => {
  test("returns no updates for an already normalized order", () => {
    const tasks = rankedTasks([Status.TODO, Status.IN_PROGRESS, Status.DONE]);

    expect(planClosedTasksToBottom(tasks)).toEqual({
      movedCount: 0,
      updates: [],
    });
  });

  test("moves one open task upward when that is cheaper", () => {
    const tasks = rankedTasks([Status.DONE, Status.DONE, Status.TODO]);

    const plan = planClosedTasksToBottom(tasks);

    expect(plan.movedCount).toBe(1);
    expect(plan.updates.map((update) => update.id)).toEqual(["task-3"]);
    expect(applyUpdates(tasks, plan.updates).map((task) => task.status)).toEqual([
      Status.TODO,
      Status.DONE,
      Status.DONE,
    ]);
  });

  test("moves closed tasks downward when that is cheaper", () => {
    const tasks = rankedTasks([
      Status.DONE,
      Status.DONE,
      Status.TODO,
      Status.IN_PROGRESS,
      Status.TRIAGE,
    ]);

    const plan = planClosedTasksToBottom(tasks);

    expect(plan.movedCount).toBe(2);
    expect(plan.updates.map((update) => update.id)).toEqual(["task-1", "task-2"]);
    expect(applyUpdates(tasks, plan.updates).map((task) => task.status)).toEqual([
      Status.TODO,
      Status.IN_PROGRESS,
      Status.TRIAGE,
      Status.DONE,
      Status.DONE,
    ]);
  });

  test("treats done and canceled as closed", () => {
    const tasks = rankedTasks([
      Status.CANCELED,
      Status.TODO,
      Status.DONE,
      Status.IN_PROGRESS,
    ]);

    const plan = planClosedTasksToBottom(tasks);

    expect(applyUpdates(tasks, plan.updates).map((task) => task.status)).toEqual([
      Status.TODO,
      Status.IN_PROGRESS,
      Status.CANCELED,
      Status.DONE,
    ]);
  });

  test("preserves relative order within open and closed groups", () => {
    const tasks = rankedTasks([
      Status.TODO,
      Status.DONE,
      Status.IN_PROGRESS,
      Status.CANCELED,
      Status.TRIAGE,
    ]);

    const plan = planClosedTasksToBottom(tasks);

    expect(applyUpdates(tasks, plan.updates).map((task) => task._id)).toEqual([
      "task-1",
      "task-3",
      "task-5",
      "task-2",
      "task-4",
    ]);
  });

  test("generates ranks inside existing boundaries when moving open tasks upward", () => {
    const tasks = rankedTasks([
      Status.TODO,
      Status.DONE,
      Status.DONE,
      Status.IN_PROGRESS,
    ]);

    const plan = planClosedTasksToBottom(tasks);
    const update = plan.updates[0];

    expect(update.id).toBe("task-4");
    expect(update.rank.localeCompare(tasks[0].rank)).toBeGreaterThan(0);
    expect(update.rank.localeCompare(tasks[1].rank)).toBeLessThan(0);
  });
});
