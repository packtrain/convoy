import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { createTestContext } from "../../convex-testing";
import * as pricing from "./lib/pricing/resolution";
import { metadataOrLegacy } from "./lib/modelUsage";
import { DAY_MS } from "./lib/dayBucket";

const DAY_1 = 1_900_800_000_000 - (1_900_800_000_000 % DAY_MS);
const DAY_2 = DAY_1 + DAY_MS;

function usage(model: string, costUsd: number, inputTokens = 10) {
  return {
    costUsd,
    byModel: [
      {
        model,
        inputTokens,
        cachedInputTokens: 0,
        outputTokens: 5,
        costUsd,
      },
    ],
  };
}

describe("costs.core", () => {
  test("recordUsage merges same-identity events and separates identities", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const otherThread = await ctx.cliThread(user._id, project._id, profile._id);

    const base = {
      projectId: project._id,
      userId: user._id,
      threadId: thread._id,
      cliType: "claude-code" as const,
    };

    // Two events, same identity/day → one merged row with runCount 2.
    await t.mutation(internal.costs.core.recordUsage, {
      ...base,
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.02),
    });
    await t.mutation(internal.costs.core.recordUsage, {
      ...base,
      atMs: DAY_1 + 2000,
      ...usage("claude-opus-4-6", 0.03),
    });
    // Same day, different model → merged row, second byModel entry.
    await t.mutation(internal.costs.core.recordUsage, {
      ...base,
      atMs: DAY_1 + 3000,
      ...usage("claude-haiku-4-5", 0.01),
    });
    // Next day → separate row/day bucket.
    await t.mutation(internal.costs.core.recordUsage, {
      ...base,
      atMs: DAY_2 + 1000,
      ...usage("claude-opus-4-6", 0.1),
    });
    // Different thread → merges into the same coarse row (thread grain
    // lives in threadCostRollups), same project totals.
    await t.mutation(internal.costs.core.recordUsage, {
      ...base,
      threadId: otherThread._id,
      atMs: DAY_2 + 2000,
      ...usage("claude-opus-4-6", 0.04),
    });

    const dash = await asUser.query(api.costs.core.getProjectUsageDashboard, {
      projectId: project._id,
      fromDayStartMs: DAY_1,
      toDayStartMs: DAY_2,
    });

    expect(dash.totalCostUsd).toBeCloseTo(0.2);
    expect(dash.totalRuns).toBe(5);
    expect(dash.byDay).toEqual([
      {
        dayStartMs: DAY_1,
        costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.06),
        byModel: expect.arrayContaining([
          { model: "claude-opus-4-6", costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.05) },
          { model: "claude-haiku-4-5", costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.01) },
        ]),
      },
      {
        dayStartMs: DAY_2,
        costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.14),
        byModel: [{ model: "claude-opus-4-6", costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.14) }],
      },
    ]);
    expect(dash.byModel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "claude-opus-4-6",
          costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.19),
          inputTokens: 40,
        }),
      ])
    );
    expect(dash.byCli).toEqual([
      { cliType: "claude-code", costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.2) },
    ]);

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("costRollups").collect();
      expect(rows[0]?.runCount).toBeGreaterThanOrEqual(1);
      // Coarse grain: the second thread's event merged into the DAY_2 row.
      expect(rows).toHaveLength(2);
      // Thread grain: one row per (thread, day).
      const threadRows = await runCtx.db.query("threadCostRollups").collect();
      expect(threadRows).toHaveLength(3);
    });
  });

  test("dashboard spans members, CLIs, tasks, and prior-period totals; range filters days", async () => {
    const ctx = createTestContext();
    const { user, org, project, asUser, t } = await ctx.setupProject();
    const member = await ctx.user();
    await ctx.orgMember(org._id, member._id, "member");
    await ctx.projectMember(project._id, member._id, "member");
    const profile = await ctx.cliProfile(user._id, project._id);
    const taskThread = await ctx.cliThread(user._id, project._id, profile._id);
    const memberThread = await ctx.cliThread(member._id, project._id, profile._id);
    const prevThread = await ctx.cliThread(user._id, project._id, profile._id);

    const task = await ctx.task(project._id, user._id, { name: "Expensive one" });

    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      taskId: task._id,
      threadId: taskThread._id,
      cliType: "claude-code",
      atMs: DAY_2 + 1000,
      ...usage("claude-opus-4-6", 0.05),
    });
    // Taskless thread spend still counts toward the project.
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: member._id,
      threadId: memberThread._id,
      cliType: "codex",
      atMs: DAY_2 + 2000,
      ...usage("gpt-5.4-codex", 0, 100),
    });
    // Previous period (immediately before the queried single day).
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      threadId: prevThread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 1),
    });

    const dash = await asUser.query(api.costs.core.getProjectUsageDashboard, {
      projectId: project._id,
      fromDayStartMs: DAY_2,
      toDayStartMs: DAY_2,
    });

    expect(dash.totalCostUsd).toBeCloseTo(0.05);
    expect(dash.prevTotalCostUsd).toBeCloseTo(1);
    expect(dash.byMember).toEqual([
      expect.objectContaining({ userId: user._id, costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.05) }),
      expect.objectContaining({ userId: member._id, costUsd: 0 }),
    ]);
    expect(dash.byMember[0]?.name).toBeTruthy();
    expect(dash.byCli[0]).toEqual({ cliType: "claude-code", costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.05) });

    // Task leaderboard: named task entry + taskless entry.
    const taskEntry = dash.topTasks.find((entry) => entry.taskId === task._id);
    expect(taskEntry).toMatchObject({
      ref: expect.stringMatching(/-\d+$/),
      name: "Expensive one",
      costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.05),
      runCount: 1,
    });
    const noTaskEntry = dash.topTasks.find((entry) => entry.taskId === undefined);
    expect(noTaskEntry).toMatchObject({ costUsd: 0, tokens: 105, runCount: 1 });
    expect(noTaskEntry?.ref).toBeUndefined();
  });

  test("dashboard requires project access", async () => {
    const ctx = createTestContext();
    const { project } = await ctx.setupProject();
    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);

    await expect(
      asOutsider.query(api.costs.core.getProjectUsageDashboard, {
        projectId: project._id,
        fromDayStartMs: DAY_1,
        toDayStartMs: DAY_2,
      })
    ).rejects.toThrow();
  });

  test("task summary isolates the task and hides tasks the user cannot view", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const task = await ctx.task(project._id, user._id);
    const otherTask = await ctx.task(project._id, user._id);

    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      taskId: task._id,
      threadId: thread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.07),
    });
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      taskId: otherTask._id,
      threadId: thread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.5),
    });
    // Taskless rows never leak into a task summary.
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      threadId: thread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.9),
    });

    const summary = await asUser.query(api.costs.core.getTaskCostSummary, {
      taskId: task._id,
    });
    expect(summary.totalCostUsd).toBeCloseTo(0.07);
    expect(summary.byDay).toEqual([
      { dayStartMs: DAY_1, costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.07) },
    ]);

    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);
    await expect(
      asOutsider.query(api.costs.core.getTaskCostSummary, { taskId: task._id })
    ).rejects.toThrow("Task not found");
  });

  test("project viewers read the usage dashboard and task summaries", async () => {
    const ctx = createTestContext();
    const { user, org, project } = await ctx.setupProject();
    const task = await ctx.task(project._id, user._id);
    const viewer = await ctx.user();
    await ctx.orgMember(org._id, viewer._id, "member");
    await ctx.projectMember(project._id, viewer._id, "viewer");
    const asViewer = ctx.asUser(viewer);

    const dash = await asViewer.query(api.costs.core.getProjectUsageDashboard, {
      projectId: project._id,
      fromDayStartMs: DAY_1,
      toDayStartMs: DAY_2,
    });
    expect(dash.totalCostUsd).toBe(0);
    const summary = await asViewer.query(api.costs.core.getTaskCostSummary, { taskId: task._id });
    expect(summary.totalCostUsd).toBe(0);
  });

  test("thread summary isolates the thread and hides threads the user cannot view", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const otherThread = await ctx.cliThread(user._id, project._id, profile._id);

    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      threadId: thread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.07),
    });
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      threadId: thread._id,
      cliType: "claude-code",
      atMs: DAY_2 + 1000,
      ...usage("claude-opus-4-6", 0.02),
    });
    // Other threads never leak into a thread summary.
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id,
      userId: user._id,
      threadId: otherThread._id,
      cliType: "claude-code",
      atMs: DAY_1 + 1000,
      ...usage("claude-opus-4-6", 0.9),
    });

    const summary = await asUser.query(api.costs.core.getThreadCostSummary, {
      threadId: thread._id,
    });
    expect(summary.totalCostUsd).toBeCloseTo(0.09);
    expect(summary.byDay).toEqual([
      { dayStartMs: DAY_1, costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.07) },
      { dayStartMs: DAY_2, costMetadata: metadataOrLegacy(), costUsd: expect.closeTo(0.02) },
    ]);

    const outsider = await ctx.user();
    const asOutsider = ctx.asUser(outsider);
    await expect(
      asOutsider.query(api.costs.core.getThreadCostSummary, {
        threadId: thread._id,
      })
    ).rejects.toThrow("Thread not found");
  });
});

