"use client";

import { Circle } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { cn } from "@/lib/utils";
import type { ThreadStatus } from "@/lib/threads/types";
import type { TaskAgentThreadWorkStatus } from "@/lib/tasks/types";

// Dot colors for the denormalized task agent-thread-work statuses (OS-1094), following the
// thread-list indicator conventions. Colors only — the wording comes from `THREAD_STATUS_META`,
// read directly at the call site so the Runs column can't drift from the thread list.

/**
 * `TaskAgentThreadWorkStatus` is the denormalized copy of `ThreadStatus` — the
 * same runs, snapshotted onto the task — and reading one union's labels from the
 * other's catalog only holds while they stay identical. Nothing structural
 * enforced that, so assert it: adding a state to either union alone breaks this
 * line rather than silently producing an `undefined` label.
 */
type AssertAgentThreadWorkStatusMatchesThreadStatus = [
  TaskAgentThreadWorkStatus extends ThreadStatus ? true : never,
  ThreadStatus extends TaskAgentThreadWorkStatus ? true : never,
];
const _assertStatusUnionsMatch: AssertAgentThreadWorkStatusMatchesThreadStatus = [true, true];
void _assertStatusUnionsMatch;

const AGENT_THREAD_WORK_DOT_CLASS: Record<TaskAgentThreadWorkStatus, string> = {
  pending: "text-muted-foreground fill-muted-foreground",
  streaming: "text-info fill-info",
  waiting_input: "text-warning fill-warning animate-pulse",
  completed: "text-success fill-success",
  failed: "text-destructive fill-destructive",
};

export function AgentThreadWorkStatusDot({
  status,
  className,
}: {
  status: TaskAgentThreadWorkStatus;
  className?: string;
}) {
  if (status === "streaming") {
    return <Spinner className={cn("size-3", className)} />;
  }
  return <Circle className={cn("size-2", AGENT_THREAD_WORK_DOT_CLASS[status], className)} />;
}
