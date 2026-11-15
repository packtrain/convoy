"use client";

import { useCallback, useRef, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SearchInput } from "@/components/custom/search-input";
import { FilterDropdown } from "@/components/blocks/project/filter-dropdown";
import { ProjectTaskListDropdown } from "@/components/blocks/project/task-lists/project-task-list-dropdown";
import { useSelectedTaskList } from "@/components/blocks/project/task-lists/use-selected-task-list";
import { TaskTableSurface } from "@/components/blocks/tasks/task-table-surface";
import { useTaskTableController } from "@/components/blocks/tasks/task-table/hooks/use-task-table-controller";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import type { ThreadWorkspaceTaskTarget } from "@/lib/threads/hooks/use-open-thread-workspace-task";
import { useTasks } from "@/lib/tasks/hooks/use-tasks";
import { useMappedTasks } from "@/lib/tasks/hooks/tasks/use-task-view-state";
import { useDebounce } from "@/hooks/react/use-debounce";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type {
  ArchiveFilter,
  AssigneeFilter,
  StatusFilterKey,
  Task,
} from "@/lib/tasks/types";

const SEARCH_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 200;
// Search hits come from many Lists in relevance order, so rank moves are meaningless.
const noop = () => {};
const NO_TASKS: Task[] = [];

/**
 * The panel's own view state. Lifted by `ThreadWorkspaceHost` so it survives a
 * first send, which swaps the view rendering the panel and would otherwise
 * remount it — resetting the filters and re-fetching (OS-1660).
 */
export interface ThreadTasksPanelFilters {
  /** null means the project's default List. */
  selectedListRef: string | null;
  archiveFilter: ArchiveFilter;
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  /** Non-empty swaps the table for active-task search hits across every List. */
  searchQuery: string;
}

export const DEFAULT_THREAD_TASKS_PANEL_FILTERS: ThreadTasksPanelFilters = {
  selectedListRef: null,
  archiveFilter: "active",
  statusFilter: "all",
  assigneeFilter: null,
  searchQuery: "",
};

interface ThreadTasksPanelProps {
  projectId: Id<"projects">;
  /** Lifted filter state; omit to keep it panel-local. */
  filters?: ThreadTasksPanelFilters;
  onFiltersChange?: (patch: Partial<ThreadTasksPanelFilters>) => void;
  defaultListId?: Id<"taskLists"> | null;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  allowedStatuses?: TaskStatus[];
  currentUserId?: string;
  onOpenTask: (task: ThreadWorkspaceTaskTarget) => void;
}

