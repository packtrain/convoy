"use client";

import type { ReactNode } from "react";
import {
  Archive,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskListItem } from "./task-list-types";
import { getTaskListPinAction } from "./task-list-pin-button";

export interface TaskListRowActions {
  onEdit: (list: TaskListItem) => void;
  onSetDefault: (list: TaskListItem) => void;
  // Pin actions are present only for users with the list:pin permission.
  onPin?: (list: TaskListItem) => void;
  onUnpin?: (list: TaskListItem) => void;
  onArchive: (list: TaskListItem) => void;
  onUnarchive: (list: TaskListItem) => void;
  onDelete: (list: TaskListItem) => void;
}

function stopAndRun(event: { stopPropagation: () => void }, handler: () => void) {
  event.stopPropagation();
  handler();
}

function stopDisabledAction(event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}) {
  event.preventDefault();
  event.stopPropagation();
}

const DEFAULT_LIST_ARCHIVE_TITLE = "The default list can't be archived.";
const DEFAULT_LIST_DELETE_TITLE = "The default list can't be deleted.";

interface TaskListActionsMenuProps {
  list: TaskListItem;
  actions: TaskListRowActions;
  trigger: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

// Canonical `...` actions menu for a task List row. Reused by List management
// rows (settings dialog, header picker) and sidebar pinned List items.
export function TaskListActionsMenu({
  list,
  actions,
  trigger,
  side,
  align = "end",
}: TaskListActionsMenuProps) {
  const isArchiveDisabled = list.isDefault && !list.isArchived;
  const isDeleteDisabled = list.isDefault;
  const pinAction = getTaskListPinAction(list, actions);
  const PinIcon = pinAction?.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="min-w-46">
        <DropdownMenuItem
          onClick={(event) => stopAndRun(event, () => actions.onEdit(list))}
        >
          <Pencil className="size-4" />
          Edit
        </DropdownMenuItem>
        {!list.isArchived && !list.isDefault ? (
          <DropdownMenuItem
            onClick={(event) =>
              stopAndRun(event, () => actions.onSetDefault(list))
            }
          >
            <Star className="size-4" />
            Set as default
          </DropdownMenuItem>
        ) : null}
        {pinAction && PinIcon ? (
          <DropdownMenuItem
            onClick={(event) => stopAndRun(event, pinAction.run)}
          >
            <PinIcon className="size-4" />
            {pinAction.menuLabel}
          </DropdownMenuItem>
        ) : null}
        {list.isArchived ? (
          <DropdownMenuItem
            onClick={(event) =>
              stopAndRun(event, () => actions.onUnarchive(list))
            }
          >
            <RotateCcw className="size-4" />
            Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={isArchiveDisabled}
            title={isArchiveDisabled ? DEFAULT_LIST_ARCHIVE_TITLE : undefined}
            className={
              isArchiveDisabled
                ? "cursor-not-allowed data-[disabled]:pointer-events-auto"
                : undefined
            }
            onClick={(event) => {
              if (isArchiveDisabled) {
                stopDisabledAction(event);
                return;
              }
              stopAndRun(event, () => actions.onArchive(list));
            }}
          >
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={isDeleteDisabled}
          title={isDeleteDisabled ? DEFAULT_LIST_DELETE_TITLE : undefined}
          className={
            isDeleteDisabled
              ? "cursor-not-allowed data-[disabled]:pointer-events-auto"
              : undefined
          }
          onClick={(event) => {
            if (isDeleteDisabled) {
              stopDisabledAction(event);
              return;
            }
            stopAndRun(event, () => actions.onDelete(list));
          }}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
