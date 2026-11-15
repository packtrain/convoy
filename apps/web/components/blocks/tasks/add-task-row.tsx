import { useState, useCallback, useRef } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createDefaultTaskFromInput,
  getFilterDefaultsFromFilters,
} from "@/lib/tasks/defaults";
import type { Task, StatusFilterKey, AssigneeFilter } from "@/lib/tasks/types";
import { ROW_HEIGHT, GROUP_INDENT_PX } from "@/lib/tasks/constants";

interface AddTaskRowProps {
  contentInset?: number;
  // Indentation depth (0 = root level)
  depth?: number;
  // Placeholder text
  placeholder?: string;
  // Parent ID for creating subtasks (null = root level)
  parentId?: string | null;
  // For creating tasks
  addTask?: (
    task: Omit<Task, "_id" | "clientId">,
    options?: { parentId?: string }
  ) => string | null;
  statusFilter?: StatusFilterKey;
  assigneeFilter?: AssigneeFilter;
  currentUserId?: string;
  // Controlled mode (for bottom add-task row with external state)
  value?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  onCommit?: (value: string, reason: "enter" | "blur") => void;
  onCancel?: (reason: "escape" | "backspace-empty") => void;
  // Drag and drop props
  isDropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  // Keyboard navigation
  clientId?: string;
  registerInput?: (id: string, el: HTMLInputElement | null) => void;
  // Backspace navigation (navigate to previous task when empty)
  onNavigatePrevious?: () => void;
}

export function AddTaskRow({
  contentInset,
  depth = 0,
  placeholder = "Add task...",
  parentId,
  addTask,
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
  value: controlledValue,
  onChange: controlledOnChange,
  onKeyDown: controlledOnKeyDown,
  onBlur: controlledOnBlur,
  onCommit,
  onCancel,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  clientId,
  registerInput,
  onNavigatePrevious,
}: AddTaskRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Internal state for uncontrolled mode
  const [internalValue, setInternalValue] = useState("");

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const handleChange = useCallback(
    (newValue: string) => {
      if (isControlled && controlledOnChange) {
        controlledOnChange(newValue);
      } else {
        setInternalValue(newValue);
      }
    },
    [isControlled, controlledOnChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // In controlled mode, delegate to parent
      if (isControlled && controlledOnKeyDown) {
        controlledOnKeyDown(e);
        return;
      }

      // Handle backspace on empty input - navigate to previous task
      if (e.key === "Backspace" && value === "") {
        if (onCancel) {
          e.preventDefault();
          onCancel("backspace-empty");
          return;
        }

        if (onNavigatePrevious) {
          e.preventDefault();
          onNavigatePrevious();
          return;
        }
      }

      if (onCancel && e.key === "Escape") {
        e.preventDefault();
        onCancel("escape");
        return;
      }

      if (onCommit && e.key === "Enter") {
        e.preventDefault();
        if (value.trim() !== "") {
          onCommit(value.trim(), "enter");
        }
        return;
      }

      // In uncontrolled mode, handle internally
      if (e.key === "Enter" && value.trim() !== "" && addTask) {
        e.preventDefault();
        const filterDefaults = getFilterDefaultsFromFilters(statusFilter, assigneeFilter, currentUserId);
        const newTask = createDefaultTaskFromInput(value, filterDefaults);
        if (!newTask) {
          return;
        }
        addTask(newTask, parentId ? { parentId } : undefined);
        setInternalValue("");
      }
    },
    [
      isControlled,
      controlledOnKeyDown,
      value,
      addTask,
      statusFilter,
      assigneeFilter,
      currentUserId,
      parentId,
      onCancel,
      onCommit,
      onNavigatePrevious,
    ]
  );

  const handleBlur = useCallback(() => {
    if (onCommit) {
      onCommit(value.trim(), "blur");
      return;
    }

    // In controlled mode, delegate to parent
    if (isControlled && controlledOnBlur) {
      controlledOnBlur();
      return;
    }

    // In uncontrolled mode, handle internally
    if (value.trim() !== "" && addTask) {
      const filterDefaults = getFilterDefaultsFromFilters(statusFilter, assigneeFilter, currentUserId);
      const newTask = createDefaultTaskFromInput(value, filterDefaults);
      if (!newTask) {
        return;
      }
      addTask(newTask, parentId ? { parentId } : undefined);
      setInternalValue("");
    }
  }, [
    isControlled,
    controlledOnBlur,
    onCommit,
    value,
    addTask,
    statusFilter,
    assigneeFilter,
    currentUserId,
    parentId,
  ]);

  const handleFocusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Match indentation: 24px per depth level
  const indentPx = depth * GROUP_INDENT_PX;

  return (
    <div
      data-task-add-row-id={clientId}
      className={cn(
        "flex items-center border-b border-border hover:bg-muted/50 relative",
        isDropTarget && "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-info before:z-20"
      )}
      style={{ height: ROW_HEIGHT }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="flex items-center gap-2 px-2 flex-1"
        style={{ paddingLeft: `${contentInset ?? indentPx + 52}px` }} // 52px = drag handle (24) + expand area (28)
      >
        <button
          type="button"
          aria-label="Focus add task title"
          className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
          onPointerDown={(e) => {
            e.preventDefault();
            handleFocusInput();
          }}
          onClick={handleFocusInput}
        >
          <Plus className="size-4" />
        </button>
        <input
          ref={(el) => {
            inputRef.current = el;
            if (clientId) registerInput?.(clientId, el);
          }}
          data-add-task-input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full bg-transparent px-2 py-2 text-foreground placeholder:text-muted-foreground outline-none"
        />
      </div>
    </div>
  );
}
