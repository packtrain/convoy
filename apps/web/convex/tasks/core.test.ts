/// <reference types="vite/client" />
import { afterEach, expect, test, describe, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext, gen } from "../../convex-testing";
import { LexoRank } from "lexorank";
import { createPersistedTaskListKey } from "../lib/contracts/taskListKeys";
import { BACKLOG_SYSTEM_LIST_KEY } from "@/lib/task-lists/system-lists";
import { MAX_EXTERNAL_LINKS_PER_TASK } from "@/lib/tasks/external-links";

const validProjectAgentInput = {
  name: "Code Review Agent",
  description: "Reviews code changes",
  prompt: "Review the current diff.",
  category: "Engineering",
  appearance: { color: "#3b82f6" },
};

describe("tasks", () => {
  describe("listTypes", () => {
    test("returns the canonical task type catalog to project viewers", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const taskTypes = await asUser.query(api.tasks.core.listTypes, {
        projectId: project._id,
      });

      expect(taskTypes.map((taskType) => taskType.key)).toEqual([
        "task",
        "bug",
        "feature",
        "epic",
        "investigation",
        "chore",
        "idea",
      ]);
      expect(taskTypes[0]).toEqual({
        key: "task",
        name: "Task",
        icon: "SquareCheckBig",
        color: "#64748b",
        isSystem: true,
      });
    });

    test("returns an empty catalog to unauthenticated and inaccessible callers", async () => {
      const ctx = createTestContext();
      const { project, t } = await ctx.setupProject();
      const outsider = await ctx.user();

      await expect(
        t.query(api.tasks.core.listTypes, { projectId: project._id })
      ).resolves.toEqual([]);
      await expect(
        ctx.asUser(outsider).query(api.tasks.core.listTypes, {
          projectId: project._id,
        })
      ).resolves.toEqual([]);
    });
  });

  test("should create a task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject({ project: { alias: "TEST" } });

    // Call the create mutation
    const createResult = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "My first task",
      priority: "Medium",
      status: "To Do",
      tags: ["test"],
      rank: gen.rank(),
    });
    const { taskId } = createResult;

    // Verify task was created
    expect(createResult).toEqual({
      taskId,
      projectId: project._id,
      organizationId: project.organizationId,
      projectAlias: "TEST",
      refNumber: 1,
      refId: "TEST-1",
    });

    // Query tasks and verify
    const tasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe("My first task");
    expect(tasks[0].priority).toBe("Medium");
    expect(tasks[0].status).toBe("To Do");
    expect(tasks[0].refId).toBe("TEST-1");
    expect(tasks[0].taskType.key).toBe("task");
    expect(tasks[0].taskType.name).toBe("Task");
    expect(tasks[0].tags).toEqual(["test"]);
    expect(tasks[0].createdByName).toBe(user.name);

    // Verify the dedicated counter advanced and the project doc was NOT
    // patched by task creation (OS-934 isolation property).
    await t.run(async (runCtx) => {
      const updatedProject = await runCtx.db.get("projects", project._id);
      expect(updatedProject?.updatedAt).toBe(project.updatedAt);

      const counter = await runCtx.db
        .query("taskRefCounters")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .unique();
      expect(counter?.nextRefNumber).toBe(2);

      if (!updatedProject?.defaultListId) {
        throw new Error("expected defaultListId");
      }
      const task = await runCtx.db.get("tasks", taskId);
      expect(task?.listKey).toBe(
        createPersistedTaskListKey(updatedProject.defaultListId)
      );
    });
  });

  describe("selected project Lists", () => {
    test("empty List selection reads and creates tasks in the current default List", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject({ project: { alias: "DEF" } });
      const originalDefaultListId = project.defaultListId;
      if (!originalDefaultListId) {
        throw new Error("expected defaultListId");
      }
      const sprintId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 12",
        ref: "SPRINT-12",
      });

      const { taskId: inboxTaskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Original default task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "a",
      });

      await asUser.mutation(api.tasks.lists.setDefault, { id: sprintId });

      const { taskId: sprintTaskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "New default task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
      });

      await t.run(async (runCtx) => {
        const inboxTask = await runCtx.db.get("tasks", inboxTaskId);
        const sprintTask = await runCtx.db.get("tasks", sprintTaskId);
        expect(inboxTask?.listKey).toBe(
          createPersistedTaskListKey(originalDefaultListId)
        );
        expect(sprintTask?.listKey).toBe(createPersistedTaskListKey(sprintId));
      });

      const defaultTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      expect(defaultTasks.map((task) => task.name)).toEqual(["New default task"]);
    });

    test("Backlog tasks are created in the system Backlog List", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();

      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Backlog task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "BACKLOG",
      });

      await t.run(async (runCtx) => {
        const task = await runCtx.db.get("tasks", taskId);
        expect(task?.status).toBe("To Do");
        expect(task?.listKey).toBe(BACKLOG_SYSTEM_LIST_KEY);
      });

      const backlogTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        listRef: "BACKLOG",
      });
      expect(backlogTasks.map((task) => task._id)).toEqual([taskId]);
      expect(backlogTasks[0].list).toEqual({
        type: "system",
        key: "backlog",
        ref: "BACKLOG",
        name: "Backlog",
      });
    });

    test("rejects Backlog as a workflow status input", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await expect(
        asUser.query(api.tasks.core.listByProject, {
          projectId: project._id,
          // @ts-expect-error Backlog is a system List ref, not a workflow status.
          status: "Backlog",
        })
      ).rejects.toThrow();

      await expect(
        asUser.mutation(api.tasks.core.create, {
          projectId: project._id,
          clientId: gen.clientId(),
          name: "Invalid Backlog status task",
          priority: "Medium",
          // @ts-expect-error Backlog is a system List ref, not a workflow status.
          status: "Backlog",
          tags: [],
        })
      ).rejects.toThrow();
    });

    test("creates and lists tasks in a selected List by id and ref", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject({ project: { alias: "LST" } });
      const listId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 1",
        ref: "SPRINT-1",
        color: "#3b82f6",
      });

      const { taskId: listedTaskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Listed task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
        listId,
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Unlisted task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "a",
      });

      await t.run(async (runCtx) => {
        const task = await runCtx.db.get("tasks", listedTaskId);
        expect(task?.listKey).toBe(createPersistedTaskListKey(listId));
      });

      const selectedTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "active",
        listId,
      });
      expect(selectedTasks.map((task) => task.name)).toEqual(["Listed task"]);
      expect(selectedTasks[0].list).toEqual({
        type: "list",
        id: listId,
        ref: "SPRINT-1",
        name: "Sprint 1",
        color: "#3b82f6",
        isArchived: false,
      });

      const normalTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      expect(normalTasks.map((task) => task.name)).toEqual(["Unlisted task"]);

      const selectedByRef = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "active",
        listRef: "SPRINT-1",
      });
      expect(selectedByRef.map((task) => task._id)).toEqual([listedTaskId]);
    });

    test("searches within a selected List by ref", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject({ project: { alias: "SEA" } });
      const sprintOneId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 1",
        ref: "SPRINT-1",
      });
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 2",
        ref: "SPRINT-2",
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Shared search term in sprint one",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "a",
        listRef: "SPRINT-1",
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Shared search term in sprint two",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
        listRef: "SPRINT-2",
      });

      const results = await asUser.query(api.tasks.core.search.byProject, {
        projectId: project._id,
        query: "shared search",
        archiveMode: "active",
        listId: sprintOneId,
        paginationOpts: { numItems: 10, cursor: null },
      });

      expect(results.page.map((task) => task.name)).toEqual([
        "Shared search term in sprint one",
      ]);
      const resultList = results.page[0].list;
      expect(resultList?.type === "list" ? resultList.ref : null).toBe("SPRINT-1");
    });

    test("rejects ambiguous List identifiers", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await expect(
        asUser.mutation(api.tasks.core.create, {
          projectId: project._id,
          clientId: gen.clientId(),
          name: "Ambiguous task",
          priority: "Medium",
          status: "To Do",
          tags: [],
          listId: "SPRINT",
          listRef: "SPRINT",
        })
      ).rejects.toThrow("Provide only one of listId or listRef");
    });

    test("rejects missing, archived, and cross-project List refs", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      const other = await ctx.setupProject();
      await other.asUser.mutation(api.tasks.lists.create, {
        projectId: other.project._id,
        name: "Other list",
        ref: "OTHER",
      });
      // Keep a second active List so archiving "OLD" does not violate the
      // at-least-one-active-List invariant.
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Keeper",
        ref: "KEEP",
      });
      const archivedListId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Old list",
        ref: "OLD",
      });
      await asUser.mutation(api.tasks.lists.archive, { id: archivedListId });

      for (const listRef of ["MISSING", "OLD", "OTHER"]) {
        await expect(
          asUser.mutation(api.tasks.core.create, {
            projectId: project._id,
            clientId: gen.clientId(),
            name: `Task in ${listRef}`,
            priority: "Medium",
            status: "To Do",
            tags: [],
            listRef,
          })
        ).rejects.toThrow("List not found");
      }
    });

    test("prevents cross-List subtasks inside Lists", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 1",
        ref: "SPRINT-1",
      });
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint 2",
        ref: "SPRINT-2",
      });

      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "SPRINT-1",
      });

      await expect(
        asUser.mutation(api.tasks.core.create, {
          projectId: project._id,
          parentId,
          clientId: gen.clientId(),
          name: "Wrong child",
          priority: "Medium",
          status: "To Do",
          tags: [],
          listRef: "SPRINT-2",
        })
      ).rejects.toThrow("same List");
    });

    test("moves selected roots and descendants to an existing List at the top", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject({ project: { alias: "MOV" } });
      const listId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });

      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Existing listed",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
        listRef: "SPRINT",
      });
      const { taskId: rootA } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Root A",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });
      const { taskId: childA } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId: rootA,
        clientId: gen.clientId(),
        name: "Child A",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });
      const { taskId: rootB } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Root B",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });

      const moveResult = await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [rootA, rootB],
        listId: "sprint",
      });
      expect(moveResult).toEqual({
        taskIds: expect.arrayContaining([rootA, rootB, childA]),
        list: {
          type: "list",
          id: listId,
          ref: "SPRINT",
          name: "Sprint",
          isDefault: false,
        },
      });

      const sprintTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        listRef: "SPRINT",
      });
      expect(sprintTasks.map((task) => task.name).sort()).toEqual([
        "Child A",
        "Existing listed",
        "Root A",
        "Root B",
      ]);
      expect(
        sprintTasks.filter((task) => task.parentId === null).map((task) => task.name)
      ).toEqual(["Root A", "Root B", "Existing listed"]);
      expect(sprintTasks.find((task) => task.name === "Child A")?.parentId).toBe(rootA);
      expect(sprintTasks.find((task) => task.name === "Root A")?.rank.localeCompare(
        sprintTasks.find((task) => task.name === "Root B")?.rank ?? ""
      )).toBeLessThan(0);

      const inboxTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      expect(inboxTasks).toEqual([]);
    });

    test("moveToList rejects overlapping moved roots", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId,
        clientId: gen.clientId(),
        name: "Child",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });

      await expect(
        asUser.mutation(api.tasks.core.move.toList, {
          rootIds: [parentId, childId],
          listRef: "SPRINT",
        })
      ).rejects.toThrow("Move roots cannot overlap");
    });

    test("moving a selected child detaches it and preserves its subtree", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId,
        clientId: gen.clientId(),
        name: "Child",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      const { taskId: grandchildId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId: childId,
        clientId: gen.clientId(),
        name: "Grandchild",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [childId],
        listRef: "SPRINT",
      });

      const sprintTasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        listRef: "SPRINT",
      });
      expect(sprintTasks.find((task) => task._id === childId)?.parentId).toBeNull();
      expect(sprintTasks.find((task) => task._id === grandchildId)?.parentId).toBe(childId);
      expect(sprintTasks.map((task) => task._id)).not.toContain(parentId);
    });

    test("moves Backlog tasks to a persisted List without changing workflow status", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId: backlogTaskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Backlog task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "BACKLOG",
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [backlogTaskId],
        listRef: "SPRINT",
      });

      await t.run(async (runCtx) => {
        const task = await runCtx.db.get("tasks", backlogTaskId);
        expect(task?.status).toBe("To Do");
        expect(task?.listKey).not.toBe(BACKLOG_SYSTEM_LIST_KEY);
      });
    });

    test("moving listed tasks to Backlog updates only List membership for the subtree", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "SPRINT",
      });
      const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId,
        clientId: gen.clientId(),
        name: "Child",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "SPRINT",
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [parentId],
        listRef: "BACKLOG",
      });

      await t.run(async (runCtx) => {
        const parent = await runCtx.db.get("tasks", parentId);
        const child = await runCtx.db.get("tasks", childId);
        expect(parent?.status).toBe("To Do");
        expect(parent?.listKey).toBe(BACKLOG_SYSTEM_LIST_KEY);
        expect(child?.status).toBe("To Do");
        expect(child?.listKey).toBe(BACKLOG_SYSTEM_LIST_KEY);
      });
    });

    test("moveToList rejects invalid tasks and target Lists", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      const other = await ctx.setupProject();
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      const { taskId: archivedTaskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Archived task",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      await other.asUser.mutation(api.tasks.lists.create, {
        projectId: other.project._id,
        name: "Other",
        ref: "OTHER",
      });
      const oldListId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Old",
        ref: "OLD",
      });
      await asUser.mutation(api.tasks.lists.archive, { id: oldListId });
      await asUser.mutation(api.tasks.core.archive, { id: archivedTaskId });

      for (const listRef of ["MISSING", "OLD", "OTHER"]) {
        await expect(
          asUser.mutation(api.tasks.core.move.toList, {
            rootIds: [taskId],
            listRef,
          })
        ).rejects.toThrow("List not found");
      }
      await expect(
        asUser.mutation(api.tasks.core.move.toList, {
          rootIds: [archivedTaskId],
          listRef: "SPRINT",
        })
      ).rejects.toThrow("Archived tasks cannot be assigned to Lists");
    });

    test("moveToList writes List activity details", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [taskId],
        listRef: "SPRINT",
      });

      await vi.waitFor(async () => {
        const logs = await asUser.query(api.tasks.activity.listByTask, {
          taskId,
          paginationOpts: { numItems: 20, cursor: null },
        });
        const listLog = logs.page.find((log) => log.eventType === "list_changed");
        expect(listLog?.changeDetails).toMatchObject({
          type: "list",
          newListRef: "SPRINT",
          newListName: "Sprint",
        });
      });
    });

    test("moving a listed task to Backlog logs Backlog as the next List location", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "SPRINT",
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [taskId],
        listRef: "BACKLOG",
      });

      await vi.waitFor(async () => {
        const logs = await asUser.query(api.tasks.activity.listByTask, {
          taskId,
          paginationOpts: { numItems: 20, cursor: null },
        });
        const listLog = logs.page.find((log) => log.eventType === "list_changed");
        expect(listLog?.changeDetails).toMatchObject({
          type: "list",
          oldListRef: "SPRINT",
          oldListName: "Sprint",
          newListSystem: "backlog",
        });
      });
    });

    test("moveToList preserves old List id in activity when old List row is gone", async () => {
      const ctx = createTestContext();
      const { project, asUser, t } = await ctx.setupProject();
      const oldListId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Old",
        ref: "OLD",
      });
      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
      });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", taskId, { listKey: `list:${oldListId}` });
        await runCtx.db.delete("taskLists", oldListId);
      });

      await asUser.mutation(api.tasks.core.move.toList, {
        rootIds: [taskId],
        listRef: "SPRINT",
      });

      await vi.waitFor(async () => {
        const logs = await asUser.query(api.tasks.activity.listByTask, {
          taskId,
          paginationOpts: { numItems: 20, cursor: null },
        });
        const listLog = logs.page.find((log) => log.eventType === "list_changed");
        expect(listLog?.changeDetails).toMatchObject({
          type: "list",
          oldListId,
          newListRef: "SPRINT",
          newListName: "Sprint",
        });
      });
    });
  });

  test("should create a task with description and include it in search index", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject({ project: { alias: "TEST" } });

    const description = "Investigate MCP description persistence bug";
    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Investigate MCP bug",
      description,
      priority: "Medium",
      status: "To Do",
      tags: ["mcp"],
      rank: gen.rank(),
    });

    await t.run(async (runCtx) => {
      const created = await runCtx.db.get("tasks", taskId);
      expect(created?.description).toBe(description);
    });

    const searchByDescription = await asUser.query(api.tasks.core.search.byProject, {
      projectId: project._id,
      query: "description persistence",
      archiveMode: "active",
      paginationOpts: { numItems: 8, cursor: null },
    });

    expect(searchByDescription.page.map((task) => task._id)).toContain(taskId);
  });

  test("should persist taskTypeKey on create without exposing it in public task payloads", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject({ project: { alias: "TEST" } });

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Typed task",
      taskTypeKey: "bug",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: gen.rank(),
    });

    await t.run(async (runCtx) => {
      const created = await runCtx.db.get("tasks", taskId);
      expect(created?.taskTypeKey).toBe("bug");
    });

    const task = await asUser.query(api.tasks.core.getById, { id: taskId });
    expect(task).toBeDefined();
    expect(task && "taskTypeKey" in task).toBe(false);
  });

  test("should create tasks with Triage and Plan Review statuses", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject({ project: { alias: "FLOW" } });

    const { taskId: triageTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Triage task",
      priority: "Medium",
      status: "Triage",
      tags: [],
      rank: gen.rank(),
    });

    const { taskId: planReviewTaskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Plan review task",
      priority: "Medium",
      status: "Plan Review",
      tags: [],
      rank: gen.rank(),
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });

    expect(tasks.find((task) => task._id === triageTaskId)?.status).toBe("Triage");
    expect(tasks.find((task) => task._id === planReviewTaskId)?.status).toBe(
      "Plan Review"
    );
  });

  test("should reject creating a task with a disabled project status", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject({ project: { alias: "FLOW" } });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, {
        disabledStatuses: ["Plan Review"],
      });
    });

    await expect(
      asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Blocked by config",
        priority: "Medium",
        status: "Plan Review",
        tags: [],
        rank: gen.rank(),
      })
    ).rejects.toThrow("disabled for this project");
  });

  test("should return empty array when not authenticated", async () => {
    const ctx = createTestContext();
    const { project, t } = await ctx.setupProject();

    // Query without authentication (using raw t instead of asUser)
    const tasks = await t.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });

    // Should return empty array (not throw)
    expect(tasks).toEqual([]);
  });

  test("should return tasks with assignee info", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    // Create task with assignee
    const task = await ctx.task(project._id, user._id, {
      name: "Assigned Task",
      assigneeId: user._id,
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]._id).toBe(task._id);
    expect(tasks[0].assignee).toEqual({
      type: "user",
      userId: user._id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
    });
    expect(tasks[0].createdByName).toBe(user.name);
  });

  test("should return empty for deleted project", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    await ctx.task(project._id, user._id);

    // Soft delete the project
    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, { isDeleted: true, deletedAt: Date.now() });
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });

    expect(tasks).toEqual([]);
  });
});