export function ThreadTasksPanel({
  projectId,
  filters,
  onFiltersChange,
  defaultListId = null,
  hiddenTaskTableColumns,
  allowedStatuses,
  currentUserId,
  onOpenTask,
}: ThreadTasksPanelProps) {
  // Falls back to panel-local state when the host doesn't lift it.
  const [localFilters, setLocalFilters] = useState<ThreadTasksPanelFilters>(
    DEFAULT_THREAD_TASKS_PANEL_FILTERS
  );
  const { selectedListRef, archiveFilter, statusFilter, assigneeFilter, searchQuery } =
    filters ?? localFilters;
  const patchFilters = useCallback(
    (patch: Partial<ThreadTasksPanelFilters>) => {
      if (onFiltersChange) {
        onFiltersChange(patch);
        return;
      }
      setLocalFilters((current) => ({ ...current, ...patch }));
    },
    [onFiltersChange]
  );
  const setArchiveFilter = useCallback(
    (next: ArchiveFilter) => patchFilters({ archiveFilter: next }),
    [patchFilters]
  );
  const setStatusFilter = useCallback(
    (next: StatusFilterKey) => patchFilters({ statusFilter: next }),
    [patchFilters]
  );
  const setAssigneeFilter = useCallback(
    (next: AssigneeFilter) => patchFilters({ assigneeFilter: next }),
    [patchFilters]
  );
  const setSearchQuery = useCallback(
    (next: string) => patchFilters({ searchQuery: next }),
    [patchFilters]
  );
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelWidth = useElementWidth(panelRef);
  const isMobile = useIsMobile();
  const useCards = panelWidth === null ? isMobile : panelWidth < 768;

  const selectedList = useSelectedTaskList({
    projectId,
    selectedListRef,
    onInvalidListRef: useCallback(
      () => patchFilters({ selectedListRef: null }),
      [patchFilters]
    ),
  });
  const taskResult = useTasks(projectId, archiveFilter, statusFilter, selectedListRef);
  const moveToList =
    archiveFilter === "active" ? taskResult.moveToList : undefined;

  const trimmedQuery = searchQuery.trim();
  const debouncedQuery = useDebounce(trimmedQuery, SEARCH_DEBOUNCE_MS);
  const isSearching = trimmedQuery.length > 0;
  const search = usePaginatedQuery(
    api.tasks.core.search.byProjectForTable,
    isSearching && debouncedQuery ? { projectId, query: debouncedQuery } : "skip",
    { initialNumItems: SEARCH_PAGE_SIZE }
  );
  const searchHits = useMappedTasks(search.results);
  const isSearchLoading =
    debouncedQuery !== trimmedQuery || search.status === "LoadingFirstPage";

  const tasks = isSearching ? (isSearchLoading ? NO_TASKS : searchHits) : taskResult.tasks;
  const isLoading = isSearching ? isSearchLoading : taskResult.isLoading;
  const ops = isSearching
    ? {
        ...taskResult,
        reorderTasks: noop,
        reorderMultiple: noop,
        setParent: noop,
        setParentMultiple: noop,
        moveActiveToList: undefined,
        moveToList,
      }
    : { ...taskResult, moveToList };

  const handleSelectedListChange = useCallback(
    (nextListRef: string | null) => {
      patchFilters({ selectedListRef: nextListRef, archiveFilter: "active" });
    },
    [patchFilters]
  );

  const handleOpenDetails = useCallback(
    (clientId: string) => {
      const task = tasks.find((candidate) => candidate.clientId === clientId);
      if (!task?.refId) {
        return;
      }
      onOpenTask({ refId: task.refId, isArchived: task.isArchived });
    },
    [onOpenTask, tasks]
  );

  const { canCreateTask, canUpdateTask } = useProjectPermissions(projectId);
  const table = useTaskTableController({
    allTasks: tasks,
    updateTask: taskResult.updateTask,
    deleteTask: taskResult.deleteTask,
    archiveTask: taskResult.archiveTask,
    unarchiveTask: taskResult.unarchiveTask,
    addTask: taskResult.addTask,
    reorderTasks: ops.reorderTasks,
    reorderMultiple: ops.reorderMultiple,
    setParent: ops.setParent,
    setParentMultiple: ops.setParentMultiple,
    bulkUpdateStatus: taskResult.bulkUpdateStatus,
    bulkUpdateAssignee: taskResult.bulkUpdateAssignee,
    bulkUpdatePriority: taskResult.bulkUpdatePriority,
    bulkUpdateDueDate: taskResult.bulkUpdateDueDate,
    bulkUpdateTaskType: taskResult.bulkUpdateTaskType,
    bulkArchive: taskResult.bulkArchive,
    bulkUnarchive: taskResult.bulkUnarchive,
    moveToList,
    moveClosedToBottom: isSearching ? undefined : taskResult.moveClosedToBottom,
    bulkDelete: taskResult.bulkDelete,
    duplicateTask: taskResult.duplicateTask,
    inputRefs: taskResult.inputRefs,
    focusInput: taskResult.focusInput,
    containerRef: tableContainerRef,
    onOpenDetails: handleOpenDetails,
    openDetailsOnNameClick: true,
    enabled: !isLoading && !useCards,
    canUpdateTask,
    projectId,
    currentUserId,
    allowedStatuses,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    assigneeFilter,
    onAssigneeFilterChange: setAssigneeFilter,
    allowAddTask: !isSearching && archiveFilter !== "archived" && canCreateTask,
    preserveRootOrder: isSearching || archiveFilter === "archived",
  });

  return (
    <section ref={panelRef} className="flex h-full min-h-0 flex-col">
      <header className="flex h-[41px] shrink-0 items-center gap-1.5 border-b border-border bg-card px-2">
        <SearchInput
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && isSearching) {
              event.stopPropagation();
              setSearchQuery("");
            }
          }}
          placeholder="Search tasks"
          aria-label="Search tasks"
          autoComplete="off"
          className="h-7 min-w-0 flex-1 border-0 bg-transparent shadow-none dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0"
          showClearButton={isSearching}
          onClear={() => setSearchQuery("")}
        />
        <ProjectTaskListDropdown
          projectId={projectId}
          defaultListId={defaultListId}
          archiveFilter={archiveFilter}
          selectedListRef={selectedListRef}
          selectedList={selectedList ?? null}
          onStatusFilterChange={setStatusFilter}
          onArchiveFilterChange={setArchiveFilter}
          onSelectedListChange={handleSelectedListChange}
        />
        <FilterDropdown
          statusFilter={statusFilter}
          assigneeFilter={assigneeFilter}
          projectId={projectId}
          isActive={statusFilter !== "all" || assigneeFilter !== null}
          onStatusFilterChange={setStatusFilter}
          onAssigneeFilterChange={setAssigneeFilter}
        />
      </header>
      <TaskTableSurface
        projectId={projectId}
        controller={table}
        tasks={tasks}
        isLoading={isLoading}
        ops={ops}
        archiveFilter={archiveFilter}
        selectedListRef={isSearching ? null : selectedListRef}
        viewCacheScope="thread-tasks-panel-view"
        tableContainerRef={tableContainerRef}
        hiddenTaskTableColumns={hiddenTaskTableColumns}
        allowedStatuses={allowedStatuses}
        currentUserId={currentUserId}
        onOpenDetails={handleOpenDetails}
        compact
        mobileCardLayout={useCards}
        maxHeight="100%"
        onLoadMore={isSearching ? () => search.loadMore(SEARCH_PAGE_SIZE) : undefined}
        hasMore={isSearching && (search.status === "CanLoadMore" || search.status === "LoadingMore")}
        isLoadingMore={isSearching && search.status === "LoadingMore"}
      />
    </section>
  );
}
