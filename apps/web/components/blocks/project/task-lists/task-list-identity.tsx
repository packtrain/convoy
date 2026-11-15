"use client";

import { Archive, Circle, CircleOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const ARCHIVED_TASK_LIST_ICON_CLASS = "text-amber-600 dark:text-amber-400";
export const ARCHIVED_TASK_LIST_TRIGGER_CLASS =
  "bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50";
export const ARCHIVED_TASK_LIST_HEADER_TRIGGER_CLASS = `${ARCHIVED_TASK_LIST_TRIGGER_CLASS} aria-expanded:bg-amber-100 dark:aria-expanded:bg-amber-900/50`;

// The minimal identity every list shape can satisfy. `TaskListSummary`, the public list Doc and
// sidebar entries are all structural supersets, so callers pass their existing object directly.
// Only `name` is required — system lists carry no color/isArchived, and "removed" marks tasks
// whose List row was deleted.
export type TaskListIdentityInput = {
  type: "list" | "system" | "removed";
  name: string;
  color?: string | null;
  isArchived?: boolean;
};

type TaskListIdentityProps = {
  list: TaskListIdentityInput;
  size?: "compact" | "default";
  // "plain" renders inline icon + name; "badge" wraps it in a secondary pill
  // with a smaller icon (used in dense lists such as search results).
  variant?: "plain" | "badge";
  className?: string;
  titleClassName?: string;
};

export function TaskListIdentity({ list, size = "default", variant = "plain", className, titleClassName }: TaskListIdentityProps) {
  const isPersisted = list.type === "list";
  const name = list.name;
  // System lists have no color; archived persisted lists swap to the archive
  // icon; removed (deleted-List) entries render a struck-through circle.
  const color = isPersisted ? list.color : undefined;
  const icon = list.type === "removed" ? "removed" : isPersisted && list.isArchived ? "archive" : "circle";

  const iconSize = variant === "badge" ? "size-3" : size === "compact" ? "size-3.5" : "size-4";
  const Icon = icon === "archive" ? Archive : icon === "removed" ? CircleOff : Circle;

  const content = (
    <span className={cn("flex min-w-0 items-center gap-2", variant === "plain" && className)}>
      <Icon
        className={cn(iconSize, "shrink-0", icon === "archive" ? ARCHIVED_TASK_LIST_ICON_CLASS : !color && "text-muted-foreground")}
        style={icon === "circle" && color ? { color } : undefined}
        aria-hidden="true"
      />
      <span className={cn("min-w-0 flex-1 truncate", icon === "removed" && "text-muted-foreground", titleClassName)}>{name}</span>
    </span>
  );

  if (variant === "badge") {
    return (
      <Badge variant="secondary" className={cn("max-w-35 pl-1 text-muted-foreground", className)}>
        {content}
      </Badge>
    );
  }

  return content;
}
