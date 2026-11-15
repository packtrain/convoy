"use client";

import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CliThreadGoal } from "@/convex/lib/contracts/validators";
import { formatContextWindowTokens } from "@/lib/cli-stream-ui/context-window";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<CliThreadGoal["status"], string> = {
  active: "Goal active",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usageLimited: "Goal stopped at a usage limit",
  budgetLimited: "Goal reached its token budget",
  complete: "Goal met",
};

function goalLabel(goal: CliThreadGoal): string {
  if (goal.status !== "active") {
    return STATUS_LABELS[goal.status];
  }
  const checks = goal.iterations > 0 ? ` · ${goal.iterations} ${goal.iterations === 1 ? "check" : "checks"}` : "";
  const tokens = goal.tokensUsed ? ` · ${formatContextWindowTokens(goal.tokensUsed)} tokens` : "";
  return `Goal active${checks}${tokens}`;
}

function iconColor(status: CliThreadGoal["status"]): string {
  if (status === "complete") return "text-success";
  if (status === "active") return "text-info";
  if (status === "paused") return "text-muted-foreground";
  return "text-warning";
}

/**
 * Composer target icon for the thread's runtime goal, beside the mode selector.
 * Spec: docs/specs/cli-thread-goal.md.
 */
export function GoalButton({ goal, onClear }: { goal: CliThreadGoal | undefined; onClear?: () => void }) {
  if (!goal) {
    return null;
  }

  const label = goalLabel(goal);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="cursor-pointer"
          aria-label={`${label}: ${goal.objective}`}
          title={label}
        >
          <Crosshair className={cn("size-4", iconColor(goal.status))} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 max-w-[90vw] px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </div>
          <div className="break-words text-xs font-medium text-foreground">{goal.objective}</div>
          {goal.lastReason ? (
            <div className="break-words text-xs text-muted-foreground">
              Last check: {goal.lastReason}
            </div>
          ) : null}
          {goal.tokensUsed !== undefined ? (
            <div className="text-xs text-muted-foreground">
              Tokens: {formatContextWindowTokens(goal.tokensUsed)} used
              {goal.tokenBudget !== undefined ? ` of ${formatContextWindowTokens(goal.tokenBudget)}` : ""}
            </div>
          ) : null}
          {goal.status === "paused" ? (
            <div className="text-xs text-muted-foreground">Send /goal resume to continue.</div>
          ) : null}
          {onClear ? (
            <div className="flex justify-end pt-1">
              <Button type="button" variant="outline" size="sm" className="cursor-pointer" onClick={onClear}>
                Clear goal
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