describe("tasks API key scope enforcement", () => {
  test("hides out-of-scope tasks from read paths", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });
    const allowedTask = await ctx.task(project._id, user._id, {
      name: "Allowed task",
    });
    const otherTask = await ctx.task(otherProject._id, user._id, {
      name: "Other task",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Scoped",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });

    const allowedTasks = await t.query(api.tasks.core.listByProject, {
      projectId: project._id,
      apiKey: key,
    });
    expect(allowedTasks.map((task) => task._id)).toContain(allowedTask._id);

    const outOfScopeTasks = await t.query(api.tasks.core.listByProject, {
      projectId: otherProject._id,
      apiKey: key,
    });
    expect(outOfScopeTasks).toEqual([]);

    const searchResult = await t.query(api.tasks.core.search.byProject, {
      projectId: otherProject._id,
      query: "Other",
      archiveMode: "active",
      paginationOpts: { numItems: 10, cursor: null },
      apiKey: key,
    });
    expect(searchResult.page).toEqual([]);

    const rawTask = await t.query(api.tasks.core.getById, {
      id: otherTask._id,
      apiKey: key,
    });
    expect(rawTask).toBeNull();
  });

  test("rejects out-of-scope task writes", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const otherProject = await ctx.project(org._id, user._id, {
      name: "Other",
      alias: "OTHR",
    });
    const otherTask = await ctx.task(otherProject._id, user._id, {
      name: "Other task",
    });
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "Scoped",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      scope: {
        organizationId: org._id,
        projectIds: [project._id],
      },
    });

    await expect(
      t.mutation(api.tasks.core.create, {
        projectId: otherProject._id,
        clientId: gen.clientId(),
        name: "Blocked create",
        priority: "Medium",
        status: "To Do",
        tags: [],
        apiKey: key,
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      t.mutation(api.tasks.core.update, {
        id: otherTask._id,
        name: "Blocked update",
        apiKey: key,
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      t.mutation(api.tasks.core.remove, {
        id: otherTask._id,
        apiKey: key,
      })
    ).rejects.toThrow("Permission denied");
  });
});

