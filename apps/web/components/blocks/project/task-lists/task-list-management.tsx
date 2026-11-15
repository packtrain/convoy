"use client";

import {
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { Archive, Circle, CircleDashed, Pin, PinOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import {
  BACKLOG_SYSTEM_LIST,
  type SystemTaskListKey,
} from "@/lib/task-lists/system-lists";
import { cn } from "@/lib/utils";
import { useOptimisticRankReorder } from "@/components/custom/sortable-rank-list";
import { handleSearchablePickerKeyDown } from "@/components/custom/searchable-picker-keyboard";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppLink } from "@/lib/navigation";
import type { TaskListItem } from "./task-list-types";
import { TaskListFormDialog, type CreatedTaskList } from "./task-list-form-dialog";
import {
  filterSystemRows,
  resolveDefaultTaskList,
} from "./task-list-menu-model";
import { TaskListResultsList } from "./task-list-results-list";
import {
  useTaskListActions,
  type TaskListSystemActions,
} from "./use-task-list-actions";
import { TaskListSearchInput } from "./task-list-search-input";
import {
  getTaskListPickerItemProps,
} from "./task-list-picker-keyboard";
import {
  useResolvedTaskListResultsController,
  useSettingsTaskListResults,
  type TaskListResultsController,
} from "./use-task-list-results";

interface TaskListToolbarProps {
  data: TaskListResultsController;
  start?: ReactNode;
  end?: ReactNode;
  autoFocusSearch?: boolean;
  searchClassName?: string;
}

function TaskListToolbar({
  data,
  start,
  end,
  autoFocusSearch = false,
  searchClassName,
}: TaskListToolbarProps) {
  if (!start && !end) {
    return (
      <TaskListSearchInput
        data={data}
        autoFocus={autoFocusSearch}
        className={searchClassName}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <TaskListSearchInput
        data={data}
        autoFocus={autoFocusSearch}
        className={searchClassName}
      />
      {start}
      {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}

interface TaskListSurfaceProps {
  projectId?: Id<"projects">;
  data: TaskListResultsController;
  archived?: boolean;
  compactRows?: boolean;
  createRowPlacement?: "top" | "bottom";
  className: string;
  listClassName: string;
  showEmptyState?: boolean;
  renderToolbarStart?: (openCreateForm: () => void) => ReactNode;
  renderToolbarEnd?: (openCreateForm: () => void) => ReactNode;
  renderBeforeList?: (systemActions: TaskListSystemActions) => ReactNode;
  renderCreateRow?: (openCreateForm: (initialName?: string) => void) => ReactNode;
  onSelectList?: (list: TaskListItem) => void;
  onCreateList?: (list: CreatedTaskList) => void;
  selectedListRef?: string | null;
  isListDisabled?: (list: TaskListItem) => boolean;
  isListHidden?: (list: TaskListItem) => boolean;
  getOpenTasksHref?: (list: TaskListItem) => string | undefined;
  actionsMenuSide?: "top" | "right" | "bottom" | "left";
  actionsMenuAlign?: "start" | "center" | "end";
  showRowActions?: boolean;
  autoFocusSearch?: boolean;
  searchClassName?: string;
  sortable?: {
    enabled: boolean;
    onDragEnd: (activeId: string, overId: string) => void;
  };
}

function TaskListSurface({
  projectId,
  data,
  archived = false,
  compactRows = false,
  createRowPlacement = "top",
  className,
  listClassName,
  showEmptyState = true,
  renderToolbarStart,
  renderToolbarEnd,
  renderBeforeList,
  renderCreateRow,
  onSelectList,
  onCreateList,
  selectedListRef = null,
  isListDisabled,
  isListHidden,
  getOpenTasksHref,
  actionsMenuSide,
  actionsMenuAlign,
  showRowActions = true,
  autoFocusSearch = false,
  searchClassName,
  sortable,
}: TaskListSurfaceProps) {
  const { canManageLists, rowActions, systemActions, dialogs } = useTaskListActions({ projectId });
  const [initialCreateName, setInitialCreateName] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  if (!canManageLists && isFormOpen) {
    setIsFormOpen(false);
  }
  const listLimitMessage =
    "Projects can have up to 20 active lists. Archive an existing list before creating another.";

  const openCreateForm = (initialName = "") => {
    if (!archived && data.activeListLimitReached) {
      toast.warning(listLimitMessage);
      return;
    }

    setInitialCreateName(initialName);
    setIsFormOpen(true);
  };

  return (
    <div className={className}>
      <TaskListToolbar
        data={data}
        autoFocusSearch={autoFocusSearch}
        searchClassName={searchClassName}
        start={renderToolbarStart?.(() => openCreateForm())}
        end={renderToolbarEnd?.(() => openCreateForm())}
      />

      <TaskListResultsList
        data={data}
        className={listClassName}
        compactRows={compactRows}
        createRowPlacement={createRowPlacement}
        emptyText={archived ? "No archived lists" : "No lists found"}
        beforeList={renderBeforeList?.(systemActions)}
        createRow={renderCreateRow?.(openCreateForm)}
        showEmptyState={showEmptyState}
        onSelectList={onSelectList}
        selectedListRef={selectedListRef}
        isListDisabled={isListDisabled}
        isListHidden={isListHidden}
        getOpenTasksHref={getOpenTasksHref}
        actionsMenuSide={actionsMenuSide}
        actionsMenuAlign={actionsMenuAlign}
        rowActions={showRowActions ? rowActions : undefined}
        sortable={sortable}
      />

      {projectId ? (
        <TaskListFormDialog
          projectId={projectId}
          list={null}
          initialName={initialCreateName}
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          onCreated={onCreateList}
        />
      ) : null}

      {dialogs}
    </div>
  );
}

interface TaskListPickerProps {
  projectId?: Id<"projects">;
  defaultListId?: Id<"taskLists"> | null;
  onSelectList?: (list: TaskListItem) => void;
  onSelectInbox?: () => void;
  onSelectBacklog?: () => void;
  onSelectArchived?: () => void;
  isInboxSelected?: boolean;
  isBacklogSelected?: boolean;
  isArchivedSelected?: boolean;
  resultsController?: TaskListResultsController;
  onCreateList?: (list: CreatedTaskList) => void;
  selectedListRef?: string | null;
  getListHref?: (listRef: string | null) => string | undefined;
  backlogHref?: string;
  archivedHref?: string;
  disabledRows?: {
    system?: boolean | ((key: string) => boolean);
    create?: boolean;
    predicate?: (list: TaskListItem) => boolean;
  };
  showRowActions?: boolean;
  // Enables the hover-revealed pin/unpin control on the Backlog system row.
  // Only the header List picker opts in; further gated by the list:pin
  // permission through the resolved system pin actions.
  allowSystemPin?: boolean;
  rowActionsMenuSide?: "top" | "right" | "bottom" | "left";
  rowActionsMenuAlign?: "start" | "center" | "end";
  autoFocusSearch?: boolean;
  // Fills the available height instead of clipping List rows to the 17rem menu
  // viewport. Used by the mobile bottom-sheet selector, where the picker owns
  // the sheet's full height and the search row stays pinned above the scroll
  // area. Requires a height-constrained flex parent.
  fillHeight?: boolean;
}

// Hover-revealed pin/unpin control for a system List row, mirroring the
// persisted List row pin button. Resolved from the picker's system pin actions.
interface SystemListPinAction {
  Icon: typeof Pin;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

function getSystemListPinAction(
  systemActions: TaskListSystemActions,
  key: SystemTaskListKey,
  name: string,
  isPinned: boolean
): SystemListPinAction | undefined {
  if (isPinned) {
    if (!systemActions.onUnpin) {
      return undefined;
    }
    return {
      Icon: PinOff,
      label: "Unpin from sidebar",
      ariaLabel: `Unpin ${name} from sidebar`,
      onClick: () => systemActions.onUnpin?.(key),
    };
  }
  if (!systemActions.onPin) {
    return undefined;
  }
  return {
    Icon: Pin,
    label: "Pin to sidebar",
    ariaLabel: `Pin ${name} to sidebar`,
    onClick: () => systemActions.onPin?.(key),
  };
}

interface SystemListButtonProps {
  label: string;
  selected?: boolean;
  icon?: ReactNode;
  content?: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  pinAction?: SystemListPinAction;
}

function SystemListButton({
  label,
  selected = false,
  icon,
  content,
  onClick,
  href,
  disabled = false,
  pinAction,
}: SystemListButtonProps) {
  const className = cn(
    "flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
    disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
    selected && "bg-muted",
    pinAction && "pr-8"
  );
  const children = content ?? (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );

  const core =
    href && !disabled ? (
      <AppLink
        href={href}
        {...getTaskListPickerItemProps(true)}
        className={className}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey
          ) {
            return;
          }

          event.preventDefault();
          onClick?.();
        }}
      >
        {children}
      </AppLink>
    ) : (
      <button
        type="button"
        disabled={disabled}
        {...getTaskListPickerItemProps(!disabled)}
        className={className}
        onClick={onClick}
      >
        {children}
      </button>
    );

  if (!pinAction) {
    return core;
  }

  const PinIcon = pinAction.Icon;
  return (
    <div className="group/system-row relative">
      {core}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={pinAction.ariaLabel}
        title={pinAction.label}
        className="absolute right-1 top-1/2 size-6 -translate-y-1/2 cursor-pointer opacity-0 transition-opacity group-hover/system-row:opacity-100 group-focus-within/system-row:opacity-100"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          pinAction.onClick();
        }}
      >
        <PinIcon className="size-3" />
      </Button>
    </div>
  );
}

