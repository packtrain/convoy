/// <reference types="vite/client" />
import { describe, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { MAX_LABELS_PER_PROJECT } from "./lib/constants";

describe("taskLabels", () => {
  test("creates labels appended in rank order and lists them", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    const q1 = await asUser.mutation(api.tasks.labels.create, {
      projectId: project._id,
      name: "  Q1   Goals ",
      color: "#ef4444",
    });
    const q2 = await asUser.mutation(api.tasks.labels.create, {
      projectId: project._id,
      name: "Q2",
    });

    const labels = await asUser.query(api.tasks.labels.list, { projectId: project._id });
    expect(labels.map((label) => label._id)).toEqual([q1, q2]);
    expect(labels[0].name).toBe("Q1 Goals");
    expect(labels[0].color).toBe("#ef4444");
    expect(labels[1].color).toBe("#3b82f6"); // default color

    const stored = await t.run(async (runCtx) => runCtx.db.get("projectLabels", q1));
    expect(stored?.normalizedName).toBe("q1 goals");
  });

  test("rejects empty names, duplicate names (case/whitespace-insensitive), and invalid colors", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    await expect(
      asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "   " })
    ).rejects.toThrow("Label name cannot be empty");

    await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Frontend" });
    await expect(
      asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "  FRONTEND " })
    ).rejects.toThrow("A label with this name already exists");

    await expect(
      asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Backend", color: "#123456" })
    ).rejects.toThrow("Label color must be one of the supported palette colors");
  });

  test("rejects creating more labels than the per-project cap", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    for (let i = 0; i < MAX_LABELS_PER_PROJECT; i++) {
      await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: `Label ${i}` });
    }

    await expect(
      asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "One too many" })
    ).rejects.toThrow(`up to ${MAX_LABELS_PER_PROJECT} labels`);
  });

  test("requires project:update to manage labels; viewers and members can list", async () => {
    const ctx = createTestContext();
    const { org, project, asUser } = await ctx.setupProject();

    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);

    await expect(
      asMember.mutation(api.tasks.labels.create, { projectId: project._id, name: "Nope" })
    ).rejects.toThrow();

    const labelId = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q1" });

    await expect(asMember.mutation(api.tasks.labels.update, { labelId, name: "Q2" })).rejects.toThrow();
    await expect(
      asMember.mutation(api.tasks.labels.remove, { labelId, resolution: "clear" })
    ).rejects.toThrow();

    const labels = await asMember.query(api.tasks.labels.list, { projectId: project._id });
    expect(labels).toHaveLength(1);
  });

  test("update renames and recolors without touching tasks; duplicate rename rejected, own name allowed", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const q1 = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q1" });
    await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q2" });
    const task = await ctx.task(project._id, user._id, { labelId: q1 });

    await expect(asUser.mutation(api.tasks.labels.update, { labelId: q1, name: "q2" })).rejects.toThrow(
      "A label with this name already exists"
    );

    // Renaming to its own name (case change) is allowed.
    await asUser.mutation(api.tasks.labels.update, { labelId: q1, name: "q1", color: "#22c55e" });

    const labels = await asUser.query(api.tasks.labels.list, { projectId: project._id });
    const renamed = labels.find((label) => label._id === q1);
    expect(renamed?.name).toBe("q1");
    expect(renamed?.color).toBe("#22c55e");

    // Tasks reference by id — rename does not rewrite them.
    const storedTask = await t.run(async (runCtx) => runCtx.db.get("tasks", task._id));
    expect(storedTask?.labelId).toBe(q1);
  });

  test("reorder patches rank and list order follows; invalid rank rejected", async () => {
    const ctx = createTestContext();
    const { project, asUser } = await ctx.setupProject();

    const a = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "A" });
    const b = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "B" });

    const before = await asUser.query(api.tasks.labels.list, { projectId: project._id });
    expect(before.map((label) => label._id)).toEqual([a, b]);

    await expect(asUser.mutation(api.tasks.labels.reorder, { labelId: b, rank: "not a rank" })).rejects.toThrow(
      "Label rank is not a valid rank value"
    );

    // Move B above A.
    await asUser.mutation(api.tasks.labels.reorder, { labelId: b, rank: "0|0i0000:" });

    const after = await asUser.query(api.tasks.labels.list, { projectId: project._id });
    expect(after.map((label) => label._id)).toEqual([b, a]);
  });

  test("remove/clear clears labelId on ALL tasks (active, archived, soft-deleted) and logs activity with the old name", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const labelId = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Doomed" });
      const active = await ctx.task(project._id, user._id, { labelId });
      const archived = await ctx.task(project._id, user._id, { labelId, isArchived: true });
      const deleted = await ctx.task(project._id, user._id, { labelId, isDeleted: true });

      const result = await asUser.mutation(api.tasks.labels.remove, { labelId, resolution: "clear" });
      expect(new Set(result.affectedTaskIds)).toEqual(new Set([active._id, archived._id, deleted._id]));

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (runCtx) => {
        expect(await runCtx.db.get("projectLabels", labelId)).toBeNull();
        for (const taskId of [active._id, archived._id, deleted._id]) {
          const task = await runCtx.db.get("tasks", taskId);
          expect(task?.labelId).toBeUndefined();
        }

        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", active._id))
          .collect();
        const labelLog = logs.find((log) => log.eventType === "label_changed");
        expect(labelLog?.changeDetails).toMatchObject({
          type: "label",
          oldLabelId: labelId,
          oldLabelName: "Doomed",
        });

        // No activity is logged for soft-deleted tasks.
        const deletedLogs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", deleted._id))
          .collect();
        expect(deletedLogs.some((log) => log.eventType === "label_changed")).toBe(false);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("remove/reassign moves tasks to the target label and validates the target", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();

    const from = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "From" });
    const to = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "To" });
    const task = await ctx.task(project._id, user._id, { labelId: from });

    await expect(
      asUser.mutation(api.tasks.labels.remove, { labelId: from, resolution: "reassign" })
    ).rejects.toThrow("Choose a label to reassign tasks to");
    await expect(
      asUser.mutation(api.tasks.labels.remove, { labelId: from, resolution: "reassign", reassignToLabelId: from })
    ).rejects.toThrow("Cannot reassign tasks to the label being deleted");

    const otherProject = await ctx.project(org._id, user._id);
    const foreign = await asUser.mutation(api.tasks.labels.create, { projectId: otherProject._id, name: "Foreign" });
    await expect(
      asUser.mutation(api.tasks.labels.remove, { labelId: from, resolution: "reassign", reassignToLabelId: foreign })
    ).rejects.toThrow("Label belongs to a different project");

    await asUser.mutation(api.tasks.labels.remove, { labelId: from, resolution: "reassign", reassignToLabelId: to });

    await t.run(async (runCtx) => {
      expect(await runCtx.db.get("projectLabels", from)).toBeNull();
      expect((await runCtx.db.get("tasks", task._id))?.labelId).toBe(to);
    });
  });

  test("remove/archiveTasks archives active tasks, leaves archived ones untouched, clears everywhere", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const labelId = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Sunset" });
    const active = await ctx.task(project._id, user._id, { labelId });
    const alreadyArchived = await ctx.task(project._id, user._id, {
      labelId,
      isArchived: true,
      archivedAt: 123,
    });

    await asUser.mutation(api.tasks.labels.remove, { labelId, resolution: "archiveTasks" });

    await t.run(async (runCtx) => {
      const archivedNow = await runCtx.db.get("tasks", active._id);
      expect(archivedNow?.isArchived).toBe(true);
      expect(archivedNow?.labelId).toBeUndefined();

      const untouched = await runCtx.db.get("tasks", alreadyArchived._id);
      expect(untouched?.isArchived).toBe(true);
      expect(untouched?.archivedAt).toBe(123);
      expect(untouched?.labelId).toBeUndefined();
    });
  });
});