describe("cost source and coverage", () => {

  test("both grains and every summary preserve mixed evidence across days and legacy rows", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const task = await ctx.task(project._id, user._id);
    const base = { projectId: project._id, userId: user._id, threadId: thread._id, taskId: task._id, cliType: "codex" as const };
    const model = { model: "gpt-5.5", inputTokens: 100, cachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, costUsd: 0, reportedCost: false };
    const events = [
      { costUsd: 10, reportedCost: true, byModel: [{ ...model, costUsd: 10, reportedCost: true }] },
      { costUsd: 0, reportedCost: false, byModel: [model] },
      { costUsd: 0, reportedCost: false, byModel: [{ ...model, model: "unknown" }] },
      { costUsd: 3, byModel: [{ ...model, costUsd: 3, reportedCost: undefined }] },
    ];
    for (const atMs of [DAY_1 - DAY_MS, DAY_1, DAY_2]) {
      for (const event of events) await t.mutation(internal.costs.core.recordUsage, { ...base, atMs, ...event });
    }
    const dash = await asUser.query(api.costs.core.getProjectUsageDashboard, { projectId: project._id, fromDayStartMs: DAY_1, toDayStartMs: DAY_2 });
    const mixed = { hasReported: true, hasEstimated: true, hasUnpriced: true, hasLegacy: true };
    expect(dash.totalCostUsd).toBeGreaterThan(26);
    expect(dash.prevTotalCostUsd).toBeCloseTo(dash.totalCostUsd / 2);
    expect(dash.totalRuns).toBe(8);
    expect(dash.costMetadata).toMatchObject(mixed);
    expect(dash.prevCostMetadata).toMatchObject(mixed);
    for (const group of [dash.byDay, dash.byMember, dash.byCli, dash.topTasks]) {
      for (const row of group) expect(row.costMetadata).toMatchObject(mixed);
    }
    for (const models of [dash.byModel, ...dash.byDay.map((day) => day.byModel)]) {
      expect(models.find((row) => row.model === "gpt-5.5")?.costMetadata).toMatchObject({ hasReported: true, hasEstimated: true, hasLegacy: true });
      expect(models.find((row) => row.model === "unknown")?.costMetadata?.hasUnpriced).toBe(true);
    }
    const summaries = await Promise.all([
      asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id }),
      asUser.query(api.costs.core.getTaskCostSummary, { taskId: task._id }),
    ]);
    for (const summary of summaries) {
      expect(summary.totalCostUsd).toBeCloseTo(dash.totalCostUsd * 1.5);
      expect(summary.costMetadata).toMatchObject(mixed);
      for (const day of summary.byDay) expect(day.costMetadata).toMatchObject(mixed);
    }
    await t.run(async (dbCtx) => {
      const coarse = await dbCtx.db.query("costRollups").collect();
      const threads = await dbCtx.db.query("threadCostRollups").collect();
      expect(coarse).toHaveLength(3);
      expect(threads).toHaveLength(3);
      for (const row of coarse) {
        const companion = threads.find((other) => other.dayStartMs === row.dayStartMs)!;
        expect(companion.costMetadata).toEqual(row.costMetadata);
        expect(companion.byModel).toEqual(row.byModel);
        expect(companion.costUsd).toBe(row.costUsd);
        expect(companion.runCount).toBe(row.runCount);
      }
    });
  });

  test.each([0, 10])("aggregate-only reported %s survives recording with complete total and incomplete allocation", async (costUsd) => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id, userId: user._id, threadId: thread._id, cliType: "claude-code", atMs: DAY_1,
      costUsd, reportedCost: true, byModel: [],
    });
    const summary = await asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id });
    expect(summary).toMatchObject({ totalCostUsd: costUsd, byModel: [], costMetadata: { hasReported: true, hasUnpriced: false, modelAllocationIncomplete: true } });
  });
});

