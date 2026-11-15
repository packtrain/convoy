/// <reference types="vite/client" />
import { expect, test, describe, vi } from "vitest";
import { api } from "../../_generated/api";
import { createTestContext } from "../../../convex-testing";

const validProjectAgentInput = {
  name: "Bulk Agent",
  description: "Handles bulk work",
  prompt: "Work on selected tasks.",
  category: "Operations",
  appearance: { color: "#3b82f6" },
};

describe("bulkArchive", () => {
  test("should archive multiple tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2, task3] = await ctx.tasks(project._id, user._id, 3);

    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [task1._id, task2._id, task3._id],
    });
    expect(result).toEqual({
      archivedRootIds: [task1._id, task2._id, task3._id],
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      const t3 = await runCtx.db.get("tasks", task3._id);
      expect(t1?.isArchived).toBe(true);
      expect(t2?.isArchived).toBe(true);
      expect(t3?.isArchived).toBe(true);
    });
  });

  test("should cascade to descendants", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> A1, B -> B1
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
    const taskA1 = await ctx.task(project._id, user._id, {
      name: "A1",
      parentId: taskA._id,
    });
    const taskB = await ctx.task(project._id, user._id, { name: "B" });
    const taskB1 = await ctx.task(project._id, user._id, {
      name: "B1",
      parentId: taskB._id,
    });

    // Bulk archive A and B
    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [taskA._id, taskB._id],
    });
    expect(result).toEqual({ archivedRootIds: [taskA._id, taskB._id] });

    // Verify all are archived
    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const a1 = await runCtx.db.get("tasks", taskA1._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      const b1 = await runCtx.db.get("tasks", taskB1._id);

      expect(a?.isArchived).toBe(true);
      expect(a1?.isArchived).toBe(true);
      expect(b?.isArchived).toBe(true);
      expect(b1?.isArchived).toBe(true);
    });
  });

  test("should skip already archived tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    // Pre-archive task1
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task1._id, {
        isArchived: true,
        archivedAt: Date.now(),
        archivedBy: user._id,
      });
    });

    // This should not throw
    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [task1._id, task2._id],
    });
    expect(result).toEqual({ archivedRootIds: [task2._id] });

    await t.run(async (runCtx) => {
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t2?.isArchived).toBe(true);
    });
  });

  test("should skip deleted tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    // Delete task1
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task1._id, { isDeleted: true, deletedAt: Date.now() });
    });

    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [task1._id, task2._id],
    });
    expect(result).toEqual({ archivedRootIds: [task2._id] });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      // Deleted task should not be archived
      expect(t1?.isArchived).toBe(false);
      expect(t2?.isArchived).toBe(true);
    });
  });

  test("should reject tasks from multiple projects", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create another user with their own project
    const { user: user2, project: project2 } = await ctx.setupProject();
    const task2 = await ctx.task(project2._id, user2._id);

    const task1 = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.bulk.archive, {
        ids: [task1._id, task2._id],
      })
    ).rejects.toThrow("Tasks must be in the same project");

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      // Neither task should be archived (operation failed)
      expect(t1?.isArchived).toBe(false);
      expect(t2?.isArchived).toBe(false);
    });
  });

  test("should handle duplicate IDs (task and its descendant both in array)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> B
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
    const taskB = await ctx.task(project._id, user._id, {
      name: "B",
      parentId: taskA._id,
    });

    // Archive both A and B (B is also a descendant of A)
    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [taskA._id, taskB._id],
    });
    expect(result).toEqual({ archivedRootIds: [taskA._id] });

    // Both should be archived (no error from double-processing)
    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      expect(a?.isArchived).toBe(true);
      expect(b?.isArchived).toBe(true);
    });
  });

  test("should keep subtask parent when bulk archiving parent and subtask together", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [parent._id, child._id],
    });
    expect(result).toEqual({ archivedRootIds: [parent._id] });

    await t.run(async (runCtx) => {
      const parentTask = await runCtx.db.get("tasks", parent._id);
      const childTask = await runCtx.db.get("tasks", child._id);

      expect(parentTask?.isArchived).toBe(true);
      expect(childTask?.isArchived).toBe(true);
      expect(childTask?.parentId).toBe(parent._id);
    });
  });

  test("should keep nested subtask attached when its subtask ancestor is archived in the same batch, regardless of id order", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const root = await ctx.task(project._id, user._id, { name: "Root" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: root._id,
    });
    const grandchild = await ctx.task(project._id, user._id, {
      name: "Grandchild",
      parentId: child._id,
    });

    // Grandchild listed before its ancestor: it must still be archived via
    // the child's cascade (keeping its parent), not detached separately.
    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [grandchild._id, child._id],
    });
    expect(result).toEqual({ archivedRootIds: [child._id] });

    await t.run(async (runCtx) => {
      const rootTask = await runCtx.db.get("tasks", root._id);
      const childTask = await runCtx.db.get("tasks", child._id);
      const grandchildTask = await runCtx.db.get("tasks", grandchild._id);

      expect(rootTask?.isArchived).toBe(false);
      expect(childTask?.isArchived).toBe(true);
      expect(childTask?.parentId).toBeUndefined();
      expect(grandchildTask?.isArchived).toBe(true);
      expect(grandchildTask?.parentId).toBe(child._id);
    });
  });

  test("should work with empty selection", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    // Bulk archive with empty array - should not throw
    const result = await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [],
    });

    expect(result).toEqual({ archivedRootIds: [] });
  });
});

