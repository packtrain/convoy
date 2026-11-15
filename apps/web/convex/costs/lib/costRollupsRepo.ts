import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { mergeCostMetadata, mergeModelUsage } from "./modelUsage";
import type { CostModelUsage, CostMetadata } from "./validators";

type Ctx = QueryCtx | MutationCtx;

export type CostRollupIdentity = {
  projectId: Id<"projects">;
  userId: Id<"users">;
  taskId: Id<"tasks"> | undefined;
  cliType: Doc<"costRollups">["cliType"];
  dayStartMs: number;
};

/**
 * Add one cost event to its daily rollup row, creating the row on first
 * spend for the (project, user, task?, cliType, day) identity.
 */
export async function upsertDailyCostRollup(
  ctx: MutationCtx,
  args: CostRollupIdentity & {
    costUsd: number;
    costMetadata?: CostMetadata;
    byModel: CostModelUsage[];
    runCount: number;
  }
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("costRollups")
    .withIndex("by_project_user_task_cliType_day", (q) =>
      q
        .eq("projectId", args.projectId)
        .eq("userId", args.userId)
        .eq("taskId", args.taskId)
        .eq("cliType", args.cliType)
        .eq("dayStartMs", args.dayStartMs)
    )
    .unique();

  if (existing) {
    await ctx.db.patch("costRollups", existing._id, {
      costUsd: existing.costUsd + args.costUsd,
      costMetadata: mergeCostMetadata(existing.costMetadata, args.costMetadata),
      byModel: mergeModelUsage(existing.byModel, args.byModel),
      runCount: (existing.runCount ?? 0) + args.runCount,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("costRollups", {
    projectId: args.projectId,
    userId: args.userId,
    taskId: args.taskId,
    cliType: args.cliType,
    dayStartMs: args.dayStartMs,
    costUsd: args.costUsd,
    costMetadata: args.costMetadata,
    byModel: args.byModel,
    runCount: args.runCount,
    updatedAt: now,
  });
}

/**
 * Add one cost event to its thread-grain daily row (companion write to
 * `upsertDailyCostRollup`, keyed only by (thread, day) so thread summary
 * reads stay bounded by the thread's active days).
 */
export async function upsertDailyThreadCostRollup(
  ctx: MutationCtx,
  args: {
    threadId: Id<"cliThreads">;
    dayStartMs: number;
    costUsd: number;
    costMetadata?: CostMetadata;
    byModel: CostModelUsage[];
    runCount: number;
  }
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("threadCostRollups")
    .withIndex("by_thread_and_day", (q) =>
      q.eq("threadId", args.threadId).eq("dayStartMs", args.dayStartMs)
    )
    .unique();

  if (existing) {
    await ctx.db.patch("threadCostRollups", existing._id, {
      costUsd: existing.costUsd + args.costUsd,
      costMetadata: mergeCostMetadata(existing.costMetadata, args.costMetadata),
      byModel: mergeModelUsage(existing.byModel, args.byModel),
      runCount: existing.runCount + args.runCount,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.insert("threadCostRollups", {
    threadId: args.threadId,
    dayStartMs: args.dayStartMs,
    costUsd: args.costUsd,
    costMetadata: args.costMetadata,
    byModel: args.byModel,
    runCount: args.runCount,
    updatedAt: now,
  });
}

/**
 * Rollup rows for a project within [fromDayStartMs, toDayStartMs]
 * (inclusive). Bounded: one row per active (user, task?, cliType, day)
 * tuple in the range.
 */
export async function listCostRollupsByProjectAndDayRange(
  ctx: Ctx,
  projectId: Id<"projects">,
  fromDayStartMs: number,
  toDayStartMs: number
): Promise<Doc<"costRollups">[]> {
  return await ctx.db
    .query("costRollups")
    .withIndex("by_project_and_day", (q) =>
      q
        .eq("projectId", projectId)
        .gte("dayStartMs", fromDayStartMs)
        .lte("dayStartMs", toDayStartMs)
    )
    .collect();
}

/** All rollup rows for one task (bounded: days worked × users × cliTypes). */
export async function listCostRollupsByTask(
  ctx: Ctx,
  taskId: Id<"tasks">
): Promise<Doc<"costRollups">[]> {
  return await ctx.db
    .query("costRollups")
    .withIndex("by_task_and_day", (q) => q.eq("taskId", taskId))
    .collect();
}

/** All thread-grain rows for one thread (bounded: days active). */
export async function listCostRollupsByThread(
  ctx: Ctx,
  threadId: Id<"cliThreads">
): Promise<Doc<"threadCostRollups">[]> {
  return await ctx.db
    .query("threadCostRollups")
    .withIndex("by_thread_and_day", (q) => q.eq("threadId", threadId))
    .collect();
}
