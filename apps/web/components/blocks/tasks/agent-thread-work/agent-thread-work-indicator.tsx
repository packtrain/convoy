"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import type { TaskAgentThreadWorkEntry } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import { AgentThreadWorkStatusDot } from "./agent-thread-work-status";

/**
 * Compact linked-thread-work indicator for task rows (OS-1094): a single
 * status dot for the latest entry, all entries detailed in the tooltip.
 */
export function AgentThreadWorkIndicator({
  entries,
  className,
}: {
  entries: TaskAgentThreadWorkEntry[] | undefined;
  className?: string;
}) {
  if (!entries || entries.length === 0) {
    return null;
  }

  // Stored order is least-recently-updated first (sync re-appends); show newest first.
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const latest = sorted[0];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex shrink-0 items-center text-muted-foreground", className)}
          aria-label={`Agent thread work: ${THREAD_STATUS_META[latest.status].label}`}
        >
          <AgentThreadWorkStatusDot status={latest.status} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <ul className="grid gap-1">
          {sorted.map((entry) => (
            <li key={entry.threadId} className="flex items-center gap-1.5">
              <AgentThreadWorkStatusDot status={entry.status} className="shrink-0" />
              {isCliType(entry.cliType) ? (
                <span className="shrink-0 [&>svg]:size-3.5">{renderCliIcon(entry.cliType, "size-3.5")}</span>
              ) : null}
              <span className="truncate">{entry.threadTitle}</span>
              <span className="shrink-0 text-muted-foreground">
                {entry.agentName ? `${entry.agentName} · ` : ""}
                {entry.userName} · {THREAD_STATUS_META[entry.status].label}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
