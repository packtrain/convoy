"use client";

import { useState } from "react";
import { CornerDownRight, Plus } from "lucide-react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { ThreadListItem } from "@/components/blocks/thread/thread-list-item";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Task } from "@/lib/tasks/types";

/** Rows kept visible while collapsed (OS-1803). */
const COLLAPSED_THREADS = 4;

type ThreadRow = FunctionReturnType<typeof api.cli.threads.lists.listByAssociatedTask>[number];

/** A workflow run's container thread — its lane threads nest under it. */
function isWorkflowRunRow(row: ThreadRow): boolean {
  return row.kind === "group" && row.workflowRunId !== undefined;
}

/**
 * Group each run's lane threads under its container row (rendered indented
 * with a corner glyph); everything else keeps the query's activity order.
 * A lane thread whose container isn't associated renders as a plain row.
 */
function toDisplayRows(rows: ThreadRow[]): { row: ThreadRow; isChild: boolean }[] {
  const containerRunIds = new Set(rows.filter(isWorkflowRunRow).map((row) => row.workflowRunId));
  const out: { row: ThreadRow; isChild: boolean }[] = [];
  for (const row of rows) {
    if (!isWorkflowRunRow(row) && row.workflowRunId !== undefined && containerRunIds.has(row.workflowRunId)) {
      continue;
    }
    out.push({ row, isChild: false });
    if (isWorkflowRunRow(row)) {
      for (const child of rows) {
        if (!isWorkflowRunRow(child) && child.workflowRunId === row.workflowRunId) {
          out.push({ row: child, isChild: true });
        }
      }
    }
  }
  return out;
}

interface TaskThreadsFieldProps {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  taskId: Task["_id"];
  onOpenThreadsComposer?: () => void;
}

export function TaskThreadsField({
  projectId,
  organizationSlug,
  projectAlias,
  taskId,
  onOpenThreadsComposer,
}: TaskThreadsFieldProps) {
  const threads = useQuery(api.cli.threads.lists.listByAssociatedTask, {
    projectId,
    taskId,
  });
  const isLoading = threads === undefined;
  const displayRows = toDisplayRows(threads ?? []);
  const [isExpanded, setIsExpanded] = useState(false);
  // Collapse only when it hides 2+ rows: "Show 1 more thread" costs a row to save one.
  const isCollapsed = !isExpanded && displayRows.length > COLLAPSED_THREADS + 1;
  const visibleRows = isCollapsed ? displayRows.slice(0, COLLAPSED_THREADS) : displayRows;
  const hiddenCount = displayRows.length - visibleRows.length;

  const composerAction = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenThreadsComposer}
          aria-label="Open threads composer"
        >
          <Plus className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open threads composer</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex items-start gap-4 mb-3.5">
      <span className="w-24 shrink-0 pt-1 text-sm text-muted-foreground">
        Threads
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {displayRows.length === 0 ? (
          <div className="flex items-center gap-2">
            {isLoading ? null : (
              <span className="text-sm text-muted-foreground">No threads</span>
            )}
            {composerAction}
          </div>
        ) : (
          <>
            {visibleRows.map(({ row, isChild }, index) => (
              <div key={row._id} className="flex items-center gap-2">
                {isChild ? (
                  <CornerDownRight
                    data-testid="workflow-child-glyph"
                    className="ml-0.5 size-3.5 shrink-0 text-muted-foreground"
                  />
                ) : null}
                {/* Rows fill the metadata column so a short title still gets a full-width
                    hit area. Child rows shed the glyph offset (0.875 + gap 0.5rem) so
                    every row's right edge lines up. */}
                <div className={isChild ? "min-w-0 flex-1 max-w-[20.625rem]" : "min-w-0 flex-1 max-w-88"}>
                  <ThreadListItem
                    chat={row}
                    isActive={false}
                    compactLayout
                    organizationSlug={organizationSlug}
                    projectAlias={projectAlias}
                    showAssociatedTask={false}
                    showActions={false}
                    showStatusIndicator={false}
                    linkTarget="_blank"
                    linkRel="noreferrer"
                    rowClassName="border-b-0 bg-transparent rounded-sm hover:bg-muted dark:hover:bg-muted/50 -ml-1.5"
                    innerClassName="px-1.5 py-1"
                  />
                </div>
                {index === 0 ? composerAction : null}
              </div>
            ))}
            {isCollapsed ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1.5 h-7 w-fit cursor-pointer justify-start px-1.5 text-muted-foreground"
                onClick={() => setIsExpanded(true)}
              >
                {`Show ${hiddenCount} more threads`}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
