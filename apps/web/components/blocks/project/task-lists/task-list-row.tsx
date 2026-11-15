"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TaskListActionsMenu,
  type TaskListRowActions,
} from "./task-list-actions-menu";
import { TaskListIdentity } from "./task-list-identity";
import type { TaskListItem } from "./task-list-types";
import { getTaskListPickerItemProps } from "./task-list-picker-keyboard";
import { AppLink } from "@/lib/navigation";
import { TaskListPinButton } from "./task-list-pin-button";

interface TaskListRowProps {
  list: TaskListItem;
  compact?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: (list: TaskListItem) => void;
  openTasksHref?: string;
  actions?: TaskListRowActions;
  actionsMenuSide?: "top" | "right" | "bottom" | "left";
  actionsMenuAlign?: "start" | "center" | "end";
}

function isPlainPrimaryClick(event: {
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

export function TaskListRow({
  list,
  compact = false,
  selected = false,
  disabled = false,
  onSelect,
  openTasksHref,
  actions,
  actionsMenuSide,
  actionsMenuAlign,
}: TaskListRowProps) {
  const isLinked = Boolean(openTasksHref && !disabled);
  const contentPaddingClass = compact ? "px-1.5 py-1" : "px-2 py-1.5";
  // ponytail: hide via display (not opacity) so invisible actions don't reserve
  // width and prematurely truncate the name; they reflow in on hover/focus/open.
  const actionsVisibilityClass =
    "md:hidden md:group-hover:flex md:group-focus-within:flex md:has-[[data-state=open]]:flex";
  const rowContent = (
    <>
      <TaskListIdentity
        list={list}
        size={compact ? "compact" : "default"}
        titleClassName="text-sm text-foreground"
      />
      {list.isArchived ? (
        <span
          aria-hidden="true"
          className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          Archived
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md",
        !isLinked && contentPaddingClass,
        onSelect && !disabled && !isLinked && "cursor-pointer focus-visible:outline-none",
        onSelect &&
          !disabled &&
          compact &&
          "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground",
        onSelect &&
          !disabled &&
          !compact &&
          "hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:ring-1 focus-visible:ring-border/80 dark:focus-visible:ring-border/60",
        disabled && "cursor-not-allowed opacity-60",
        !compact && "hover:bg-muted/50",
        selected && "bg-muted text-foreground"
      )}
      role={onSelect && !isLinked ? "option" : undefined}
      aria-selected={onSelect && !isLinked ? selected : undefined}
      aria-disabled={onSelect && !isLinked ? disabled : undefined}
      {...getTaskListPickerItemProps(Boolean(onSelect && !disabled && !isLinked))}
      tabIndex={onSelect && !disabled && !isLinked ? 0 : undefined}
      onClick={() => {
        if (!disabled && !isLinked) {
          onSelect?.(list);
        }
      }}
      onKeyDown={(event) => {
        if (!onSelect || disabled || isLinked) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(list);
        }
      }}
    >
      {openTasksHref && !disabled ? (
        <AppLink
          href={openTasksHref}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            contentPaddingClass
          )}
          {...getTaskListPickerItemProps(Boolean(onSelect && !disabled))}
          onClick={(event) => {
            event.stopPropagation();

            if (!onSelect || !isPlainPrimaryClick(event)) {
              return;
            }

            event.preventDefault();
            onSelect(list);
          }}
          onKeyDown={(event) => {
            if (!onSelect) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(list);
            }
          }}
        >
          {rowContent}
        </AppLink>
      ) : (
        rowContent
      )}
      {actions ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5",
            actionsVisibilityClass,
            compact ? "mr-1" : "mr-2"
          )}
        >
          <TaskListPinButton list={list} actions={actions} />
          <TaskListActionsMenu
            list={list}
            actions={actions}
            side={actionsMenuSide}
            align={actionsMenuAlign}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${list.name}`}
                className="size-5 shrink-0 cursor-pointer"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}
