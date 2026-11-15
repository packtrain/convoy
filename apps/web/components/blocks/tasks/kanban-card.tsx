"use client";

import { memo, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CircularProgress } from "@/components/ui/circular-progress";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import { PriorityCell } from "@/components/blocks/tasks/task-table/cells/priority-cell";
import { AssigneeSelector } from "@/components/blocks/tasks/task-table/cells/assignee-selector";
import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { AgentThreadWorkIndicator } from "@/components/blocks/tasks/agent-thread-work/agent-thread-work-indicator";
import { TaskLabelChip } from "@/components/blocks/tasks/task-label-picker";
import { BUILT_IN_TASK_TYPES } from "@/lib/tasks/task-types";
import { DATE_FORMAT } from "@/lib/tasks/constants";
import { Status } from "@/lib/tasks/status";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskTableColumnId } from "@/lib/tasks/task-table-columns";
import type { ProjectLabelSummary, Status as TaskStatus, Task, TaskUpdate } from "@/lib/tasks/types";

const STATUS_GLOW_BG: Partial<Record<TaskStatus, string>> = {
  [Status.TRIAGE]: "bg-orange-600 dark:bg-orange-400",
  [Status.PLANNING]: "bg-purple-600 dark:bg-purple-400",
  [Status.PLAN_REVIEW]: "bg-cyan-600 dark:bg-cyan-400",
  [Status.IN_PROGRESS]: "bg-warning",
  [Status.IN_REVIEW]: "bg-info",
  [Status.BLOCKED]: "bg-destructive",
  [Status.DONE]: "bg-success",
};

export interface KanbanCardPresentation {
  hideStatus?: boolean;
  emphasizeStatus?: boolean;
}

export interface SubtaskProgress {
  completed: number;
  total: number;
}

export interface KanbanCardItem {
  task: Task;
  subtaskProgress?: SubtaskProgress;
  presentation?: KanbanCardPresentation;
}

export interface KanbanCardProps {
  task: Task;
  subtaskProgress?: SubtaskProgress;
  presentation?: KanbanCardPresentation;
  projectId?: Id<"projects">;
  allowedStatuses?: TaskStatus[];
  hiddenTaskTableColumns?: readonly TaskTableColumnId[];
  /** The task's label, resolved by the host from the project labels. */
  label?: Pick<ProjectLabelSummary, "name"> & { color?: string } | null;
  /** Per-viewer "Show description" display setting (lib/tasks/card-view-prefs.ts). */
  showDescription?: boolean;
  onTaskUpdate?: (taskId: Task["_id"], updates: TaskUpdate) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  onClick?: (task: Task) => void;
  className?: string;
}

interface KanbanCardFooterControlProps {
  children: ReactNode;
  dataAttribute:
    | "data-kanban-card-status"
    | "data-kanban-card-due-date"
    | "data-kanban-card-priority"
    | "data-kanban-card-assignee";
}

function KanbanCardFooterControl({
  children,
  dataAttribute,
}: KanbanCardFooterControlProps) {
  return (
    <div
      {...{ [dataAttribute]: true }}
      className="flex items-center"
      // Control clicks, including portalled menus, must not open details.
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function collectTextFromProseMirrorNode(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const node = value as Record<string, unknown>;
  const text = typeof node.text === "string" ? [node.text] : [];
  const content = Array.isArray(node.content)
    ? node.content.flatMap(collectTextFromProseMirrorNode)
    : [];

  return [...text, ...content];
}

function getDescriptionPreview(description: string | null): string | null {
  const trimmed = description?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return trimmed;
    }

    const text = collectTextFromProseMirrorNode(parsed).join(" ").trim();
    return text || trimmed;
  } catch {
    return trimmed;
  }
}

