/// <reference types="vite/client" />
import { expect, test, describe } from "vitest";
import { api } from "../../_generated/api";
import { createTestContext, gen } from "../../../convex-testing";
import { createPersistedTaskListKey } from "../../lib/contracts/taskListKeys";

describe("updateRank", () => {
  test("should update rank", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);
    const newRank = gen.rank();

    await asUser.mutation(api.tasks.core.rank.update, {
      id: task._id,
      rank: newRank,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.rank).toBe(newRank);
    });
  });

  test("should reject non-existent task", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.core.rank.update, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: "invalid_id" as any,
        rank: gen.rank(),
      })
    ).rejects.toThrow();
  });

  test("should reject deleted task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Soft delete the task
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, { isDeleted: true, deletedAt: Date.now() });
    });

    await expect(
      asUser.mutation(api.tasks.core.rank.update, {
        id: task._id,
        rank: gen.rank(),
      })
    ).rejects.toThrow("Task not found");
  });
});

describe("batchUpdateRanks", () => {
  test("should update multiple sibling ranks in one mutation", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const taskA = await ctx.task(project._id, user._id);
    const taskB = await ctx.task(project._id, user._id);
    const rankA = gen.rank();
    const rankB = gen.rank();

    await asUser.mutation(api.tasks.core.rank.batchUpdate, {
      updates: [
        { id: taskA._id, rank: rankA },
        { id: taskB._id, rank: rankB },
      ],
    });

    await t.run(async (runCtx) => {
      const updatedA = await runCtx.db.get("tasks", taskA._id);
      const updatedB = await runCtx.db.get("tasks", taskB._id);
      expect(updatedA?.rank).toBe(rankA);
      expect(updatedB?.rank).toBe(rankB);
    });
  });

  test("should reject rank updates from users without project access", async () => {
    const ctx = createTestContext();
    const { project, user } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const { asUser: asUser2 } = await ctx.setupUser();

    await expect(
      asUser2.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [{ id: task._id, rank: gen.rank() }],
      })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("should reject rank updates that span sibling scopes", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const parent = await ctx.task(project._id, user._id);
    const rootTask = await ctx.task(project._id, user._id);
    const childTask = await ctx.task(project._id, user._id, { parentId: parent._id });

    await expect(
      asUser.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [
          { id: rootTask._id, rank: gen.rank() },
          { id: childTask._id, rank: gen.rank() },
        ],
      })
    ).rejects.toThrow("Rank updates must target tasks in the same sibling scope");
  });

  test("should reject rank updates that span projects", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id);
    const firstTask = await ctx.task(project._id, user._id);
    const secondTask = await ctx.task(otherProject._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [
          { id: firstTask._id, rank: gen.rank() },
          { id: secondTask._id, rank: gen.rank() },
        ],
      })
    ).rejects.toThrow("Rank updates must target tasks in the same sibling scope");
  });

  test("should reject rank updates that mix archived and active tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const activeTask = await ctx.task(project._id, user._id);
    const archivedTask = await ctx.task(project._id, user._id, {
      isArchived: true,
      archivedAt: Date.now(),
      archivedBy: user._id,
    });

    await expect(
      asUser.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [
          { id: activeTask._id, rank: gen.rank() },
          { id: archivedTask._id, rank: gen.rank() },
        ],
      })
    ).rejects.toThrow("Rank updates must target tasks in the same sibling scope");
  });

  test("should reject rank updates that span Lists", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
      color: "#3b82f6",
    });
    const listedTask = await ctx.task(project._id, user._id, {
      listKey: createPersistedTaskListKey(listId),
    });
    const unlistedTask = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [
          { id: listedTask._id, rank: gen.rank() },
          { id: unlistedTask._id, rank: gen.rank() },
        ],
      })
    ).rejects.toThrow("Rank updates must target tasks in the same sibling scope");
  });

  test("should reject duplicate task IDs", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.rank.batchUpdate, {
        updates: [
          { id: task._id, rank: gen.rank() },
          { id: task._id, rank: gen.rank() },
        ],
      })
    ).rejects.toThrow("Rank updates must not include duplicate tasks");
  });
});