test("reading and extending an existing row without metadata preserves its historical cost", async () => {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id);
  const base = { projectId: project._id, userId: user._id, cliType: "codex" as const };
  const oldUsage = usage("gpt-5.5", 7);
  await t.run(async (dbCtx) => {
    await dbCtx.db.insert("costRollups", { ...base, ...oldUsage, dayStartMs: DAY_1, updatedAt: DAY_1, runCount: 1 });
    await dbCtx.db.insert("threadCostRollups", { threadId: thread._id, ...oldUsage, dayStartMs: DAY_1, updatedAt: DAY_1, runCount: 1 });
  });
  const old = await asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id });
  expect(old).toMatchObject({ totalCostUsd: 7, costMetadata: { hasLegacy: true, hasEstimated: false } });
  await t.mutation(internal.costs.core.recordUsage, { ...base, threadId: thread._id, atMs: DAY_1, costUsd: 0, reportedCost: false,
    byModel: [{ model: "gpt-5.5", inputTokens: 100, cachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, costUsd: 0, reportedCost: false }],
  });
  const updated = await asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id });
  expect(updated.totalCostUsd).toBeCloseTo(7.0008);
  expect(updated.costMetadata).toMatchObject({ hasLegacy: true, hasEstimated: true });
  expect(updated.byModel[0]?.cacheReadTokens).toBeUndefined();
  const dashboard = await asUser.query(api.costs.core.getProjectUsageDashboard, { projectId: project._id, fromDayStartMs: DAY_1, toDayStartMs: DAY_1 });
  expect(dashboard.totalCostUsd).toBe(updated.totalCostUsd);
  expect(dashboard.costMetadata).toEqual(updated.costMetadata);
});

