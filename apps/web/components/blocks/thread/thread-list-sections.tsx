"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, MessagesSquare } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  DONE_SECTION_STORAGE_KEY,
  PINNED_SECTION_STORAGE_KEY,
  readSectionCollapsed,
  writeSectionCollapsed,
} from "@/lib/threads/section-collapsed";
import { EmptyState } from "@/components/custom/empty-state";
import type { ThreadListItemData } from "./thread-list-item";
import { ThreadsLoadMoreButton } from "./threads-load-more-button";

interface ThreadListSectionProps {
  children: ReactNode;
  compactLayout: boolean;
}

/** Plain section label for a thread-list group (e.g. "Threads" below the pinned section). */
export function ThreadListSectionLabel({
  children,
  compactLayout,
}: ThreadListSectionProps) {
  return (
    <div
      className={cn(
        "flex h-8 items-center px-3 text-xs font-medium text-muted-foreground",
        compactLayout && "bg-card"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Collapsible group in a thread list ("Pinned" OS-1173, "Done" OS-1394). The
 * chevron appears on hover and rotates with the open state; the collapse state
 * persists in localStorage as a browser-local preference.
 */
export function ThreadCollapsibleSection({
  label,
  storageKey,
  defaultCollapsed = false,
  children,
  compactLayout,
}: ThreadListSectionProps & {
  label: string;
  storageKey: string;
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(
    () => !readSectionCollapsed(storageKey, defaultCollapsed)
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        writeSectionCollapsed(storageKey, !nextOpen);
      }}
    >
      <CollapsibleTrigger
        className={cn(
          "group/section flex h-8 w-full cursor-pointer items-center gap-1 px-3 text-xs font-medium text-muted-foreground",
          compactLayout && "bg-card"
        )}
      >
        {label}
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 opacity-0 transition-transform duration-200 group-hover/section:opacity-100 group-focus-visible/section:opacity-100",
            open && "rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The full grouped thread list — Pinned / Active / Done sections with their
 * own Load more buttons (OS-1394). Shared by the desktop sidebar and the
 * mobile thread list so the grouping rules live in one place; row rendering
 * stays with the caller via `renderRow`.
 */
export function ThreadListSections({
  threads,
  doneThreads,
  pinnedThreads,
  groupDone,
  compactLayout,
  hasMore,
  isLoadingMore,
  onLoadMore,
  hasMoreDone,
  isLoadingMoreDone,
  onLoadMoreDone,
  renderRow,
}: {
  threads: ThreadListItemData[];
  doneThreads: ThreadListItemData[];
  pinnedThreads: ThreadListItemData[];
  groupDone: boolean;
  compactLayout: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  hasMoreDone: boolean;
  isLoadingMoreDone: boolean;
  onLoadMoreDone: () => void;
  renderRow: (chat: ThreadListItemData, compactLayout: boolean) => ReactNode;
}) {
  return (
    <>
      {pinnedThreads.length > 0 && (
        <ThreadCollapsibleSection
          label="Pinned"
          storageKey={PINNED_SECTION_STORAGE_KEY}
          compactLayout={compactLayout}
        >
          {pinnedThreads.map((chat) => renderRow(chat, compactLayout))}
        </ThreadCollapsibleSection>
      )}
      {/* Grouped mode labels the section whenever Done rows exist too, so an
          all-done list doesn't render as a bare "Done" header. */}
      {(groupDone
        ? threads.length > 0 || doneThreads.length > 0
        : pinnedThreads.length > 0 && threads.length > 0) && (
        <ThreadListSectionLabel compactLayout={compactLayout}>
          {groupDone ? "Active" : "Threads"}
        </ThreadListSectionLabel>
      )}
      {threads.map((chat) => renderRow(chat, compactLayout))}
      {threads.length === 0 &&
        pinnedThreads.length === 0 &&
        doneThreads.length === 0 && (
          <EmptyState
            icon={MessagesSquare}
            title="No threads yet"
            description="Threads started in this project appear here."
          />
        )}
      {hasMore && (
        <ThreadsLoadMoreButton isLoadingMore={isLoadingMore} onClick={onLoadMore} />
      )}
      {/* Done rows stay compact whatever the density preference: the section
          is a put-away pile, not a working list (OS-1394). */}
      {groupDone && doneThreads.length > 0 && (
        <ThreadDoneSection
          compactLayout={compactLayout}
          hasMore={hasMoreDone}
          isLoadingMore={isLoadingMoreDone}
          onLoadMore={onLoadMoreDone}
        >
          {doneThreads.map((chat) => renderRow(chat, true))}
        </ThreadDoneSection>
      )}
    </>
  );
}

/**
 * "Done" group (OS-1394): collapsed by default and paginated on its own, so
 * its Load more lives inside the collapsed content.
 */
function ThreadDoneSection({
  children,
  compactLayout,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ThreadListSectionProps & {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <ThreadCollapsibleSection
      label="Done"
      storageKey={DONE_SECTION_STORAGE_KEY}
      defaultCollapsed
      compactLayout={compactLayout}
    >
      {children}
      {hasMore && (
        <ThreadsLoadMoreButton
          isLoadingMore={isLoadingMore}
          onClick={onLoadMore}
        />
      )}
    </ThreadCollapsibleSection>
  );
}
