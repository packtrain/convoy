"use client";

import { useState } from "react";
import { Archive, CircleDashed } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  TaskRef,
  TaskRefWithType,
  TaskType,
  TaskTypeSelector,
} from "@/components/blocks/tasks/task-ref-with-type";
import { TaskTitleEditor } from "@/components/blocks/tasks/task-title-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import { StatusBadge, PriorityIcon } from "@/components/blocks/tasks/task-table/badges";
import { AssigneeSelector } from "@/components/blocks/tasks/task-table/cells/assignee-selector";
import { TaskListPicker } from "@/components/blocks/project/task-lists/task-list-management";
import {
  ARCHIVED_TASK_LIST_ICON_CLASS,
  ARCHIVED_TASK_LIST_TRIGGER_CLASS,
  TaskListIdentity,
} from "@/components/blocks/project/task-lists/task-list-identity";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";
import { TaskThreadsField } from "./task-threads-field";
import { TaskTagsEditor } from "./task-tags-editor";
import { TaskLabelChip, TaskLabelPicker } from "@/components/blocks/tasks/task-label-picker";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { TaskDetailLinks } from "./task-detail-links";
import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { DATE_FORMAT } from "@/lib/tasks/constants";
import { PriorityPicker } from "@/components/blocks/tasks/priority-picker";
import { cn } from "@/lib/utils";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import {
  BACKLOG_LIST_REF,
  BACKLOG_SYSTEM_LIST,
} from "@/lib/task-lists/system-lists";
import { format, formatDistanceToNow } from "date-fns";
import { Status, type Task, type Priority, type TaskUpdate } from "@/lib/tasks/types";

// Helper component for due date field with state management
function DueDateField({
  dueDate,
  onDueDateChange,
  readOnlyReason,
}: {
  dueDate: number | null;
  onDueDateChange: (dueDate: number | null) => void;
  readOnlyReason?: string;
}) {
  // Derive dateTime directly from prop - no internal state needed
  const dateTime = dueDate ? new Date(dueDate) : undefined;

  const handleSetDateTime = (newDate: Date | undefined | ((prev: Date | undefined) => Date | undefined)) => {
    // The picker's open suggestions and calendar ignore `disabled`, so guard the save itself.
    if (readOnlyReason !== undefined) return;
    const resolvedDate = typeof newDate === "function" ? newDate(dateTime) : newDate;
    onDueDateChange(resolvedDate ? resolvedDate.getTime() : null);
  };

  return (
    <div className="flex items-center gap-4" title={readOnlyReason}>
      <span className="w-24 text-sm text-muted-foreground -mr-[5px]">Due date</span>
      <DateTimePicker
        disabled={readOnlyReason !== undefined}
        dateTime={dateTime}
        setDateTime={handleSetDateTime}
        variant="ghost"
        iconPosition="left"
        popoverSide="bottom"
        popoverAlign="start"
        mode="date"
        dateFormat={DATE_FORMAT}
        // Read-only values stay legible rather than greyed out.
        className="h-8 text-sm disabled:cursor-default disabled:bg-transparent disabled:opacity-100 dark:disabled:bg-transparent"
      />
    </div>
  );
}

type PersistedTaskListPreview = Pick<
  TaskListItem,
  "type" | "name" | "ref" | "color" | "isArchived"
>;
type BacklogTaskListPreview = Extract<NonNullable<Task["list"]>, { type: "system" }>;
type TaskListPreview = PersistedTaskListPreview | BacklogTaskListPreview;
type OptimisticTaskList = {
  taskId: string;
  list: TaskListPreview;
};
type TaskListDisplay =
  | { kind: "backlog" }
  | { kind: "list"; list: PersistedTaskListPreview }
  | { kind: "removed"; name: string }
  | { kind: "loading" };

function backlogListPreview(): BacklogTaskListPreview {
  return {
    type: "system",
    key: BACKLOG_SYSTEM_LIST.key,
    ref: BACKLOG_SYSTEM_LIST.ref,
    name: BACKLOG_SYSTEM_LIST.name,
  };
}

