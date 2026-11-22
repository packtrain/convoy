"use client";

import type { ComponentProps, ReactNode } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bug,
  CircleSmall,
  Layers3,
  Lightbulb,
  Search,
  Sparkles,
  SquareCheckBig,
  Wrench,
} from "lucide-react";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatHotkeyForCrossPlatformLabel } from "@/lib/browser/hotkeys";
import { useTaskLinkActions } from "@/components/blocks/tasks/task-action-menu-items";
import { useTaskFieldMenuTrigger } from "@/lib/tasks/hooks/use-task-field-menu";
import {
  normalizeTaskTypeIcon,
  type TaskTypeDefinition,
  type TaskTypeSummary,
} from "@/lib/tasks/task-types";
import { cn } from "@/lib/utils";

type TaskTypeRenderable = Pick<TaskTypeSummary, "icon" | "color" | "name">;

const ICON_BY_KEY = {
  SquareCheckBig,
  Bug,
  Sparkles,
  Layers3,
  Search,
  Wrench,
  Lightbulb,
} as const;

interface TaskRefProps {
  refId: string;
  onClick?: (e: React.MouseEvent) => void;
  interactive?: boolean;
  className?: string;
}

interface TaskTypeProps {
  taskType: TaskTypeRenderable;
  variant?: "icon" | "badge";
  className?: string;
  /** Badge only: trailing content inside the pill, e.g. a remove button. */
  children?: ReactNode;
}

interface TaskTypeSelectorProps {
  taskType: TaskTypeSummary;
  taskTypes?: readonly TaskTypeDefinition[];
  onTaskTypeChange: (taskType: TaskTypeDefinition) => void;
  variant?: "icon" | "badge";
  trigger?: ReactNode;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: number;
  className?: string;
  contentClassName?: string;
}

interface TaskRefWithTypeProps {
  refId: string;
  taskType: TaskTypeSummary;
  editable?: boolean;
  taskTypes?: readonly TaskTypeDefinition[];
  onTaskTypeChange?: (taskType: TaskTypeDefinition) => void;
  typeVariant?: "icon" | "badge";
  className?: string;
  refClassName?: string;
  typeClassName?: string;
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: number;
  contentClassName?: string;
  onRefClick?: (e: React.MouseEvent) => void;
  refInteractive?: boolean;
}

export function TaskTypeGlyph({
  taskType,
  className,
  sizeClassName,
}: {
  taskType: TaskTypeRenderable;
  className?: string;
  sizeClassName?: string;
}) {
  const normalizedIcon = normalizeTaskTypeIcon(taskType.icon);

  if (normalizedIcon === "Dot") {
    return (
      <CircleSmall
        className={cn("inline-block shrink-0", className, sizeClassName)}
        strokeWidth={2.5}
        style={{ color: taskType.color }}
      />
    );
  }

  const Icon = ICON_BY_KEY[normalizedIcon];
  return (
    <Icon
      className={cn("size-4", className, sizeClassName)}
      style={{ color: taskType.color }}
    />
  );
}

export function TaskRef({
  refId,
  onClick,
  interactive = true,
  className,
}: TaskRefProps) {
  const { handleCopyLink } = useTaskLinkActions(refId);
  const isPendingRef = refId.trim() === "...";

  if (!interactive || isPendingRef) {
    return (
      <span
        aria-label={isPendingRef ? "Task reference pending" : undefined}
        className={cn(
          "inline-flex shrink-0 justify-end font-mono",
          isPendingRef && "min-w-[3ch]",
          className
        )}
      >
        {isPendingRef ? "..." : refId}
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
      return;
    }

    e.stopPropagation();

    if (e.metaKey || e.ctrlKey) {
      handleCopyLink();
      toast.success("Task link copied to clipboard");
    } else {
      navigator.clipboard.writeText(refId);
      toast.success(`${refId} copied to clipboard`);
    }
  };

  const tooltipLabel = `Click to copy ID · ${formatHotkeyForCrossPlatformLabel("Mod+Click")} to copy link`;

  const content = (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 justify-end font-mono cursor-pointer hover:text-foreground transition-colors",
        className
      )}
      onClick={handleClick}
    >
      {refId}
    </button>
  );

  if (onClick) {
    return content;
  }

  return (
    <TooltipExt content={tooltipLabel} delayDuration={500}>
      {content}
    </TooltipExt>
  );
}