describe("subtasks", () => {
  describe("create with parentId", () => {
    test("should create a subtask under a parent", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      // Create parent task via API
      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });

      // Create child task with parentId
      const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId,
        clientId: gen.clientId(),
        name: "Child Task",
        priority: "Low",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });

      // Verify child has correct parentId
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const child = tasks.find((t) => t._id === childId);

      expect(child).toBeDefined();
      expect(child?.parentId).toBe(parentId);
    });

    test("should reject parentId from different project", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser } = await ctx.setupProject();

      // Create a second project
      const project2 = await ctx.project(org._id, user._id, { alias: "PR2" });

      // Create parent in project 1
      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent Task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: gen.rank(),
      });

      // Try to create child in project 2 with parent from project 1
      await expect(
        asUser.mutation(api.tasks.core.create, {
          projectId: project2._id,
          parentId,
          clientId: gen.clientId(),
          name: "Child Task",
          priority: "Low",
          status: "To Do",
          tags: [],
          rank: gen.rank(),
        })
      ).rejects.toThrow("Parent task must be in the same project");
    });

    test("should reject non-existent parentId", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      // Try to create child with invalid parentId
      await expect(
        asUser.mutation(api.tasks.core.create, {
          projectId: project._id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parentId: "invalid_id" as any,
          clientId: gen.clientId(),
          name: "Child Task",
          priority: "Low",
          status: "To Do",
          tags: [],
          rank: gen.rank(),
        })
      ).rejects.toThrow();
    });
  });

  describe("listByParent", () => {
    test("should return only direct children", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create parent -> child -> grandchild using fixtures
      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      const child = await ctx.task(project._id, user._id, {
        name: "Child",
        parentId: parent._id,
      });
      await ctx.task(project._id, user._id, {
        name: "Grandchild",
        parentId: child._id,
      });

      // listByParent(parent) should return only child, not grandchild
      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toHaveLength(1);
      expect(children[0]._id).toBe(child._id);
      expect(children[0].name).toBe("Child");
    });

    test("should return empty array for task without children", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create task with no children
      const task = await ctx.task(project._id, user._id, { name: "Lone Task" });

      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: task._id,
      });

      expect(children).toEqual([]);
    });

    test("should not return deleted children", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      // Create parent with 2 children
      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      const child1 = await ctx.task(project._id, user._id, {
        name: "Child 1",
        parentId: parent._id,
      });
      const child2 = await ctx.task(project._id, user._id, {
        name: "Child 2",
        parentId: parent._id,
      });

      // Soft-delete one child directly
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", child1._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      // listByParent should return only the non-deleted child
      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toHaveLength(1);
      expect(children[0]._id).toBe(child2._id);
    });

    test("should return children with assignee info", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      const child = await ctx.task(project._id, user._id, {
        name: "Assigned Child",
        parentId: parent._id,
        assigneeId: user._id,
      });

      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toHaveLength(1);
      expect(children[0]._id).toBe(child._id);
      expect(children[0].assignee).toEqual({
        type: "user",
        userId: user._id,
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
      });
      expect(children[0].createdByName).toBe(user.name);
    });

    test("should return empty when parent is deleted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      await ctx.task(project._id, user._id, {
        name: "Child",
        parentId: parent._id,
      });

      // Soft-delete the parent
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", parent._id, { isDeleted: true, deletedAt: Date.now() });
      });

      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toEqual([]);
    });

    test("should return empty when project is deleted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      await ctx.task(project._id, user._id, {
        name: "Child",
        parentId: parent._id,
      });

      // Soft-delete the project
      await t.run(async (runCtx) => {
        await runCtx.db.patch("projects", project._id, { isDeleted: true, deletedAt: Date.now() });
      });

      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toEqual([]);
    });
  });

  describe("updateParent", () => {
    test("should move task to new parent", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create task and new parent
      const task = await ctx.task(project._id, user._id, { name: "Task" });
      const newParent = await ctx.task(project._id, user._id, { name: "New Parent" });

      // Move task under new parent
      await asUser.mutation(api.tasks.core.move.toParent, {
        id: task._id,
        parentId: newParent._id,
        rank: gen.rank(),
      });

      // Verify parentId changed
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const updatedTask = tasks.find((t) => t._id === task._id);

      expect(updatedTask?.parentId).toBe(newParent._id);
    });

    test("should accept apiKey authentication", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id, { name: "Task" });
      const newParent = await ctx.task(project._id, user._id, { name: "New Parent" });
      const { key } = await asUser.mutation(api.apiKeys.core.create, {
        name: "Move Task",
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      await ctx.t.mutation(api.tasks.core.move.toParent, {
        id: task._id,
        parentId: newParent._id,
        apiKey: key,
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const updatedTask = tasks.find((candidate) => candidate._id === task._id);

      expect(updatedTask?.parentId).toBe(newParent._id);
    });

    test("should make subtask top-level when parentId is null", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create parent and subtask
      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      const subtask = await ctx.task(project._id, user._id, {
        name: "Subtask",
        parentId: parent._id,
      });

      // Make subtask top-level
      await asUser.mutation(api.tasks.core.move.toParent, {
        id: subtask._id,
        parentId: null,
        rank: gen.rank(),
      });

      // Verify parentId is null (top-level)
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const updatedSubtask = tasks.find((t) => t._id === subtask._id);

      expect(updatedSubtask?.parentId).toBeNull();
    });

    test("should append to end of new parent's children when rank is omitted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      let childRank = LexoRank.middle();
      await ctx.task(project._id, user._id, {
        name: "Child A",
        parentId: parent._id,
        rank: childRank.toString(),
      });
      childRank = childRank.genNext();
      await ctx.task(project._id, user._id, {
        name: "Child B",
        parentId: parent._id,
        rank: childRank.toString(),
      });
      const movedTask = await ctx.task(project._id, user._id, {
        name: "Moved",
        rank: LexoRank.middle().genNext().genNext().toString(),
      });

      await asUser.mutation(api.tasks.core.move.toParent, {
        id: movedTask._id,
        parentId: parent._id,
      });

      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children.map((task) => task.name)).toEqual(["Child A", "Child B", "Moved"]);
    });

    test("should append to end of top-level roots when rank is omitted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      let rootRank = LexoRank.middle();
      await ctx.task(project._id, user._id, {
        name: "Root A",
        rank: rootRank.toString(),
      });
      rootRank = rootRank.genNext();
      await ctx.task(project._id, user._id, {
        name: "Root B",
        rank: rootRank.toString(),
      });

      const parent = await ctx.task(project._id, user._id, {
        name: "Parent",
        rank: rootRank.genNext().toString(),
      });
      const movedTask = await ctx.task(project._id, user._id, {
        name: "Moved",
        parentId: parent._id,
        rank: LexoRank.middle().toString(),
      });

      await asUser.mutation(api.tasks.core.move.toParent, {
        id: movedTask._id,
        parentId: null,
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const rootNames = tasks.filter((task) => !task.parentId).map((task) => task.name);

      expect(rootNames).toEqual(["Root A", "Root B", "Parent", "Moved"]);
    });

    test("should no-op when parent is unchanged and rank is omitted", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      const child = await ctx.task(project._id, user._id, {
        name: "Child",
        parentId: parent._id,
        rank: LexoRank.middle().toString(),
      });

      const beforeLogs = await asUser.query(api.tasks.activity.listByTask, {
        taskId: child._id,
        paginationOpts: {
          numItems: 10,
          cursor: null,
        },
      });

      await asUser.mutation(api.tasks.core.move.toParent, {
        id: child._id,
        parentId: parent._id,
      });

      const updatedChild = await asUser.query(api.tasks.core.getById, {
        id: child._id,
      });
      const afterLogs = await asUser.query(api.tasks.activity.listByTask, {
        taskId: child._id,
        paginationOpts: {
          numItems: 10,
          cursor: null,
        },
      });

      expect(updatedChild?.parentId).toBe(parent._id);
      expect(updatedChild?.rank).toBe(child.rank);
      expect(afterLogs.page).toEqual(beforeLogs.page);
    });

    test("should reject setting parent to self", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id, { name: "Task" });

      await expect(
        asUser.mutation(api.tasks.core.move.toParent, {
          id: task._id,
          parentId: task._id,
          rank: gen.rank(),
        })
      ).rejects.toThrow("Cannot set a task as its own parent");
    });

    test("should reject setting parent to descendant (circular reference)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A -> B -> C
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      const taskC = await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskB._id,
      });

      // Try to set A's parent to C (its grandchild)
      await expect(
        asUser.mutation(api.tasks.core.move.toParent, {
          id: taskA._id,
          parentId: taskC._id,
          rank: gen.rank(),
        })
      ).rejects.toThrow("Cannot set parent to a descendant");
    });

    test("should reject parent from different project", async () => {
      const ctx = createTestContext();
      const { project, user, org, asUser } = await ctx.setupProject();

      // Create a second project
      const project2 = await ctx.project(org._id, user._id, { alias: "PR2" });

      // Create task in project 1
      const task = await ctx.task(project._id, user._id, { name: "Task" });

      // Create parent in project 2
      const parentInProject2 = await ctx.task(project2._id, user._id, {
        name: "Parent in Project 2",
      });

      // Try to set parent to task in different project
      await expect(
        asUser.mutation(api.tasks.core.move.toParent, {
          id: task._id,
          parentId: parentInProject2._id,
          rank: gen.rank(),
        })
      ).rejects.toThrow("Parent task must be in the same project");
    });
  });

  describe("outdent positioning", () => {
    test("outdented task should be positioned after former parent (single task)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A, A->B (subtask), C with specific ranks
      const rankA = LexoRank.middle();
      const rankC = rankA.genNext();

      const taskA = await ctx.task(project._id, user._id, {
        name: "A",
        rank: rankA.toString(),
      });
      const taskB = await ctx.task(project._id, user._id, {
        name: "B",
        parentId: taskA._id,
        rank: LexoRank.middle().toString(),
      });
      const taskC = await ctx.task(project._id, user._id, {
        name: "C",
        rank: rankC.toString(),
      });

      // Calculate rank between A and C (simulating frontend calculation)
      const newRank = rankA.between(rankC).toString();

      // Outdent B to root level, positioned after A
      await asUser.mutation(api.tasks.core.move.toParent, {
        id: taskB._id,
        parentId: null,
        rank: newRank,
      });

      // Verify order: A, B, C
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const rootTasks = tasks.filter((t) => !t.parentId);
      const names = rootTasks.map((t) => t.name);

      expect(names).toEqual(["A", "B", "C"]);
    });

    test("outdented tasks should preserve order (multi-selection)", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A with subtasks B, C, D; then E at root
      const rankA = LexoRank.middle();
      const rankE = rankA.genNext();

      const taskA = await ctx.task(project._id, user._id, {
        name: "A",
        rank: rankA.toString(),
      });
      const taskE = await ctx.task(project._id, user._id, {
        name: "E",
        rank: rankE.toString(),
      });

      // Subtasks of A
      let subtaskRank = LexoRank.middle();
      const taskB = await ctx.task(project._id, user._id, {
        name: "B",
        parentId: taskA._id,
        rank: subtaskRank.toString(),
      });
      subtaskRank = subtaskRank.genNext();
      const taskC = await ctx.task(project._id, user._id, {
        name: "C",
        parentId: taskA._id,
        rank: subtaskRank.toString(),
      });
      subtaskRank = subtaskRank.genNext();
      const taskD = await ctx.task(project._id, user._id, {
        name: "D",
        parentId: taskA._id,
        rank: subtaskRank.toString(),
      });

      // Outdent B, C, D with ranks between A and E (simulating frontend bulk outdent)
      let prevRank = rankA;
      const nextRank = rankE;

      for (const task of [taskB, taskC, taskD]) {
        const newRank = prevRank.between(nextRank);
        await asUser.mutation(api.tasks.core.move.toParent, {
          id: task._id,
          parentId: null,
          rank: newRank.toString(),
        });
        prevRank = newRank;
      }

      // Verify order: A, B, C, D, E
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const rootTasks = tasks.filter((t) => !t.parentId);
      const names = rootTasks.map((t) => t.name);

      expect(names).toEqual(["A", "B", "C", "D", "E"]);
    });
  });

  describe("remove with cascadeMode", () => {
    test("delete_all should delete parent and all descendants", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      // Create: A -> B -> C
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      const taskC = await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskB._id,
      });

      // Remove A with cascadeMode: "delete_all"
      const result = await asUser.mutation(api.tasks.core.remove, {
        id: taskA._id,
        cascadeMode: "delete_all",
      });
      expect(new Set(result.deletedIds)).toEqual(
        new Set([taskA._id, taskB._id, taskC._id])
      );

      // Verify A, B, C are all soft-deleted (not returned by listByProject)
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      expect(tasks).toHaveLength(0);

      // Verify they are marked as deleted in DB
      await t.run(async (runCtx) => {
        const a = await runCtx.db.get("tasks", taskA._id);
        const b = await runCtx.db.get("tasks", taskB._id);
        const c = await runCtx.db.get("tasks", taskC._id);

        expect(a?.isDeleted).toBe(true);
        expect(b?.isDeleted).toBe(true);
        expect(c?.isDeleted).toBe(true);
      });
    });

    test("keep_children should promote children to grandparent", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      // Create: A -> B -> C
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      const taskC = await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskB._id,
      });

      // Remove B with cascadeMode: "keep_children"
      const result = await asUser.mutation(api.tasks.core.remove, {
        id: taskB._id,
        cascadeMode: "keep_children",
      });
      expect(result.deletedIds).toEqual([taskB._id]);

      // Verify B is deleted
      await t.run(async (runCtx) => {
        const b = await runCtx.db.get("tasks", taskB._id);
        expect(b?.isDeleted).toBe(true);
      });

      // Verify C's parentId is now A
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const c = tasks.find((t) => t._id === taskC._id);

      expect(c?.parentId).toBe(taskA._id);
    });

    test("keep_children should make children top-level if no grandparent", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      // Create: A -> B (no grandparent)
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });

      // Remove A with cascadeMode: "keep_children"
      const result = await asUser.mutation(api.tasks.core.remove, {
        id: taskA._id,
        cascadeMode: "keep_children",
      });
      expect(result.deletedIds).toEqual([taskA._id]);

      // Verify A is deleted
      await t.run(async (runCtx) => {
        const a = await runCtx.db.get("tasks", taskA._id);
        expect(a?.isDeleted).toBe(true);
      });

      // Verify B's parentId is null (top-level)
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const b = tasks.find((t) => t._id === taskB._id);

      expect(b?.parentId).toBeNull();
    });

    test("keep_children delete then restore keeps promoted child hierarchy", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A -> B -> C
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      const taskC = await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskB._id,
      });

      // Delete B using keep_children (C is promoted to A)
      const deleteResult = await asUser.mutation(api.tasks.core.remove, {
        id: taskB._id,
        cascadeMode: "keep_children",
      });
      expect(deleteResult.deletedIds).toEqual([taskB._id]);

      // Undo by restoring each deleted ID from mutation result
      await Promise.all(
        deleteResult.deletedIds.map((id) =>
          asUser.mutation(api.tasks.core.restore, { id })
        )
      );

      // Parent task is restored, but promoted child remains under grandparent
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });

      const restoredB = tasks.find((t) => t._id === taskB._id);
      const childC = tasks.find((t) => t._id === taskC._id);

      expect(restoredB?.parentId).toBe(taskA._id);
      expect(childC?.parentId).toBe(taskA._id);
    });

    test("should return empty deletedIds for already deleted tasks", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id, { name: "Task A" });

      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", task._id, {
          isDeleted: true,
          deletedAt: Date.now(),
        });
      });

      const result = await asUser.mutation(api.tasks.core.remove, { id: task._id });
      expect(result.deletedIds).toEqual([]);
    });
  });

  describe("duplicate", () => {
    test("should copy task and all descendants", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A -> B -> C
      const taskA = await ctx.task(project._id, user._id, {
        name: "Task A",
        priority: "High",
        status: "In Progress",
        tags: ["important"],
      });
      const taskB = await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskB._id,
      });

      // Duplicate A
      const newAId = await asUser.mutation(api.tasks.core.duplicate, {
        id: taskA._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      });

      // Verify new A', B', C' exist
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });

      // Should have 6 tasks now (3 original + 3 duplicates)
      expect(tasks).toHaveLength(6);

      // Find the duplicated root
      const newA = tasks.find((t) => t._id === newAId);
      expect(newA).toBeDefined();
      expect(newA?.name).toBe("Task A");
      expect(newA?.priority).toBe("High");
      expect(newA?.tags).toEqual(["important"]);
    });

    test("should assign new refNumbers to copies", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create original task
      const original = await ctx.task(project._id, user._id, { name: "Original" });

      // Duplicate
      const copyId = await asUser.mutation(api.tasks.core.duplicate, {
        id: original._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      });

      // Verify copies have unique refNumbers
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const originalTask = tasks.find((t) => t._id === original._id);
      const copyTask = tasks.find((t) => t._id === copyId);

      expect(originalTask?.refNumber).toBe(1);
      expect(copyTask?.refNumber).toBe(2);
    });

    test("should preserve split assignment in copies", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();
      const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
        projectId: project._id,
        ...validProjectAgentInput,
      });
      const original = await ctx.task(project._id, user._id, { name: "Original" });
      await asUser.mutation(api.tasks.core.update, {
        id: original._id,
        delegatedToAgentId: projectAgentId,
      });

      const copyId = await asUser.mutation(api.tasks.core.duplicate, {
        id: original._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      });

      await t.run(async (runCtx) => {
        const copy = await runCtx.db.get("tasks", copyId);
        expect(copy?.delegatedToAgentId).toBe(projectAgentId);
        // Delegating the ownerless original auto-set the acting user as owner.
        expect(copy?.assigneeId).toBe(user._id);
      });
    });

    test("should preserve hierarchy in copies", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      // Create: A -> B, A -> C
      const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
      await ctx.task(project._id, user._id, {
        name: "Task B",
        parentId: taskA._id,
      });
      await ctx.task(project._id, user._id, {
        name: "Task C",
        parentId: taskA._id,
      });

      // Duplicate A
      const newAId = await asUser.mutation(api.tasks.core.duplicate, {
        id: taskA._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      });

      // Verify A' -> B', A' -> C'
      const children = await asUser.query(api.tasks.core.listByParent, {
        parentId: newAId,
      });

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.name).sort()).toEqual(["Task B", "Task C"]);
      expect(children.every((c) => c.parentId === newAId)).toBe(true);
    });
  });
});