describe("bulkUnarchive", () => {
  test("should unarchive multiple root tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task1 = await ctx.task(project._id, user._id, { name: "Task 1" });
    const task2 = await ctx.task(project._id, user._id, { name: "Task 2" });
    const task3 = await ctx.task(project._id, user._id, { name: "Task 3" });

    await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [task1._id, task2._id, task3._id],
    });

    await asUser.mutation(api.tasks.core.bulk.unarchive, {
      ids: [task1._id, task2._id, task3._id],
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      const t3 = await runCtx.db.get("tasks", task3._id);
      expect(t1?.isArchived).toBe(false);
      expect(t2?.isArchived).toBe(false);
      expect(t3?.isArchived).toBe(false);
    });
  });

  test("should cascade to descendants", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    await asUser.mutation(api.tasks.core.archive, { id: parent._id });
    await asUser.mutation(api.tasks.core.bulk.unarchive, { ids: [parent._id] });

    await t.run(async (runCtx) => {
      const parentDoc = await runCtx.db.get("tasks", parent._id);
      const childDoc = await runCtx.db.get("tasks", child._id);
      expect(parentDoc?.isArchived).toBe(false);
      expect(childDoc?.isArchived).toBe(false);
    });
  });

  test("should ignore selected subtasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    await asUser.mutation(api.tasks.core.archive, { id: parent._id });
    const result = await asUser.mutation(api.tasks.core.bulk.unarchive, {
      ids: [child._id],
    });
    expect(result).toBeNull();

    await t.run(async (runCtx) => {
      const parentDoc = await runCtx.db.get("tasks", parent._id);
      const childDoc = await runCtx.db.get("tasks", child._id);
      expect(parentDoc?.isArchived).toBe(true);
      expect(childDoc?.isArchived).toBe(true);
    });
  });

  test("should skip deleted and already-unarchived tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const archivedAndDeleted = await ctx.task(project._id, user._id, {
      name: "Archived and deleted",
    });
    const archivedTask = await ctx.task(project._id, user._id, {
      name: "Archived task",
    });
    const activeTask = await ctx.task(project._id, user._id, {
      name: "Active task",
    });

    await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [archivedAndDeleted._id, archivedTask._id],
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", archivedAndDeleted._id, {
        isDeleted: true,
        deletedAt: Date.now(),
      });
    });

    await asUser.mutation(api.tasks.core.bulk.unarchive, {
      ids: [archivedAndDeleted._id, archivedTask._id, activeTask._id],
    });

    await t.run(async (runCtx) => {
      const deletedDoc = await runCtx.db.get("tasks", archivedAndDeleted._id);
      const archivedDoc = await runCtx.db.get("tasks", archivedTask._id);
      const activeDoc = await runCtx.db.get("tasks", activeTask._id);

      expect(deletedDoc?.isArchived).toBe(true);
      expect(deletedDoc?.isDeleted).toBe(true);
      expect(archivedDoc?.isArchived).toBe(false);
      expect(activeDoc?.isArchived).toBe(false);
    });
  });

  test("should reject tasks from multiple projects", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const { project: project2, user: user2 } = await ctx.setupProject();
    const asUser2 = ctx.asUser(user2);

    const task1 = await ctx.task(project._id, user._id, { name: "P1 task" });
    const task2 = await ctx.task(project2._id, user2._id, { name: "P2 task" });

    await asUser.mutation(api.tasks.core.bulk.archive, { ids: [task1._id] });
    await asUser2.mutation(api.tasks.core.bulk.archive, { ids: [task2._id] });

    await expect(
      asUser.mutation(api.tasks.core.bulk.unarchive, {
        ids: [task1._id, task2._id],
      })
    ).rejects.toThrow("Tasks must be in the same project");

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.isArchived).toBe(true);
      expect(t2?.isArchived).toBe(true);
    });
  });

  test("should work with empty selection", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    const result = await asUser.mutation(api.tasks.core.bulk.unarchive, { ids: [] });
    expect(result).toBeNull();
  });

  test("should place restored tasks at the top preserving archived order", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const activeA = await ctx.task(project._id, user._id, { name: "Active A" });
    await ctx.task(project._id, user._id, { name: "Active B" });
    const archivedOlder = await ctx.task(project._id, user._id, {
      name: "Archived Older",
    });
    const archivedNewer = await ctx.task(project._id, user._id, {
      name: "Archived Newer",
    });

    await asUser.mutation(api.tasks.core.bulk.archive, {
      ids: [archivedOlder._id, archivedNewer._id],
    });

    // Ensure deterministic archived order: newer first in archived view order.
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", archivedOlder._id, { archivedAt: 1000 });
      await runCtx.db.patch("tasks", archivedNewer._id, { archivedAt: 2000 });
    });

    await asUser.mutation(api.tasks.core.bulk.unarchive, {
      ids: [archivedOlder._id, archivedNewer._id],
    });

    const activeTasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      archiveFilter: "active",
    });
    const rootNames = activeTasks.filter((task) => task.parentId === null).map((task) => task.name);

    expect(rootNames[0]).toBe("Archived Newer");
    expect(rootNames[1]).toBe("Archived Older");
    expect(rootNames.indexOf("Archived Older")).toBeLessThan(rootNames.indexOf("Active A"));
    expect(rootNames.indexOf("Archived Newer")).toBeLessThan(rootNames.indexOf("Active A"));
    expect(rootNames).toContain(activeA.name);
  });
});

