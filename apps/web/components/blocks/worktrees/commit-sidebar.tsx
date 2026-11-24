"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Mail, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { type CommitSummary, useCommitPatch } from "@/lib/worktrees/hooks/use-worktree-history";
import { CommitBody, CommitFiles, CopyHash, type DiffOptions, RefBadge, emptyCommitMessage, visibleRefs } from "./commit-detail";
import { Counts, ErrorWithRetry, Fetching, Message, Truncated } from "./worktree-changes-body";

/** The Graph sidebar's own width, narrower than the thread sidebar's so the table keeps room. */
export const COMMIT_SIDEBAR_RESIZE_BOUNDS = { min: 320, max: 480, default: 360, storageKey: "worktree-commit-sidebar-width" };

/** The Graph sidebar's header, level with the table header. */
export function CommitSidebarHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b border-border pr-1 pl-4 text-xs font-medium text-muted-foreground">
      Commit
      {onClose && (
        <TooltipExt content="Close commit" delayDuration={500}>
          <Button type="button" variant="ghost" size="icon-sm" className="size-7 cursor-pointer" aria-label="Close commit" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </TooltipExt>
      )}
    </div>
  );
}

/** `CommitSidebar`'s meta block, message and a few tree rows. */
export function CommitSidebarSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-full" />
      </div>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="px-4 py-2">
        <Skeleton className="h-3 w-28" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-1.5 py-1 pr-3" style={{ paddingLeft: 12 + index * 16 }}>
          <Skeleton className="size-4" />
          <Skeleton className="h-3" style={{ width: `${30 + index * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Graph's right sidebar (OS-2536): author, date, email and hash, the message, then the changed files as a tree. */
export function CommitSidebar({
  profileId,
  pathId,
  commit,
  selectedPath,
  onOpenFile,
}: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  commit: CommitSummary;
  selectedPath: string | undefined;
  onOpenFile: (path: string) => void;
}) {
  const patch = useCommitPatch(profileId, pathId, commit.hash, true);
  const files = useMemo(() => (patch.result ? parseRunPatchFiles(splitRunPatch(patch.result.patch)) : []), [patch.result]);
  const [messageOpen, setMessageOpen] = useState(true);
  const Chevron = messageOpen ? ChevronDown : ChevronRight;
  return (
    <div className="text-xs">
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3 text-muted-foreground">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{commit.authorName}</span>
          <span className="shrink-0">{new Date(commit.committedAt).toLocaleString()}</span>
        </div>
        {commit.authorEmail && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Mail className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{commit.authorEmail}</span>
          </span>
        )}
        <span className="-ml-2 flex min-w-0">
          <CopyHash hash={commit.hash} full />
        </span>
        {/* Every ref, where the table's Refs cell shows one and a count. */}
        {visibleRefs(commit).length > 0 && (
          <span className="flex flex-wrap gap-1">
            {visibleRefs(commit).map((ref) => (
              <RefBadge key={ref} name={ref} />
            ))}
          </span>
        )}
      </div>
      <div className="border-b border-border">
        <button
          type="button"
          aria-expanded={messageOpen}
          className="flex h-8 w-full cursor-pointer items-center gap-1.5 px-4 font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setMessageOpen((open) => !open)}
        >
          <Chevron className="size-3.5" aria-hidden />
          Message
        </button>
        {messageOpen && (
          <div className="flex flex-col gap-2 px-4 pb-3">
            <p className="text-sm break-words text-foreground">{commit.subject}</p>
            {patch.result?.body && <CommitBody body={patch.result.body} />}
          </div>
        )}
      </div>
      {patch.result ? (
        <>
          {patch.result.truncated && <Truncated />}
          {files.length === 0 ? (
            <Message>{emptyCommitMessage(commit.parents.length > 1)}</Message>
          ) : (
            <>
              <div className="flex h-8 items-center gap-1.5 px-4 font-medium text-muted-foreground">
                {files.length} Changed {files.length === 1 ? "File" : "Files"}
                {!files.every((file) => file.binary) && (
                  <Counts additions={files.reduce((sum, file) => sum + file.additions, 0)} deletions={files.reduce((sum, file) => sum + file.deletions, 0)} />
                )}
              </div>
              <WorktreeFileTree files={files} selectedPath={selectedPath} onSelectFile={onOpenFile} />
            </>
          )}
        </>
      ) : patch.error ? (
        <ErrorWithRetry error={patch.error} onRetry={patch.retry} />
      ) : (
        <Fetching />
      )}
    </div>
  );
}

/** A file picked in the Graph sidebar: the commit's whole diff in the table's place, scrolled to that file. */
export function CommitDiffPane({
  profileId,
  pathId,
  commit,
  scrollTo,
  onBack,
  diffOptions,
  allCollapsed,
  wordWrap,
}: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  commit: CommitSummary;
  scrollTo: { path: string };
  onBack: () => void;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
}) {
  const patch = useCommitPatch(profileId, pathId, commit.hash, true);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-xs">
        <button type="button" className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-1 font-medium hover:bg-muted" onClick={onBack}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to graph
        </button>
        <span className="truncate text-muted-foreground" title={commit.subject}>
          {commit.subject}
        </span>
      </div>
      {/* Focusable, so a click into the diff's text keeps Escape inside the view. */}
      <div className="min-h-0 flex-1 overflow-y-auto outline-none" tabIndex={-1}>
        {patch.result ? (
          <>
            {patch.result.truncated && <Truncated />}
            <CommitFiles
              patch={patch.result.patch}
              diffOptions={diffOptions}
              allCollapsed={allCollapsed}
              wordWrap={wordWrap}
              merge={commit.parents.length > 1}
              scrollTo={scrollTo}
            />
          </>
        ) : patch.error ? (
          <ErrorWithRetry error={patch.error} onRetry={patch.retry} />
        ) : (
          <Fetching />
        )}
      </div>
    </div>
  );
}