describe("update", () => {
  test("should update name", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { name: "Original" });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      name: "Updated Name",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.name).toBe("Updated Name");
    });
  });

  test("should update description", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      description: "New description",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.description).toBe("New description");
    });
  });

  test("should update priority", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { priority: "Medium" });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      priority: "Critical",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.priority).toBe("Critical");
    });
  });

  test("should update status", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { status: "To Do" });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      status: "Done",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.status).toBe("Done");
    });
  });

  test("should update taskTypeKey without exposing it in public task payloads", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { name: "Typed task" });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      taskTypeKey: "feature",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.taskTypeKey).toBe("feature");
    });

    const fetched = await asUser.query(api.tasks.core.getById, { id: task._id });
    expect(fetched).toBeDefined();
    expect(fetched && "taskTypeKey" in fetched).toBe(false);
  });

  test("should reject updating a task to a disabled project status", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { status: "To Do" });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, {
        disabledStatuses: ["Plan Review"],
      });
    });

    await expect(
      asUser.mutation(api.tasks.core.update, {
        id: task._id,
        status: "Plan Review",
      })
    ).rejects.toThrow("disabled for this project");
  });

  test("should update rank", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { rank: "0|hzzzzz:" });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      rank: "0|100000:",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.rank).toBe("0|100000:");
    });
  });

  test("should apply status and rank in one mutation", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, {
      status: "To Do",
      rank: "0|hzzzzz:",
    });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      status: "In Progress",
      rank: "0|100000:",
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.status).toBe("In Progress");
      expect(updated?.rank).toBe("0|100000:");
    });
  });

  test("should not apply rank when the status change is rejected", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, {
      status: "To Do",
      rank: "0|hzzzzz:",
    });

    await t.run(async (runCtx) => {
      await runCtx.db.patch("projects", project._id, {
        disabledStatuses: ["Plan Review"],
      });
    });

    await expect(
      asUser.mutation(api.tasks.core.update, {
        id: task._id,
        status: "Plan Review",
        rank: "0|100000:",
      })
    ).rejects.toThrow("disabled for this project");

    await t.run(async (runCtx) => {
      const unchanged = await runCtx.db.get("tasks", task._id);
      expect(unchanged?.status).toBe("To Do");
      expect(unchanged?.rank).toBe("0|hzzzzz:");
    });
  });

  test("should update the assignee (human owner)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      assigneeId: user._id,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.assigneeId).toBe(user._id);
    });
  });

  test("should create and return a typed user assignee", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Typed user assignment",
      priority: "Medium",
      status: "To Do",
      tags: [],
      assigneeId: user._id,
    });

    await t.run(async (runCtx) => {
      const task = await runCtx.db.get("tasks", taskId);
      expect(task?.assigneeId).toBe(user._id);
    });

    const fetched = await asUser.query(api.tasks.core.getById, { id: taskId });
    expect(fetched?.assignee).toEqual({
      type: "user",
      userId: user._id,
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
    });
  });

  test("should create, return, and clear a delegated Project agent", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Agent assignment",
      priority: "Medium",
      status: "To Do",
      tags: [],
      assigneeId: null,
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const task = await runCtx.db.get("tasks", taskId);
      expect(task?.delegatedToAgentId).toBe(projectAgentId);
      // Explicit assigneeId: null keeps the delegated task ownerless.
      expect(task?.assigneeId).toBeUndefined();
    });

    const assigned = await asUser.query(api.tasks.core.getById, { id: taskId });
    expect(assigned?.delegatedToAgent).toEqual({
      type: "projectAgent",
      projectAgentId,
      name: validProjectAgentInput.name,
      appearance: validProjectAgentInput.appearance,
      isDeleted: false,
    });
    expect(assigned?.assignee).toBeNull();

    await asUser.mutation(api.tasks.core.update, {
      id: taskId,
      delegatedToAgentId: null,
    });

    await t.run(async (runCtx) => {
      const task = await runCtx.db.get("tasks", taskId);
      expect(task?.delegatedToAgentId).toBeUndefined();
    });

    const cleared = await asUser.query(api.tasks.core.getById, { id: taskId });
    expect(cleared?.delegatedToAgent).toBeNull();
  });

  test("should deny Project-agent assignment for project viewers", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });
    const task = await ctx.task(project._id, user._id);

    await expect(
      asViewer.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Viewer assigned task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        delegatedToAgentId: projectAgentId,
      })
    ).rejects.toThrow("Permission denied");

    await expect(
      asViewer.mutation(api.tasks.core.update, {
        id: task._id,
        delegatedToAgentId: projectAgentId,
      })
    ).rejects.toThrow("Permission denied");
  });

  test("should preserve stale Project-agent assignee display after Project agent deletion", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
    });

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Stale agent assignment",
      priority: "Medium",
      status: "To Do",
      tags: [],
      delegatedToAgentId: projectAgentId,
    });

    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, {
      projectAgentId,
    });

    const fetched = await asUser.query(api.tasks.core.getById, { id: taskId });
    expect(fetched?.delegatedToAgent).toMatchObject({
      type: "projectAgent",
      projectAgentId,
      name: "Deleted agent",
      isDeleted: true,
    });
  });

  test("should reject assigning a Project agent from another project or a deleted Project agent", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();
    const other = await ctx.setupProject();
    const otherProjectAgentId = await other.asUser.mutation(api.agents.projectAgents.create, {
      projectId: other.project._id,
      ...validProjectAgentInput,
    });
    const projectAgentId = await asUser.mutation(api.agents.projectAgents.create, {
      projectId: project._id,
      ...validProjectAgentInput,
      name: "Deleted Agent",
    });
    await asUser.mutation(api.agents.projectAgents.deleteProjectAgent, {
      projectAgentId,
    });
    const task = await ctx.task(project._id, other.user._id);

    await expect(
      asUser.mutation(api.tasks.core.update, {
        id: task._id,
        delegatedToAgentId: otherProjectAgentId,
      })
    ).rejects.toThrow("Project agent assignee must belong to the task's project");

    await expect(
      asUser.mutation(api.tasks.core.update, {
        id: task._id,
        delegatedToAgentId: projectAgentId,
      })
    ).rejects.toThrow("Project agent assignee not found");
  });

  test("should update tags", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { tags: ["old"] });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      tags: ["new", "updated"],
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.tags).toEqual(["new", "updated"]);
    });
  });

  test("should update dueDate", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);
    const dueDate = Date.now() + 86400000; // Tomorrow

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      dueDate,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.dueDate).toBe(dueDate);
    });
  });

  test("should clear optional fields (null)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const dueDate = Date.now();
    const task = await ctx.task(project._id, user._id, {
      description: "Some description",
      dueDate,
      assigneeId: user._id,
    });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      description: null,
      dueDate: null,
      assigneeId: null,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.description).toBeUndefined();
      expect(updated?.dueDate).toBeUndefined();
      expect(updated?.assigneeId).toBeUndefined();
    });
  });

  test("should reject non-existent task", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.core.update, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: "invalid_id" as any,
        name: "Test",
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
      asUser.mutation(api.tasks.core.update, {
        id: task._id,
        name: "Test",
      })
    ).rejects.toThrow("Task not found");
  });
});