describe("bulkUpdate", () => {
  test("should update status for multiple tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2, task3] = await ctx.tasks(project._id, user._id, 3);

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id, task3._id],
      status: "Done",
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      const t3 = await runCtx.db.get("tasks", task3._id);
      expect(t1?.status).toBe("Done");
      expect(t2?.status).toBe("Done");
      expect(t3?.status).toBe("Done");
    });

    await vi.waitFor(async () => {
      const statusLogs = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task1._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(
        statusLogs.page.filter((log) => log.eventType === "status_changed")
      ).toHaveLength(1);
    });
  });

  test("should update assignee for multiple tasks and clear it with null", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const assignee = await ctx.user({ name: "Assigned User" });

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      assigneeId: assignee._id,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.assigneeId).toBe(assignee._id);
      expect(t2?.assigneeId).toBe(assignee._id);
    });

    await vi.waitFor(async () => {
      const assigneeLogs = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task1._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      const assignLog = assigneeLogs.page.find(
        (log) => log.eventType === "assignee_changed"
      );
      expect(assignLog?.changeDetails).toMatchObject({
        type: "assignee",
        newUserId: assignee._id,
        newUserName: "Assigned User",
      });
      expect(assignLog?.changeDetails).not.toHaveProperty("oldUserName");
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      assigneeId: null,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.assigneeId).toBeUndefined();
      expect(t2?.assigneeId).toBeUndefined();
    });
  });

  test("should not log assignee changes when typed assignee is unchanged", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const assignee = await ctx.user({ name: "Assigned User" });
    const task = await ctx.task(project._id, user._id, {
      assigneeId: assignee._id,
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task._id],
      assigneeId: assignee._id,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      // Same owner: no change logged.
      expect(updated?.assigneeId).toBe(assignee._id);
    });

    const assigneeLogs = await asUser.query(api.tasks.activity.listByTask, {
      taskId: task._id,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(
      assigneeLogs.page.filter((log) => log.eventType === "assignee_changed")
    ).toHaveLength(0);
  });

  test("should delegate multiple tasks to a Project agent and clear delegation with null", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.delegatedToAgentId).toBe(projectAgentId);
      expect(t2?.delegatedToAgentId).toBe(projectAgentId);
      // Ownerless tasks get the acting user auto-set as owner.
      expect(t1?.assigneeId).toBe(user._id);
      expect(t2?.assigneeId).toBe(user._id);
    });

    await vi.waitFor(async () => {
      const assigneeLogs = await asUser.query(api.tasks.activity.listByTask, {
        taskId: task1._id,
        paginationOpts: { numItems: 10, cursor: null },
      });
      const delegationLog = assigneeLogs.page.find(
        (log) => log.eventType === "delegation_changed"
      );
      expect(delegationLog?.changeDetails).toMatchObject({
        type: "delegation",
        newAgentId: projectAgentId,
        newAgentName: validProjectAgentInput.name,
      });
      const assignLog = assigneeLogs.page.find(
        (log) => log.eventType === "assignee_changed"
      );
      expect(assignLog?.changeDetails).toMatchObject({
        type: "assignee",
        newUserId: user._id,
      });
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      delegatedToAgentId: null,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.delegatedToAgentId).toBeUndefined();
      expect(t2?.delegatedToAgentId).toBeUndefined();
      // Clearing delegation keeps the (auto-set) owner.
      expect(t1?.assigneeId).toBe(user._id);
      expect(t2?.assigneeId).toBe(user._id);
    });
  });

  test("bulk delegation auto-sets owner only for ownerless tasks and keeps delegation on owner change", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser, t } = await ctx.setupProject();
    const owner = await ctx.user({ name: "Existing Owner" });
    await ctx.orgMember(org._id, owner._id, "member");
    await ctx.projectMember(project._id, owner._id, "member");
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    const [ownerless, owned] = await ctx.tasks(project._id, user._id, 2);
    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [owned._id],
      assigneeId: owner._id,
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [ownerless._id, owned._id],
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", ownerless._id);
      const t2 = await runCtx.db.get("tasks", owned._id);
      expect(t1?.assigneeId).toBe(user._id);
      expect(t2?.assigneeId).toBe(owner._id);
      expect(t1?.delegatedToAgentId).toBe(projectAgentId);
      expect(t2?.delegatedToAgentId).toBe(projectAgentId);
    });

    // Bulk owner change keeps delegation.
    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [ownerless._id, owned._id],
      assigneeId: owner._id,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", ownerless._id);
      expect(t1?.assigneeId).toBe(owner._id);
      expect(t1?.delegatedToAgentId).toBe(projectAgentId);
    });
  });

  test("should update priority for multiple tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      priority: "Critical",
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.priority).toBe("Critical");
      expect(t2?.priority).toBe("Critical");
    });
  });

  test("should update due date for multiple tasks and clear it with null", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);
    const dueDate = Date.now() + 86400000;

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      dueDate,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.dueDate).toBe(dueDate);
      expect(t2?.dueDate).toBe(dueDate);
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      dueDate: null,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.dueDate).toBeUndefined();
      expect(t2?.dueDate).toBeUndefined();
    });
  });

  test("should update task type and reset null to the default task type", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      taskTypeKey: "bug",
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.taskTypeKey).toBe("bug");
      expect(t2?.taskTypeKey).toBe("bug");
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      taskTypeKey: null,
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.taskTypeKey).toBe("task");
      expect(t2?.taskTypeKey).toBe("task");
    });
  });

  test("logs one type_changed row per task and nothing for a no-op type update (OS-1455)", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

      const typeLogs = async () => {
        await t.finishAllScheduledFunctions(vi.runAllTimers);
        return t.run(async (runCtx) => {
          const logs = await runCtx.db
            .query("taskActivityLogs")
            .withIndex("by_task", (q) => q.eq("taskId", task1._id))
            .collect();
          return logs.filter((log) => log.eventType === "type_changed");
        });
      };

      await asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task1._id, task2._id],
        taskTypeKey: "bug",
      });

      const logs = await typeLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].changeDetails).toEqual({
        type: "task_type",
        oldKey: "task",
        oldName: "Task",
        newKey: "bug",
        newName: "Bug",
      });

      await asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task1._id, task2._id],
        taskTypeKey: "bug",
      });
      expect(await typeLogs()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("should apply multiple update fields in one call", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);
    const dueDate = Date.now() + 86400000;

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      status: "In Progress",
      taskTypeKey: "feature",
      assigneeId: user._id,
      dueDate,
      priority: "High",
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.status).toBe("In Progress");
      expect(t2?.status).toBe("In Progress");
      expect(t1?.taskTypeKey).toBe("feature");
      expect(t2?.taskTypeKey).toBe("feature");
      expect(t1?.assigneeId).toBe(user._id);
      expect(t2?.assigneeId).toBe(user._id);
      expect(t1?.dueDate).toBe(dueDate);
      expect(t2?.dueDate).toBe(dueDate);
      expect(t1?.priority).toBe("High");
      expect(t2?.priority).toBe("High");
    });
  });

  test("should skip deleted tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task1._id, { isDeleted: true, deletedAt: Date.now() });
    });

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task1._id, task2._id],
      status: "Done",
      priority: "Critical",
    });

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.status).toBe("To Do");
      expect(t1?.priority).toBe(task1.priority);
      expect(t2?.status).toBe("Done");
      expect(t2?.priority).toBe("Critical");
    });
  });

  test("should not write unchanged tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, {
      status: "Done",
      priority: "High",
    });
    const before = task.updatedAt;

    await asUser.mutation(api.tasks.core.bulk.update, {
      ids: [task._id],
      status: "Done",
      priority: "High",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.updatedAt).toBe(before);
    });
  });

  test("should throw when no update fields are provided", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task._id],
      })
    ).rejects.toThrow("No bulk update fields provided");
  });

  test("should throw if any task is unauthorized (fail-fast)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const { user: user2, project: project2 } = await ctx.setupProject();
    const task2 = await ctx.task(project2._id, user2._id);
    const task1 = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task1._id, task2._id],
        status: "Done",
      })
    ).rejects.toThrow("Tasks must be in the same project");

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.status).toBe("To Do");
      expect(t2?.status).toBe("To Do");
    });
  });

  test("should reject bulk update to a disabled project status", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, {
        disabledStatuses: ["Blocked"],
      });
    });

    await expect(
      asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task1._id, task2._id],
        status: "Blocked",
      })
    ).rejects.toThrow("disabled for this project");
  });

  test("should reject invalid task type keys", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.bulk.update, {
        ids: [task._id],
        taskTypeKey: "invalid-type",
      })
    ).rejects.toThrow("Invalid task type");
  });
});

