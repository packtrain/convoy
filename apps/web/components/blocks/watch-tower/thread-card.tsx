"use client";

import { AppLink, appRoute } from "@/lib/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { ThreadAgentChip } from "@/components/blocks/thread/thread-agent-chip";
import { ThreadDiffStat } from "@/components/blocks/thread/thread-diff-stat";
import { ThreadPrBadge } from "@/components/blocks/thread/thread-pr-badge";
import { ThreadStatusIndicator } from "@/components/blocks/thread/thread-status-indicator";
import { ThreadTaskRefLink } from "@/components/blocks/thread/thread-task-link";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { SlashCommandDisplayText, slashCommandDisplayText } from "@/lib/slash-commands/display";
import { getThreadDisplayStatus } from "@/lib/threads/display-status";
import { THREAD_STATUS_META } from "@/lib/threads/status-meta";
import type { Id } from "@/convex/_generated/dataModel";
import type { WatchTowerThreadItem } from "@/convex/cli/threads/lib/validators";
import { cn } from "@/lib/utils";
import { WatchTowerBranchLabel, WatchTowerChildCount, WatchTowerThreadIcon } from "./thread-meta";
import { isWaitingForAgent } from "./thread-status";

/**
 * Board-mode thread card (OS-1595), laid out like the project thread list's
 * non-compact card: title + status on the first line, project · branch with the
 * runtime icon and time on the second. Deliberately not the task board's
 * `KanbanCard` — every field on that one is a task field.
 *
 * The status *word* comes from `THREAD_STATUS_META` and the glyph from
 * `ThreadStatusIndicator`, per the shared-glyph rule, rather than a local
 * switch. The exception is the unclaimed queue, a Watch-Tower-only sub-state
 * inside Running that the shared union has no member for.
 */
export function WatchTowerThreadCard({
  thread,
  organizationSlug,
  selectable,
  selected,
  forceCheckbox,
  onToggleSelect,
}: {
  thread: WatchTowerThreadItem;
  organizationSlug: string;
  selectable: boolean;
  selected: boolean;
  /** Any selection in this column: every card keeps its checkbox on show. */
  forceCheckbox: boolean;
  onToggleSelect: (threadId: Id<"cliThreads">, shiftKey: boolean) => void;
}) {
  const threadTitle = slashCommandDisplayText(thread.title || "New thread");
  const waitingForAgent = isWaitingForAgent(thread);
  const displayStatus = getThreadDisplayStatus(thread);
  const statusMeta = THREAD_STATUS_META[displayStatus];

  return (
    <div
      className={cn(
        "group/card relative w-full overflow-hidden rounded-lg border border-border bg-card text-left shadow-xs transition-colors dark:border-transparent dark:shadow-none [&_svg]:saturate-70",
        thread.isOwner && "hover:border-muted-foreground/35",
        selected && "border-muted-foreground/35 bg-muted/50"
      )}
    >
      {thread.isOwner ? <AppLink
        href={appRoute.projectThreadDetail(
          organizationSlug,
          thread.location.projectAlias,
          String(thread._id)
        )}
        aria-label={`Open thread ${threadTitle}`}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">{threadTitle}</span>
      </AppLink> : null}
      <div className="pointer-events-none relative z-10 px-3 py-2.5">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {selectable ? (
              // Only the hovered card reveals its checkbox; once the column has
              // a selection every card in it keeps one (OS-1255). `hidden` (not
              // `invisible`) so the resting card leaves no gap and the title
              // starts at the card's edge — the checkbox pushes it right on
              // hover, matching the project thread list's card.
              <span
                className={cn(
                  "size-4 shrink-0 items-center justify-center",
                  forceCheckbox
                    ? "flex"
                    : "hidden group-hover/card:flex group-has-[[data-state=open]]/card:flex"
                )}
              >
                <Checkbox
                  checked={selected}
                  aria-label={`Select ${thread.title || "thread"}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleSelect(thread._id, event.shiftKey);
                  }}
                  className="pointer-events-auto cursor-pointer"
                />
              </span>
            ) : null}
            {thread.associatedTask ? (
              <ThreadTaskRefLink
                task={thread.associatedTask}
                organizationSlug={organizationSlug}
                projectAlias={thread.location.projectAlias}
                className="pointer-events-auto relative z-20 max-w-fit shrink-0"
              />
            ) : null}
            <h4
              className="min-w-0 truncate text-sm font-medium leading-5 text-foreground"
              title={threadTitle}
            >
              <SlashCommandDisplayText
                text={thread.title || "New thread"}
                highlightCommands={false}
              />
            </h4>
          </div>
          {/* The column already says the bucket, so a settled thread shows no
              status word — only live/blocked states and the unclaimed queue,
              which the column can't express. */}
          {waitingForAgent ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <ThreadStatusIndicator status="pending" resting="blank" className="flex items-center" />
              Waiting for agent
            </span>
          ) : displayStatus === "completed" ? (
            <ThreadStatusIndicator
              status="completed"
              isUnread={thread.hasUnread}
              isDone={thread.isDone}
              showDoneCheck
              resting="blank"
              className="flex size-4 shrink-0 items-center justify-center"
            />
          ) : (
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                statusMeta.className
              )}
            >
              <ThreadStatusIndicator
                status={displayStatus}
                isUnread={thread.hasUnread}
                resting="blank"
                className="flex items-center"
              />
              {statusMeta.label}
            </span>
          )}
        </div>
        <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{thread.location.projectName}</span>
            {thread.ownerName ? <span className="truncate" title={thread.ownerName}>{thread.ownerName}</span> : null}
            <WatchTowerChildCount thread={thread} />
            {thread.pullRequest ? <ThreadPrBadge pullRequest={thread.pullRequest} /> : null}
            {thread.branch ? (
              <WatchTowerBranchLabel branch={thread.branch} className="text-muted-foreground/70" />
            ) : null}
          </span>
          <span className="flex shrink-0 items-center justify-end gap-1.5">
            {/* Unlike the list's fixed Changes column, an unset diff renders
                nothing here rather than a "—" placeholder on every card. */}
            {thread.linesAdded !== undefined || thread.linesRemoved !== undefined ? (
              <ThreadDiffStat added={thread.linesAdded} removed={thread.linesRemoved} />
            ) : null}
            {thread.agent ? <ThreadAgentChip agent={thread.agent} compact /> : null}
            <WatchTowerThreadIcon thread={thread} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground/70">
              {formatRelativeTime(thread.lastActivityAt)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