describe("restore", () => {
  test("should restore deleted task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Soft delete via mutation (to get scheduled deletion)
    await asUser.mutation(api.tasks.core.remove, { id: task._id });

    // Verify it's deleted
    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("tasks", task._id);
      expect(deleted?.isDeleted).toBe(true);
      expect(deleted?.scheduledDeletionId).toBeDefined();
    });

    // Restore
    await asUser.mutation(api.tasks.core.restore, { id: task._id });

    // Verify restored
    await t.run(async (runCtx) => {
      const restored = await runCtx.db.get("tasks", task._id);
      expect(restored?.isDeleted).toBe(false);
      expect(restored?.deletedAt).toBeUndefined();
      expect(restored?.deletedBy).toBeUndefined();
      expect(restored?.scheduledDeletionId).toBeUndefined();
    });
  });

  test("should be idempotent on non-deleted", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Restore non-deleted task should not throw
    const result = await asUser.mutation(api.tasks.core.restore, { id: task._id });
    expect(result).toBeNull();
  });

  test("should throw for non-existent task", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.core.restore, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: "invalid_id" as any,
      })
    ).rejects.toThrow();
  });
});

describe("archive", () => {
  test("should archive a task successfully", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    const result = await asUser.mutation(api.tasks.core.archive, { id: task._id });
    expect(result).toEqual({ archivedRootIds: [task._id] });

    await t.run(async (runCtx) => {
      const archived = await runCtx.db.get("tasks", task._id);
      expect(archived?.isArchived).toBe(true);
      expect(archived?.archivedAt).toBeDefined();
      expect(archived?.archivedBy).toBe(user._id);
    });
  });

  test("should archive parent and all descendants (cascade)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create: A -> B -> C
    const taskA = await ctx.task(project._id, user._id, { name: "Task A" });
    const taskB = await ctx.task(project._id, user._id, {
      name: "Task B",
      parentId: taskA._id,
    });
    const taskC = await ctx.task(project._id, user._id, {
      name: "Task C",
      parentId: taskB._id,
    });

    // Archive A - should cascade to B and C
    const result = await asUser.mutation(api.tasks.core.archive, { id: taskA._id });
    expect(result).toEqual({ archivedRootIds: [taskA._id] });

    await t.run(async (runCtx) => {
      const a = await runCtx.db.get("tasks", taskA._id);
      const b = await runCtx.db.get("tasks", taskB._id);
      const c = await runCtx.db.get("tasks", taskC._id);

      expect(a?.isArchived).toBe(true);
      expect(b?.isArchived).toBe(true);
      expect(c?.isArchived).toBe(true);
    });
  });

  test("should be idempotent (archiving already archived task returns null)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Archive once
    await asUser.mutation(api.tasks.core.archive, { id: task._id });

    // Archive again - should not throw
    const result = await asUser.mutation(api.tasks.core.archive, { id: task._id });
    expect(result).toEqual({ archivedRootIds: [] });

    // Should still be archived
    await t.run(async (runCtx) => {
      const archived = await runCtx.db.get("tasks", task._id);
      expect(archived?.isArchived).toBe(true);
    });
  });

  test("should return null for deleted tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Delete the task
    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, { isDeleted: true, deletedAt: Date.now() });
    });

    // Archive should return null (not throw)
    const result = await asUser.mutation(api.tasks.core.archive, { id: task._id });
    expect(result).toEqual({ archivedRootIds: [] });

    // Should NOT be archived
    await t.run(async (runCtx) => {
      const dbTask = await runCtx.db.get("tasks", task._id);
      expect(dbTask?.isArchived).toBe(false);
    });
  });

  test("should reject unauthorized access", async () => {
    const ctx = createTestContext();

    // User 1 has a task
    const { project, user } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    // User 2 tries to archive it
    const { asUser: asUser2 } = await ctx.setupUser();

    await expect(
      asUser2.mutation(api.tasks.core.archive, { id: task._id })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("should detach and archive a subtask directly", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    const result = await asUser.mutation(api.tasks.core.archive, { id: child._id });
    expect(result).toEqual({ archivedRootIds: [child._id] });

    await t.run(async (runCtx) => {
      const parentTask = await runCtx.db.get("tasks", parent._id);
      const childTask = await runCtx.db.get("tasks", child._id);
      expect(parentTask?.isArchived).toBe(false);
      expect(childTask?.isArchived).toBe(true);
      expect(childTask?.parentId).toBeUndefined();
      expect(childTask?.archivedAt).toBeDefined();
      expect(childTask?.archivedBy).toBe(user._id);
    });
  });

  test("should archive direct subtask descendants without detaching them", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });
    const grandchild = await ctx.task(project._id, user._id, {
      name: "Grandchild",
      parentId: child._id,
    });

    const result = await asUser.mutation(api.tasks.core.archive, { id: child._id });
    expect(result).toEqual({ archivedRootIds: [child._id] });

    await t.run(async (runCtx) => {
      const parentTask = await runCtx.db.get("tasks", parent._id);
      const childTask = await runCtx.db.get("tasks", child._id);
      const grandchildTask = await runCtx.db.get("tasks", grandchild._id);

      expect(parentTask?.isArchived).toBe(false);
      expect(childTask?.isArchived).toBe(true);
      expect(childTask?.parentId).toBeUndefined();
      expect(grandchildTask?.isArchived).toBe(true);
      expect(grandchildTask?.parentId).toBe(child._id);
    });
  });

  test("should unarchive a directly archived subtask as a root task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    await asUser.mutation(api.tasks.core.archive, { id: child._id });
    await asUser.mutation(api.tasks.core.unarchive, { id: child._id });

    await t.run(async (runCtx) => {
      const parentTask = await runCtx.db.get("tasks", parent._id);
      const childTask = await runCtx.db.get("tasks", child._id);

      expect(parentTask?.isArchived).toBe(false);
      expect(childTask?.isArchived).toBe(false);
      expect(childTask?.parentId).toBeUndefined();
      expect(childTask?.archivedAt).toBeUndefined();
      expect(childTask?.archivedBy).toBeUndefined();
    });
  });

  test("should keep parent active and exclude detached archived subtask from active subtasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    await asUser.mutation(api.tasks.core.archive, { id: child._id });

    const activeTasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
      archiveFilter: "active",
    });

    const activeParent = activeTasks.find((task) => task._id === parent._id);
    expect(activeParent?.isArchived).toBe(false);
    expect(activeTasks.map((task) => task._id)).not.toContain(child._id);
    expect(activeTasks.some((task) => task.parentId === parent._id)).toBe(false);
  });
});

describe("unarchive", () => {
  test("should unarchive a task successfully", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Archive first
    await asUser.mutation(api.tasks.core.archive, { id: task._id });

    // Unarchive
    await asUser.mutation(api.tasks.core.unarchive, { id: task._id });

    await t.run(async (runCtx) => {
      const unarchived = await runCtx.db.get("tasks", task._id);
      expect(unarchived?.isArchived).toBe(false);
      expect(unarchived?.archivedAt).toBeUndefined();
      expect(unarchived?.archivedBy).toBeUndefined();
    });
  });

  test("should be idempotent (unarchiving non-archived task returns null)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Unarchive non-archived task - should not throw
    const result = await asUser.mutation(api.tasks.core.unarchive, { id: task._id });
    expect(result).toBeNull();
  });

  test("unarchiving a task whose List was deleted moves it to the default List", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const listId = await asUser.mutation(api.tasks.lists.create, {
      projectId: project._id,
      name: "Sprint 1",
      ref: "SPRINT-1",
    });
    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: "task-1",
      name: "Doomed List task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      listRef: "SPRINT-1",
    });

    await asUser.mutation(api.tasks.core.archive, { id: taskId });
    await asUser.mutation(api.tasks.lists.remove, { id: listId });
    await asUser.mutation(api.tasks.core.unarchive, { id: taskId });

    await t.run(async (runCtx) => {
      const unarchived = await runCtx.db.get("tasks", taskId);
      expect(unarchived?.isArchived).toBe(false);
      expect(unarchived?.listKey).toBe(`list:${project.defaultListId}`);
    });
  });

  test("should throw for non-existent task", async () => {
    const ctx = createTestContext();
    const { asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.core.unarchive, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: "invalid_id" as any,
      })
    ).rejects.toThrow();
  });

  test("should reject unauthorized access", async () => {
    const ctx = createTestContext();

    // User 1 has an archived task
    const { project, user, asUser: asUser1 } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    await asUser1.mutation(api.tasks.core.archive, { id: task._id });

    // User 2 tries to unarchive it
    const { asUser: asUser2 } = await ctx.setupUser();

    await expect(
      asUser2.mutation(api.tasks.core.unarchive, { id: task._id })
    ).rejects.toThrow("Not a member of this organization");
  });

  test("should skip subtasks (only top-level tasks can be unarchived directly)", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    // Create parent and child, then archive parent (which cascades to child)
    const parent = await ctx.task(project._id, user._id, { name: "Parent" });
    const child = await ctx.task(project._id, user._id, {
      name: "Child",
      parentId: parent._id,
    });

    // Archive the parent (cascades to child)
    await asUser.mutation(api.tasks.core.archive, { id: parent._id });

    // Verify both are archived
    await t.run(async (runCtx) => {
      const parentTask = await runCtx.db.get("tasks", parent._id);
      const childTask = await runCtx.db.get("tasks", child._id);
      expect(parentTask?.isArchived).toBe(true);
      expect(childTask?.isArchived).toBe(true);
    });

    // Try to unarchive the child directly - should return null and not unarchive
    const result = await asUser.mutation(api.tasks.core.unarchive, { id: child._id });
    expect(result).toBeNull();

    // Child should still be archived
    await t.run(async (runCtx) => {
      const childTask = await runCtx.db.get("tasks", child._id);
      expect(childTask?.isArchived).toBe(true);
    });
  });
});