export function TaskListPicker({
  projectId,
  defaultListId = null,
  onSelectList,
  onSelectInbox,
  onSelectBacklog,
  onSelectArchived,
  isInboxSelected = false,
  isBacklogSelected = false,
  isArchivedSelected = false,
  resultsController,
  onCreateList,
  selectedListRef = null,
  getListHref,
  backlogHref,
  archivedHref,
  disabledRows,
  showRowActions = true,
  allowSystemPin = false,
  rowActionsMenuSide,
  rowActionsMenuAlign,
  autoFocusSearch = false,
  fillHeight = false,
}: TaskListPickerProps) {
  const data = useResolvedTaskListResultsController({
    projectId,
    resultsController,
  });
  const { canManageLists } = useProjectPermissions(projectId ?? null);
  const pinnedSystemKeys = useQuery(
    api.tasks.lists.listPinnedSystemListKeys,
    allowSystemPin && projectId ? { projectId } : "skip"
  );
  const isBacklogPinned = (pinnedSystemKeys ?? []).includes(
    BACKLOG_SYSTEM_LIST.key
  );
  const defaultList = resolveDefaultTaskList(data.results, defaultListId);
  const effectiveDefaultListId = defaultList?._id ?? defaultListId;
  const defaultListLabel = defaultList?.name ?? "Default list";
  const createSearchName = data.query.trim();
  const normalizedSystemQuery = createSearchName.toLocaleLowerCase();
  const visibleProjectLists = data.results;
  const hasExactSearchMatch =
    createSearchName.length > 0 &&
    data.results.some(
      (list) => list.name.trim().toLowerCase() === createSearchName.toLowerCase()
    );
  const shouldShowCreateRow =
    canManageLists &&
    !disabledRows?.create &&
    !data.activeListLimitReached &&
    !data.isLoading &&
    (createSearchName.length > 0
      ? !hasExactSearchMatch
      : Boolean(projectId));
  const hasProjectListRows = visibleProjectLists.length > 0 || shouldShowCreateRow;
  const systemLists = [
    ...(defaultList
      ? []
      : [
          {
            key: "default",
            label: defaultListLabel,
            selected: isInboxSelected,
            icon: <Circle className="size-3.5 shrink-0 text-muted-foreground" />,
            content: (
              <span className="min-w-0 flex-1 truncate">{defaultListLabel}</span>
            ),
            href: getListHref?.(null),
            onClick: onSelectInbox,
          },
        ]),
    {
      key: BACKLOG_SYSTEM_LIST.key,
      label: BACKLOG_SYSTEM_LIST.name,
      selected: isBacklogSelected,
      icon: <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />,
      href: backlogHref,
      onClick: onSelectBacklog,
    },
    {
      key: "archived",
      label: "Archived",
      selected: isArchivedSelected,
      icon: <Archive className="size-3.5 shrink-0 text-muted-foreground" />,
      href: archivedHref,
      onClick: onSelectArchived,
    },
  ];
  const filteredSystemLists = filterSystemRows(systemLists, normalizedSystemQuery);
  const isSystemRowDisabled = (key: string) =>
    typeof disabledRows?.system === "function"
      ? disabledRows.system(key)
      : disabledRows?.system;
  const shouldRenderSystemSeparator =
    filteredSystemLists.length > 0 && hasProjectListRows;
  const shouldShowNotFoundRow =
    createSearchName.length > 0 &&
    !data.isLoading &&
    filteredSystemLists.length === 0 &&
    visibleProjectLists.length === 0 &&
    !shouldShowCreateRow;
  const shouldShowListLimitRow =
    data.activeListLimitReached && createSearchName.length > 0;
  const createLabel = createSearchName
    ? `Create list "${createSearchName}"`
    : "Create list";
  const pickerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={pickerRef}
      className={fillHeight ? "flex min-h-0 flex-1 flex-col" : undefined}
      onKeyDownCapture={(event) =>
        handleSearchablePickerKeyDown(event, pickerRef.current)
      }
    >
      <TaskListSurface
        projectId={projectId}
        data={data}
        compactRows
        createRowPlacement="bottom"
        className={cn(
          "w-full min-w-0",
          fillHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"
        )}
        listClassName={
          fillHeight
            ? // Trailing scroll space so the last row can be scrolled clear of
              // the floating mobile nav bar that overlaps the sheet.
              "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--mobile-nav-clearance)]"
            : "max-h-[17rem] overflow-y-auto"
        }
        showEmptyState={false}
        onCreateList={onCreateList}
        selectedListRef={selectedListRef}
        getOpenTasksHref={(list) => getListHref?.(list.ref)}
        isListDisabled={disabledRows?.predicate}
        actionsMenuSide={rowActionsMenuSide}
        actionsMenuAlign={rowActionsMenuAlign}
        showRowActions={showRowActions}
        autoFocusSearch={autoFocusSearch}
        onSelectList={(list) => {
          if (list._id === effectiveDefaultListId) {
            if (onSelectInbox) {
              onSelectInbox();
              return;
            }
            onSelectList?.(list);
            return;
          }
          onSelectList?.(list);
        }}
        renderBeforeList={(systemActions) => (
          <div className="space-y-1">
            {filteredSystemLists.map((list) => {
              const pinAction =
                allowSystemPin && list.key === BACKLOG_SYSTEM_LIST.key
                  ? getSystemListPinAction(
                      systemActions,
                      BACKLOG_SYSTEM_LIST.key,
                      BACKLOG_SYSTEM_LIST.name,
                      isBacklogPinned
                    )
                  : undefined;
              return (
                <SystemListButton
                  key={list.key}
                  label={list.label}
                  selected={list.selected}
                  icon={list.icon}
                  content={"content" in list ? list.content : undefined}
                  href={"href" in list ? list.href : undefined}
                  onClick={list.onClick}
                  disabled={isSystemRowDisabled(list.key)}
                  pinAction={pinAction}
                />
              );
            })}
            {shouldRenderSystemSeparator ? (
              <div role="separator" className="-mx-2 mb-1 mt-2 h-px bg-border" />
            ) : null}
          </div>
        )}
        renderCreateRow={(openCreateForm) => {
          if (
            !shouldShowCreateRow &&
            !shouldShowNotFoundRow &&
            !shouldShowListLimitRow
          ) {
            return null;
          }

          return (
            <>
              {shouldShowCreateRow ? (
                <button
                  type="button"
                  {...getTaskListPickerItemProps(Boolean(projectId))}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!projectId}
                  onClick={() => openCreateForm(createSearchName)}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{createLabel}</span>
                </button>
              ) : null}
              {shouldShowNotFoundRow ? (
                <div className="px-1.5 py-1 text-sm text-muted-foreground">
                  {`"${createSearchName}" not found`}
                </div>
              ) : shouldShowListLimitRow ? (
                <div className="px-1.5 py-1 text-sm text-muted-foreground">
                  Project list limit reached
                </div>
              ) : null}
            </>
          );
        }}
      />
    </div>
  );
}

