"use client";

import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskListRowActions } from "./task-list-actions-menu";
import type { TaskListItem } from "./task-list-types";

export function getTaskListPinAction(
  list: TaskListItem,
  actions: TaskListRowActions
) {
  if (list.isArchived || !actions.onPin || !actions.onUnpin) {
    return null;
  }

  if (list.isPinned) {
    return {
      Icon: PinOff,
      menuLabel: "Unpin from sidebar",
      ariaLabel: `Unpin ${list.name} from sidebar`,
      run: () => actions.onUnpin?.(list),
    };
  }

  return {
    Icon: Pin,
    menuLabel: "Pin to sidebar",
    ariaLabel: `Pin ${list.name} to sidebar`,
    run: () => actions.onPin?.(list),
  };
}

interface TaskListPinButtonProps {
  list: TaskListItem;
  actions: TaskListRowActions;
  className?: string;
}

export function TaskListPinButton({
  list,
  actions,
  className,
}: TaskListPinButtonProps) {
  const pinAction = getTaskListPinAction(list, actions);

  if (!pinAction) {
    return null;
  }

  const Icon = pinAction.Icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={pinAction.ariaLabel}
      title={pinAction.menuLabel}
      className={cn("size-5 shrink-0 cursor-pointer", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void pinAction.run();
      }}
    >
      <Icon className="size-3" />
    </Button>
  );
}