function getTaskListDisplay(
  task: Task,
  optimisticList: OptimisticTaskList | null,
  defaultList: TaskListItem | null
): TaskListDisplay {
  const taskListRef = task.list?.ref ?? null;
  const activeOptimisticList =
    optimisticList?.taskId === task._id && optimisticList.list.ref !== taskListRef
      ? optimisticList.list
      : null;

  // An optimistic move always wins over the (stale) persisted list.
  if (activeOptimisticList) {
    return activeOptimisticList.type === "system"
      ? { kind: "backlog" }
      : { kind: "list", list: activeOptimisticList };
  }
  if (task.list?.type === "system") {
    return { kind: "backlog" };
  }
  if (task.list?.type === "list") {
    return { kind: "list", list: task.list };
  }
  if (task.list?.type === "removed") {
    return { kind: "removed", name: task.list.name };
  }
  if (defaultList) {
    return { kind: "list", list: defaultList };
  }
  return { kind: "loading" };
}

function renderTaskListDisplay(display: TaskListDisplay) {
  switch (display.kind) {
    case "backlog":
      return (
        <span className="flex min-w-0 items-center gap-2">
          <CircleDashed className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{BACKLOG_SYSTEM_LIST.name}</span>
        </span>
      );
    case "list":
      return (
        <TaskListIdentity
          list={display.list}
          size="compact"
          className="[&_svg]:size-3"
        />
      );
    case "removed":
      return (
        <TaskListIdentity
          list={{ type: "removed", name: display.name }}
          size="compact"
          className="[&_svg]:size-3"
        />
      );
    case "loading":
      return (
        <span className="flex min-w-0 items-center gap-2" aria-hidden="true">
          <Skeleton className="h-3.5 w-14" />
        </span>
      );
  }
}

