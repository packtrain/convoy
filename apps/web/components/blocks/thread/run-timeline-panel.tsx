"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CliRunDiffSummary, CliRunDiffSummaryPreview } from "@/convex/lib/contracts/validators";
import { timelineRangeSummary, type TimelineRun } from "@/lib/threads/run-timeline";
import { cn } from "@/lib/utils";

export interface RunTimelinePanelProps {
  /** Oldest-first, as built by `buildTimelineRuns`. */
  runs: TimelineRun[];
  /**
   * Open the diff viewer on the committed run range. `span` is the 1-based
   * run interval over the loaded runs, oldest = 1 (used for tab labels).
   */
  onOpenRange: (
    diffSummary: CliRunDiffSummary,
    span: { from: number; to: number }
  ) => void;
  /** Restore the working tree to before this run (existing confirm flow). */
  /** Omitted when the caller cannot revert (a read-only viewer, or no
   *  profile/path context); the restore action is then not offered. */
  onRevertRun?: (diffSummary: CliRunDiffSummaryPreview) => void;
}

/**
 * Run timeline sidebar panel (OS-1160, tabbed in OS-1169): the thread's runs
 * newest-first. Clicking a run anchors a range selection that follows the
 * hovered row (always contiguous); a second click opens the combined diff and
 * resets the selection. Clicking the same run twice opens that single run's
 * diff.
 */
export function RunTimelinePanel({ runs, onOpenRange, onRevertRun }: RunTimelinePanelProps) {
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const handleRowClick = (index: number) => {
    if (anchorIndex === null) {
      setAnchorIndex(index);
      return;
    }
    const range = timelineRangeSummary(runs, anchorIndex, index);
    const from = Math.min(anchorIndex, index) + 1;
    const to = Math.max(anchorIndex, index) + 1;
    setAnchorIndex(null);
    setHoverIndex(null);
    onOpenRange(range, { from, to });
  };

  const isSelected = (index: number): boolean => {
    if (anchorIndex === null) {
      return false;
    }
    const end = hoverIndex ?? anchorIndex;
    return index >= Math.min(anchorIndex, end) && index <= Math.max(anchorIndex, end);
  };

  const selectedCount =
    anchorIndex === null ? 0 : Math.abs((hoverIndex ?? anchorIndex) - anchorIndex) + 1;

  if (runs.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No runs yet.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul
        className="min-h-0 flex-1 divide-y overflow-y-auto"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {runs
          .map((run, index) => ({ run, index }))
          .reverse()
          .map(({ run, index }) => (
            <li
              key={run.diffSummary.postRef}
              className={cn(
                "group/timeline-row flex items-center text-sm",
                isSelected(index) ? "bg-accent" : "hover:bg-muted/50"
              )}
              onMouseEnter={() => setHoverIndex(index)}
            >
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer px-3 py-2 text-left"
                onClick={() => handleRowClick(index)}
              >
                <span className="block truncate">
                  {run.prompt.trim() || "Untitled run"}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                  <span className="text-success">+{run.additions}</span>
                  <span className="text-destructive">-{run.deletions}</span>
                  <span>
                    · {run.fileCount} {run.fileCount === 1 ? "file" : "files"} ·{" "}
                    {formatDistanceToNow(run.createdAt, { addSuffix: true })}
                  </span>
                </span>
              </button>
              {onRevertRun ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mr-2 hidden size-6 shrink-0 cursor-pointer text-muted-foreground group-hover/timeline-row:inline-flex hover:text-foreground"
                  aria-label="Restore to before this run"
                  title="Restore to before this run"
                  onClick={() => onRevertRun(run.diffSummary)}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
      </ul>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        {anchorIndex === null
          ? "Click a run to start a range, click another to view the combined diff."
          : `${selectedCount} ${selectedCount === 1 ? "run" : "runs"} selected — click to open the diff.`}
      </div>
    </div>
  );
}