describe("permanentlyDelete", () => {
  test("should hard delete task", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Call internal mutation directly
    await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("tasks", task._id);
      expect(deleted).toBeNull();
    });
  });

  test("should be no-op if already deleted", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Delete once
    await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

    // Delete again - should not throw
    const result = await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });
    expect(result).toBeNull();
  });

  test("should delete task attachments when task is permanently deleted", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Create real storage blobs and attachments
    let storageId1: import("../_generated/dataModel").Id<"_storage">;
    let storageId2: import("../_generated/dataModel").Id<"_storage">;

    await t.run(async (runCtx) => {
      storageId1 = await runCtx.storage.store(new Blob(["test content 1"]));
      storageId2 = await runCtx.storage.store(new Blob(["test content 2"]));

      await runCtx.db.insert("taskArtifacts", {
        taskId: task._id,
        name: "Implementation Plan",
        fileName: "implementation-plan.md",
        content: "# Plan",
        source: "user",
        createdBy: user._id,
        updatedBy: user._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await runCtx.db.insert("taskAttachments", {
        taskId: task._id,
        storageId: storageId1,
        fileName: "test1.txt",
        fileSize: 1024,
        contentType: "text/plain",
        uploadedBy: user._id,
        uploadedAt: Date.now(),
      });
      await runCtx.db.insert("taskAttachments", {
        taskId: task._id,
        storageId: storageId2,
        fileName: "test2.pdf",
        fileSize: 2048,
        contentType: "application/pdf",
        uploadedBy: user._id,
        uploadedAt: Date.now(),
      });
    });

    // Verify attachments exist
    await t.run(async (runCtx) => {
      const artifacts = await runCtx.db
        .query("taskArtifacts")
        .withIndex("by_task_and_updatedAt", (q) => q.eq("taskId", task._id))
        .collect();
      expect(artifacts).toHaveLength(1);

      const attachments = await runCtx.db
        .query("taskAttachments")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      expect(attachments).toHaveLength(2);

      // Verify storage files exist
      expect(await runCtx.storage.get(storageId1)).not.toBeNull();
      expect(await runCtx.storage.get(storageId2)).not.toBeNull();
    });

    // Permanently delete the task
    await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

    // Verify task is deleted
    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("tasks", task._id);
      expect(deleted).toBeNull();
    });

    // Verify attachments and storage files are also deleted
    await t.run(async (runCtx) => {
      const artifacts = await runCtx.db
        .query("taskArtifacts")
        .withIndex("by_task_and_updatedAt", (q) => q.eq("taskId", task._id))
        .collect();
      expect(artifacts).toHaveLength(0);

      const attachments = await runCtx.db
        .query("taskAttachments")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      expect(attachments).toHaveLength(0);

      // Verify storage files are also deleted
      expect(await runCtx.storage.get(storageId1)).toBeNull();
      expect(await runCtx.storage.get(storageId2)).toBeNull();
    });
  });

  test("should handle task with no attachments", async () => {
    const ctx = createTestContext();
    const { project, user, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);

    // Verify no attachments
    await t.run(async (runCtx) => {
      const attachments = await runCtx.db
        .query("taskAttachments")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      expect(attachments).toHaveLength(0);
    });

    // Should not throw when deleting task with no attachments
    await t.mutation(internal.tasks.core.permanentlyDelete, { taskId: task._id });

    await t.run(async (runCtx) => {
      const deleted = await runCtx.db.get("tasks", task._id);
      expect(deleted).toBeNull();
    });
  });
});

describe("authorization", () => {
  describe("create", () => {
    test("should reject creating task in another user's project", async () => {
      const ctx = createTestContext();

      // User 1 has a project
      const { project: user1Project } = await ctx.setupProject();

      // User 2 tries to create a task in User 1's project
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.create, {
          projectId: user1Project._id,
          clientId: gen.clientId(),
          name: "Unauthorized Task",
          priority: "Medium",
          status: "To Do",
          tags: [],
          rank: gen.rank(),
        })
      ).rejects.toThrow("Not a member of this organization");
    });

    test("should auto-generate rank after last task when rank is omitted", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      // Create first task with explicit rank
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "First",
        priority: "None",
        status: "To Do",
        tags: [],
        rank: LexoRank.middle().toString(),
      });

      // Create second task without rank — should auto-generate after first
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Second",
        priority: "None",
        status: "To Do",
        tags: [],
      });

      // Create third task without rank — should auto-generate after second
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Third",
        priority: "None",
        status: "To Do",
        tags: [],
      });

      // All three should have unique ranks and be ordered correctly
      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      const names = tasks.map((t) => t.name);
      expect(names).toEqual(["First", "Second", "Third"]);

      // Verify ranks are unique
      const ranks = tasks.map((t) => t.rank);
      expect(new Set(ranks).size).toBe(3);
    });

    test("should auto-generate middle rank when project has no tasks", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Only task",
        priority: "None",
        status: "To Do",
        tags: [],
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Only task");
      expect(tasks[0].rank).toBe(LexoRank.middle().toString());
    });
  });

  describe("update", () => {
    test("should reject updating another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has a task
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // User 2 tries to update it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.update, {
          id: task._id,
          name: "Hacked!",
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("updateRank", () => {
    test("should reject reordering another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has a task
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // User 2 tries to reorder it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.rank.update, {
          id: task._id,
          rank: gen.rank(),
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("updateParent", () => {
    test("should reject moving another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has tasks
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // User 2 tries to move it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.move.toParent, {
          id: task._id,
          parentId: null,
          rank: gen.rank(),
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("remove", () => {
    test("should reject deleting another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has a task
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // User 2 tries to delete it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.remove, {
          id: task._id,
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("restore", () => {
    test("should reject restoring another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has a deleted task
      const { project, user, asUser: asUser1, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // Soft delete it
      await asUser1.mutation(api.tasks.core.remove, { id: task._id });

      // User 2 tries to restore it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.restore, {
          id: task._id,
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("duplicate", () => {
    test("should reject duplicating another user's task", async () => {
      const ctx = createTestContext();

      // User 1 has a task
      const { project, user } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      // User 2 tries to duplicate it
      const { asUser: asUser2 } = await ctx.setupUser();

      await expect(
        asUser2.mutation(api.tasks.core.duplicate, {
          id: task._id,
          newClientId: gen.clientId(),
          newRank: gen.rank(),
        })
      ).rejects.toThrow("Not a member of this organization");
    });
  });

  describe("listByProject", () => {
    test("should return empty for another user's project", async () => {
      const ctx = createTestContext();

      // User 1 has a project with tasks
      const { project, user } = await ctx.setupProject();
      await ctx.task(project._id, user._id, { name: "Secret Task" });

      // User 2 tries to list them
      const { asUser: asUser2 } = await ctx.setupUser();

      const tasks = await asUser2.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });

      expect(tasks).toEqual([]);
    });

    test("should exclude archived tasks by default", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const activeTask = await ctx.task(project._id, user._id, {
        name: "Active",
      });
      const archivedTask = await ctx.task(project._id, user._id, {
        name: "Archived",
      });

      // Archive one task
      await asUser.mutation(api.tasks.core.archive, { id: archivedTask._id });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(activeTask._id);
    });

    test("should return only archived tasks when archiveFilter is 'archived'", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      await ctx.task(project._id, user._id, { name: "Active" });
      const archivedTask = await ctx.task(project._id, user._id, {
        name: "Archived",
      });

      // Archive one task
      await asUser.mutation(api.tasks.core.archive, { id: archivedTask._id });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "archived",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(archivedTask._id);
    });

    test("does not scope archived task reads to selected Lists", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });
      const { taskId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Archived listed task",
        priority: "Medium",
        status: "To Do",
        tags: [],
        listRef: "SPRINT",
      });
      await asUser.mutation(api.tasks.core.archive, { id: taskId });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "archived",
        listRef: "SPRINT",
      });

      expect(tasks).toEqual([]);
    });

    test("should return active tasks when archiveFilter is 'active'", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const activeTask = await ctx.task(project._id, user._id, {
        name: "Active",
      });
      const archivedTask = await ctx.task(project._id, user._id, {
        name: "Archived",
      });

      // Archive one task
      await asUser.mutation(api.tasks.core.archive, { id: archivedTask._id });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "active",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(activeTask._id);
    });

    test("strips internal assigneeId from listed task return values", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const task = await ctx.task(project._id, user._id, {
        name: "Legacy assignee task",
        assigneeId: user._id,
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(task._id);
      expect(tasks[0].assignee).toMatchObject({
        type: "user",
        userId: user._id,
        name: user.name,
      });
      expect("assigneeId" in tasks[0]).toBe(false);
    });

    test("should filter tasks by status when provided", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      const doneTask = await ctx.task(project._id, user._id, {
        name: "Done Task",
        status: "Done",
      });
      await ctx.task(project._id, user._id, {
        name: "Todo Task",
        status: "To Do",
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        status: "Done",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(doneTask._id);
      expect(tasks[0].status).toBe("Done");
    });

    test("should filter selected Lists by status", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();
      const listId = await asUser.mutation(api.tasks.lists.create, {
        projectId: project._id,
        name: "Sprint",
        ref: "SPRINT",
      });

      const { taskId: sprintDoneId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Sprint done",
        priority: "Medium",
        status: "Done",
        tags: [],
        rank: "a",
        listId,
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Sprint todo",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
        listId,
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Default done",
        priority: "Medium",
        status: "Done",
        tags: [],
        rank: "c",
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        listRef: "SPRINT",
        status: "Done",
      });

      expect(tasks.map((task) => task._id)).toEqual([sprintDoneId]);
    });

    test("should filter Backlog by status", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const { taskId: backlogDoneId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Backlog done",
        priority: "Medium",
        status: "Done",
        tags: [],
        rank: "a",
        listRef: "BACKLOG",
      });
      await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Backlog todo",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
        listRef: "BACKLOG",
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        listRef: "BACKLOG",
        status: "Done",
      });

      expect(tasks.map((task) => task._id)).toEqual([backlogDoneId]);
      expect(tasks[0]?.list).toEqual({
        type: "system",
        key: "backlog",
        ref: "BACKLOG",
        name: "Backlog",
      });
    });

    test("should apply status with archiveFilter", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      await ctx.task(project._id, user._id, {
        name: "Active Done",
        status: "Done",
      });
      const archivedDone = await ctx.task(project._id, user._id, {
        name: "Archived Done",
        status: "Done",
      });
      await asUser.mutation(api.tasks.core.archive, { id: archivedDone._id });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "archived",
        status: "Done",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0]._id).toBe(archivedDone._id);
      expect(tasks[0].status).toBe("Done");
    });

    test("should keep status-filtered archived tasks newest first", async () => {
      const ctx = createTestContext();
      const { project, user, asUser, t } = await ctx.setupProject();

      const olderDone = await ctx.task(project._id, user._id, {
        name: "Older archived done",
        status: "Done",
      });
      const newerDone = await ctx.task(project._id, user._id, {
        name: "Newer archived done",
        status: "Done",
      });
      const archivedTodo = await ctx.task(project._id, user._id, {
        name: "Archived todo",
        status: "To Do",
      });

      await asUser.mutation(api.tasks.core.archive, { id: olderDone._id });
      await asUser.mutation(api.tasks.core.archive, { id: newerDone._id });
      await asUser.mutation(api.tasks.core.archive, { id: archivedTodo._id });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", olderDone._id, { archivedAt: 1000 });
        await runCtx.db.patch("tasks", newerDone._id, { archivedAt: 3000 });
        await runCtx.db.patch("tasks", archivedTodo._id, { archivedAt: 5000 });
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        archiveFilter: "archived",
        status: "Done",
      });

      expect(tasks.map((task) => task._id)).toEqual([
        newerDone._id,
        olderDone._id,
      ]);
    });

    test("should include subtasks for open status filters", async () => {
      const ctx = createTestContext();
      const { project, asUser } = await ctx.setupProject();

      const { taskId: parentId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: gen.clientId(),
        name: "Parent",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "a",
      });
      const { taskId: childId } = await asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        parentId,
        clientId: gen.clientId(),
        name: "Child",
        priority: "Medium",
        status: "To Do",
        tags: [],
        rank: "b",
      });

      const tasks = await asUser.query(api.tasks.core.listByProject, {
        projectId: project._id,
        status: "To Do",
      });

      expect(tasks.map((task) => task._id)).toEqual([parentId, childId]);
    });

    test("should reject legacy statuses filter", async () => {
      const ctx = createTestContext();
      const { project, user, asUser } = await ctx.setupProject();

      await ctx.task(project._id, user._id, {
        name: "Done Task",
        status: "Done",
      });
      await ctx.task(project._id, user._id, {
        name: "Todo Task",
        status: "To Do",
      });

      await expect(
        asUser.query(api.tasks.core.listByProject, {
          projectId: project._id,
          // @ts-expect-error legacy multi-status listing input should be rejected.
          statuses: ["Done"],
        })
      ).rejects.toThrow();
    });
  });

  describe("listByParent", () => {
    test("should return empty for another user's subtasks", async () => {
      const ctx = createTestContext();

      // User 1 has a task with children
      const { project, user } = await ctx.setupProject();
      const parent = await ctx.task(project._id, user._id, { name: "Parent" });
      await ctx.task(project._id, user._id, { name: "Child", parentId: parent._id });

      // User 2 tries to list children
      const { asUser: asUser2 } = await ctx.setupUser();

      const children = await asUser2.query(api.tasks.core.listByParent, {
        parentId: parent._id,
      });

      expect(children).toEqual([]);
    });
  });
});

