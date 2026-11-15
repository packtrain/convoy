"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { AppLink, appRoute } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { ThreadDiffStat } from "@/components/blocks/thread/thread-diff-stat";
import { ThreadUnreadIndicator } from "@/components/blocks/thread/thread-status-indicator";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { slashCommandDisplayText } from "@/lib/slash-commands/display";
import { THREAD_BATCH_ACTION_MAX } from "@/lib/threads/constants";
import { intersectVisibleThreadIds } from "@/lib/threads/thread-batch-selection";
import type { WatchTowerThreadItem } from "@/convex/cli/threads/lib/validators";
import { watchTowerSections, type WatchTowerScope, type WatchStatus } from "@/lib/watch-tower/watch-tower-view";
import { cn } from "@/lib/utils";
import { WatchTowerThreadMeta, WatchTowerThreadIcon } from "./thread-meta";
import { StatusIndicator, isWaitingForAgent } from "./thread-status";
import { SECTION_BULK_ACTIONS, type BatchAction, type SectionData, type SectionSelection } from "./types";

// Mobile shows only the thread cell, full width: Status (sections already
// group by it), Changes and Updated are all hidden <sm.
const ROW_GRID = "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_80px_80px]";

function ThreadRow({
  thread,
  watchStatus,
  organizationSlug,
  selectable,
  selected,
  forceCheckbox,
  onToggleSelect,
}: {
  thread: WatchTowerThreadItem;
  watchStatus: WatchStatus;
  organizationSlug: string;
  selectable: boolean;
  selected: boolean;
  forceCheckbox: boolean;
  onToggleSelect: (threadId: Id<"cliThreads">, shiftKey: boolean) => void;
}) {
  const showCheckbox = selectable && (selected || forceCheckbox);
  const threadTitle = slashCommandDisplayText(thread.title || "New thread");
  const threadTarget = appRoute.projectThreadDetail(
    organizationSlug,
    thread.location.projectAlias,
    String(thread._id)
  );
  return (
    <div
      className={cn(
        "group relative grid items-center gap-4 border-t border-border px-4 py-2.5 transition-colors",
        thread.isOwner && "cursor-pointer hover:bg-muted/50",
        selected && "bg-muted/50",
        ROW_GRID
      )}
    >
      {thread.isOwner ? <AppLink
        href={threadTarget}
        aria-label={`Open thread ${threadTitle}`}
        className="absolute inset-0 z-0"
      >
        <span className="sr-only">{threadTitle}</span>
      </AppLink> : null}
      <div className="pointer-events-none relative z-10 flex min-w-0 items-start gap-4">
        {/* invisible (not hidden/opacity) so the unhovered checkbox never steals clicks */}
        <span className="relative mt-0.5 size-4 shrink-0 text-muted-foreground">
          <span
            className={cn(
              selectable && "group-hover:invisible",
              showCheckbox && "invisible"
            )}
          >
            <WatchTowerThreadIcon thread={thread} className="size-4" />
          </span>
          {selectable ? (
            <Checkbox
              checked={selected}
              aria-label={`Select ${thread.title || "thread"}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleSelect(thread._id, event.shiftKey);
              }}
              className={cn(
                "pointer-events-auto absolute inset-0 cursor-pointer",
                !showCheckbox && "invisible group-hover:visible"
              )}
            />
          ) : null}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <ThreadUnreadIndicator isUnread={thread.hasUnread} />
            <span className="truncate">{threadTitle}</span>
          </div>
          <WatchTowerThreadMeta
            thread={thread}
            organizationSlug={organizationSlug}
            className="mt-0.5"
          />
        </div>
      </div>
      <StatusIndicator
        status={watchStatus}
        waitingForAgent={isWaitingForAgent(thread)}
      />
      <ThreadDiffStat
        added={thread.linesAdded}
        removed={thread.linesRemoved}
        className="pointer-events-none relative z-10 hidden text-right sm:block"
      />
      <span className="pointer-events-none relative z-10 hidden text-right text-xs text-muted-foreground sm:block">
        {formatRelativeTime(thread.lastActivityAt)}
      </span>
    </div>
  );
}

function TableHeader() {
  return (
    <div className={cn("grid gap-4 rounded-t-lg bg-muted/60 px-4 py-2 text-xs font-medium text-muted-foreground", ROW_GRID)}>
      <span>Thread</span>
      <span className="hidden text-right sm:block">Status</span>
      <span className="hidden text-right sm:block">Changes</span>
      <span className="hidden text-right sm:block">Updated</span>
    </div>
  );
}

function Section({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">{header}</div>
      {children}
    </section>
  );
}

function SectionBulkActions({
  selectedCount,
  actions,
  onAction,
  onClear,
}: {
  selectedCount: number;
  actions: { markRead: boolean; markDone: boolean; markNotDone: boolean };
  onAction: (action: BatchAction) => void;
  onClear: () => void;
}) {
  // h-6 matches the section title's 24px line height so appearing
  // buttons don't grow the header row and shift the table below.
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <span className="mr-1 text-xs tabular-nums text-muted-foreground">
        {selectedCount} selected
        {selectedCount >= THREAD_BATCH_ACTION_MAX ? " (max)" : ""}
      </span>
      {actions.markRead ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer px-2"
          onClick={() => onAction("markRead")}
        >
          Mark as read
        </Button>
      ) : null}
      {actions.markDone ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer px-2"
          onClick={() => onAction("markDone")}
        >
          Mark as done
        </Button>
      ) : null}
      {actions.markNotDone ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 cursor-pointer px-2"
          onClick={() => onAction("markNotDone")}
        >
          Move to review
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 cursor-pointer px-2 text-destructive hover:text-destructive"
        onClick={() => onAction("delete")}
      >
        Delete
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 cursor-pointer"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

/** List placeholder: a section header over table rows sized like `ThreadRow`. */
export function StatusSectionsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-label="Loading threads" className="space-y-6">
      <Section header={<Skeleton className="h-6 w-40 rounded-sm" />}>
        <div className="rounded-lg border border-border">
          <TableHeader />
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className={cn("grid items-center gap-4 border-t border-border px-4 py-2.5", ROW_GRID)}>
              <div className="flex min-w-0 items-start gap-4">
                <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
                  <Skeleton className="h-4 w-3/5 rounded-sm" />
                  <Skeleton className="h-3 w-2/5 rounded-sm" />
                </div>
              </div>
              <Skeleton className="hidden h-4 w-16 justify-self-end rounded-sm sm:block" />
              <Skeleton className="hidden h-4 w-12 justify-self-end rounded-sm sm:block" />
              <Skeleton className="hidden h-3 w-10 justify-self-end rounded-sm sm:block" />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** List layout: one stacked section per non-empty bucket. */
export function StatusSections({
  sections,
  scope,
  hidden,
  organizationSlug,
  selection,
  onToggleSelect,
  onBatchAction,
  onClearSelection,
}: {
  sections: Record<WatchStatus, SectionData>;
  scope: WatchTowerScope;
  hidden: Set<string>;
  organizationSlug: string;
  selection: SectionSelection | null;
  onToggleSelect: (
    section: WatchStatus,
    orderedIds: Id<"cliThreads">[],
    threadId: Id<"cliThreads">,
    shiftKey: boolean
  ) => void;
  onBatchAction: (action: BatchAction, ids: Id<"cliThreads">[]) => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="space-y-6">
      {watchTowerSections(scope).map((section) => {
        if (hidden.has(section.status)) return null;
        const data = sections[section.status];
        const sectionThreads = data.threads;
        if (sectionThreads.length === 0) return null;
        const bulkActions = SECTION_BULK_ACTIONS[section.status];
        const sectionIds = sectionThreads.filter((thread) => thread.isOwner).map((thread) => thread._id);
        // Reactive updates can move a selected thread to another bucket;
        // intersecting keeps counts and actions scoped to what's shown here.
        const selectedIds =
          selection?.section === section.status
            ? intersectVisibleThreadIds(selection.ids, sectionIds)
            : [];
        return (
          <Section
            key={section.status}
            header={
              <>
                <span className="flex min-w-0 items-baseline gap-2">
                  {/* shrink-0 + nowrap: the title always stays on one line
                      (it wrapped to two on mobile); the description is the
                      part that gives up space and truncates. */}
                  <h2 className="shrink-0 whitespace-nowrap text-base font-semibold">
                    {section.title}
                  </h2>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {section.description}
                  </span>
                </span>
                {bulkActions && selectedIds.length > 0 ? (
                  <SectionBulkActions
                    selectedCount={selectedIds.length}
                    actions={bulkActions}
                    onAction={(action) => onBatchAction(action, selectedIds)}
                    onClear={onClearSelection}
                  />
                ) : null}
              </>
            }
          >
            <div className="rounded-lg border border-border">
              <TableHeader />
              {sectionThreads.map((thread) => (
                <ThreadRow
                  key={thread._id}
                  thread={thread}
                  watchStatus={section.status}
                  organizationSlug={organizationSlug}
                  selectable={bulkActions !== null && thread.isOwner}
                  selected={selectedIds.includes(thread._id)}
                  forceCheckbox={selectedIds.length > 0}
                  onToggleSelect={(threadId, shiftKey) =>
                    onToggleSelect(section.status, sectionIds, threadId, shiftKey)
                  }
                />
              ))}
            </div>
            {data.status === "CanLoadMore" ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 cursor-pointer text-muted-foreground"
                onClick={data.loadMore}
              >
                Show more
              </Button>
            ) : null}
            {data.status === "LoadingMore" ? (
              <Spinner className="mt-2 size-4 text-muted-foreground" />
            ) : null}
          </Section>
        );
      })}
    </div>
  );
}
