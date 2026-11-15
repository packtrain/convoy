"use client";

import { useCallback, useMemo } from "react";
import {
  Check,
  X,
  CornerLeftUp,
  Archive,
  ArchiveRestore,
  Trash2,
  Bot,
  MoreHorizontal,
  ListTree,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppLink, appRoute, href } from "@/lib/navigation";
import { Status, type Task } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import {
  ONE_LINE_MENU_CLASS,
  TaskActionMenuItems,
  useTaskLinkActions,
  type TaskActionCallbacks,
} from "@/components/blocks/tasks/task-action-menu-items";
import { MoveToListMenuContent } from "@/components/blocks/project/task-lists/move-to-list-menu-content";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";

interface TaskDetailHeaderProps {
  task: Task;
  parentTask?: Task;
  onClose: () => void;
  onToggleComplete: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
  onNavigateToParent?: () => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
  onUpdateStatus?: (status: Status) => void;
  projectId?: Id<"projects">;
  taskListResultsController?: TaskListResultsController;
  selectedListRef?: string | null;
  onMoveToList?: (listRef: string, sectionId?: Id<"taskSections">) => void;
  variant?: "default" | "thread-workspace";
  organizationSlug?: string;
  projectAlias?: string;
  /** Set for read-only callers (docs/specs/read-only-viewer-ux.md). */
  readOnlyReason?: string | null;
  canUseThreads?: boolean;
}

export function TaskDetailHeader({
  task,
  parentTask,
  onClose,
  onToggleComplete,
  onUnarchive,
  onDelete,
  onNavigateToParent,
  onDuplicate,
  onArchive,
  projectId,
  taskListResultsController,
  selectedListRef = null,
  onMoveToList,
  variant = "default",
  organizationSlug,
  projectAlias,
  readOnlyReason = null,
  canUseThreads = true,
}: TaskDetailHeaderProps) {
  const isCompleted = task.status === Status.DONE;
  const isArchived = task.isArchived;
  const isThreadWorkspace = variant === "thread-workspace";
  const readOnly = readOnlyReason !== null;
  const threadPageHref =
    canUseThreads && organizationSlug && projectAlias
      ? href(appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
          attachedTask: task.refId,
        }))
      : null;

  const { handleOpenInNewTab, handleCopyLink } = useTaskLinkActions(task.refId);
  const moveToListProjectId = projectId && onMoveToList && !isArchived
    ? projectId
    : null;
  const moveToListItem = moveToListProjectId && onMoveToList ? (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ListTree className="mr-2 h-4 w-4" />
        Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-auto p-0">
        <MoveToListMenuContent
          projectId={moveToListProjectId}
          resultsController={taskListResultsController}
          selectedListRef={selectedListRef}
          autoFocusSearch
          Item={DropdownMenuItem}
          itemClassName="h-7"
          onMoveToList={onMoveToList}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ) : null;

  const callbacks = useMemo<TaskActionCallbacks>(
    () => ({
      onDuplicate,
      onMarkComplete: onToggleComplete,
      onOpenInNewTab: handleOpenInNewTab,
      onCopyLink: handleCopyLink,
      onArchive,
      onUnarchive,
      onDelete,
    }),
    [
      onDuplicate,
      onToggleComplete,
      handleOpenInNewTab,
      handleCopyLink,
      onArchive,
      onUnarchive,
      onDelete,
    ]
  );

  const handleCloseClick = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <>
      {/* Header */}
      <div
        data-testid="task-detail-header"
        className={
          isThreadWorkspace
            ? "flex min-h-[41px] items-center justify-between border-b border-border bg-card px-4 py-1"
            : "flex min-h-[41px] items-center justify-between border-b border-border px-4 py-1"
        }
      >
        <div className="flex items-center gap-2">
          {parentTask && onNavigateToParent && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onNavigateToParent}
              aria-label={`Go to parent task ${parentTask.refId}`}
            >
              <CornerLeftUp />
            </Button>
          )}
          {/* The span carries the tooltip: a disabled Button drops pointer events. */}
          {isArchived ? (
            <>
              <span title={readOnlyReason ?? undefined}>
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-2"
                  onClick={onUnarchive}
                  disabled={readOnly}
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Unarchive
                </Button>
              </span>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onDelete}
                  aria-label="Delete task"
                >
                  <Trash2 />
                </Button>
              )}
            </>
          ) : (
            <span title={readOnlyReason ?? undefined}>
              <Button
                variant={isCompleted ? "default" : "outline"}
                size="xs"
                className="gap-2"
                onClick={onToggleComplete}
                disabled={readOnly}
              >
                <Check className="h-4 w-4" />
                {isCompleted ? "Completed" : "Mark complete"}
              </Button>
            </span>
          )}
          {threadPageHref && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" asChild>
                  <AppLink
                    href={threadPageHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open threads page"
                  >
                    <Bot />
                  </AppLink>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open threads page</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer"
                aria-label="Task actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn("min-w-52", ONE_LINE_MENU_CLASS)}>
              <TaskActionMenuItems
                task={task}
                callbacks={callbacks}
                Item={DropdownMenuItem}
                Separator={DropdownMenuSeparator}
                moveToListItem={moveToListItem}
                readOnlyReason={readOnlyReason}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCloseClick}
            aria-label="Close task details"
          >
            <X />
          </Button>
        </div>
      </div>

      {/* Archived indicator - full width warning banner */}
      {isArchived && (
        <div className="flex h-9 items-center gap-2 border-b border-warning/30 bg-warning-soft px-4 text-sm text-warning-foreground">
          <Archive className="h-4 w-4" />
          <span>This task is archived</span>
        </div>
      )}
    </>
  );
}
