"use client";

import { Check, Circle, CircleAlert, CircleDashed } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import type { WatchStatus } from "@/lib/watch-tower/watch-tower-view";
import { cn } from "@/lib/utils";

/** Row words come from `THREAD_STATUS_META`; only the review bucket, which has no thread status, words itself. */
export const STATUS_META: Record<
  WatchStatus,
  { label: string; dotClassName: string; pulse?: boolean }
> = {
  waiting_input: {
    label: THREAD_STATUS_META.waiting_input.label,
    dotClassName: "text-warning fill-warning",
    pulse: true,
  },
  failed: { label: THREAD_STATUS_META.failed.label, dotClassName: "text-destructive fill-destructive" },
  running: { label: THREAD_STATUS_META.streaming.label, dotClassName: "text-info fill-info" },
  needs_review: {
    label: "Needs review",
    dotClassName: "text-info fill-info",
  },
  done: { label: THREAD_STATUS_META.completed.label, dotClassName: "text-success fill-success" },
};

/**
 * A queued thread no agent has claimed yet: no connected CLI has picked it up,
 * so a "Running" spinner would be a lie. Clears when an agent claims it.
 */
export function isWaitingForAgent(thread: {
  status: string;
  processingState?: string | null;
}): boolean {
  return thread.status === "pending" && thread.processingState === "idle";
}

export function StatusIndicator({
  status,
  waitingForAgent,
}: {
  status: WatchStatus;
  waitingForAgent?: boolean;
}) {
  // Hidden on mobile: sections already group by status, so the column is
  // redundant there and only steals width from the title.
  const base =
    "pointer-events-none relative z-10 hidden items-center gap-2 justify-self-end text-xs sm:inline-flex";
  if (waitingForAgent) {
    return (
      <span className={cn(base, "text-muted-foreground")}>
        <CircleDashed className="size-3.5" />
        Waiting for agent
      </span>
    );
  }
  const meta = STATUS_META[status];
  return (
    <span className={cn(base, "text-foreground")}>
      {status === "running" ? (
        <Spinner className="size-3 text-info" />
      ) : status === "done" ? (
        <Check className="size-3.5 text-success" />
      ) : status === "failed" ? (
        <CircleAlert className="size-3.5 text-destructive" />
      ) : (
        <Circle
          className={cn("size-2", meta.dotClassName, meta.pulse && "animate-pulse")}
        />
      )}
      {meta.label}
    </span>
  );
}
