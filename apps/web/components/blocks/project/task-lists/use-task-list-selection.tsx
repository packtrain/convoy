"use client";

import { useMemo, useState } from "react";
import { Archive, CircleDashed, ListTree } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  BACKLOG_LIST_REF,
  isBacklogListRef,
  isSystemListRef,
} from "@/lib/task-lists/system-lists";
import type { ArchiveFilter, StatusFilterKey } from "@/lib/tasks/types";
import {
  ARCHIVED_TASK_LIST_ICON_CLASS,
  TaskListIdentity,
  type TaskListIdentityInput,
} from "./task-list-identity";
import type { TaskListItem } from "./task-list-types";
import {
  useResolvedTaskListResultsController,
  type TaskListResultsController,
} from "./use-task-list-results";

/**
 * Minimal shape a picker row (persisted List or freshly created List) has to
 * satisfy to become the optimistic trigger label of the selector.
 */
export type TaskListSelectionPreview = Pick<
  TaskListItem,
  "name" | "ref" | "color"
> & {
  isArchived?: boolean;
};

interface UseTaskListSelectionArgs {
  projectId?: Id<"projects">;
  defaultListId?: Id<"taskLists"> | null;
  archiveFilter: ArchiveFilter;
  selectedListRef: string | null;
  selectedList?: TaskListItem | null;
  resultsController?: TaskListResultsController;
  onStatusFilterChange: (filter: StatusFilterKey) => void;
  onArchiveFilterChange: (filter: ArchiveFilter) => void;
  onSelectedListChange: (listRef: string | null) => void;
}

function triggerSkeleton() {
  return (
    <span className="flex min-w-0 items-center gap-2" aria-hidden="true">
      <Skeleton className="h-3.5 w-14" />
    </span>
  );
}

function getTriggerLabel({
  isArchivedSelected,
  isBacklogSelected,
  isPersistedListSelected,
  isInboxSelected,
  selectedListIdentity,
  defaultList,
}: {
  isArchivedSelected: boolean;
  isBacklogSelected: boolean;
  isPersistedListSelected: boolean;
  isInboxSelected: boolean;
  selectedListIdentity: TaskListIdentityInput | null;
  defaultList: TaskListItem | null;
}) {
  if (isArchivedSelected) {
    return (
      <>
        <Archive className={cn("size-3.5", ARCHIVED_TASK_LIST_ICON_CLASS)} />
        Archived
      </>
    );
  }
  if (isBacklogSelected) {
    return (
      <>
        <CircleDashed className="size-3.5 text-muted-foreground" />
        Backlog
      </>
    );
  }
  if (isPersistedListSelected) {
    // The selected-list query may still be reloading; show a skeleton until an
    // identity resolves rather than flashing a "Loading…" label.
    return selectedListIdentity ? (
      <TaskListIdentity list={selectedListIdentity} size="compact" />
    ) : (
      triggerSkeleton()
    );
  }
  if (isInboxSelected) {
    return defaultList ? (
      <TaskListIdentity list={defaultList} size="compact" />
    ) : (
      triggerSkeleton()
    );
  }
  return (
    <>
      <ListTree className="size-3.5 text-muted-foreground" />
      Lists
    </>
  );
}

/**
 * Shared selection state for the project List selector surfaces: the desktop
 * header dropdown and the mobile task-views header selector. Owns the trigger
 * label, the selection flags the picker highlights, and the selection handlers
 * (spec: docs/specs/task-lists.md "List Selector").
 */
export function useTaskListSelection({
  projectId,
  defaultListId = null,
  archiveFilter,
  selectedListRef,
  selectedList = null,
  resultsController,
  onStatusFilterChange,
  onArchiveFilterChange,
  onSelectedListChange,
}: UseTaskListSelectionArgs) {
  const activeResultsController = useResolvedTaskListResultsController({
    projectId,
    resultsController,
  });
  const [selectedListPreview, setSelectedListPreview] =
    useState<TaskListSelectionPreview | null>(null);
  const defaultList =
    activeResultsController.results.find((list) => list._id === defaultListId) ??
    null;
  const effectiveSelectedListPreview =
    selectedListPreview?.ref === selectedListRef ? selectedListPreview : null;
  const isPersistedListSelected =
    archiveFilter === "active" &&
    Boolean(selectedListRef) &&
    !isSystemListRef(selectedListRef);
  const isInboxSelected = archiveFilter === "active" && !selectedListRef;
  const isBacklogSelected =
    archiveFilter === "active" && isBacklogListRef(selectedListRef);
  const isArchivedSelected = archiveFilter === "archived";
  // Selection can change outside the selector (e.g. sidebar pinned lists)
  // while the selected-list query reloads; the already-loaded results keep the
  // trigger pill stable instead of flashing a loading label.
  const selectedListFromResults = useMemo(() => {
    if (!isPersistedListSelected || !selectedListRef) {
      return null;
    }
    return (
      activeResultsController.results.find(
        (list) => list.ref === selectedListRef
      ) ?? null
    );
  }, [activeResultsController.results, isPersistedListSelected, selectedListRef]);
  // Resolve the selected list's identity from the most authoritative available
  // source; null until something resolves (the trigger then shows a skeleton).
  const selectedListIdentity = useMemo<TaskListIdentityInput | null>(() => {
    if (!isPersistedListSelected) {
      return null;
    }
    const name =
      selectedList?.name ??
      effectiveSelectedListPreview?.name ??
      selectedListFromResults?.name ??
      null;
    if (!name) {
      return null;
    }
    return {
      type: "list",
      name,
      color:
        selectedList?.color ??
        effectiveSelectedListPreview?.color ??
        selectedListFromResults?.color ??
        null,
      isArchived:
        selectedList?.isArchived ??
        effectiveSelectedListPreview?.isArchived ??
        false,
    };
  }, [
    effectiveSelectedListPreview,
    isPersistedListSelected,
    selectedList,
    selectedListFromResults,
  ]);
  const triggerLabel = getTriggerLabel({
    isArchivedSelected,
    isBacklogSelected,
    isPersistedListSelected,
    isInboxSelected,
    selectedListIdentity,
    defaultList,
  });

  const selectList = (list: TaskListSelectionPreview) => {
    setSelectedListPreview(list);
    onSelectedListChange(list.ref);
  };

  const selectInbox = () => {
    setSelectedListPreview(null);
    onSelectedListChange(null);
    if (archiveFilter === "archived") {
      onStatusFilterChange("all");
    }
  };

  const selectBacklog = () => {
    setSelectedListPreview(null);
    onSelectedListChange(BACKLOG_LIST_REF);
  };

  const selectArchived = () => {
    setSelectedListPreview(null);
    onSelectedListChange(null);
    if (archiveFilter !== "archived") {
      onArchiveFilterChange("archived");
    }
  };

  return {
    resultsController: activeResultsController,
    isInboxSelected,
    isBacklogSelected,
    isPersistedListSelected,
    isArchivedSelected,
    isSelectedListArchived: Boolean(
      isPersistedListSelected && selectedListIdentity?.isArchived
    ),
    triggerLabel,
    selectList,
    selectInbox,
    selectBacklog,
    selectArchived,
  };
}
