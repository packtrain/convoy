"use client";

import { useState } from "react";
import { AtSign, ChevronDown, ChevronUp, FileDiff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";
import type {
  CliRunDiffFile,
  CliRunDiffSummaryPreview,
} from "@/convex/lib/contracts/validators";
import { cn } from "@/lib/utils";

const COLLAPSED_FILE_COUNT = 3;

function splitPath(path: string): { dir: string; base: string } {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", base: path };
  }
  return { dir: path.slice(0, lastSlash + 1), base: path.slice(lastSlash + 1) };
}

function LineCounts({ file }: { file: CliRunDiffFile }) {
  if (file.binary) {
    return <span className="text-xs text-muted-foreground">binary</span>;
  }
  return (
    <>
      <span className="text-success">+{file.additions}</span>
      <span className="text-destructive">-{file.deletions}</span>
    </>
  );
}

export interface RunChangesCardProps {
  /**
   * Envelope-sized preview: refs, roll-up totals, file count, and the leading
   * file rows. Expanding fetches the rest through `allFiles` (OS-1600).
   */
  diffSummary: CliRunDiffSummaryPreview;
  /**
   * Full stored file list once fetched. `undefined` means "not loaded yet" —
   * the host starts loading when `onExpandedChange(true)` fires.
   */
  allFiles?: CliRunDiffFile[];
  /** Told when the user expands/collapses, so the host can fetch lazily. */
  onExpandedChange?: (expanded: boolean) => void;
  /** When present, rows open the on-demand patch/full-file viewer (OS-1143). */
  onSelectFile?: (file: CliRunDiffFile) => void;
  /** When present, the header shows Undo — revert to the pre-run checkpoint (OS-1151). */
  onUndo?: () => void;
  /** Row hover action: insert an `@path` mention into the composer (OS-1159). */
  onMentionFile?: (path: string) => void;
  /** Row hover action: revert this one file to its pre-run state (OS-1156). */
  onRevertFile?: (file: CliRunDiffFile) => void;
}

/** Per-file summary of what a completed run changed (OS-1142). */
export function RunChangesCard({
  diffSummary,
  allFiles,
  onExpandedChange,
  onSelectFile,
  onUndo,
  onMentionFile,
  onRevertFile,
}: RunChangesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { fileCount, additions: totalAdditions, deletions: totalDeletions, truncated } =
    diffSummary;
  if (fileCount === 0) {
    return null;
  }

  // Expanded renders the fetched list; until it lands, the preview rows stay
  // put so the card never flashes empty.
  const files = expanded && allFiles ? allFiles : diffSummary.files;
  const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_FILE_COUNT);
  // The preview carries more rows than the collapsed card shows, so a small run
  // is already complete on arrival — expanding it must not wait on a fetch that
  // the host never issues (OS-1600).
  const previewIsComplete = diffSummary.files.length >= fileCount;
  const isLoadingMore = expanded && !previewIsComplete && allFiles === undefined;
  const hiddenCount = fileCount - visibleFiles.length;

  const handleToggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-3 p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileDiff className="size-4.5" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            Edited {fileCount} {fileCount === 1 ? "file" : "files"}
            {truncated ? " (truncated)" : ""}
          </span>
          <span className="flex items-center gap-1.5 text-xs tabular-nums">
            <span className="text-success">+{totalAdditions}</span>
            <span className="text-destructive">-{totalDeletions}</span>
          </span>
        </div>
        {(onUndo || onSelectFile) && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {onUndo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={onUndo}
              >
                Undo
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            {onSelectFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => onSelectFile(files[0])}
              >
                Review
              </Button>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y border-t">
        {visibleFiles.map((file) => {
          const { dir, base } = splitPath(file.path);
          const clickable = onSelectFile !== undefined && !file.binary;
          const hasRowActions = onMentionFile !== undefined || onRevertFile !== undefined;
          const path = (
            <span className="min-w-0 flex-1 truncate" title={file.path}>
              <span className="text-muted-foreground">{dir}</span>
              <span className={cn(file.kind === "deleted" && "line-through")}>{base}</span>
            </span>
          );
          return (
            // Named group: an ancestor message row already owns bare `group`,
            // which would show the actions on hovering the whole message.
            <li key={file.path} className="group/file-row flex items-center text-sm hover:bg-muted/50">
              {clickable ? (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left"
                  onClick={() => onSelectFile?.(file)}
                >
                  {path}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">{path}</div>
              )}
              <span className="flex shrink-0 items-center pr-3">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs tabular-nums",
                    hasRowActions && "group-hover/file-row:hidden"
                  )}
                >
                  <LineCounts file={file} />
                </span>
                {hasRowActions && (
                  // Hover actions swap in over the counts (OS-1159 / OS-1156).
                  <span className="hidden items-center gap-0.5 group-hover/file-row:flex">
                    {onMentionFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 cursor-pointer text-muted-foreground hover:text-foreground"
                        aria-label={`Mention ${file.path} in reply`}
                        title="Mention in reply"
                        onClick={() => onMentionFile(file.path)}
                      >
                        <AtSign className="size-3.5" />
                      </Button>
                    )}
                    {onRevertFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-6 cursor-pointer text-muted-foreground hover:text-foreground"
                        aria-label={`Revert ${file.path}`}
                        title="Revert file"
                        onClick={() => onRevertFile(file)}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    )}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 border-t px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={handleToggleExpanded}
        >
          {expanded ? (
            <>
              {isLoadingMore ? (
                <Spinner
                  className="text-sm"
                  text="Loading files…"
                  textClassName="text-current"
                  textPlacement="inline"
                />
              ) : (
                <>
                  Show fewer files
                  <ChevronUp className="size-4" />
                </>
              )}
            </>
          ) : (
            <>
              Show {hiddenCount} more {hiddenCount === 1 ? "file" : "files"}
              <ChevronDown className="size-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