test("a catalog exception records tokens as unpriced in both grains", async () => {
  const failure = vi.spyOn(pricing, "estimateTokenCost").mockImplementation(() => {
    throw new Error("catalog unavailable");
  });
  try {
    const ctx = createTestContext();
    const { user, project, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    await t.mutation(internal.costs.core.recordUsage, {
      projectId: project._id, userId: user._id, threadId: thread._id, cliType: "codex", atMs: DAY_1,
      costUsd: 0, reportedCost: false,
      byModel: [{ model: "gpt-5.5", inputTokens: 100, cachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, costUsd: 0, reportedCost: false }],
    });
    expect(failure).toHaveBeenCalledOnce();
    for (const table of ["costRollups", "threadCostRollups"] as const) {
      const rows = await t.run((dbCtx) => dbCtx.db.query(table).collect());
      expect(rows[0]).toMatchObject({ costUsd: 0, runCount: 1, costMetadata: { hasUnpriced: true, hasEstimated: false }, byModel: [{ inputTokens: 100, outputTokens: 10 }] });
    }
  } finally {
    failure.mockRestore();
  }
});

test("unknown model allocation stays incomplete for mixed usage without known model pricing", async () => {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id);
  const task = await ctx.task(project._id, user._id);
  const model = { model: "unknown", inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, costUsd: 10, reportedCost: true };
  await t.mutation(internal.costs.core.recordUsage, {
    projectId: project._id, userId: user._id, threadId: thread._id, taskId: task._id,
    cliType: "opencode", atMs: DAY_1, costUsd: 10, reportedCost: false,
    byModel: [model, { ...model, costUsd: 0, reportedCost: false }],
  });
  const summary = await asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id });
  expect(summary.costMetadata).toMatchObject({ hasReported: true, hasUnpriced: true, modelAllocationIncomplete: true });
  expect(summary.byModel[0]?.costMetadata?.modelAllocationIncomplete).toBe(true);
  expect(await asUser.query(api.costs.core.getTaskCostSummary, { taskId: task._id })).toEqual(summary);
  const dashboard = await asUser.query(api.costs.core.getProjectUsageDashboard, { projectId: project._id, fromDayStartMs: DAY_1, toDayStartMs: DAY_1 });
  expect(dashboard.costMetadata).toEqual(summary.costMetadata);
  for (const group of [dashboard.byDay, dashboard.byMember, dashboard.byCli, dashboard.topTasks, dashboard.byModel]) {
    expect(group[0]?.costMetadata?.modelAllocationIncomplete).toBe(true);
  }
});