function TaskListValue({
  task,
  projectId,
  taskListResultsController,
  onMoveToList,
}: {
  task: Task;
  projectId?: Id<"projects">;
  taskListResultsController?: TaskListResultsController;
  onMoveToList?: (taskId: string, listRef: string) => void;
}) {
  const [optimisticList, setOptimisticList] = useState<OptimisticTaskList | null>(null);
  const [open, setOpen] = useState(false);
  const defaultList =
    taskListResultsController?.results.find((list) => list.isDefault) ?? null;

  const display = getTaskListDisplay(
    task,
    optimisticList,
    defaultList
  );
  const triggerLabel = renderTaskListDisplay(display);

  if (task.isArchived) {
    const hasPersistedListMembership = Boolean(task.list);

    return (
      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        {hasPersistedListMembership &&
        (display.kind === "list" || display.kind === "removed") ? (
          triggerLabel
        ) : (
          <>
            <Archive
              className={cn(
                "size-3.5 shrink-0",
                ARCHIVED_TASK_LIST_ICON_CLASS
              )}
            />
            <span className="truncate">Archived</span>
          </>
        )}
      </span>
    );
  }

  const selectedListRef =
    display.kind === "list"
      ? display.list.ref
      : display.kind === "backlog"
        ? BACKLOG_LIST_REF
        : null;
  const canMove = Boolean(projectId && onMoveToList);
  const triggerClassName = cn(
    "-ml-1 inline-flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-sm text-foreground transition-opacity hover:opacity-80",
    display.kind === "list" &&
      display.list.isArchived &&
      cn("ml-0 px-2 text-xs font-medium", ARCHIVED_TASK_LIST_TRIGGER_CLASS)
  );

  if (!canMove) {
    return <span className="min-w-0 text-sm text-foreground">{triggerLabel}</span>;
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      taskListResultsController?.resetQuery();
    }
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClassName}>
          {triggerLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-2">
        <TaskListPicker
          projectId={projectId}
          resultsController={taskListResultsController}
          selectedListRef={selectedListRef}
          autoFocusSearch
          showRowActions={false}
          disabledRows={{
            system: (key) => key !== BACKLOG_SYSTEM_LIST.key,
            create: true,
            predicate: (list) => list.ref === selectedListRef,
          }}
          isInboxSelected={display.kind === "list" && display.list.ref === defaultList?.ref}
          isBacklogSelected={display.kind === "backlog"}
          isArchivedSelected={false}
          onSelectBacklog={() => {
            setOptimisticList({
              taskId: task._id,
              list: backlogListPreview(),
            });
            onMoveToList?.(task._id, BACKLOG_LIST_REF);
            handleOpenChange(false);
          }}
          onSelectList={(list) => {
            // The server subscription will provide the canonical List; this keeps
            // the row responsive when the task leaves the current table filter.
            setOptimisticList({
              taskId: task._id,
              list: { ...list, isArchived: false },
            });
            onMoveToList?.(task._id, list.ref);
            handleOpenChange(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TaskDetailMetadataProps {
  task: Task;
  parentTask?: Task;
  projectId?: Id<"projects">;
  organizationSlug?: string;
  projectAlias?: string;
  allowedStatuses?: Status[];
  onUpdate: (id: string, updates: TaskUpdate) => void;
  taskListResultsController?: TaskListResultsController;
  onMoveToList?: (taskId: string, listRef: string) => void;
  onOpenThreadsComposer?: () => void;
  onOpenSubtask?: (clientId: string) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  /** Set when the caller cannot edit: fields render as values with this tooltip. */
  readOnlyReason?: string | null;
  canUseThreads?: boolean;
}

export function TaskDetailMetadata({
  task,
  parentTask,
  projectId,
  organizationSlug,
  projectAlias,
  allowedStatuses,
  onUpdate,
  taskListResultsController,
  onMoveToList,
  onOpenThreadsComposer,
  onOpenSubtask,
  onInviteClick,
  onAddAgentClick,
  readOnlyReason = null,
  canUseThreads = true,
}: TaskDetailMetadataProps) {
  const { labels, labelsById } = useProjectLabels(projectId);
  // docs/specs/read-only-viewer-ux.md: editors become plain values, each row explains why.
  const readOnly = readOnlyReason !== null;
  const rowTitle = readOnlyReason ?? undefined;
  const taskLabel = task.labelId ? (labelsById.get(String(task.labelId)) ?? null) : null;
  const creatorName = task.createdByName ?? "Unknown";
  const createdAtDate = new Date(task.createdAt);
  const createdRelativeTime = formatDistanceToNow(createdAtDate, {
    addSuffix: true,
  });
  const createdFullDateTime = format(createdAtDate, "PPpp");

  const handleStatusChange = (status: Status) => {
    onUpdate(task._id, { status });
  };

  const handlePriorityChange = (priority: Priority) => {
    onUpdate(task._id, { priority });
  };

  const priorityValue = (
    <>
      <PriorityIcon priority={task.priority} />
      <span>{task.priority}</span>
    </>
  );

  return (
    <>
      {/* Ref ID */}
      <TaskRef
        refId={task.refId}
        className="text-xs text-muted-foreground mb-2 block"
      />

      {/* Title */}
      <TaskTitleEditor
        value={task.name}
        onCommit={(name) => onUpdate(task._id, { name })}
        readOnly={readOnly}
        title={rowTitle}
        className="text-xl font-semibold"
        isClosed={isClosedStatus(task.status)}
      />

      {/* Fields */}
      <div className="space-y-4 pt-2 pb-0.5">
        {/* Parent Task */}
        {parentTask && onOpenSubtask && (
          <div className="flex items-center gap-4">
            <span className="w-24 text-sm text-muted-foreground">Parent</span>
            <button
              type="button"
              onClick={() => onOpenSubtask(parentTask.clientId)}
              className="cursor-pointer flex min-w-0 items-center gap-1.5 text-sm text-foreground transition-opacity hover:opacity-80"
            >
              <TaskRefWithType
                refId={parentTask.refId}
                taskType={parentTask.taskType}
                refInteractive={false}
                className="shrink-0 gap-1.5"
                refClassName="text-muted-foreground"
                typeClassName="shrink-0"
              />
              <span className="truncate max-w-[200px]">{parentTask.name}</span>
            </button>
          </div>
        )}

        {/* List */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">List</span>
          <TaskListValue
            task={task}
            projectId={projectId}
            taskListResultsController={taskListResultsController}
            onMoveToList={readOnly ? undefined : onMoveToList}
          />
        </div>

        {/* Type */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">Type</span>
          {readOnly ? (
            <span className="flex items-center text-sm">
              <TaskType taskType={task.taskType} variant="badge" />
            </span>
          ) : (
            <TaskTypeSelector
              taskType={task.taskType}
              taskTypes={BUILT_IN_TASK_TYPES}
              onTaskTypeChange={(taskType) => onUpdate(task._id, { taskTypeKey: taskType.key })}
              variant="badge"
              className="text-sm"
              align="start"
            />
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">Status</span>
          {readOnly ? (
            <span className="flex items-center gap-2 text-sm">
              <StatusBadge status={task.status} />
            </span>
          ) : (
            <StatusDropdownMenu
              status={task.status}
              statuses={allowedStatuses}
              onStatusChange={handleStatusChange}
              trigger={
                <button className="cursor-pointer flex items-center gap-2 text-sm hover:opacity-80">
                  <StatusBadge status={task.status} />
                </button>
              }
              align="start"
            />
          )}
        </div>

        {/* Priority */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">Priority</span>
          {readOnly ? (
            <span className="flex items-center gap-2 text-sm">{priorityValue}</span>
          ) : (
            <PriorityPicker
              priority={task.priority}
              onPriorityChange={handlePriorityChange}
              trigger={
                <button type="button" className="cursor-pointer flex items-center gap-2 text-sm hover:opacity-80">
                  {priorityValue}
                </button>
              }
              align="start"
            />
          )}
        </div>

        {/* Label */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">Label</span>
          {readOnly ? (
            <span className="flex items-center gap-2 text-sm">
              {taskLabel ? (
                <TaskLabelChip label={taskLabel} />
              ) : (
                <span className="text-muted-foreground">No label</span>
              )}
            </span>
          ) : (
            <TaskLabelPicker
              projectId={projectId}
              labels={labels}
              value={task.labelId ?? null}
              onChange={(labelId) => onUpdate(task._id, { labelId })}
              trigger={
                <button className="cursor-pointer flex items-center gap-2 text-sm hover:opacity-80">
                  {taskLabel ? (
                    <TaskLabelChip label={taskLabel} />
                  ) : (
                    <span className="text-muted-foreground">Add label</span>
                  )}
                </button>
              }
              align="start"
            />
          )}
        </div>

        {/* Assignee */}
        <div className="flex items-center gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground -mr-[4px]">Assignee</span>
          <AssigneeSelector
            assignee={task.assignee}
            delegatedToAgent={task.delegatedToAgent}
            projectId={projectId}
            onAssigneeChange={(change) =>
              onUpdate(task._id, change)
            }
            onInviteClick={onInviteClick}
            onAddAgentClick={onAddAgentClick}
            variant="default"
            disabled={readOnly}
          />
        </div>

        {canUseThreads && projectId && organizationSlug && projectAlias ? (
          <TaskThreadsField
            projectId={projectId}
            organizationSlug={organizationSlug}
            projectAlias={projectAlias}
            taskId={task._id}
            onOpenThreadsComposer={onOpenThreadsComposer}
          />
        ) : null}

        {/* Due Date */}
        <DueDateField
          dueDate={task.dueDate}
          onDueDateChange={(dueDate) => onUpdate(task._id, { dueDate })}
          readOnlyReason={rowTitle}
        />

        <div className="flex items-start gap-4" title={rowTitle}>
          <span className="w-24 text-sm text-muted-foreground">Tags</span>
          <TaskTagsEditor
            tags={task.tags}
            onTagsChange={(tags) => onUpdate(task._id, { tags })}
            readOnly={readOnly}
            className="flex-1"
          />
        </div>

        {/* External links (read-only; created via MCP/CLI) */}
        {task.externalLinks && task.externalLinks.length > 0 && (
          <div className="flex items-start gap-4">
            <span className="w-24 text-sm text-muted-foreground">Links</span>
            <TaskDetailLinks links={task.externalLinks} />
          </div>
        )}

        {/* Created */}
        <div className="flex items-center gap-4">
          <span className="w-24 text-sm text-muted-foreground">Created</span>
          <span className="text-sm text-muted-foreground" title={createdFullDateTime}>
            {`by ${creatorName} ${createdRelativeTime}`}
          </span>
        </div>
      </div>
    </>
  );
}
