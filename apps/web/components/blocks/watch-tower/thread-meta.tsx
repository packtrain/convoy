"use client";

import { GitBranch, Layers } from "lucide-react";
import { AppLink, appRoute } from "@/lib/navigation";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { ThreadWorkflowRowBadge } from "@/components/blocks/thread/thread-workflow-row-badge";
import { renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { ThreadPrBadges } from "@/components/blocks/thread/thread-pr-badge";
import { threadPullRequests } from "@/lib/threads/pull-request";
import { threadBranchLabel, type ThreadBranchLabel } from "@/lib/threads/repo-branches";
import type { WatchTowerThreadItem } from "@/convex/cli/threads/lib/validators";
import { cn } from "@/lib/utils";

/**
 * Threads created from a task usually inherit its name, so repeating the task
 * name under the title is noise — show only ref+icon then. Titles get
 * truncated with "…", hence the prefix check.
 */
export function taskNameMatchesTitle(title: string, taskName: string): boolean {
  const t = title.trim().toLowerCase();
  const name = taskName.trim().toLowerCase();
  if (t === name) return true;
  return t.endsWith("…") && name.startsWith(t.slice(0, -1));
}

/**
 * The linked task as a chip: type icon + ref + name. A nested link inside the
 * host's full-bleed row link, so it re-enables pointer events on itself. The
 * board card uses the shared `ThreadTaskRefLink` instead — there the chip shares
 * the title's line, so it shows the ref alone.
 */
function WatchTowerTaskChip({
  thread,
  organizationSlug,
  className,
}: {
  thread: WatchTowerThreadItem;
  organizationSlug: string;
  className?: string;
}) {
  const task = thread.associatedTask;
  if (!task) return null;

  return (
    <AppLink
      href={appRoute.projectTask(
        organizationSlug,
        thread.location.projectAlias,
        task.refId
      )}
      className={cn(
        "pointer-events-auto relative z-20 inline-flex min-w-0 cursor-pointer items-center gap-1 hover:text-foreground",
        className
      )}
    >
      <TaskType taskType={task.taskType} variant="icon" className="size-3 shrink-0" />
      <span className="shrink-0 font-medium text-foreground/80">{task.refId}</span>
      {taskNameMatchesTitle(thread.title, task.name) ? null : (
        <span className="truncate">{task.name}</span>
      )}
    </AppLink>
  );
}

/** Branch name, or "N branches" in a multi-repo folder, truncated with the full value in the tooltip (OS-1257, OS-2523). */
export function WatchTowerBranchLabel({
  label,
  className,
}: {
  label: ThreadBranchLabel;
  className?: string;
}) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1", className)}
      title={label.title}
    >
      <GitBranch className="size-3 shrink-0" />
      <span className={cn("min-w-0 truncate", label.branch && "font-mono")}>{label.text}</span>
    </span>
  );
}

/**
 * The list row's meta line: project · PR · branch · task, all under the title.
 * The board card composes the same pieces into its own two-line grid instead —
 * shared parts, per-layout arrangement (OS-1595).
 */
export function WatchTowerThreadMeta({
  thread,
  organizationSlug,
  className,
}: {
  thread: WatchTowerThreadItem;
  organizationSlug: string;
  className?: string;
}) {
  const branchLabel = threadBranchLabel(thread);
  const pullRequests = threadPullRequests(thread);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <span className="min-w-8 truncate" title={thread.location.projectName}>{thread.location.projectName}</span>
      {thread.ownerName ? <span className="truncate" title={thread.ownerName}>{thread.ownerName}</span> : null}
      <WatchTowerChildCount thread={thread} />
      {pullRequests.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          {pullRequests.length > 1 ? (
            // One badge and +N on a phone, so the task chip stays in the row (UX OS-2523 round 2).
            <>
              <span className="contents sm:hidden">
                <ThreadPrBadges pullRequests={pullRequests} max={1} />
              </span>
              <span className="hidden sm:contents">
                <ThreadPrBadges pullRequests={pullRequests} />
              </span>
            </>
          ) : (
            <ThreadPrBadges pullRequests={pullRequests} />
          )}
        </>
      ) : null}
      {branchLabel ? (
        <>
          <span aria-hidden>·</span>
          {/* shrink-0: a long task name must truncate itself, not crush the branch */}
          <WatchTowerBranchLabel label={branchLabel} className="max-w-40 shrink-0" />
        </>
      ) : null}
      {thread.associatedTask ? (
        <>
          <span aria-hidden>·</span>
          <WatchTowerTaskChip thread={thread} organizationSlug={organizationSlug} />
        </>
      ) : null}
    </div>
  );
}


/** Container identity never implies a single runtime for all children. */
export function WatchTowerThreadIcon({ thread, className }: {
  thread: WatchTowerThreadItem;
  className?: string;
}) {
  if (thread.kind === undefined) return renderCliIcon(thread.cliType, className);
  if (thread.workflowRunId) {
    return <ThreadWorkflowRowBadge workflow={thread.workflow} className={cn(className, "pointer-events-none")} />;
  }
  return <span role="img" aria-label="Thread group" title="Thread group"><Layers className={className} /></span>;
}

export function WatchTowerChildCount({ thread }: { thread: WatchTowerThreadItem }) {
  if (thread.kind === undefined) return null;
  const count = thread.childCount ?? 0;
  return <span className="shrink-0">{count} {count === 1 ? "thread" : "threads"}</span>;
}