interface TaskListSettingsManagementProps {
  projectId?: Id<"projects">;
  archived?: boolean;
  showArchiveFilter?: boolean;
  onArchivedChange?: (archived: boolean) => void;
  getOpenTasksHref?: (list: TaskListItem) => string | undefined;
}

export function TaskListSettingsManagement({
  projectId,
  archived = false,
  showArchiveFilter = false,
  onArchivedChange,
  getOpenTasksHref,
}: TaskListSettingsManagementProps) {
  const data = useSettingsTaskListResults({ projectId, archived });
  const reorderList = useMutation(api.tasks.lists.reorder);
  const { canManageLists } = useProjectPermissions(projectId ?? null);
  const { orderedItems, handleDragEnd } = useOptimisticRankReorder({
    items: data.results,
    onReorder: (list, rank) => reorderList({ id: list._id, rank }),
    errorMessage: "Failed to reorder list",
  });
  const orderedData = useMemo(
    () => ({ ...data, results: orderedItems }),
    [data, orderedItems]
  );
  const dragEnabled =
    Boolean(projectId) &&
    canManageLists &&
    !archived &&
    data.query.trim().length === 0 &&
    !data.isLoading;

  return (
    <TaskListSurface
      projectId={projectId}
      data={orderedData}
      archived={archived}
      className="w-full space-y-2"
      listClassName="w-full"
      getOpenTasksHref={getOpenTasksHref}
      searchClassName="max-w-72 flex-1"
      renderToolbarStart={() => (
        showArchiveFilter ? (
          <Select
            value={archived ? "archived" : "active"}
            onValueChange={(value) => onArchivedChange?.(value === "archived")}
          >
            <SelectTrigger className="h-8 w-[116px] shrink-0 cursor-pointer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        ) : null
      )}
      renderToolbarEnd={(openCreateForm) => (
        !archived ? (
          <Button
            type="button"
            variant="outline"
            size="settings"
            disabled={!projectId || data.activeListLimitReached}
            title={data.activeListLimitReached ? "Project list limit reached" : undefined}
            onClick={openCreateForm}
          >
            <Plus className="size-4" />
            New list
          </Button>
        ) : null
      )}
      sortable={{
        enabled: dragEnabled,
        onDragEnd: (activeId, overId) => void handleDragEnd(activeId, overId),
      }}
    />
  );
}
