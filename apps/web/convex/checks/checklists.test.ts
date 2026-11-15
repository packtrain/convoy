/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import { retypeTaskChecks } from "./lib/resolution";

async function setupCatalog() {
  const ctx = createTestContext();
  const setup = await ctx.setupProject();
  const { project, asUser } = setup;
  for (const [key, label] of [
    ["tests", "All tests pass"],
    ["ui", "UI verified"],
    ["regression", "Regression test added"],
  ]) {
    await asUser.mutation(api.checks.definitions.create, { projectId: project._id, key, label, instruction: "" });
  }
  const createChecklist = (name: string, checkKeys: string[], taskTypeKeys: string[] = []) =>
    asUser.mutation(api.checks.checklists.create, { projectId: project._id, name, checkKeys, taskTypeKeys });
  return { ctx, ...setup, createChecklist };
}

describe("checks.checklists", () => {
  test("creates checklists in name order, keeping check order and dropping duplicate keys", async () => {
    const { project, asUser, createChecklist } = await setupCatalog();
    await createChecklist("  Feature ", ["ui", "tests", "ui"], ["feature"]);
    await createChecklist("Bug fix", ["regression"], ["bug"]);

    const list = await asUser.query(api.checks.checklists.list, { projectId: project._id });
    expect(list.map(({ name, checkKeys, taskTypeKeys }) => ({ name, checkKeys, taskTypeKeys }))).toEqual([
      { name: "Bug fix", checkKeys: ["regression"], taskTypeKeys: ["bug"] },
      { name: "Feature", checkKeys: ["ui", "tests"], taskTypeKeys: ["feature"] },
    ]);
  });

  test("rejects unknown checks, unknown task types, and duplicate names", async () => {
    const { createChecklist } = await setupCatalog();
    await expect(createChecklist("Feature", ["nope"])).rejects.toThrow("Unknown check 'nope'");
    await expect(createChecklist("Feature", [], ["not-a-type"])).rejects.toThrow("Invalid task type 'not-a-type'");
    await createChecklist("Feature", []);
    await expect(createChecklist(" FEATURE ", [])).rejects.toThrow("A checklist with this name already exists");
  });

  test("mapping a task type moves it off the checklist that had it", async () => {
    const { project, asUser, createChecklist } = await setupCatalog();
    await createChecklist("Feature", ["tests"], ["feature", "task"]);
    const bugFix = await createChecklist("Bug fix", ["regression"], ["bug"]);

    await asUser.mutation(api.checks.checklists.update, { checklistId: bugFix, taskTypeKeys: ["bug", "feature"] });

    const list = await asUser.query(api.checks.checklists.list, { projectId: project._id });
    expect(Object.fromEntries(list.map((checklist) => [checklist.name, checklist.taskTypeKeys]))).toEqual({
      "Bug fix": ["bug", "feature"],
      Feature: ["task"],
    });
  });

  test("members cannot manage checklists", async () => {
    const { ctx, org, project, createChecklist } = await setupCatalog();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const asMember = ctx.asUser(member);
    const checklistId = await createChecklist("Feature", []);

    await expect(
      asMember.mutation(api.checks.checklists.create, { projectId: project._id, name: "Nope", checkKeys: [], taskTypeKeys: [] })
    ).rejects.toThrow();
    await expect(asMember.mutation(api.checks.checklists.update, { checklistId, name: "Nope" })).rejects.toThrow();
    await expect(asMember.mutation(api.checks.checklists.remove, { checklistId })).rejects.toThrow();
  });
});