export function TaskType({
  taskType,
  variant = "badge",
  className,
  children,
}: TaskTypeProps) {
  if (variant === "icon") {
    return (
      <TaskTypeGlyph
        taskType={taskType}
        className={className}
        sizeClassName="size-3.5"
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium text-foreground",
        className
      )}
    >
      <TaskTypeGlyph
        taskType={taskType}
        sizeClassName="size-3"
      />
      {taskType.name}
      {children}
    </span>
  );
}

export function TaskTypeSelector({
  taskType,
  taskTypes = [],
  onTaskTypeChange,
  variant = "badge",
  trigger,
  align = "start",
  side,
  sideOffset,
  className,
  contentClassName,
}: TaskTypeSelectorProps) {
  const [open, setOpen] = useState(false);
  const fieldTriggerProps = useTaskFieldMenuTrigger({
    open,
    onOpenChange: setOpen,
  });

  const availableTaskTypes = useMemo(() => {
    if (taskTypes.some((candidate) => candidate.key === taskType.key)) {
      return taskTypes;
    }

    return [
      ...taskTypes,
      {
        key: taskType.key,
        name: taskType.name,
        icon: taskType.icon,
        color: taskType.color,
        order: Number.MAX_SAFE_INTEGER,
        isSystem: taskType.isSystem,
      },
    ];
  }, [taskType, taskTypes]);

  const defaultTrigger =
    trigger ??
    (variant === "icon" ? (
      <button
        type="button"
        aria-label={`Change task type: ${taskType.name}`}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground",
          className
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <TaskType taskType={taskType} variant="icon" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`Change task type: ${taskType.name}`}
        className={cn("cursor-pointer flex items-center gap-2 text-sm hover:opacity-80", className)}
        onClick={(event) => event.stopPropagation()}
      >
        <TaskType taskType={taskType} variant="badge" />
      </button>
    ));

  return (
    <DropdownMenu deferMount modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild {...fieldTriggerProps}>
        {defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn("w-38 p-0", contentClassName)}
      >
        {availableTaskTypes.length === 0 ? (
          <div className="px-3 py-2.5 text-sm text-muted-foreground">No task types found.</div>
        ) : (
          <div className="py-1">
            {availableTaskTypes.map((candidate) => (
              <DropdownMenuItem
                key={candidate.key}
                data-interactive
                data-checked={candidate.key === taskType.key}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onTaskTypeChange(candidate);
                  // Defer close so Radix doesn't swallow the click with modal={false}
                  window.setTimeout(() => setOpen(false), 0);
                }}
              >
                <TaskType taskType={candidate} variant="badge" />
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskRefWithType({
  refId,
  taskType,
  editable = false,
  taskTypes,
  onTaskTypeChange,
  typeVariant = "icon",
  className,
  refClassName,
  typeClassName,
  align = "start",
  side,
  sideOffset,
  contentClassName,
  onRefClick,
  refInteractive = true,
}: TaskRefWithTypeProps) {
  const typeNode =
    editable && onTaskTypeChange ? (
      <TaskTypeSelector
        taskType={taskType}
        taskTypes={taskTypes}
        onTaskTypeChange={onTaskTypeChange}
        variant={typeVariant}
        className={typeClassName}
        align={align}
        side={side}
        sideOffset={sideOffset}
        contentClassName={contentClassName}
      />
    ) : (
      <TaskType taskType={taskType} variant={typeVariant} className={typeClassName} />
    );

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 whitespace-nowrap", className)}>
      {typeNode}
      {typeVariant === "icon" ? (
        <span className="sr-only">Type: {taskType.name}</span>
      ) : null}
      <TaskRef
        refId={refId}
        onClick={onRefClick}
        interactive={refInteractive}
        className={refClassName}
      />
    </span>
  );
}
