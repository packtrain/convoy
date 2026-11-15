"use client";

import type { ReactNode } from "react";
import type { BoardRowGroupBy, ListGroupBy } from "@/lib/navigation";

import { LayoutGrid, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { SettingsDropdown } from "./settings-dropdown";
import { FilterDropdown } from "./filter-dropdown";
import { ProjectMembersAvatarGroup } from "./project-members-avatar-group";
import { TaskSearchDropdown } from "./task-search-dropdown";
import { ProjectTaskListDropdown } from "./task-lists/project-task-list-dropdown";
import type { TaskListItem } from "./task-lists/task-list-types";
import type { TaskListResultsController } from "./task-lists/use-task-list-results";
import { cn } from "@/lib/utils";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import type { StatusFilterKey, AssigneeFilter, ArchiveFilter } from "@/lib/tasks/types";
import type {
  TaskSearchHrefBuilder,
  TaskSearchSelectHandler,
} from "@/lib/tasks/task-selector";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AppLink,
  DEFAULT_BOARD_GROUP_BY,
  appRoute,
  href,
  type BoardGroupBy,
  type ProjectViewMode,
} from "@/lib/navigation";

interface ProjectHeaderProps {
  projectName?: string;
  /** Rendered after the project name (the view-only badge). */
  badge?: ReactNode;
  projectId?: Id<"projects">;
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  defaultListId?: Id<"taskLists"> | null;
  isBoardViewAvailable?: boolean;
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  archiveFilter: ArchiveFilter;
  selectedListRef?: string | null;
  selectedList?: TaskListItem | null;
  /** The List whose view is on screen (the default List when no ref). */
  viewedList?: TaskListItem | null;
  taskListResultsController?: TaskListResultsController;
  boardGroupBy?: BoardGroupBy;
  boardRowGroupBy?: BoardRowGroupBy;
  defaultBoardRowGroupBy?: BoardRowGroupBy;
  onBoardRowGroupByChange?: (groupBy: BoardRowGroupBy) => void;
  listGroupBy?: ListGroupBy;
  defaultListGroupBy?: ListGroupBy;
  onListGroupByChange?: (groupBy: ListGroupBy) => void;
  defaultViewMode?: ProjectViewMode;
  defaultBoardGroupBy?: BoardGroupBy;
  getListHref?: (listRef: string | null) => string | undefined;
  backlogHref?: string;
  archivedHref?: string;
  viewMode: ProjectViewMode;
  listPath: string;
  boardPath?: string | null;
  onStatusFilterChange: (filter: StatusFilterKey) => void;
  onAssigneeFilterChange: (filter: AssigneeFilter) => void;
  onArchiveFilterChange: (filter: ArchiveFilter) => void;
  onSelectedListChange?: (listRef: string | null) => void;
  onBoardGroupByChange?: (groupBy: BoardGroupBy) => void;
  onSearchTaskSelect: TaskSearchSelectHandler;
  getSearchTaskHref: TaskSearchHrefBuilder;
  /** Omitted when the caller cannot create tasks here; the + button hides. */
  onAddTask?: () => void;
  onMembersClick?: () => void;
  onAiAgentsClick?: () => void;
  organizationSlug?: string;
  projectAlias?: string;
}

