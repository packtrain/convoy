import { v, type Infer } from "convex/values";
import {
  costMetadataValidator,
  costModelUsageValidator,
  resolvedCostTotalValidator,
} from "../../lib/contracts/validators";
export {
  costMetadataValidator,
  costModelUsageValidator,
  costTotalValidator,
  costUsageValidator,
  extractedCostModelUsageValidator,
  toCostModelUsage,
  type CostMetadata,
  type CostModelUsage,
  type CostTotal,
  type CostUsage,
  type ExtractedCostUsage,
  type ExtractedCostModelUsage,
  type ResolvedCostTotal,
} from "../../lib/contracts/validators";

export const costByDayValidator = v.object({
  dayStartMs: v.number(),
  ...resolvedCostTotalValidator.fields,
});

// Shared shape for task- and thread-scoped summaries.
export const costSummaryValidator = v.object({
  totalCostUsd: v.number(),
  costMetadata: costMetadataValidator,
  byModel: v.array(costModelUsageValidator),
  byDay: v.array(costByDayValidator),
});

export type CostSummary = Infer<typeof costSummaryValidator>;

export const projectUsageDashboardValidator = v.object({
  totalCostUsd: v.number(),
  costMetadata: costMetadataValidator,
  // Same-length range immediately before the requested one (period delta).
  prevTotalCostUsd: v.number(),
  prevCostMetadata: costMetadataValidator,
  totalRuns: v.number(),
  byDay: v.array(
    v.object({
      dayStartMs: v.number(),
      ...resolvedCostTotalValidator.fields,
      byModel: v.array(
        v.object({ model: v.string(), costUsd: v.number(), costMetadata: costMetadataValidator })
      ),
    })
  ),
  byModel: v.array(costModelUsageValidator),
  byMember: v.array(
    v.object({
      userId: v.id("users"),
      name: v.string(),
      ...resolvedCostTotalValidator.fields,
    })
  ),
  byCli: v.array(
    v.object({
      cliType: v.string(),
      ...resolvedCostTotalValidator.fields,
    })
  ),
  // Top tasks by cost (bounded); the entry without taskId aggregates
  // unattached-thread spend.
  topTasks: v.array(
    v.object({
      taskId: v.optional(v.id("tasks")),
      ref: v.optional(v.string()),
      name: v.optional(v.string()),
      ...resolvedCostTotalValidator.fields,
      tokens: v.number(),
      runCount: v.number(),
    })
  ),
});

export type ProjectUsageDashboard = Infer<typeof projectUsageDashboardValidator>;
