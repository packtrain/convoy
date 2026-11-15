"use client";

import { Trash2, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { BoardColumn, type BoardColumnData } from "@/components/blocks/board/board-column";
import { BoardLayout } from "@/components/blocks/board/board-layout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { THREAD_BATCH_ACTION_MAX } from "@/lib/threads/constants";
import { intersectVisibleThreadIds } from "@/lib/threads/thread-batch-selection";
import type { WatchTowerThreadItem } from "@/convex/cli/threads/lib/validators";
import { watchTowerSections, type WatchTowerScope, type WatchStatus } from "@/lib/watch-tower/watch-tower-view";
import { WatchTowerThreadCard } from "./thread-card";
import { STATUS_META } from "./thread-status";
import type { BatchAction, SectionData, SectionSelection } from "./types";
import { SECTION_BULK_ACTIONS } from "./types";

/**
 * Bulk actions inside a `w-80` column header: icon-only buttons with tooltips,
 * replacing the title/count cluster while a selection is live. Keeping them in
 * the header (rather than a board-wide floating bar) is what makes the
 * one-column-at-a-time selection model legible — see docs/specs/watch-tower.md.
 */
function ColumnBulkActions({
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
  return (
    <span className="flex min-w-0 flex-1 items-center gap-0.5">
      <span className="mr-auto truncate text-xs tabular-nums text-muted-foreground">
        {selectedCount} selected
        {selectedCount >= THREAD_BATCH_ACTION_MAX ? " (max)" : ""}
      </span>
      {actions.markRead ? (
        <TooltipExt content="Mark as read" delayDuration={500}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 cursor-pointer px-1.5 text-xs"
            onClick={() => onAction("markRead")}
          >
            Read
          </Button>
        </TooltipExt>
      ) : null}
      {actions.markDone ? (
        <TooltipExt content="Mark as done" delayDuration={500}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 cursor-pointer px-1.5 text-xs"
            onClick={() => onAction("markDone")}
          >
            Done
          </Button>
        </TooltipExt>
      ) : null}
      {actions.markNotDone ? (
        <TooltipExt content="Move to review" delayDuration={500}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 cursor-pointer px-1.5 text-xs"
            onClick={() => onAction("markNotDone")}
          >
            Review
          </Button>
        </TooltipExt>
      ) : null}
      <TooltipExt content="Delete" delayDuration={500}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete"
          className="size-6 cursor-pointer text-destructive hover:text-destructive"
          onClick={() => onAction("delete")}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </TooltipExt>
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

type ThreadColumn = BoardColumnData<WatchTowerThreadItem> & {
  status: WatchStatus;
  orderedIds: Id<"cliThreads">[];
  selectedIds: Id<"cliThreads">[];
};

/**
 * Board layout for Watch Tower (OS-1595). Columns are the five watch buckets in
 * the list's fixed order, each backed by its own paginated query — the same data
 * the list renders, so there is no client-side bucketing here either.
 *
 * Unlike the list, empty columns stay rendered: a board whose columns appear and
 * vanish as agents finish is disorienting, and the column is the visual anchor.
 */
export function ThreadBoard({
  sections,
  scope,
  hidden,
  organizationSlug,
  selection,
  isLoadingSection,
  onToggleSelect,
  onBatchAction,
  onClearSelection,
}: {
  sections: Record<WatchStatus, SectionData>;
  scope: WatchTowerScope;
  hidden: Set<string>;
  organizationSlug: string;
  selection: SectionSelection | null;
  isLoadingSection: (status: WatchStatus) => boolean;
  onToggleSelect: (
    section: WatchStatus,
    orderedIds: Id<"cliThreads">[],
    threadId: Id<"cliThreads">,
    shiftKey: boolean
  ) => void;
  onBatchAction: (action: BatchAction, ids: Id<"cliThreads">[]) => void;
  onClearSelection: () => void;
}) {
  const columns: ThreadColumn[] = watchTowerSections(scope).filter(
    (section) => !hidden.has(section.status)
  ).map((section) => {
    const data = sections[section.status];
    const orderedIds = data.threads.filter((thread) => thread.isOwner).map((thread) => thread._id);
    // Reactive updates can move a selected thread to another bucket;
    // intersecting keeps counts and actions scoped to what's shown here.
    const selectedIds =
      selection?.section === section.status
        ? intersectVisibleThreadIds(selection.ids, orderedIds)
        : [];
    const bulkActions = SECTION_BULK_ACTIONS[section.status];
    const loading = isLoadingSection(section.status);

    return {
      id: section.status,
      status: section.status,
      title: section.title,
      metadata: (
        <span
          className={STATUS_META[section.status].dotClassName}
          aria-hidden
          title={section.description}
        >
          <svg viewBox="0 0 8 8" className="size-2">
            <circle cx="4" cy="4" r="4" />
          </svg>
        </span>
      ),
      items: data.threads,
      orderedIds,
      selectedIds,
      // The count is what's loaded, not the bucket total (pages are 25), so it
      // would understate a busy column — the card stack speaks for itself.
      showCount: false,
      emptyState: loading ? undefined : "Nothing here.",
      headerActions:
        bulkActions && selectedIds.length > 0 ? (
          <ColumnBulkActions
            selectedCount={selectedIds.length}
            actions={bulkActions}
            onAction={(action) => onBatchAction(action, selectedIds)}
            onClear={onClearSelection}
          />
        ) : undefined,
      footer:
        data.status === "CanLoadMore" ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full cursor-pointer text-muted-foreground"
            onClick={data.loadMore}
          >
            Show more
          </Button>
        ) : data.status === "LoadingMore" || loading ? (
          <div className="flex justify-center py-2">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : undefined,
    };
  });

  return (
    <BoardLayout
      fillWidth
      columns={columns}
      renderColumn={(column) => (
        <BoardColumn
          column={column}
          // Fill the share `fillWidth` handed the wrapper. `md:min-w-0` hands
          // the floor to the wrapper (identical for every column) instead of
          // the column's own content, which is what keeps the widths equal.
          className="md:w-full md:min-w-0"
          getItemKey={(thread) => thread._id}
          renderItem={(thread) => (
            <WatchTowerThreadCard
              thread={thread}
              organizationSlug={organizationSlug}
              selectable={SECTION_BULK_ACTIONS[column.status] !== null && thread.isOwner}
              selected={column.selectedIds.includes(thread._id)}
              forceCheckbox={column.selectedIds.length > 0}
              onToggleSelect={(threadId, shiftKey) =>
                onToggleSelect(column.status, column.orderedIds, threadId, shiftKey)
              }
            />
          )}
        />
      )}
    />
  );
}