describe("tasks.core with labels", () => {
  test("create accepts a labelId in the project and rejects labels from other projects", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();

    const labelId = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q1" });
    const otherProject = await ctx.project(org._id, user._id);
    const foreign = await asUser.mutation(api.tasks.labels.create, { projectId: otherProject._id, name: "Q1" });

    await expect(
      asUser.mutation(api.tasks.core.create, {
        projectId: project._id,
        clientId: crypto.randomUUID(),
        name: "Labeled",
        priority: "Medium",
        status: "To Do",
        tags: [],
        labelId: foreign,
      })
    ).rejects.toThrow("Label belongs to a different project");

    const created = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: crypto.randomUUID(),
      name: "Labeled",
      priority: "Medium",
      status: "To Do",
      tags: [],
      labelId,
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
    expect(tasks.find((task) => task._id === created.taskId)?.labelId).toBe(labelId);
  });

  test("update sets, changes, and clears the label, logging activity only on real change", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { user, project, asUser, t } = await ctx.setupProject();

      const q1 = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q1" });
      const q2 = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q2" });
      const task = await ctx.task(project._id, user._id);

      await asUser.mutation(api.tasks.core.update, { id: task._id, labelId: q1 });
      // Same value again — no additional activity entry.
      await asUser.mutation(api.tasks.core.update, { id: task._id, labelId: q1 });
      await asUser.mutation(api.tasks.core.update, { id: task._id, labelId: q2 });
      await asUser.mutation(api.tasks.core.update, { id: task._id, labelId: null });

      const tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
      expect(tasks.find((item) => item._id === task._id)?.labelId).toBeNull();

      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (runCtx) => {
        const logs = await runCtx.db
          .query("taskActivityLogs")
          .withIndex("by_task_and_createdAt", (q) => q.eq("taskId", task._id))
          .collect();
        const labelLogs = logs.filter((log) => log.eventType === "label_changed");
        expect(labelLogs).toHaveLength(3); // set, change, clear — no log for the no-op

        const detailsList = labelLogs.map((log) => log.changeDetails);
        expect(detailsList).toContainEqual(
          expect.objectContaining({ type: "label", newLabelName: "Q1" })
        );
        expect(detailsList).toContainEqual(
          expect.objectContaining({ type: "label", oldLabelName: "Q1", newLabelName: "Q2" })
        );
        expect(detailsList).toContainEqual(
          expect.objectContaining({ type: "label", oldLabelName: "Q2" })
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("update rejects a label from another project", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser } = await ctx.setupProject();

    const otherProject = await ctx.project(org._id, user._id);
    const foreign = await asUser.mutation(api.tasks.labels.create, { projectId: otherProject._id, name: "Q1" });
    const task = await ctx.task(project._id, user._id);

    await expect(asUser.mutation(api.tasks.core.update, { id: task._id, labelId: foreign })).rejects.toThrow(
      "Label belongs to a different project"
    );
  });

  test("duplicate carries the label over", async () => {
    const ctx = createTestContext();
    const { user, project, asUser } = await ctx.setupProject();

    const labelId = await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Q1" });
    const task = await ctx.task(project._id, user._id, { labelId });

    const newTaskId = await asUser.mutation(api.tasks.core.duplicate, {
      id: task._id,
      newClientId: crypto.randomUUID(),
      newRank: "0|zzzzzz:",
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, { projectId: project._id });
    expect(tasks.find((item) => item._id === newTaskId)?.labelId).toBe(labelId);
  });
});

describe("taskLabels with apiKey auth (MCP)", () => {
  test("create, update, and remove work with an API key of a project admin", async () => {
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();
    const { key } = await asUser.mutation(api.apiKeys.core.create, {
      name: "MCP Labels",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    const labelId = await t.mutation(api.tasks.labels.create, {
      projectId: project._id,
      name: "Bug",
      apiKey: key,
    });
    await t.mutation(api.tasks.labels.update, { labelId, name: "Defect", apiKey: key });
    const listed = await t.query(api.tasks.labels.list, { projectId: project._id, apiKey: key });
    expect(listed.map((label) => label.name)).toEqual(["Defect"]);

    await t.mutation(api.tasks.labels.remove, { labelId, resolution: "clear", apiKey: key });
    expect(await t.query(api.tasks.labels.list, { projectId: project._id, apiKey: key })).toEqual([]);
  });

  test("a plain member's API key cannot manage labels", async () => {
    const ctx = createTestContext();
    const { org, project, asUser, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);
    const { key } = await asMember.mutation(api.apiKeys.core.create, {
      name: "Member key",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    await expect(
      t.mutation(api.tasks.labels.create, { projectId: project._id, name: "Nope", apiKey: key })
    ).rejects.toThrow();

    // Members can still read labels through their key.
    await asUser.mutation(api.tasks.labels.create, { projectId: project._id, name: "Bug" });
    const listed = await t.query(api.tasks.labels.list, { projectId: project._id, apiKey: key });
    expect(listed.map((label) => label.name)).toEqual(["Bug"]);
  });
});
