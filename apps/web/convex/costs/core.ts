import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ProjectPermission } from "../../lib/authz/permissions";
import { cliTypeValidator } from "../lib/contracts/validators";
import { getAuthenticatedUser } from "../lib/access/auth";
import { requireAuthorizedProject } from "../lib/access/permissions";
import { ensure } from "../lib/shared/ensure";
import { join } from "../lib/shared/join";
import { getThreadById } from "../cli/threads/lib/cliThreadsRepo";
import { getTaskById, getTasksByIds } from "../tasks/lib/tasksRepo";
import { getUsersByIds } from "../users/lib/usersRepo";
import { errors } from "./errors";
import { DAY_MS, utcDayStartMs } from "./lib/dayBucket";
import {
  listCostRollupsByProjectAndDayRange,
  listCostRollupsByTask,
  listCostRollupsByThread,
  upsertDailyCostRollup,
  upsertDailyThreadCostRollup,
} from "./lib/costRollupsRepo";
import { resolveCostUsage } from "./lib/resolution";
import { addCost, emptyCostMetadata, metadataOrLegacy, mergeModelUsage } from "./lib/modelUsage";
import {
  extractedCostModelUsageValidator,
  type ResolvedCostTotal,
  costSummaryValidator,
  projectUsageDashboardValidator,
  type CostModelUsage,
  type CostSummary,
  type ProjectUsageDashboard,
} from "./lib/validators";

// Bounds the "most expensive tasks" list (rows beyond it are dropped, not
// aggregated — acceptable for a leaderboard).
const TOP_TASKS_LIMIT = 10;

/**
 * Resolve and record an event in both grains, off the streaming path.
 * Optional presence/run count fields preserve already-scheduled events.
 * See docs/specs/cost-tracking.md.
 */
export const recordUsage = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    taskId: v.optional(v.id("tasks")),
    threadId: v.id("cliThreads"),
    cliType: cliTypeValidator,
    atMs: v.number(),
    costUsd: v.number(),
    reportedCost: v.optional(v.boolean()),
    byModel: v.array(extractedCostModelUsageValidator),
    runCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const usage = resolveCostUsage({
      costUsd: args.costUsd,
      reportedCost: args.reportedCost,
      byModel: args.byModel,
    });
    const dayStartMs = utcDayStartMs(args.atMs);
    const runCount = args.runCount ?? 1;
    // Two grains from one event: project/task reads scan the coarse rows,
    // the thread summary scans its own (thread, day) rows.
    await upsertDailyCostRollup(ctx, {
      projectId: args.projectId,
      userId: args.userId,
      taskId: args.taskId,
      cliType: args.cliType,
      dayStartMs,
      costUsd: usage.costUsd,
      costMetadata: usage.costMetadata,
      byModel: usage.byModel,
      runCount,
    });
    await upsertDailyThreadCostRollup(ctx, {
      threadId: args.threadId,
      dayStartMs,
      costUsd: usage.costUsd,
      costMetadata: usage.costMetadata,
      byModel: usage.byModel,
      runCount,
    });
    return null;
  },
});

function modelTokens(entry: CostModelUsage): number {
  return entry.inputTokens + entry.cachedInputTokens + entry.outputTokens;
}

