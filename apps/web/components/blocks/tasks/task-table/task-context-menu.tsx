"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { CircleDashed, ListTree, Signal, Tag, UserRound } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { cn } from "@/lib/utils";
import { Status as TaskStatus, type Priority, type Task, type Status, type TaskUpdate } from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { TASK_TABLE_HOTKEYS } from "@/lib/browser/hotkeys";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { StatusPickerContent } from "@/components/blocks/tasks/status-dropdown-menu";
import { PriorityPickerContent } from "@/components/blocks/tasks/priority-picker";
import { TaskLabelPickerContent } from "@/components/blocks/tasks/task-label-picker";
import { AssigneePickerContent } from "./cells/assignee-selector";
import { StatusIcon } from "./badges";
import {
  MenuShortcut,
  ONE_LINE_MENU_CLASS,
  TaskActionMenuItems,
  useTaskLinkActions,
  type TaskActionCallbacks,
} from "@/components/blocks/tasks/task-action-menu-items";
import { MoveToListMenuContent } from "@/components/blocks/project/task-lists/move-to-list-menu-content";
import {
  BACKLOG_SYSTEM_LIST,
  isBacklogListRef,
} from "@/lib/task-lists/system-lists";
import { useTaskListMove } from "./task-list-move-context";
import { VIEW_ONLY_REASON } from "@/lib/authz/use-project-permissions";

export interface TaskContextMenuSelectionActions {
  selectedCount: number;
  onDelete: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onUpdateStatus: (status: Status) => void;
  onUpdatePriority?: (priority: Priority) => void;
  onUpdateAssignee?: (change: TaskAssigneeChange) => void;
  onUpdateLabel?: (labelId: Id<"projectLabels"> | null) => void;
}

interface TaskContextMenuPropertyContext {
  projectId?: Id<"projects">;
  allowedStatuses?: Status[];
  updateTask: (id: string, updates: TaskUpdate) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
}

const PropertyContext = createContext<TaskContextMenuPropertyContext | null>(null);

/** Table-level data the row menus' property submenus need, so rows don't take extra props. */
export function TaskContextMenuProvider({
  children,
  projectId,
  allowedStatuses,
  updateTask,
  onInviteClick,
  onAddAgentClick,
}: TaskContextMenuPropertyContext & { children: ReactNode }) {
  const value = useMemo(
    () => ({ projectId, allowedStatuses, updateTask, onInviteClick, onAddAgentClick }),
    [projectId, allowedStatuses, updateTask, onInviteClick, onAddAgentClick]
  );
  return <PropertyContext.Provider value={value}>{children}</PropertyContext.Provider>;
}