test("history gaps propagate through both grains, every grouping and previous periods", async () => {
  const ctx = createTestContext();
  const { user, project, asUser, t } = await ctx.setupProject();
  const profile = await ctx.cliProfile(user._id, project._id);
  const thread = await ctx.cliThread(user._id, project._id, profile._id);
  const task = await ctx.task(project._id, user._id);
  const costMetadata = { hasReported: true, hasEstimated: false, hasUnpriced: false, hasLegacy: false, modelAllocationIncomplete: false, hasDataGap: true };
  await t.run(async (runCtx) => {
    for (const dayStartMs of [DAY_1, DAY_2]) {
      const totals = { dayStartMs, updatedAt: Date.now(), costUsd: 3, costMetadata, runCount: 1,
        byModel: [{ model: "gpt-5.5", costUsd: 3, inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costMetadata }] };
      await runCtx.db.insert("costRollups", { ...totals, projectId: project._id, userId: user._id, taskId: task._id, cliType: "codex" });
      await runCtx.db.insert("threadCostRollups", { ...totals, threadId: thread._id });
    }
  });
  const dashboard = await asUser.query(api.costs.core.getProjectUsageDashboard, { projectId: project._id, fromDayStartMs: DAY_2, toDayStartMs: DAY_2 });
  expect(dashboard.totalCostUsd).toBe(3);
  expect(dashboard.totalRuns).toBe(1);
  for (const metadata of [dashboard.costMetadata, dashboard.prevCostMetadata,
    ...dashboard.byModel.map((row) => row.costMetadata), ...dashboard.byDay.map((row) => row.costMetadata),
    ...dashboard.byDay.flatMap((row) => row.byModel.map((entry) => entry.costMetadata)),
    ...dashboard.byMember.map((row) => row.costMetadata), ...dashboard.byCli.map((row) => row.costMetadata),
    ...dashboard.topTasks.map((row) => row.costMetadata)]) {
    expect(metadata).toMatchObject({ hasDataGap: true, hasReported: true });
  }
  for (const summary of [
    await asUser.query(api.costs.core.getTaskCostSummary, { taskId: task._id }),
    await asUser.query(api.costs.core.getThreadCostSummary, { threadId: thread._id }),
  ]) {
    expect(summary.totalCostUsd).toBe(6);
    expect(summary.costMetadata.hasDataGap).toBe(true);
    expect(summary.byModel[0].costMetadata?.hasDataGap).toBe(true);
    expect(summary.byDay.every((day) => day.costMetadata.hasDataGap)).toBe(true);
  }
});
