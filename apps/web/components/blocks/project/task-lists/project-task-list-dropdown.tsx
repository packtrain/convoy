"use client";

import { useCallback, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/blocks/mobile/mobile-sheet";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { cn } from "@/lib/utils";
import type { ArchiveFilter, StatusFilterKey } from "@/lib/tasks/types";
import { HeaderMenu } from "../header-menu";
import { TaskListPicker } from "./task-list-management";
import { ARCHIVED_TASK_LIST_HEADER_TRIGGER_CLASS } from "./task-list-identity";
import type { TaskListItem } from "./task-list-types";
import type { TaskListResultsController } from "./use-task-list-results";
import { useTaskListSelection } from "./use-task-list-selection";

interface ProjectTaskListDropdownProps {
  projectId?: Id<"projects">;
  defaultListId?: Id<"taskLists"> | null;
  archiveFilter: ArchiveFilter;
  selectedListRef: string | null;
  selectedList?: TaskListItem | null;
  resultsController?: TaskListResultsController;
  getListHref?: (listRef: string | null) => string | undefined;
  backlogHref?: string;
  archivedHref?: string;
  onStatusFilterChange: (filter: StatusFilterKey) => void;
  onArchiveFilterChange: (filter: ArchiveFilter) => void;
  onSelectedListChange: (listRef: string | null) => void;
}

const archivedTriggerClasses = ARCHIVED_TASK_LIST_HEADER_TRIGGER_CLASS;
const activeTriggerClasses = "bg-muted text-foreground hover:bg-muted aria-expanded:bg-muted";

/**
 * The project List selector. One component, two presentations: a header popover
 * menu on desktop and a draggable bottom sheet on mobile (spec:
 * docs/specs/task-lists.md "List Selector").
 */
export function ProjectTaskListDropdown({
  projectId,
  defaultListId = null,
  archiveFilter,
  selectedListRef,
  selectedList = null,
  resultsController,
  getListHref,
  backlogHref,
  archivedHref,
  onStatusFilterChange,
  onArchiveFilterChange,
  onSelectedListChange,
}: ProjectTaskListDropdownProps) {
  const isMobile = useIsMobile();
  const [isSheetOpen, setSheetOpen] = useState(false);
  const selection = useTaskListSelection({
    projectId,
    defaultListId,
    archiveFilter,
    selectedListRef,
    selectedList,
    resultsController,
    onStatusFilterChange,
    onArchiveFilterChange,
    onSelectedListChange,
  });
  const {
    isArchivedSelected,
    isBacklogSelected,
    isInboxSelected,
    isPersistedListSelected,
    isSelectedListArchived,
  } = selection;
  const resetQuery = selection.resultsController.resetQuery;

  const handleSelect = (close: () => void, select: () => void) => {
    close();
    select();
  };

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    resetQuery();
  }, [resetQuery]);

  // One trigger for both presentations — the pill looks and behaves the same on
  // mobile as in the desktop header; only `aria-haspopup` reflects what opens.
  const renderTrigger = ({
    open,
    onOpen,
    haspopup,
  }: {
    open: boolean;
    onOpen: () => void;
    haspopup: "menu" | "dialog";
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      shape="pill"
      aria-label="Open lists"
      aria-expanded={open}
      aria-haspopup={haspopup}
      className={cn(
        "max-w-[240px] cursor-pointer gap-1.5 px-3 pl-2 text-foreground transition-none",
        isArchivedSelected
          ? archivedTriggerClasses
          : (isInboxSelected || isBacklogSelected || isPersistedListSelected) &&
              activeTriggerClasses,

        isArchivedSelected && "pl-2.5",
        isSelectedListArchived && ARCHIVED_TASK_LIST_HEADER_TRIGGER_CLASS
      )}
      disabled={!projectId}
      onClick={onOpen}
    >
      {selection.triggerLabel}
    </Button>
  );

  const renderPicker = ({
    close,
    fillHeight,
  }: {
    close: () => void;
    fillHeight?: boolean;
  }) => (
    <TaskListPicker
      projectId={projectId}
      defaultListId={defaultListId}
      onSelectList={(list) => handleSelect(close, () => selection.selectList(list))}
      onCreateList={(list) => handleSelect(close, () => selection.selectList(list))}
      onSelectInbox={() => handleSelect(close, selection.selectInbox)}
      onSelectBacklog={() => handleSelect(close, selection.selectBacklog)}
      onSelectArchived={() => handleSelect(close, selection.selectArchived)}
      isInboxSelected={isInboxSelected}
      isBacklogSelected={isBacklogSelected}
      isArchivedSelected={isArchivedSelected}
      resultsController={selection.resultsController}
      selectedListRef={selectedListRef}
      getListHref={getListHref}
      backlogHref={backlogHref}
      archivedHref={archivedHref}
      allowSystemPin={!fillHeight}
      rowActionsMenuSide={fillHeight ? undefined : "right"}
      rowActionsMenuAlign={fillHeight ? undefined : "start"}
      // Touch has no hover: row actions would sit permanently next to every
      // row in the sheet, so the sheet stays a selection surface.
      showRowActions={!fillHeight}
      // On touch, auto-focusing search opens the keyboard over the sheet.
      autoFocusSearch={!fillHeight}
      fillHeight={fillHeight}
    />
  );

  if (isMobile) {
    return (
      <>
        {renderTrigger({
          open: isSheetOpen,
          onOpen: () => setSheetOpen(true),
          haspopup: "dialog",
        })}
        {/* `fill` body: the picker keeps its search row pinned and owns the
            scroll area, including the nav-bar clearance that lets the last List
            row scroll clear of the floating bar. */}
        <MobileSheet
          open={isSheetOpen}
          onClose={closeSheet}
          title="Lists"
          description="Switch the list shown in the task views."
          body="fill"
        >
          <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
            {renderPicker({ close: closeSheet, fillHeight: true })}
          </div>
        </MobileSheet>
      </>
    );
  }

  return (
    <HeaderMenu
      menuClassName="overflow-hidden p-2"
      onClose={resetQuery}
      trigger={({ open, toggle }) =>
        renderTrigger({ open, onOpen: toggle, haspopup: "menu" })
      }
    >
      {({ close }) => renderPicker({ close })}
    </HeaderMenu>
  );
}
