"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { CostSummary } from "@/convex/costs/lib/validators";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatContextWindowTokens } from "@/lib/cli-stream-ui";
import {
  describeCost,
  hasCostEvidence,
  modelTokenShares,
} from "@/lib/costs/cost-summary";
import { cn } from "@/lib/utils";

function CostBreakdown({
  label,
  summary,
}: {
  label: string;
  summary: CostSummary;
}) {
  const shares = modelTokenShares(summary.byModel);
  const cost = describeCost({
    costUsd: summary.totalCostUsd,
    costMetadata: summary.costMetadata,
  }, { showLegacyLabel: false });
  return (
    <div className="space-y-1.5 leading-tight">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="whitespace-nowrap text-xs font-medium text-foreground">
        {cost.label} total
      </div>
      {summary.costMetadata.hasUnpriced ? (
        <p className="text-xs text-muted-foreground">Some usage is not priced.</p>
      ) : null}
      {summary.costMetadata.modelAllocationIncomplete ? (
        <p className="text-xs text-muted-foreground">Model breakdown is incomplete.</p>
      ) : null}
      {summary.costMetadata.hasDataGap ? (
        <p className="text-xs text-muted-foreground">Historical usage was excluded.</p>
      ) : null}
      <div className="space-y-1">
        {shares.map((share) => (
          <div
            key={share.model}
            className="flex items-center justify-between gap-4 whitespace-nowrap text-xs text-muted-foreground"
          >
            <span className="min-w-0 truncate">{share.model}</span>
            <span className="tabular-nums">
              {formatContextWindowTokens(share.tokens)} tokens ·{" "}
              {Math.round(share.shareOfTokens)}% · {describeCost(share, { showEstimateLabel: false, showLegacyLabel: false }).label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Recorded task/thread costs, including zero and unpriced usage. */
export function CostIndicator({
  taskId,
  threadId,
  className,
}: {
  taskId?: Id<"tasks">;
  threadId?: Id<"cliThreads">;
  className?: string;
}) {
  const taskSummary = useQuery(
    api.costs.core.getTaskCostSummary,
    taskId ? { taskId } : "skip"
  );
  const threadSummary = useQuery(
    api.costs.core.getThreadCostSummary,
    threadId ? { threadId } : "skip"
  );

  const task =
    taskSummary && hasRecordedUsage(taskSummary) ? taskSummary : undefined;
  const thread =
    threadSummary && hasRecordedUsage(threadSummary)
      ? threadSummary
      : undefined;

  if (!task && !thread) {
    return null;
  }

  const taskCost = task
    ? describeCost({
        costUsd: task.totalCostUsd,
        costMetadata: task.costMetadata,
      }, { showEstimateLabel: false, showLegacyLabel: false })
    : undefined;
  const threadCost = thread
    ? describeCost({
        costUsd: thread.totalCostUsd,
        costMetadata: thread.costMetadata,
      }, { showEstimateLabel: false, showLegacyLabel: false })
    : undefined;
  const showBoth =
    taskCost &&
    threadCost &&
    (task?.totalCostUsd !== thread?.totalCostUsd ||
      taskCost.label !== threadCost.label ||
      taskCost.description !== threadCost.description);
  const triggerLabel = showBoth
    ? `${taskCost.label} / ${threadCost.label}`
    : (taskCost ?? threadCost)!.label;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-pointer items-center rounded-full text-xs font-medium tabular-nums text-muted-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            className
          )}
          aria-label={`Agent cost ${triggerLabel}`}
        >
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-auto min-w-0 px-3 py-2"
      >
        <div className="space-y-3">
          {task ? <CostBreakdown label="Task cost" summary={task} /> : null}
          {thread ? (
            <CostBreakdown label="Thread cost" summary={thread} />
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function hasRecordedUsage(summary: CostSummary): boolean {
  return (
    summary.byDay.length > 0 ||
    summary.byModel.length > 0 ||
    summary.totalCostUsd > 0 ||
    hasCostEvidence(summary.costMetadata)
  );
}