describe("bulkRemove", () => {
  test("should delete multiple tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2, task3] = await ctx.tasks(project._id, user._id, 3);

    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [task1._id, task2._id, task3._id],
    });
    expect(new Set(result.deletedIds)).toEqual(
      new Set([task1._id, task2._id, task3._id])
    );

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      const t3 = await runCtx.db.get("tasks", task3._id);
      expect(t1?.isDeleted).toBe(true);
      expect(t2?.isDeleted).toBe(true);
      expect(t3?.isDeleted).toBe(true);
    });
  });

  test("should reject tasks from multiple projects", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();
    const { user: user2, project: project2 } = await ctx.setupProject();
    const task1 = await ctx.task(project._id, user._id);
    const task2 = await ctx.task(project2._id, user2._id);

    await expect(
      asUser.mutation(api.tasks.core.bulk.remove, {
        ids: [task1._id, task2._id],
      })
    ).rejects.toThrow("Tasks must be in the same project");

    await t.run(async (runCtx) => {
      const t1 = await runCtx.db.get("tasks", task1._id);
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t1?.isDeleted).toBe(false);
      expect(t2?.isDeleted).toBe(false);
    });
  });

  test("should skip already deleted tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const [task1, task2] = await ctx.tasks(project._id, user._id, 2);

    // Pre-delete task1
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task1._id, { isDeleted: true, deletedAt: Date.now() });
    });

    // This should not throw
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [task1._id, task2._id],
    });
    expect(result.deletedIds).toEqual([task2._id]);

    await t.run(async (runCtx) => {
      const t2 = await runCtx.db.get("tasks", task2._id);
      expect(t2?.isDeleted).toBe(true);
    });
  });

  test("should schedule deletion", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.bulk.remove, { ids: [task._id] });

    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("tasks", task._id);
      expect(deleted?.scheduledDeletionId).toBeDefined();
    });
  });

  test("delete_all should delete all selected tasks and their descendants", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> A1, B -> B1 -> B1a
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
    const taskA1 = await ctx.task(project._id, user._id, {
      name: "A1",
        parentId: taskA._id,
    });
      const taskB = await ctx.task(project._id, user._id, { name: "B" });
    const taskB1 = await ctx.task(project._id, user._id, {
      name: "B1",
        parentId: taskB._id,
    });
    const taskB1a = await ctx.task(project._id, user._id, {
      name: "B1a",
      parentId: taskB1._id,
    });

    // Bulk delete A and B with delete_all
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [taskA._id, taskB._id],
      cascadeMode: "delete_all",
    });
    expect(new Set(result.deletedIds)).toEqual(
      new Set([taskA._id, taskA1._id, taskB._id, taskB1._id, taskB1a._id])
    );

      // Verify all are deleted
      await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const a1 = await runCtx.db.get("tasks", taskA1._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      const b1 = await runCtx.db.get("tasks", taskB1._id);
      const b1a = await runCtx.db.get("tasks", taskB1a._id);

      expect(a?.isDeleted).toBe(true);
      expect(a1?.isDeleted).toBe(true);
      expect(b?.isDeleted).toBe(true);
      expect(b1?.isDeleted).toBe(true);
      expect(b1a?.isDeleted).toBe(true);
    });
  });

  test("keep_children should promote all children of selected tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> A1, B -> B1
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
    const taskA1 = await ctx.task(project._id, user._id, {
      name: "A1",
        parentId: taskA._id,
    });
      const taskB = await ctx.task(project._id, user._id, { name: "B" });
    const taskB1 = await ctx.task(project._id, user._id, {
      name: "B1",
        parentId: taskB._id,
    });

    // Bulk delete A and B with keep_children
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [taskA._id, taskB._id],
      cascadeMode: "keep_children",
    });
    expect(new Set(result.deletedIds)).toEqual(new Set([taskA._id, taskB._id]));

    // Verify A and B deleted, A1 and B1 are now top-level
    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const a1 = await runCtx.db.get("tasks", taskA1._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      const b1 = await runCtx.db.get("tasks", taskB1._id);

      expect(a?.isDeleted).toBe(true);
      expect(b?.isDeleted).toBe(true);
      expect(a1?.isDeleted).toBe(false);
      expect(a1?.parentId).toBeUndefined();
      expect(b1?.isDeleted).toBe(false);
      expect(b1?.parentId).toBeUndefined();
    });
  });

  test("should handle nested selection (parent and child both selected)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> B -> C
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
      const taskB = await ctx.task(project._id, user._id, {
      name: "B",
        parentId: taskA._id,
    });
    const taskC = await ctx.task(project._id, user._id, {
      name: "C",
        parentId: taskB._id,
    });

    // Select both A and B for bulk delete with delete_all
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [taskA._id, taskB._id],
      cascadeMode: "delete_all",
    });
    expect(new Set(result.deletedIds)).toEqual(
      new Set([taskA._id, taskB._id, taskC._id])
    );

    // All should be deleted (including C as descendant of A)
    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      const c = await runCtx.db.get("tasks", taskC._id);

      expect(a?.isDeleted).toBe(true);
      expect(b?.isDeleted).toBe(true);
      expect(c?.isDeleted).toBe(true);
    });
  });

  test("should default to delete_all when cascadeMode not specified", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> A1
    const taskA = await ctx.task(project._id, user._id, { name: "A" });
    const taskA1 = await ctx.task(project._id, user._id, {
      name: "A1",
        parentId: taskA._id,
    });

    // Bulk delete without cascadeMode
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [taskA._id],
    });
    expect(new Set(result.deletedIds)).toEqual(new Set([taskA._id, taskA1._id]));

    // Verify A and A1 both deleted (backward compatible)
    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const a1 = await runCtx.db.get("tasks", taskA1._id);

      expect(a?.isDeleted).toBe(true);
      expect(a1?.isDeleted).toBe(true);
    });
  });

  test("should work with empty selection", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    // Bulk delete with empty array - should not throw
    const result = await asUser.mutation(api.tasks.core.bulk.remove, {
      ids: [],
    });

    expect(result.deletedIds).toEqual([]);
  });
});