export function ProjectHeader({
  projectName,
  badge,
  projectId,
  hiddenTaskTableColumns,
  defaultListId = null,
  isBoardViewAvailable = true,
  statusFilter,
  assigneeFilter,
  archiveFilter,
  selectedListRef = null,
  selectedList = null,
  viewedList = null,
  taskListResultsController,
  boardGroupBy = DEFAULT_BOARD_GROUP_BY,
  boardRowGroupBy,
  defaultBoardRowGroupBy,
  onBoardRowGroupByChange,
  defaultViewMode,
  defaultBoardGroupBy,
  listGroupBy = "none",
  defaultListGroupBy,
  onListGroupByChange,
  getListHref,
  backlogHref,
  archivedHref,
  viewMode,
  listPath,
  boardPath,
  onStatusFilterChange,
  onAssigneeFilterChange,
  onArchiveFilterChange,
  onSelectedListChange = () => {},
  onBoardGroupByChange,
  onSearchTaskSelect,
  getSearchTaskHref,
  onAddTask,
  onMembersClick,
  onAiAgentsClick,
  organizationSlug,
  projectAlias,
}: ProjectHeaderProps) {
  const activeTriggerClasses = "bg-muted text-foreground hover:bg-muted aria-expanded:bg-muted";
  const isDefaultListView =
    viewMode === "list" &&
    statusFilter === "all" &&
    assigneeFilter === null &&
    archiveFilter === "active";
  const isBoardDisabled = !isBoardViewAvailable;
  const projectPath =
    organizationSlug && projectAlias
      ? href(appRoute.project(organizationSlug, projectAlias))
      : undefined;
  return (
    <header className="hidden h-14 shrink-0 items-center gap-2 border-b border-border px-4 md:flex">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="min-w-0">
              {projectName ? (
                <BreadcrumbPage
                  className="block truncate font-medium"
                  title={projectName}
                >
                  {projectName}
                </BreadcrumbPage>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {badge}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {boardPath ? (
          <div role="group" className="flex w-fit items-center gap-0.5">
            <TooltipExt content="List" delayDuration={500}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="List"
                className={cn(
                  "size-7 rounded-md text-muted-foreground",
                  isDefaultListView && activeTriggerClasses
                )}
                asChild
              >
                <AppLink
                  href={listPath}
                  aria-current={isDefaultListView ? "page" : undefined}
                >
                  <List className="size-3.5" />
                </AppLink>
              </Button>
            </TooltipExt>
            <TooltipExt content="Board" delayDuration={500}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Board"
                className={cn(
                  "size-7 rounded-md text-muted-foreground",
                  isBoardDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  viewMode === "board" && activeTriggerClasses
                )}
                aria-disabled={isBoardDisabled}
                disabled={isBoardDisabled}
                asChild={!isBoardDisabled}
              >
                {isBoardDisabled ? (
                  <span>
                    <LayoutGrid className="size-3.5" />
                  </span>
                ) : (
                  <AppLink
                    href={boardPath}
                    aria-current={viewMode === "board" ? "page" : undefined}
                  >
                    <LayoutGrid className="size-3.5" />
                  </AppLink>
                )}
              </Button>
            </TooltipExt>
          </div>
        ) : null}
        <ProjectTaskListDropdown
          projectId={projectId}
          defaultListId={defaultListId}
          archiveFilter={archiveFilter}
          selectedListRef={selectedListRef}
          selectedList={selectedList}
          resultsController={taskListResultsController}
          getListHref={getListHref}
          backlogHref={backlogHref}
          archivedHref={archivedHref}
          onStatusFilterChange={onStatusFilterChange}
          onArchiveFilterChange={onArchiveFilterChange}
          onSelectedListChange={onSelectedListChange}
        />
        <FilterDropdown
          statusFilter={statusFilter}
          assigneeFilter={assigneeFilter}
          projectId={projectId}
          isActive={false}
          onStatusFilterChange={onStatusFilterChange}
          onAssigneeFilterChange={onAssigneeFilterChange}
        />
        <TaskSearchDropdown
          projectId={projectId}
          onSelectTask={onSearchTaskSelect}
          getTaskHref={getSearchTaskHref}
        />
        {projectId && onMembersClick && (
          <ProjectMembersAvatarGroup
            projectId={projectId}
            onMembersClick={onMembersClick}
          />
        )}
        <SettingsDropdown
          onAddMembers={onMembersClick}
          onOpenAiAgents={onAiAgentsClick}
          projectPath={projectPath}
          showBoardGroupBy={viewMode === "board"}
          boardGroupBy={boardGroupBy}
          boardRowGroupBy={boardRowGroupBy}
          defaultBoardRowGroupBy={defaultBoardRowGroupBy}
          onBoardRowGroupByChange={onBoardRowGroupByChange}
            listGroupBy={listGroupBy}
            defaultListGroupBy={defaultListGroupBy}
            onListGroupByChange={onListGroupByChange}
          defaultViewMode={defaultViewMode}
          defaultBoardGroupBy={defaultBoardGroupBy}
          viewedList={viewedList}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          onBoardGroupByChange={onBoardGroupByChange}
          projectId={projectId}
          hiddenTaskTableColumns={hiddenTaskTableColumns}
        />
        {onAddTask && (
          <TooltipExt content="Add task (N)" delayDuration={500}>
            <Button
              size="sm"
              className="h-8 w-8 rounded-full"
              aria-label="Add task"
              onClick={onAddTask}
              disabled={archiveFilter === "archived"}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipExt>
        )}
      </div>
    </header>
  );
}
