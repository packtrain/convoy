"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Flag,
  ListTree,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  Priority,
  Status,
} from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TooltipExt } from "../../custom/tooltip-ext";
import { AssigneeSelector } from "./task-table/cells/assignee-selector";
import { PriorityCell } from "./task-table/cells/priority-cell";
import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { StatusDropdownMenu } from "./status-dropdown-menu";
import { MoveToListDropdown } from "@/components/blocks/project/task-lists/move-to-list-dropdown";
import { useTaskListMove } from "./task-table/task-list-move-context";
import { TaskLabelPicker } from "./task-label-picker";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { DATE_FORMAT } from "@/lib/tasks/constants";

interface MultiSelectToolbarProps {
  /** Shows only the count and clear selection (read-only-viewer-ux.md). */
  readOnly?: boolean;
  selectedCount: number;
  projectId?: Id<"projects">;
  allowedStatuses?: Status[];
  onMarkComplete: () => void;
  onStatusChange: (status: Status) => void;
  onPriorityChange: (priority: Priority) => void;
  onAssigneeChange: (change: TaskAssigneeChange) => void;
  onDueDateChange: (dueDate: number | null) => void;
  /** Omitted by callers that cannot set labels; hides the label control. */
  onLabelChange?: (labelId: Id<"projectLabels"> | null) => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  /** Opens project settings to invite members (used by assignee dropdown footer) */
  onInviteClick?: () => void;
  /** Opens project settings to manage AI agents (used by assignee dropdown footer) */
  onAddAgentClick?: () => void;
}

export function MultiSelectToolbar({
  readOnly = false,
  selectedCount,
  projectId,
  allowedStatuses,
  onMarkComplete,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueDateChange,
  onLabelChange,
  onArchive,
  onUnarchive,
  onDelete,
  onClearSelection,
  onInviteClick,
  onAddAgentClick,
}: MultiSelectToolbarProps) {
  const { labels } = useProjectLabels(onLabelChange && !readOnly ? projectId : undefined);
  const [dueDateTime, setDueDateTime] = useState<Date | undefined>(undefined);
  const taskListMove = useTaskListMove({
    selectedListRef: null,
    isEnabled: false,
  });

  const handleSetDueDateTime = (newDate: Date | undefined | ((prev: Date | undefined) => Date | undefined)) => {
    const resolvedDate = typeof newDate === "function" ? newDate(dueDateTime) : newDate;
    setDueDateTime(resolvedDate);
    onDueDateChange(resolvedDate ? resolvedDate.getTime() : null);
  };
  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-background border border-border rounded-full px-4 py-2 shadow-lg">
        {/* Task count */}
        <span className="text-sm font-medium text-foreground pr-2 whitespace-nowrap">
          {selectedCount} {selectedCount === 1 ? "task" : "tasks"} selected
        </span>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {!readOnly && (
          <>
            {/* Mark complete */}
            <TooltipExt content="Mark as complete">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-muted rounded-full"
                onClick={onMarkComplete}
                aria-label="Mark as complete"
              >
                <Check className="h-4 w-4 text-muted-foreground" />
              </Button>
            </TooltipExt>

            {/* Status dropdown */}
            <TooltipExt content="Change status">
              <StatusDropdownMenu
                statuses={allowedStatuses}
                onStatusChange={onStatusChange}
                align="center"
                side="top"
                sideOffset={8}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 hover:bg-muted rounded-full gap-1"
                  >
                    <span className="text-sm text-muted-foreground">Status</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                }
              />
            </TooltipExt>

            {taskListMove.projectId &&
            taskListMove.isEnabled &&
            taskListMove.moveSelectionToList ? (
              <MoveToListDropdown
                projectId={taskListMove.projectId}
                resultsController={taskListMove.resultsController}
                selectedListRef={taskListMove.selectedListRef}
                onMoveToList={taskListMove.moveSelectionToList}
                trigger={
                  <span>
                    <TooltipExt content="Move selected to">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 hover:bg-muted rounded-full cursor-pointer gap-1"
                        aria-label="Move selected to"
                      >
                        <ListTree className="size-4 text-muted-foreground" />
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </TooltipExt>
                  </span>
                }
              />
            ) : null}

            {/* Priority dropdown - reuses PriorityCell component */}
            <TooltipExt content="Set priority">
              <PriorityCell
                onPriorityChange={onPriorityChange}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 hover:bg-muted rounded-full gap-1"
                    aria-label="Set priority"
                  >
                    <Flag className="h-4 w-4 text-muted-foreground" />
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                }
                align="center"
                side="top"
                sideOffset={8}
              />
            </TooltipExt>

            {/* Assignee dropdown - reuses AssigneeSelector component */}
            <TooltipExt content="Assign to">
              <AssigneeSelector
                projectId={projectId}
                onAssigneeChange={onAssigneeChange}
                onInviteClick={onInviteClick}
                onAddAgentClick={onAddAgentClick}
                variant="icon"
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 hover:bg-muted rounded-full gap-1"
                    aria-label="Assign to"
                  >
                    <User className="h-4 w-4 text-muted-foreground" />
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                }
                align="center"
                side="top"
                sideOffset={8}
              />
            </TooltipExt>

            {onLabelChange ? (
              <TooltipExt content="Set label">
                <TaskLabelPicker
                  projectId={projectId}
                  labels={labels}
                  value={null}
                  onChange={onLabelChange}
                  align="center"
                  side="top"
                  sideOffset={8}
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Set label"
                      className="h-8 px-2 hover:bg-muted rounded-full gap-1"
                    >
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  }
                />
              </TooltipExt>
            ) : null}

            {/* Due date picker */}
            <TooltipExt content={dueDateTime ? "Change due date" : "Set due date"}>
              <DateTimePicker
                dateTime={dueDateTime}
                setDateTime={handleSetDueDateTime}
                variant="icon-or-date"
                popoverSide="top"
                popoverAlign="center"
                mode="date"
                dateFormat={DATE_FORMAT}
                className="h-8 rounded-full hover:bg-muted"
              />
            </TooltipExt>

            {/* Divider */}
            <div className="w-px h-5 bg-border mx-1" />

            {onUnarchive ? (
              <TooltipExt content="Unarchive selected">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 hover:bg-muted rounded-full"
                  onClick={onUnarchive}
                  aria-label="Unarchive selected tasks"
                >
                  <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipExt>
            ) : onArchive ? (
              <TooltipExt content="Archive selected">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 hover:bg-muted rounded-full"
                  onClick={onArchive}
                  aria-label="Archive selected tasks"
                >
                  <Archive className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipExt>
            ) : null}

            {/* Delete button */}
            <TooltipExt content="Delete selected">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-destructive/10 rounded-full"
                onClick={onDelete}
                aria-label="Delete selected tasks"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </TooltipExt>
          </>
        )}

        {/* Close button */}
        <TooltipExt content="Clear selection">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:bg-muted rounded-full"
            onClick={onClearSelection}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </TooltipExt>
      </div>
    </TooltipProvider>
  );
}