function PropertySub({
  icon,
  label,
  hotkey,
  readOnlyReason,
  children,
}: {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  readOnlyReason: string | null;
  children: ReactNode;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        disabled={readOnlyReason !== null}
        title={readOnlyReason ?? undefined}
        className="data-[disabled]:pointer-events-auto data-[disabled]:cursor-default"
      >
        {icon}
        {label}
        {hotkey ? <MenuShortcut hotkey={hotkey} /> : null}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-56 p-0">{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** Mounted only while the Label submenu is open, so closed menus never subscribe. */
function LabelSubmenuContent({
  projectId,
  value,
  onSelect,
}: {
  projectId?: Id<"projects">;
  value: Id<"projectLabels"> | null;
  onSelect: (labelId: Id<"projectLabels"> | null) => void;
}) {
  const { labels } = useProjectLabels(projectId);
  return <TaskLabelPickerContent labels={labels} value={value} onSelect={onSelect} itemAs={ContextMenuItem} />;
}

interface TaskContextMenuProps {
  readOnly?: boolean;
  task: Task;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDuplicate: (task: Task) => void;
  onUpdateStatus: (id: string, status: Status) => void;
  onOpenDetails: (clientId: string) => void;
  selectionActions?: TaskContextMenuSelectionActions;
  /** Board cards handle only the property keys, so they hint only those. */
  shortcutHints?: "table" | "board";
  children: React.ReactNode;
}

export function TaskContextMenu({
  readOnly = false,
  task,
  onDelete,
  onArchive,
  onUnarchive,
  onDuplicate,
  onUpdateStatus,
  onOpenDetails,
  selectionActions,
  shortcutHints = "table",
  children,
}: TaskContextMenuProps) {
  const showTableHints = shortcutHints === "table";
  const isMobile = useIsMobile();
  const isCompleted = task.status === TaskStatus.DONE;
  const isSelectionScope =
    !!selectionActions && selectionActions.selectedCount > 1;
  const activeSelectionActions = isSelectionScope ? selectionActions : undefined;
  const taskListMove = useTaskListMove({
    selectedListRef: null,
    isEnabled: false,
  });
  const currentMoveListRef = isSelectionScope
    ? taskListMove.selectedListRef
    : task.list?.ref ?? taskListMove.selectedListRef;
  const { handleOpenInNewTab, handleCopyLink } = useTaskLinkActions(task.refId);

  const handleDuplicateTask = useCallback(() => {
    onDuplicate(task);
  }, [onDuplicate, task]);

  const handleMarkComplete = useCallback(() => {
    const nextStatus = isCompleted ? TaskStatus.TODO : TaskStatus.DONE;
    if (activeSelectionActions) {
      activeSelectionActions.onUpdateStatus(nextStatus);
      return;
    }

    onUpdateStatus(task._id, nextStatus);
  }, [
    isCompleted,
    activeSelectionActions,
    onUpdateStatus,
    task._id,
  ]);

  const handleOpenDetails = useCallback(() => {
    onOpenDetails(task.clientId);
  }, [onOpenDetails, task.clientId]);

  const handleDelete = useCallback(() => {
    if (activeSelectionActions) {
      activeSelectionActions.onDelete();
      return;
    }

    onDelete(task._id);
  }, [activeSelectionActions, onDelete, task._id]);

  const handleArchive = useCallback(() => {
    if (activeSelectionActions?.onArchive) {
      activeSelectionActions.onArchive();
      return;
    }

    onArchive(task._id);
  }, [activeSelectionActions, onArchive, task._id]);

  const handleUnarchive = useCallback(() => {
    if (activeSelectionActions?.onUnarchive) {
      activeSelectionActions.onUnarchive();
      return;
    }

    onUnarchive(task._id);
  }, [activeSelectionActions, onUnarchive, task._id]);

  const callbacks = useMemo<TaskActionCallbacks>(
    () => ({
      onDuplicate: handleDuplicateTask,
      onMarkComplete: handleMarkComplete,
      onOpenDetails: handleOpenDetails,
      onOpenInNewTab: handleOpenInNewTab,
      onCopyLink: handleCopyLink,
      onArchive:
        isSelectionScope && !activeSelectionActions?.onArchive
          ? undefined
          : handleArchive,
      onUnarchive:
        isSelectionScope && !activeSelectionActions?.onUnarchive
          ? undefined
          : handleUnarchive,
      onDelete: handleDelete,
    }),
    [
      activeSelectionActions?.onArchive,
      activeSelectionActions?.onUnarchive,
      handleDuplicateTask,
      handleMarkComplete,
      handleOpenDetails,
      handleOpenInNewTab,
      handleCopyLink,
      handleArchive,
      handleUnarchive,
      handleDelete,
      isSelectionScope,
    ]
  );

  const canMoveToList = isSelectionScope
    ? Boolean(taskListMove.moveSelectionToList)
    : Boolean(taskListMove.moveTaskToList);
  const handleMoveToBacklog = useCallback(() => {
    if (isSelectionScope) {
      taskListMove.moveSelectionToList?.(BACKLOG_SYSTEM_LIST.ref);
      return;
    }

    taskListMove.moveTaskToList?.(task._id, BACKLOG_SYSTEM_LIST.ref);
  }, [isSelectionScope, taskListMove, task._id]);

  const properties = useContext(PropertyContext);
  const readOnlyReason = readOnly ? VIEW_ONLY_REASON : null;
  const selectionPriority = activeSelectionActions?.onUpdatePriority;
  const selectionAssignee = activeSelectionActions?.onUpdateAssignee;
  const selectionLabel = activeSelectionActions?.onUpdateLabel;
  const updateTask = properties?.updateTask;
  const handlePropertyStatus = (status: Status) =>
    activeSelectionActions ? activeSelectionActions.onUpdateStatus(status) : onUpdateStatus(task._id, status);
  const handlePropertyPriority = (priority: Priority) =>
    activeSelectionActions ? selectionPriority?.(priority) : updateTask?.(task._id, { priority });
  const handlePropertyAssignee = (change: TaskAssigneeChange) =>
    activeSelectionActions ? selectionAssignee?.(change) : updateTask?.(task._id, change);
  const handlePropertyLabel = (labelId: Id<"projectLabels"> | null) =>
    activeSelectionActions ? selectionLabel?.(labelId) : updateTask?.(task._id, { labelId });
  const canEditProperty = (selectionHandler: unknown) =>
    activeSelectionActions ? Boolean(selectionHandler) : Boolean(updateTask);
  // Selection scope shows no current value; a single task shows its own.
  const currentTask = activeSelectionActions ? null : task;
  const propertyItems = properties ? (
    <>
      <PropertySub
        icon={<StatusIcon status={task.status} className="mr-2 size-4" />}
        label="Status"
        hotkey={showTableHints ? TASK_TABLE_HOTKEYS.setStatusPrefix : undefined}
        readOnlyReason={readOnlyReason}
      >
        <StatusPickerContent
          status={currentTask?.status}
          statuses={properties.allowedStatuses}
          onSelect={handlePropertyStatus}
          itemAs={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </PropertySub>
      {canEditProperty(selectionPriority) && (
        <PropertySub
          icon={<Signal className="mr-2 size-4" />}
          label="Priority"
          hotkey={TASK_TABLE_HOTKEYS.setPriority}
          readOnlyReason={readOnlyReason}
        >
          <PriorityPickerContent
            priority={currentTask?.priority}
            onSelect={handlePropertyPriority}
            itemAs={ContextMenuItem}
          />
        </PropertySub>
      )}
      {canEditProperty(selectionAssignee) && (
        <PropertySub
          icon={<UserRound className="mr-2 size-4" />}
          label="Assignee"
          hotkey={TASK_TABLE_HOTKEYS.setAssignee}
          readOnlyReason={readOnlyReason}
        >
          <AssigneePickerContent
            projectId={properties.projectId}
            assignee={currentTask?.assignee ?? null}
            delegatedToAgent={currentTask?.delegatedToAgent ?? null}
            onSelect={handlePropertyAssignee}
            onInviteClick={properties.onInviteClick}
            onAddAgentClick={properties.onAddAgentClick}
            itemAs={ContextMenuItem}
          />
        </PropertySub>
      )}
      {canEditProperty(selectionLabel) && (
        <PropertySub
          icon={<Tag className="mr-2 size-4" />}
          label="Label"
          hotkey={TASK_TABLE_HOTKEYS.setLabel}
          readOnlyReason={readOnlyReason}
        >
          <LabelSubmenuContent
            projectId={properties.projectId}
            value={currentTask?.labelId ?? null}
            onSelect={handlePropertyLabel}
          />
        </PropertySub>
      )}
    </>
  ) : null;

  const isInBacklog = isBacklogListRef(currentMoveListRef);
  const moveToListItem =
    taskListMove.projectId && taskListMove.isEnabled && canMoveToList ? (
      <>
        {!isInBacklog && (
          <ContextMenuItem onClick={handleMoveToBacklog}>
            <CircleDashed className="mr-2 h-4 w-4" />
            {isSelectionScope ? "Move selected to backlog" : "Move to backlog"}
          </ContextMenuItem>
        )}
        <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ListTree className="mr-2 h-4 w-4" />
          {isSelectionScope ? "Move selected to" : "Move to"}
          <MenuShortcut hotkey={TASK_TABLE_HOTKEYS.moveToList} />
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-auto p-0">
          <MoveToListMenuContent
            projectId={taskListMove.projectId}
            resultsController={taskListMove.resultsController}
            selectedListRef={currentMoveListRef}
            autoFocusSearch
            Item={ContextMenuItem}
            itemClassName="h-7"
            onMoveToList={(listRef, sectionId) => {
              if (isSelectionScope) {
                taskListMove.moveSelectionToList?.(listRef, sectionId);
                return;
              }

              taskListMove.moveTaskToList?.(task._id, listRef, sectionId);
            }}
          />
        </ContextMenuSubContent>
        </ContextMenuSub>
      </>
    ) : null;

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className={cn(isSelectionScope ? "min-w-60" : "min-w-52", ONE_LINE_MENU_CLASS)}
      >
        <TaskActionMenuItems
          task={task}
          callbacks={callbacks}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
          actionScope={isSelectionScope ? "selection" : "task"}
          moveToListItem={moveToListItem}
          propertyItems={propertyItems}
          showShortcuts={showTableHints}
          readOnlyReason={readOnlyReason}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