describe("getByRefs", () => {
  test("returns tasks with creator display name", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject({ project: { alias: "CRE" } });

    const task = await ctx.task(project._id, user._id, {
      name: "Creator task",
    });

    const result = await asUser.query(api.tasks.core.getByRefs, {
      refs: [`${project.alias}-${task.refNumber}`],
      projectId: project._id,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].task?._id).toBe(task._id);
    expect(result.results[0].task?.dueDate).toBeNull();
    expect(result.results[0].task?.createdByName).toBe(user.name);
  });
});

describe("getById", () => {
  test("returns task with creator display name", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, {
      name: "Task with creator",
    });

    const result = await asUser.query(api.tasks.core.getById, {
      id: task._id,
    });

    expect(result?._id).toBe(task._id);
    expect(result?.createdByName).toBe(user.name);
  });
});

describe("listArchivedByProject", () => {
  test("should paginate archived tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    // Create 5 tasks and archive them
    const tasks = await ctx.tasks(project._id, user._id, 5);
    for (const task of tasks) {
      await asUser.mutation(api.tasks.core.archive, { id: task._id });
    }

    // First page: request 2 items
    const page1 = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: null },
    });

    expect(page1.page).toHaveLength(2);
    expect(page1.isDone).toBe(false);
    expect(page1.continueCursor).toBeTruthy();

    // Second page: request 2 more
    const page2 = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: page1.continueCursor },
    });

    expect(page2.page).toHaveLength(2);
    expect(page2.isDone).toBe(false);

    // Third page: remaining 1
    const page3 = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 2, cursor: page2.continueCursor },
    });

    expect(page3.page).toHaveLength(1);
    expect(page3.isDone).toBe(true);

    // All 5 unique tasks across all pages
    const allIds = [
      ...page1.page.map((t) => t._id),
      ...page2.page.map((t) => t._id),
      ...page3.page.map((t) => t._id),
    ];
    expect(new Set(allIds).size).toBe(5);
  });

  test("should return tasks ordered by archivedAt descending", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    // Create and archive tasks sequentially so archivedAt values differ
    const task1 = await ctx.task(project._id, user._id, { name: "First" });
    await asUser.mutation(api.tasks.core.archive, { id: task1._id });

    const task2 = await ctx.task(project._id, user._id, { name: "Second" });
    await asUser.mutation(api.tasks.core.archive, { id: task2._id });

    const task3 = await ctx.task(project._id, user._id, { name: "Third" });
    await asUser.mutation(api.tasks.core.archive, { id: task3._id });

    const result = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    // Most recently archived first
    expect(result.page[0].name).toBe("Third");
    expect(result.page[1].name).toBe("Second");
    expect(result.page[2].name).toBe("First");
  });

  test("should exclude active and deleted tasks", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    // Active task (not archived)
    await ctx.task(project._id, user._id, { name: "Active" });

    // Archived task
    const archived = await ctx.task(project._id, user._id, { name: "Archived" });
    await asUser.mutation(api.tasks.core.archive, { id: archived._id });

    // Deleted task (archived then deleted)
    const deleted = await ctx.task(project._id, user._id, { name: "Deleted" });
    await asUser.mutation(api.tasks.core.archive, { id: deleted._id });
    await asUser.mutation(api.tasks.core.remove, { id: deleted._id });

    const result = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].name).toBe("Archived");
  });

  test("should enrich tasks with assignee data", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, org } = await ctx.setupProject();

    // Create a second user as assignee
    const assignee = await ctx.user({ name: "Alice Test" });
    await ctx.orgMember(org._id, assignee._id, "member");
    await ctx.projectMember(project._id, assignee._id, "member");

    const task = await ctx.task(project._id, user._id, {
      name: "Assigned task",
      assigneeId: assignee._id,
    });
    await asUser.mutation(api.tasks.core.archive, { id: task._id });

    const result = await asUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(1);
    expect(result.page[0].assignee).toEqual({
      type: "user",
      userId: assignee._id,
      name: "Alice Test",
      avatarUrl: assignee.avatarUrl ?? null,
    });
    expect(result.page[0].createdByName).toBe(user.name);
  });

  test("should return empty result when not authenticated", async () => {
    const ctx = createTestContext();
    const { project, user, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { name: "Archived" });
    await asUser.mutation(api.tasks.core.archive, { id: task._id });

    // Query without authentication
    const result = await t.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  test("should return empty result when user has no project access", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id, { name: "Archived" });
    await asUser.mutation(api.tasks.core.archive, { id: task._id });

    // Different user with no access
    const { asUser: asOtherUser } = await ctx.setupUser();

    const result = await asOtherUser.query(api.tasks.core.listArchivedByProject, {
      projectId: project._id,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });
});

describe("tasks.updateExternalLink (OS-760)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("upsert appends a new link and getById includes it", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const result = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "github-pr-acme-app-12",
      link: {
        kind: "pull_request",
        url: "https://github.com/acme/app/pull/12",
        title: "Add links",
        identifier: "#12",
      },
    });

    expect(result.taskId).toBe(task._id);
    expect(result.externalLinks).toHaveLength(1);
    expect(result.externalLinks[0]).toMatchObject({
      id: "github-pr-acme-app-12",
      kind: "pull_request",
      url: "https://github.com/acme/app/pull/12",
      title: "Add links",
      identifier: "#12",
    });

    const fetched = await asUser.query(api.tasks.core.getById, { id: task._id });
    expect(fetched?.externalLinks).toEqual(result.externalLinks);
  });

  test("getById defaults externalLinks to [] for tasks without links", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const fetched = await asUser.query(api.tasks.core.getById, { id: task._id });
    expect(fetched?.externalLinks).toEqual([]);
  });

  test("upsert with an existing id replaces in place, preserving createdAt and order", async () => {
    // Setup commits at an earlier ms, so convex-test doesn't bump the first upsert's clock.
    vi.useFakeTimers({ now: 500_000 });
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    vi.setSystemTime(1_000_000);

    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "branch-feature",
      link: { kind: "branch", name: "feature/links" },
    });
    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "commit-abc",
      link: { kind: "commit", sha: "abcdef1234" },
    });

    vi.setSystemTime(2_000_000);
    const result = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "branch-feature",
      link: { kind: "branch", name: "feature/links-v2" },
    });

    expect(result.externalLinks.map((link) => link.id)).toEqual([
      "branch-feature",
      "commit-abc",
    ]);
    const replaced = result.externalLinks[0];
    expect(replaced).toMatchObject({ kind: "branch", name: "feature/links-v2" });
    expect(replaced.createdAt).toBe(1_000_000);
    expect(replaced.updatedAt).toBe(2_000_000);
  });

  test("delete removes a link and is idempotent for missing ids", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "url-docs",
      link: { kind: "url", url: "https://example.com/docs", title: "Docs" },
    });

    const afterDelete = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "delete",
      id: "url-docs",
    });
    expect(afterDelete.externalLinks).toEqual([]);

    const repeated = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "delete",
      id: "url-docs",
    });
    expect(repeated.externalLinks).toEqual([]);
  });

  test("enforces the per-task link cap on new ids but allows replacing at the cap", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    for (let i = 0; i < MAX_EXTERNAL_LINKS_PER_TASK; i++) {
      await asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: `url-${i}`,
        link: { kind: "url", url: `https://example.com/${i}` },
      });
    }

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "url-overflow",
        link: { kind: "url", url: "https://example.com/overflow" },
      })
    ).rejects.toThrow(`Tasks can have up to ${MAX_EXTERNAL_LINKS_PER_TASK} links`);

    const replaced = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "url-0",
      link: { kind: "url", url: "https://example.com/updated" },
    });
    expect(replaced.externalLinks).toHaveLength(MAX_EXTERNAL_LINKS_PER_TASK);
  });

  test("rejects invalid link ids", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "bad id with spaces",
        link: { kind: "url", url: "https://example.com" },
      })
    ).rejects.toThrow("Link id must be");
  });

  test("rejects upsert without a link payload", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "url-docs",
      })
    ).rejects.toThrow("link is required when op is 'upsert'");
  });

  test("validates url and commit sha shapes", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "url-bad",
        link: { kind: "url", url: "notaurl" },
      })
    ).rejects.toThrow("Link url must be an http(s) URL");

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "commit-bad",
        link: { kind: "commit", sha: "xyz" },
      })
    ).rejects.toThrow("Commit sha must be 7-64 hex characters");
  });

  test("trims text fields and drops empty optionals", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    const result = await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "branch-main",
      link: { kind: "branch", name: "  main  ", repo: "   " },
    });

    expect(result.externalLinks[0]).toMatchObject({ kind: "branch", name: "main" });
    expect(result.externalLinks[0]).not.toHaveProperty("repo");
  });

  test("requires task update permission", async () => {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    await expect(
      asOutsider.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "upsert",
        id: "url-docs",
        link: { kind: "url", url: "https://example.com" },
      })
    ).rejects.toThrow();
  });

  test("rejects unknown tasks and soft-deleted tasks", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);

    await t.run(async (runCtx) => {
      await runCtx.db.patch("tasks", task._id, { isDeleted: true });
    });

    await expect(
      asUser.mutation(api.tasks.core.updateExternalLink, {
        taskId: task._id,
        op: "delete",
        id: "url-docs",
      })
    ).rejects.toThrow("Task not found");
  });
});