describe("task checklist", () => {
  test("a task starts with its type's default checklist, and a type with none has no checks", async () => {
    const { ctx, user, project, asUser, createChecklist } = await setupCatalog();
    const feature = await createChecklist("Feature", ["tests", "ui"], ["feature"]);
    const featureTask = await ctx.task(project._id, user._id, { taskTypeKey: "feature" });
    const plainTask = await ctx.task(project._id, user._id);

    expect(await asUser.query(api.checks.checklists.getForTask, { taskId: featureTask._id })).toEqual({
      checklists: [{ _id: feature, name: "Feature", isDefault: true, checkKeys: ["tests", "ui"], taskTypeKeys: ["feature"] }],
      checklistId: feature,
      followsTypeDefault: true,
      catalog: [
        { key: "regression", label: "Regression test added", instruction: "" },
        { key: "tests", label: "All tests pass", instruction: "" },
        { key: "ui", label: "UI verified", instruction: "" },
      ],
      checks: [
        { key: "tests", label: "All tests pass", instruction: "", added: false, results: [] },
        { key: "ui", label: "UI verified", instruction: "", added: false, results: [] },
      ],
    });
    const plain = await asUser.query(api.checks.checklists.getForTask, { taskId: plainTask._id });
    expect(plain).toMatchObject({ checklistId: null, checks: [], checklists: [{ isDefault: false }] });
  });

  test("switching stores the pick, No checks stores null, and the type default stores unset", async () => {
    const { ctx, t, user, project, asUser, createChecklist } = await setupCatalog();
    const feature = await createChecklist("Feature", ["tests", "ui"], ["feature"]);
    const bugFix = await createChecklist("Bug fix", ["regression"]);
    const task = await ctx.task(project._id, user._id, { taskTypeKey: "feature" });
    const stored = async () => (await t.run((run) => run.db.get("tasks", task._id)))?.checklistId;
    const rows = async () => (await asUser.query(api.checks.checklists.getForTask, { taskId: task._id }))?.checks.map((check) => check.key);

    await asUser.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: bugFix });
    expect(await stored()).toBe(bugFix);
    expect(await rows()).toEqual(["regression"]);

    await asUser.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: null });
    expect(await stored()).toBeNull();
    expect(await rows()).toEqual([]);

    await asUser.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: feature });
    expect(await stored()).toBeUndefined();
    expect(await rows()).toEqual(["tests", "ui"]);
  });

  test("the optimistic retype derives what the server returns after a type change", async () => {
    const { ctx, user, project, asUser, createChecklist } = await setupCatalog();
    await createChecklist("Feature", ["tests", "ui"], ["feature"]);
    await createChecklist("Bug fix", ["regression", "tests"], ["bug"]);
    const task = await ctx.task(project._id, user._id, { taskTypeKey: "feature" });
    const read = () => asUser.query(api.checks.checklists.getForTask, { taskId: task._id });

    const before = await read();
    await asUser.mutation(api.tasks.core.update, { id: task._id, taskTypeKey: "bug" });
    expect(retypeTaskChecks(before!, "bug")).toEqual(await read());
  });

  test("a deleted checklist falls back to the type default", async () => {
    const { ctx, user, project, asUser, createChecklist } = await setupCatalog();
    const feature = await createChecklist("Feature", ["tests"], ["feature"]);
    const bugFix = await createChecklist("Bug fix", ["regression"]);
    const task = await ctx.task(project._id, user._id, { taskTypeKey: "feature", checklistId: bugFix });

    await asUser.mutation(api.checks.checklists.remove, { checklistId: bugFix });

    const checks = await asUser.query(api.checks.checklists.getForTask, { taskId: task._id });
    expect(checks?.checklistId).toBe(feature);
  });

  test("rejects a checklist from another project, and viewers cannot switch", async () => {
    const { ctx, org, user, project, asUser } = await setupCatalog();
    const otherProject = await ctx.project(org._id, user._id);
    const foreign = await asUser.mutation(api.checks.checklists.create, { projectId: otherProject._id, name: "Other", checkKeys: [], taskTypeKeys: [] });
    const task = await ctx.task(project._id, user._id);

    await expect(asUser.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: foreign })).rejects.toThrow(
      "Checklist must belong to the task's project"
    );

    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);
    await expect(asViewer.mutation(api.tasks.core.setChecklist, { taskId: task._id, checklistId: null })).rejects.toThrow();
    expect(await asViewer.query(api.checks.checklists.getForTask, { taskId: task._id })).not.toBeNull();
  });

  test("returns null without task access", async () => {
    const { ctx, user, project } = await setupCatalog();
    const task = await ctx.task(project._id, user._id);
    const outsider = ctx.asUser(await ctx.user());
    expect(await outsider.query(api.checks.checklists.getForTask, { taskId: task._id })).toBeNull();
  });
});
