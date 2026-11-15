/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { LexoRank } from "lexorank";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";

async function setup() {
  const ctx = createTestContext();
  const project = await ctx.setupProject();
  const { asUser } = project;
  const otherListId = await asUser.mutation(api.tasks.lists.create, {
    projectId: project.project._id,
    name: "Sprint",
    ref: "SPRINT",
  });
  const createTask = (overrides: { listRef?: string; parentId?: Id<"tasks">; sectionId?: Id<"taskSections"> } = {}) =>
    asUser.mutation(api.tasks.core.create, {
      projectId: project.project._id,
      clientId: crypto.randomUUID(),
      name: "Task",
      priority: "None",
      status: "To Do",
      tags: [],
      ...overrides,
    });
  const getTask = (id: Id<"tasks">) => project.t.run((run) => run.db.get("tasks", id));
  return { ctx, ...project, otherListId, createTask, getTask };
}

describe("task sections", () => {
  test("creates sections per List in rank order, renames, recolors and reorders", async () => {
    const { project, asUser } = await setup();
    const projectId = project._id;

    const a = await asUser.mutation(api.tasks.sections.create, { projectId, name: "  Design  " });
    const b = await asUser.mutation(api.tasks.sections.create, { projectId, name: "Build", color: "#ef4444" });
    await asUser.mutation(api.tasks.sections.create, { projectId, listRef: "SPRINT", name: "Design" });
    await asUser.mutation(api.tasks.sections.create, { projectId, listRef: "BACKLOG", name: "Later" });

    expect(await asUser.query(api.tasks.sections.list, { projectId })).toMatchObject([
      { _id: a, name: "Design", color: null },
      { _id: b, name: "Build", color: "#ef4444" },
    ]);
    expect((await asUser.query(api.tasks.sections.list, { projectId, listRef: "SPRINT" })).map((s) => s.name)).toEqual(["Design"]);
    expect((await asUser.query(api.tasks.sections.list, { projectId, listRef: "BACKLOG" })).map((s) => s.name)).toEqual(["Later"]);
    expect(await asUser.query(api.tasks.sections.listByProject, { projectId })).toHaveLength(4);

    await asUser.mutation(api.tasks.sections.update, { sectionId: b, name: "Ship", color: null });
    const first = (await asUser.query(api.tasks.sections.list, { projectId }))[0];
    await asUser.mutation(api.tasks.sections.reorder, {
      sectionId: b,
      rank: LexoRank.parse(first.rank).genPrev().toString(),
    });
    expect(await asUser.query(api.tasks.sections.list, { projectId })).toMatchObject([
      { _id: b, name: "Ship", color: null },
      { _id: a },
    ]);

    await expect(asUser.mutation(api.tasks.sections.create, { projectId, name: " " })).rejects.toThrow("Section name cannot be empty");
    await expect(asUser.mutation(api.tasks.sections.update, { sectionId: a, color: "#123456" })).rejects.toThrow("supported palette");
  });

  test("viewers can list but not manage sections", async () => {
    const { ctx, org, project, asUser } = await setup();
    const sectionId = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);

    expect(await asViewer.query(api.tasks.sections.list, { projectId: project._id })).toHaveLength(1);
    await expect(asViewer.mutation(api.tasks.sections.create, { projectId: project._id, name: "X" })).rejects.toThrow("Permission denied");
    await expect(asViewer.mutation(api.tasks.sections.update, { sectionId, name: "X" })).rejects.toThrow("Permission denied");
    await expect(asViewer.mutation(api.tasks.sections.remove, { sectionId })).rejects.toThrow("Permission denied");
  });

  test("task create/update accept only root tasks and sections from the task's List", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const projectId = project._id;
    const design = await asUser.mutation(api.tasks.sections.create, { projectId, name: "Design" });
    const sprintSection = await asUser.mutation(api.tasks.sections.create, { projectId, listRef: "SPRINT", name: "Design" });

    const { taskId } = await createTask({ sectionId: design });
    expect((await getTask(taskId))?.sectionId).toBe(design);
    await expect(createTask({ sectionId: sprintSection })).rejects.toThrow("Section belongs to a different List");
    await expect(createTask({ parentId: taskId, sectionId: design })).rejects.toThrow("Subtasks follow their parent's section");

    await expect(asUser.mutation(api.tasks.core.update, { id: taskId, sectionId: sprintSection })).rejects.toThrow(
      "Section belongs to a different List"
    );
    await asUser.mutation(api.tasks.core.update, { id: taskId, sectionId: null });
    expect((await getTask(taskId))?.sectionId).toBeUndefined();

    const tasks = await asUser.query(api.tasks.core.listByProject, { projectId });
    expect(tasks.find((task) => task._id === taskId)?.sectionId).toBeNull();
  });

  test("deleting a section keeps its tasks under No section", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const sectionId = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const { taskId } = await createTask({ sectionId });

    await asUser.mutation(api.tasks.sections.remove, { sectionId });

    const task = await getTask(taskId);
    expect(task?.isDeleted).toBe(false);
    expect(task?.sectionId).toBeUndefined();
    expect(await asUser.query(api.tasks.sections.list, { projectId: project._id })).toEqual([]);
  });

  test("moving to another List clears sections by default, or sets a validated destination section", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const projectId = project._id;
    const source = await asUser.mutation(api.tasks.sections.create, { projectId, name: "Design" });
    const target = await asUser.mutation(api.tasks.sections.create, { projectId, listRef: "SPRINT", name: "Design" });
    const { taskId: parent } = await createTask({ sectionId: source });
    const { taskId: child } = await createTask({ parentId: parent });

    await expect(
      asUser.mutation(api.tasks.core.move.toList, { rootIds: [parent], listRef: "SPRINT", sectionId: source })
    ).rejects.toThrow("Section belongs to a different List");
    expect((await getTask(parent))?.sectionId).toBe(source);

    // Same-named sections never match implicitly.
    await asUser.mutation(api.tasks.core.move.toList, { rootIds: [parent], listRef: "SPRINT" });
    expect((await getTask(parent))?.sectionId).toBeUndefined();
    expect((await getTask(child))?.parentId).toBe(parent);

    await asUser.mutation(api.tasks.core.move.toList, { rootIds: [parent], listRef: "BACKLOG" });
    await asUser.mutation(api.tasks.core.move.toList, { rootIds: [parent], listRef: "SPRINT", sectionId: target });
    expect((await getTask(parent))?.sectionId).toBe(target);
    expect((await getTask(child))?.listKey).toBe((await getTask(parent))?.listKey);
  });

  test("nesting clears a task's section; promoting a subtask keeps its old root's section", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const design = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const { taskId: parent } = await createTask({ sectionId: design });
    const { taskId: other } = await createTask({ sectionId: design });
    const { taskId: grandchild } = await createTask({ parentId: other });

    await asUser.mutation(api.tasks.core.move.toParent, { id: other, parentId: parent });
    expect((await getTask(other))?.sectionId).toBeUndefined();

    await asUser.mutation(api.tasks.core.move.toParent, { id: grandchild, parentId: null });
    expect((await getTask(grandchild))?.sectionId).toBe(design);
  });

  test("archiving a subtask on its own makes it a root in its former root's section", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const design = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const { taskId: root } = await createTask({ sectionId: design });
    const { taskId: child } = await createTask({ parentId: root });
    const { taskId: grandchild } = await createTask({ parentId: child });

    await asUser.mutation(api.tasks.core.archive, { id: grandchild });
    const archived = await getTask(grandchild);
    expect([archived?.parentId, archived?.sectionId, archived?.isArchived]).toEqual([undefined, design, true]);
  });

  test("deleting a parent with keep subtasks gives promoted roots its section", async () => {
    const { project, asUser, createTask, getTask } = await setup();
    const design = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const { taskId: single } = await createTask({ sectionId: design });
    const { taskId: singleChild } = await createTask({ parentId: single });
    const { taskId: bulk } = await createTask({ sectionId: design });
    const { taskId: bulkChild } = await createTask({ parentId: bulk });

    await asUser.mutation(api.tasks.core.remove, { id: single, cascadeMode: "keep_children" });
    await asUser.mutation(api.tasks.core.bulk.remove, { ids: [bulk], cascadeMode: "keep_children" });
    for (const id of [singleChild, bulkChild]) {
      const promoted = await getTask(id);
      expect([promoted?.parentId, promoted?.sectionId]).toEqual([undefined, design]);
    }
  });

  test("duplicating a root keeps its section; the copied subtasks stay sectionless", async () => {
    const { project, asUser, createTask, getTask, t } = await setup();
    const design = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, name: "Design" });
    const { taskId: root } = await createTask({ sectionId: design });
    await createTask({ parentId: root });

    const copy = await asUser.mutation(api.tasks.core.duplicate, {
      id: root,
      newClientId: crypto.randomUUID(),
      newRank: LexoRank.middle().toString(),
    });
    expect((await getTask(copy))?.sectionId).toBe(design);
    const copiedChildren = await t.run((run) =>
      run.db
        .query("tasks")
        .withIndex("by_parent_and_isDeleted_and_rank", (q) => q.eq("parentId", copy))
        .collect()
    );
    expect(copiedChildren.map((task) => task.sectionId)).toEqual([undefined]);
  });

  test("unarchiving into the default List after its List was removed lands in No section", async () => {
    const { project, asUser, otherListId, createTask, getTask } = await setup();
    const sprint = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, listRef: "SPRINT", name: "Design" });
    const { taskId } = await createTask({ listRef: "SPRINT", sectionId: sprint });
    await createTask({ listRef: "SPRINT" });
    await asUser.mutation(api.tasks.core.archive, { id: taskId });
    await asUser.mutation(api.tasks.core.move.toList, {
      rootIds: (await asUser.query(api.tasks.core.listByProject, { projectId: project._id, listRef: "SPRINT" })).map((task) => task._id),
      listRef: "BACKLOG",
    });
    await asUser.mutation(api.tasks.lists.remove, { id: otherListId });

    await asUser.mutation(api.tasks.core.unarchive, { id: taskId });
    const task = await getTask(taskId);
    expect(task?.listKey).not.toBe(`list:${otherListId}`);
    expect(task?.sectionId).toBeUndefined();
  });

  test("a project holds at most 100 sections across its Lists", async () => {
    const { project, asUser, otherListId, user, t } = await setup();
    const projectId = project._id;
    await t.run(async (run) => {
      for (let i = 0; i < 99; i++) {
        await run.db.insert("taskSections", {
          projectId,
          listKey: `list:${otherListId}`,
          name: `S${i}`,
          rank: LexoRank.middle().toString(),
          createdBy: user._id,
          updatedBy: user._id,
          createdAt: 0,
          updatedAt: 0,
        });
      }
    });
    await asUser.mutation(api.tasks.sections.create, { projectId, name: "Last" });
    await expect(asUser.mutation(api.tasks.sections.create, { projectId, listRef: "BACKLOG", name: "Over" })).rejects.toThrow(
      "Projects can have up to 100 sections"
    );
    expect(await asUser.query(api.tasks.sections.listByProject, { projectId })).toHaveLength(100);
  });

  test("removing a List deletes its sections", async () => {
    const { project, asUser, otherListId, t } = await setup();
    const sectionId = await asUser.mutation(api.tasks.sections.create, { projectId: project._id, listRef: "SPRINT", name: "Design" });
    await asUser.mutation(api.tasks.lists.remove, { id: otherListId });
    expect(await t.run((run) => run.db.get("taskSections", sectionId))).toBeNull();
  });
});