describe("tasks activity logging for tags, type and links (OS-1455)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupLoggingTest() {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const setup = await ctx.setupProject();
    const task = await ctx.task(setup.project._id, setup.user._id, { tags: ["draft"] });

    const logsOfType = async (eventType: string) => {
      await setup.t.finishAllScheduledFunctions(vi.runAllTimers);
      return setup.t.run(async (runCtx) => {
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        return logs.filter((log) => log.eventType === eventType);
      });
    };

    return { ...setup, task, logsOfType };
  }

  test("logs one tags_changed row per edit, carrying added and removed", async () => {
    const { asUser, task, logsOfType } = await setupLoggingTest();

    await asUser.mutation(api.tasks.core.update, { id: task._id, tags: ["draft", "design"] });

    const added = await logsOfType("tags_changed");
    expect(added).toHaveLength(1);
    expect(added[0].changeDetails).toEqual({ type: "tags", added: ["design"], removed: [] });

    await asUser.mutation(api.tasks.core.update, { id: task._id, tags: ["design", "ui"] });

    const swapped = await logsOfType("tags_changed");
    expect(swapped).toHaveLength(2);
    expect(swapped[1].changeDetails).toEqual({ type: "tags", added: ["ui"], removed: ["draft"] });
  });

  test("does not log a tags_changed row for a pure reorder", async () => {
    const { asUser, task, logsOfType } = await setupLoggingTest();

    await asUser.mutation(api.tasks.core.update, { id: task._id, tags: ["a", "b"] });
    await asUser.mutation(api.tasks.core.update, { id: task._id, tags: ["b", "a"] });

    expect(await logsOfType("tags_changed")).toHaveLength(1);
  });

  test("logs type_changed with denormalized names, skipping no-op key updates", async () => {
    const { asUser, task, logsOfType } = await setupLoggingTest();

    await asUser.mutation(api.tasks.core.update, { id: task._id, taskTypeKey: "bug" });

    const logs = await logsOfType("type_changed");
    expect(logs).toHaveLength(1);
    expect(logs[0].changeDetails).toEqual({
      type: "task_type",
      oldKey: "task",
      oldName: "Task",
      newKey: "bug",
      newName: "Bug",
    });

    // Re-sending the same key resolves to the same type: no phantom row.
    await asUser.mutation(api.tasks.core.update, { id: task._id, taskTypeKey: "bug" });
    expect(await logsOfType("type_changed")).toHaveLength(1);
  });

  test("logs external link ops once each, ignoring no-op calls", async () => {
    const { asUser, task, logsOfType } = await setupLoggingTest();
    const link = { kind: "url" as const, url: "https://example.com/docs", title: "Docs" };

    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "url-docs",
      link,
    });
    let logs = await logsOfType("external_link_changed");
    expect(logs).toHaveLength(1);
    expect(logs[0].changeDetails).toEqual({
      type: "external_link",
      op: "added",
      linkId: "url-docs",
      kind: "url",
      label: "Docs",
      url: "https://example.com/docs",
    });

    // Identical re-upsert: MCP/CLI idempotency must not produce a row.
    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "url-docs",
      link,
    });
    expect(await logsOfType("external_link_changed")).toHaveLength(1);

    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "upsert",
      id: "url-docs",
      link: { ...link, title: "Design doc" },
    });
    logs = await logsOfType("external_link_changed");
    expect(logs).toHaveLength(2);
    expect(logs[1].changeDetails).toMatchObject({ op: "updated", label: "Design doc" });

    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "delete",
      id: "url-docs",
    });
    logs = await logsOfType("external_link_changed");
    expect(logs).toHaveLength(3);
    expect(logs[2].changeDetails).toMatchObject({ op: "removed", linkId: "url-docs" });

    // Deleting a missing id is a no-op.
    await asUser.mutation(api.tasks.core.updateExternalLink, {
      taskId: task._id,
      op: "delete",
      id: "url-docs",
    });
    expect(await logsOfType("external_link_changed")).toHaveLength(3);
  });
});

describe("split assignment (OS-1335)", () => {
  async function setupWithAgent() {
    const ctx = createTestContext();
    const setup = await ctx.setupProject();
    const projectAgentId = await setup.asUser.mutation(api.agents.projectAgents.create, {
      projectId: setup.project._id,
      ...validProjectAgentInput,
    });
    return { ctx, ...setup, projectAgentId };
  }

  test("delegating an ownerless task auto-sets the acting user as owner", async () => {
    const { project, user, asUser, t, projectAgentId, ctx } = await setupWithAgent();
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.delegatedToAgentId).toBe(projectAgentId);
      expect(updated?.assigneeId).toBe(user._id);
    });
  });

  test("delegating with explicit assigneeId: null stays ownerless", async () => {
    const { project, user, asUser, t, projectAgentId, ctx } = await setupWithAgent();
    const task = await ctx.task(project._id, user._id);

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      assigneeId: null,
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.delegatedToAgentId).toBe(projectAgentId);
      expect(updated?.assigneeId).toBeUndefined();
    });
  });

  test("delegating keeps an existing different owner", async () => {
    const { ctx, org, project, user, asUser, t, projectAgentId } = await setupWithAgent();
    const owner = await ctx.user({ name: "Owner" });
    await ctx.orgMember(org._id, owner._id, "member");
    await ctx.projectMember(project._id, owner._id, "member");
    const task = await ctx.task(project._id, user._id);
    await asUser.mutation(api.tasks.core.update, { id: task._id, assigneeId: owner._id });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.assigneeId).toBe(owner._id);
      expect(updated?.delegatedToAgentId).toBe(projectAgentId);
    });
  });

  test("clearing delegation keeps the assignee", async () => {
    const { ctx, project, user, asUser, t, projectAgentId } = await setupWithAgent();
    const task = await ctx.task(project._id, user._id);
    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      assigneeId: user._id,
      delegatedToAgentId: projectAgentId,
    });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      delegatedToAgentId: null,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.assigneeId).toBe(user._id);
      expect(updated?.delegatedToAgentId).toBeUndefined();
    });
  });

  test("changing assignee keeps delegation", async () => {
    const { ctx, org, project, user, asUser, t, projectAgentId } = await setupWithAgent();
    const nextOwner = await ctx.user({ name: "Next Owner" });
    await ctx.orgMember(org._id, nextOwner._id, "member");
    await ctx.projectMember(project._id, nextOwner._id, "member");
    const task = await ctx.task(project._id, user._id);
    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      delegatedToAgentId: projectAgentId,
    });

    await asUser.mutation(api.tasks.core.update, {
      id: task._id,
      assigneeId: nextOwner._id,
    });

    await t.run(async (runCtx) => {
      const updated = await runCtx.db.get("tasks", task._id);
      expect(updated?.assigneeId).toBe(nextOwner._id);
      expect(updated?.delegatedToAgentId).toBe(projectAgentId);
    });
  });

  test("assigneeId 'me' resolves to the caller on create and update", async () => {
    const { ctx, org, project, user, asUser, t } = await setupWithAgent();
    const other = await ctx.user({ name: "Other" });
    await ctx.orgMember(org._id, other._id, "member");
    await ctx.projectMember(project._id, other._id, "member");

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Mine on create",
      priority: "Medium",
      status: "To Do",
      tags: [],
      assigneeId: "me",
    });
    const task = await ctx.task(project._id, user._id);
    await ctx.asUser(other).mutation(api.tasks.core.update, { id: task._id, assigneeId: "me" });

    await t.run(async (runCtx) => {
      expect((await runCtx.db.get("tasks", taskId))?.assigneeId).toBe(user._id);
      expect((await runCtx.db.get("tasks", task._id))?.assigneeId).toBe(other._id);
    });
  });

  test("create with only delegatedToAgentId auto-sets the creator as owner", async () => {
    const { project, user, asUser, t, projectAgentId } = await setupWithAgent();

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "Delegated on create",
      priority: "Medium",
      status: "To Do",
      tags: [],
      delegatedToAgentId: projectAgentId,
    });

    await t.run(async (runCtx) => {
      const task = await runCtx.db.get("tasks", taskId);
      expect(task?.delegatedToAgentId).toBe(projectAgentId);
      expect(task?.assigneeId).toBe(user._id);
    });
  });

  describe("getSummariesByIds", () => {
    test("resolves task refs by id, dedupes, and skips deleted tasks", async () => {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, { name: "Tab ref" });
      const deleted = await ctx.task(project._id, user._id, { name: "Gone" });
      await t.run(async (runCtx) => {
        await runCtx.db.patch("tasks", deleted._id, { isDeleted: true });
      });

      const summaries = await asUser.query(api.tasks.core.getSummariesByIds, {
        taskIds: [task._id, deleted._id, task._id],
      });
      expect(summaries).toEqual([
        {
          _id: task._id,
          refId: `${project.alias}-${task.refNumber}`,
          name: "Tab ref",
          taskType: expect.anything(),
          isArchived: false,
        },
      ]);
    });

    test("drops tasks the caller cannot view and returns nothing when unauthenticated", async () => {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id, { name: "Private" });

      const outsider = await ctx.user();
      expect(
        await ctx.asUser(outsider).query(api.tasks.core.getSummariesByIds, { taskIds: [task._id] })
      ).toEqual([]);
      expect(await t.query(api.tasks.core.getSummariesByIds, { taskIds: [task._id] })).toEqual([]);
    });
  });
});

// Pins the server contract the read-only detail sidebar leans on
// (docs/specs/read-only-viewer-ux.md): a project viewer cannot write a task.
describe("project viewer task writes", () => {
  async function setupViewer() {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const task = await ctx.task(project._id, user._id);
    return { asOwner: asUser, asViewer: ctx.asUser(viewer), task };
  }

  test.each([
    ["update", { name: "Viewer edit" }],
    ["update", { status: "Done" as const }],
    ["update", { tags: ["viewer"] }],
  ])("rejects %s %o", async (_name, updates) => {
    const { asViewer, task } = await setupViewer();

    await expect(
      asViewer.mutation(api.tasks.core.update, { id: task._id, ...updates })
    ).rejects.toThrow("Permission denied");
  });

  test("rejects duplicate, archive, unarchive, delete, and move to List", async () => {
    const { asOwner, asViewer, task } = await setupViewer();

    await expect(
      asViewer.mutation(api.tasks.core.duplicate, {
        id: task._id,
        newClientId: gen.clientId(),
        newRank: gen.rank(),
      })
    ).rejects.toThrow("Permission denied");
    await expect(asViewer.mutation(api.tasks.core.archive, { id: task._id })).rejects.toThrow(
      "Permission denied"
    );
    await expect(asViewer.mutation(api.tasks.core.remove, { id: task._id })).rejects.toThrow(
      "Permission denied"
    );
    await expect(
      asViewer.mutation(api.tasks.core.move.toList, {
        rootIds: [task._id],
        listRef: BACKLOG_SYSTEM_LIST_KEY,
      })
    ).rejects.toThrow("Permission denied");

    await asOwner.mutation(api.tasks.core.archive, { id: task._id });
    await expect(asViewer.mutation(api.tasks.core.unarchive, { id: task._id })).rejects.toThrow(
      "Permission denied"
    );
  });
  // Production redacts plain Error messages, so the web UI can only map a
  // denial it receives as ConvexError data (read-only-viewer-ux.md, Soft failures).
  test("a member demoted to viewer mid-session gets a ConvexError denial", async () => {
    const ctx = createTestContext();
    const { org, project, user, asUser } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const task = await ctx.task(project._id, user._id);
    const asMember = ctx.asUser(member);

    await asMember.mutation(api.tasks.core.update, { id: task._id, name: "Member edit" });
    await asUser.mutation(api.projects.members.updateRole, {
      projectId: project._id,
      userId: member._id,
      role: "viewer",
    });

    await expect(
      asMember.mutation(api.tasks.core.update, { id: task._id, name: "Stale tab edit" })
    ).rejects.toMatchObject({ data: "Permission denied: task:update" });
    await expect(
      asMember.mutation(api.tasks.core.rank.update, { id: task._id, rank: gen.rank() })
    ).rejects.toMatchObject({ data: "Permission denied: task:update" });
  });
});
