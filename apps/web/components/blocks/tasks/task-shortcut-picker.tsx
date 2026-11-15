"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Id } from "@/convex/_generated/dataModel";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoveToListMenuContent } from "@/components/blocks/project/task-lists/move-to-list-menu-content";
import { PriorityPickerContent } from "./priority-picker";
import { TaskLabelPickerContent } from "./task-label-picker";
import { AssigneePickerContent } from "./task-table/cells/assignee-selector";
import { useTaskListMove } from "./task-table/task-list-move-context";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import type { TaskPropertyShortcut } from "@/lib/tasks/metadata-shortcuts";
import type { Task, TaskUpdate } from "@/lib/tasks/types";

export type TaskShortcutPickerProperty = Exclude<TaskPropertyShortcut, "assignToMe">;

export interface TaskShortcutPickerRequest {
  property: TaskShortcutPickerProperty;
  tasks: readonly Task[];
  /** The row or card the picker opens under; focus returns to it on close. */
  anchor: HTMLElement;
}

interface TaskShortcutPickerProps {
  request: TaskShortcutPickerRequest | null;
  projectId?: Id<"projects">;
  onTaskUpdate: (taskId: Task["_id"], updates: TaskUpdate) => void;
  onInviteClick?: () => void;
  onAddAgentClick?: () => void;
  onClose: () => void;
}

/**
 * The property picker a single-key shortcut opens (P, A, L, D, M), anchored
 * to the target row or card. Spec: docs/specs/keyboard-navigation.md.
 */
export function TaskShortcutPicker({ request, ...props }: TaskShortcutPickerProps) {
  if (!request) return null;
  return <AnchoredPicker key={`${request.property}:${request.tasks.map((task) => task._id).join(",")}`} request={request} {...props} />;
}

function AnchoredPicker({
  request,
  projectId,
  onTaskUpdate,
  onInviteClick,
  onAddAgentClick,
  onClose,
}: Omit<TaskShortcutPickerProps, "request"> & { request: TaskShortcutPickerRequest }) {
  const { property, tasks, anchor } = request;
  const [rect] = useState(() => anchor.getBoundingClientRect());
  const { labels } = useProjectLabels(property === "label" ? projectId : undefined);
  const taskListMove = useTaskListMove({ selectedListRef: null, isEnabled: false });
  const single = tasks.length === 1 ? tasks[0] : null;
  const canMove = taskListMove.isEnabled && Boolean(taskListMove.moveTaskToList);
  const isUnavailable = property === "moveToList" && !canMove;

  useEffect(() => {
    // Move to List needs a list-move host; without one the key does nothing.
    if (isUnavailable) onClose();
  }, [isUnavailable, onClose]);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    }, 0);
  };
  // Close after the click leaves the portal subtree (same guard as PriorityPicker).
  const apply = (updates: TaskUpdate) => {
    for (const task of tasks) onTaskUpdate(task._id, updates);
    window.setTimeout(close, 0);
  };
  const handleOpenChange = (open: boolean) => {
    if (!open) close();
  };

  const trigger = (
    <span
      aria-hidden
      className="pointer-events-none fixed"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    />
  );
  const contentProps = {
    align: "start" as const,
    side: "bottom" as const,
    sideOffset: 4,
    onCloseAutoFocus: (event: Event) => event.preventDefault(),
  };

  if (property === "dueDate") {
    const dueDate = single?.dueDate ? new Date(single.dueDate) : undefined;
    return createPortal(
      <Popover open onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent {...contentProps} className="w-auto p-0">
          <Calendar
            mode="single"
            selected={dueDate}
            defaultMonth={dueDate}
            onSelect={(date) => apply({ dueDate: date ? date.getTime() : null })}
            autoFocus
          />
        </PopoverContent>
      </Popover>,
      document.body
    );
  }

  let content: React.ReactNode = null;
  let contentClassName = "w-52 p-0";
  if (property === "priority") {
    contentClassName = "w-48 p-0";
    content = <PriorityPickerContent priority={single?.priority} onSelect={(priority) => apply({ priority })} />;
  } else if (property === "assignee") {
    contentClassName = "w-64 p-0";
    content = (
      <AssigneePickerContent
        projectId={projectId}
        assignee={single?.assignee ?? null}
        delegatedToAgent={single?.delegatedToAgent ?? null}
        onSelect={(change) => apply(change)}
        onInviteClick={onInviteClick}
        onAddAgentClick={onAddAgentClick}
      />
    );
  } else if (property === "label") {
    content = (
      <TaskLabelPickerContent
        labels={labels}
        value={single?.labelId ?? null}
        onSelect={(labelId) => apply({ labelId })}
      />
    );
  } else if (taskListMove.isEnabled && taskListMove.moveTaskToList) {
    const moveTaskToList = taskListMove.moveTaskToList;
    contentClassName = "w-auto p-0";
    content = (
      <MoveToListMenuContent
        projectId={taskListMove.projectId}
        resultsController={taskListMove.resultsController}
        selectedListRef={taskListMove.selectedListRef}
        autoFocusSearch
        onMoveToList={(listRef, sectionId) => {
          if (tasks.length > 1 && taskListMove.moveSelectionToList) {
            taskListMove.moveSelectionToList(listRef, sectionId);
          } else {
            for (const task of tasks) moveTaskToList(String(task._id), listRef, sectionId);
          }
        }}
        onAfterSelect={close}
      />
    );
  }
  if (!content) return null;

  return createPortal(
    <DropdownMenu modal={false} open onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent {...contentProps} className={contentClassName}>
        {content}
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body
  );
}