export const getProjectUsageDashboard = query({
  args: {
    projectId: v.id("projects"),
    fromDayStartMs: v.number(),
    toDayStartMs: v.number(),
  },
  returns: projectUsageDashboardValidator,
  handler: async (ctx, args): Promise<ProjectUsageDashboard> => {
    const user = await getAuthenticatedUser(ctx);
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.PROJECT_VIEW
    );

    const rangeMs = Math.max(args.toDayStartMs - args.fromDayStartMs + DAY_MS, DAY_MS);
    const [rows, prevRows] = await Promise.all([
      listCostRollupsByProjectAndDayRange(ctx, args.projectId, args.fromDayStartMs, args.toDayStartMs),
      listCostRollupsByProjectAndDayRange(
        ctx,
        args.projectId,
        args.fromDayStartMs - rangeMs,
        args.fromDayStartMs - DAY_MS
      ),
    ]);

    let total = { costUsd: 0, costMetadata: emptyCostMetadata() };
    let totalRuns = 0;
    let byModel: CostModelUsage[] = [];
    const byDay = new Map<number, ResolvedCostTotal & { byModel: CostModelUsage[] }>();
    const byMemberTotals = new Map<Id<"users">, ResolvedCostTotal>();
    const byCliTotals = new Map<string, ResolvedCostTotal>();
    const byTask = new Map<
      Id<"tasks"> | undefined,
      ResolvedCostTotal & { tokens: number; runCount: number }
    >();

    for (const row of rows) {
      total = addCost(total, row);
      totalRuns += row.runCount ?? 0;
      byModel = mergeModelUsage(byModel, row.byModel);

      const day = byDay.get(row.dayStartMs);
      byDay.set(row.dayStartMs, {
        ...addCost(day, row),
        byModel: mergeModelUsage(day?.byModel ?? [], row.byModel),
      });
      byMemberTotals.set(row.userId, addCost(byMemberTotals.get(row.userId), row));
      byCliTotals.set(row.cliType, addCost(byCliTotals.get(row.cliType), row));

      const task = byTask.get(row.taskId);
      byTask.set(row.taskId, {
        ...addCost(task, row),
        tokens: (task?.tokens ?? 0) + row.byModel.reduce((sum, entry) => sum + modelTokens(entry), 0),
        runCount: (task?.runCount ?? 0) + (row.runCount ?? 0),
      });
    }

    const byMember = await join([...byMemberTotals.entries()])
      .on(([userId]) => userId)
      .with((ids) => getUsersByIds(ctx, ids))
      .selectAll(([userId, totals], member) => ({
        userId,
        name: member?.name ?? "Former member",
        ...totals,
      }));

    const topTaskEntries = [...byTask.entries()]
      .sort((a, b) => b[1].costUsd - a[1].costUsd)
      .slice(0, TOP_TASKS_LIMIT);
    const topTasks = await join(topTaskEntries)
      .on(([taskId]) => taskId)
      .with((ids) => getTasksByIds(ctx, [...ids]))
      .selectAll(([taskId, totals], task) => ({
        ...(taskId ? { taskId } : {}),
        ...(task ? { ref: `${project.alias}-${task.refNumber}`, name: task.name } : {}),
        costUsd: totals.costUsd,
        costMetadata: totals.costMetadata,
        tokens: totals.tokens,
        runCount: totals.runCount,
      }));

    const previous = prevRows.reduce((sum, row) => addCost(sum, row), {
      costUsd: 0, costMetadata: emptyCostMetadata(),
    });
    return {
      totalCostUsd: total.costUsd,
      costMetadata: total.costMetadata,
      prevTotalCostUsd: previous.costUsd,
      prevCostMetadata: previous.costMetadata,
      totalRuns,
      byDay: [...byDay.entries()]
        .map(([dayStartMs, day]) => ({
          dayStartMs,
          costUsd: day.costUsd,
          costMetadata: day.costMetadata,
          byModel: day.byModel.map(({ model, costUsd, costMetadata }) => ({
            model, costUsd, costMetadata: metadataOrLegacy(costMetadata),
          })),
        }))
        .sort((a, b) => a.dayStartMs - b.dayStartMs),
      byModel,
      byMember: byMember.sort((a, b) => b.costUsd - a.costUsd),
      byCli: [...byCliTotals.entries()]
        .map(([cliType, totals]) => ({ cliType, ...totals }))
        .sort((a, b) => b.costUsd - a.costUsd),
      topTasks,
    };
  },
});

function summarizeRollups(
  rows: Array<Pick<Doc<"costRollups">, "costUsd" | "costMetadata" | "byModel" | "dayStartMs">>
): CostSummary {
  let total = { costUsd: 0, costMetadata: emptyCostMetadata() };
  let byModel: CostModelUsage[] = [];
  const byDayTotals = new Map<number, ResolvedCostTotal>();
  for (const row of rows) {
    total = addCost(total, row);
    byModel = mergeModelUsage(byModel, row.byModel);
    byDayTotals.set(row.dayStartMs, addCost(byDayTotals.get(row.dayStartMs), row));
  }
  return {
    totalCostUsd: total.costUsd,
    costMetadata: total.costMetadata,
    byModel,
    byDay: [...byDayTotals.entries()]
      .map(([dayStartMs, totals]) => ({ dayStartMs, ...totals }))
      .sort((a, b) => a.dayStartMs - b.dayStartMs),
  };
}

export const getTaskCostSummary = query({
  args: { taskId: v.id("tasks") },
  returns: costSummaryValidator,
  handler: async (ctx, args): Promise<CostSummary> => {
    const user = await getAuthenticatedUser(ctx);
    const task = await ensure(getTaskById(ctx, args.taskId)).notDeleted(
      errors.TASK_NOT_FOUND
    );
    await requireAuthorizedProject(
      ctx,
      user._id,
      task.projectId,
      ProjectPermission.TASK_VIEW,
      { convexErrorMessage: errors.TASK_NOT_FOUND }
    );

    return summarizeRollups(await listCostRollupsByTask(ctx, args.taskId));
  },
});

export const getThreadCostSummary = query({
  args: { threadId: v.id("cliThreads") },
  returns: costSummaryValidator,
  handler: async (ctx, args): Promise<CostSummary> => {
    const user = await getAuthenticatedUser(ctx);
    const thread = await ensure(getThreadById(ctx, args.threadId)).notDeleted(
      errors.THREAD_NOT_FOUND
    );
    await requireAuthorizedProject(
      ctx,
      user._id,
      thread.projectId,
      ProjectPermission.CLI_THREAD,
      { convexErrorMessage: errors.THREAD_NOT_FOUND }
    );

    return summarizeRollups(await listCostRollupsByThread(ctx, args.threadId));
  },
});