// Memoized: a Board drag start re-renders the whole board, and card bodies are the
// bulk of it (docs/specs/task-kanban-status-columns.md, Board Ordering And Drag).
export const KanbanCard = memo(function KanbanCard({
  task,
  subtaskProgress,
  presentation,
  projectId,
  allowedStatuses,
  hiddenTaskTableColumns = [],
  label,
  showDescription = false,
  onTaskUpdate,
  onInviteClick,
  onAddAgentClick,
  onClick,
  className,
}: KanbanCardProps) {
  const descriptionPreview = showDescription ? getDescriptionPreview(task.description) : null;
  const shouldShowSubtaskProgress = subtaskProgress !== undefined && subtaskProgress.total > 0;
  const hideStatus = presentation?.hideStatus ?? false;
  const emphasizeStatus = presentation?.emphasizeStatus ?? false;
  // Closed tasks are muted + struck through in every view (docs/specs/task-status-selection.md)
  const strikethrough = isClosedStatus(task.status);
  const isEditable = Boolean(onTaskUpdate);
  const showDueDate = !hiddenTaskTableColumns.includes("dueDate");
  const showPriority = !hiddenTaskTableColumns.includes("priority");
  const showAssignee = !hiddenTaskTableColumns.includes("assignee");
  const visibleLabel = label && !hiddenTaskTableColumns.includes("label") ? label : null;

  const handleTaskUpdate = (updates: TaskUpdate) => {
    onTaskUpdate?.(task._id, updates);
  };
  // The title button is the one focusable trigger; clicks anywhere else on the
  // card bubble here too, while footer controls stop propagation.
  const handleCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onClick || event.defaultPrevented) {
      return;
    }
    onClick(task);
  };

  const handleDateChange = (
    nextDate: Date | undefined | ((previous: Date | undefined) => Date | undefined)
  ) => {
    const currentDate = task.dueDate ? new Date(task.dueDate) : undefined;
    const resolvedDate = typeof nextDate === "function" ? nextDate(currentDate) : nextDate;
    const nextTimestamp = resolvedDate ? resolvedDate.getTime() : null;

    if (nextTimestamp === task.dueDate) {
      return;
    }

    handleTaskUpdate({ dueDate: nextTimestamp });
  };

  return (
    // Not a button itself: the title button is the keyboard and screen reader
    // entry, and this only widens its click target to the whole card.
    <div
      data-kanban-card
      onClick={onClick ? handleCardClick : undefined}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border border-border bg-card text-left shadow-xs dark:border-transparent dark:shadow-none [&_svg]:saturate-70",
        onClick && "cursor-pointer transition-colors hover:border-muted-foreground/35",
        "has-[[data-task-card-body]:focus-visible]:ring-2 has-[[data-task-card-body]:focus-visible]:ring-ring",
        strikethrough && "opacity-75",
        className
      )}
    >
      {emphasizeStatus && STATUS_GLOW_BG[task.status] && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -bottom-10 -right-10 h-24 w-24 rounded-full blur-3xl opacity-30",
            STATUS_GLOW_BG[task.status]
          )}
        />
      )}
      {/* Card Body */}
      <div className="relative px-3 pt-2 pb-1">
        {/* Title */}
        <h4
          className={cn(
            "text-sm font-medium text-foreground leading-snug",
            strikethrough && "line-through text-muted-foreground"
          )}
        >
          {onClick ? (
            <button
              type="button"
              data-task-card-body
              aria-label={`Open task details for ${task.name}`}
              className="w-full cursor-pointer text-left focus-visible:outline-none"
            >
              {task.name}
            </button>
          ) : (
            task.name
          )}
        </h4>
        {descriptionPreview ? (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {descriptionPreview}
          </p>
        ) : null}
      </div>

      {/* Card Footer */}
      <div
        data-kanban-card-footer
        className="relative flex items-center justify-between gap-2 px-3 pb-2 pt-1"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex shrink-0 items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <TaskRefWithType
              refId={task.refId}
              taskType={task.taskType}
              editable={isEditable}
              taskTypes={BUILT_IN_TASK_TYPES}
              onTaskTypeChange={(taskType) =>
                handleTaskUpdate({ taskTypeKey: taskType.key, taskType })
              }
              typeVariant="icon"
              align="start"
              side="bottom"
              contentClassName="w-38"
              refClassName="text-xs text-muted-foreground font-medium"
              typeClassName="text-muted-foreground hover:text-foreground"
            />
          </div>
          {visibleLabel ? <TaskLabelChip label={visibleLabel} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AgentThreadWorkIndicator entries={task.agentThreadWork} />
          {/* Subtasks progress */}
          {shouldShowSubtaskProgress && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CircularProgress
                completed={subtaskProgress.completed}
                total={subtaskProgress.total}
              />
              {subtaskProgress.completed}/{subtaskProgress.total}
            </span>
          )}
          {!hideStatus ? (
            <KanbanCardFooterControl dataAttribute="data-kanban-card-status">
              <StatusDropdownMenu
                status={task.status}
                statuses={allowedStatuses}
                onStatusChange={(status) => handleTaskUpdate({ status })}
                variant="compact"
                isEditable={isEditable}
                align="start"
                side="bottom"
              />
            </KanbanCardFooterControl>
          ) : null}
          {showDueDate && task.dueDate ? (
            <KanbanCardFooterControl dataAttribute="data-kanban-card-due-date">
              <DateTimePicker
                dateTime={new Date(task.dueDate)}
                setDateTime={handleDateChange}
                variant="compact"
                isEditable={isEditable}
                mode="date"
                dateFormat={DATE_FORMAT}
                popoverSide="bottom"
                popoverAlign="start"
                placeholder="Set due date"
              />
            </KanbanCardFooterControl>
          ) : null}
          {showPriority ? (
            <KanbanCardFooterControl dataAttribute="data-kanban-card-priority">
              <PriorityCell
                priority={task.priority}
                onPriorityChange={(priority) => handleTaskUpdate({ priority })}
                variant="compact"
                isEditable={isEditable}
                align="start"
                side="bottom"
              />
            </KanbanCardFooterControl>
          ) : null}
          {showAssignee ? (
            <KanbanCardFooterControl dataAttribute="data-kanban-card-assignee">
              <AssigneeSelector
                assignee={task.assignee}
                delegatedToAgent={task.delegatedToAgent}
                projectId={projectId}
                onAssigneeChange={(change) =>
                  handleTaskUpdate(change)
                }
                onInviteClick={onInviteClick}
                onAddAgentClick={onAddAgentClick}
                variant="compact"
                isEditable={isEditable}
                align="start"
                side="bottom"
              />
            </KanbanCardFooterControl>
          ) : null}
        </div>
      </div>
    </div>
  );
});
