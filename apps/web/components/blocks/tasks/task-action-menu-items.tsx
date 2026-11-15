"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";
import {
  Copy,
  CheckCircle2,
  ListTree,
  ExternalLink,
  Link,
  Trash2,
  FilePlus2,
  CirclePlus,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Status, type Task } from "@/lib/tasks/types";
import { useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { getHotkeyKeycaps, TASK_TABLE_HOTKEYS } from "@/lib/browser/hotkeys";
import { appRoute, href, useRouteParams } from "@/lib/navigation";

/** Task menus grow to their widest row so labels and keycaps stay on one line. */
export const ONE_LINE_MENU_CLASS = "w-max [&_[role=menuitem]]:whitespace-nowrap";

/** Trailing keycaps for a menu row, hidden from the accessible name. Spec: docs/specs/keyboard-navigation.md */
export function MenuShortcut({ hotkey }: { hotkey: string }) {
  return (
    <KbdGroup aria-hidden className="ml-auto pl-4">
      {getHotkeyKeycaps(hotkey).map((keycap) => (
        <Kbd key={keycap}>{keycap}</Kbd>
      ))}
    </KbdGroup>
  );
}

type MenuItemComponent = React.ComponentType<{
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  title?: string;
  className?: string;
  children: React.ReactNode;
}>;

type SeparatorComponent = React.ComponentType;

export interface TaskActionCallbacks {
  onDuplicate?: () => void;
  onMarkComplete?: () => void;
  onOpenDetails?: () => void;
  onOpenInNewTab?: () => void;
  onCopyLink?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDelete?: () => void;
}

interface TaskActionMenuItemsProps {
  task: Task;
  callbacks: TaskActionCallbacks;
  Item: MenuItemComponent;
  Separator: SeparatorComponent;
  actionScope?: "task" | "selection";
  moveToListItem?: ReactNode;
  /** Property submenus (status, priority, assignee, label) shown first. */
  propertyItems?: ReactNode;
  /** Shows keycaps for the table shortcuts; only where those shortcuts work. */
  showShortcuts?: boolean;
  /** Set for read-only callers: mutating items disable with this tooltip, delete hides. */
  readOnlyReason?: string | null;
}

export function TaskActionMenuItems({
  task,
  callbacks,
  Item,
  Separator,
  actionScope = "task",
  moveToListItem,
  propertyItems,
  showShortcuts = false,
  readOnlyReason = null,
}: TaskActionMenuItemsProps) {
  const shortcut = (hotkey: string) => (showShortcuts ? <MenuShortcut hotkey={hotkey} /> : null);
  const isCompleted = task.status === Status.DONE;
  const isArchived = task.isArchived;
  const isSelectionScope = actionScope === "selection";
  const showUnfinishedItems = useShowUnfinishedItems();
  // Disabled items normally drop pointer events; keep them so the tooltip shows.
  // No onClick: Radix still calls an item's onClick while it is disabled.
  const mutating = (onClick?: () => void) =>
    readOnlyReason === null
      ? { onClick }
      : {
          disabled: true,
          title: readOnlyReason,
          className: "data-[disabled]:pointer-events-auto data-[disabled]:cursor-default",
        };

  return (
    <>
      {propertyItems ? (
        <>
          {propertyItems}
          <Separator />
        </>
      ) : null}
      {callbacks.onMarkComplete && (
        <Item {...mutating(callbacks.onMarkComplete)}>
          <CheckCircle2 className="mr-2 h-4 w-4" />
          {isSelectionScope
            ? isCompleted
              ? "Mark selected incomplete"
              : "Mark selected complete"
            : isCompleted
              ? "Mark incomplete"
              : "Mark complete"}
          {shortcut(TASK_TABLE_HOTKEYS.toggleStatus)}
        </Item>
      )}
      {moveToListItem && readOnlyReason !== null ? (
        <Item {...mutating()}>
          <ListTree className="mr-2 h-4 w-4" />
          Move to
        </Item>
      ) : (
        moveToListItem
      )}

      {(callbacks.onDuplicate || showUnfinishedItems) && <Separator />}

      {callbacks.onDuplicate && (
        <Item {...mutating(callbacks.onDuplicate)}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate task
          {shortcut(TASK_TABLE_HOTKEYS.duplicate)}
        </Item>
      )}
      {showUnfinishedItems && (
        <>
          <Item disabled>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Create follow-up task
          </Item>
          <Item disabled>
            <ListTree className="mr-2 h-4 w-4" />
            Add subtask
          </Item>
        </>
      )}

      <Separator />

      {callbacks.onOpenDetails && (
        <Item onClick={callbacks.onOpenDetails}>
          <CirclePlus className="mr-2 h-4 w-4" />
          Open task details
          {shortcut(TASK_TABLE_HOTKEYS.openDetails)}
        </Item>
      )}
      {callbacks.onOpenInNewTab && (
        <Item onClick={callbacks.onOpenInNewTab}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Open in new tab
        </Item>
      )}
      {callbacks.onCopyLink && (
        <Item onClick={callbacks.onCopyLink}>
          <Link className="mr-2 h-4 w-4" />
          Copy task link
        </Item>
      )}

      <Separator />

      {isArchived ? (
        callbacks.onUnarchive && (
          <Item
            disabled={!isSelectionScope && !!task.parentId}
            {...mutating(callbacks.onUnarchive)}
          >
            <ArchiveRestore className="mr-2 h-4 w-4" />
            {isSelectionScope ? "Unarchive selected" : "Unarchive"}
          </Item>
        )
      ) : (
        callbacks.onArchive && (
          <Item {...mutating(callbacks.onArchive)}>
            <Archive className="mr-2 h-4 w-4" />
            {isSelectionScope ? "Archive selected" : "Archive"}
          </Item>
        )
      )}
      {callbacks.onDelete && readOnlyReason === null && (
        <Item variant="destructive" onClick={callbacks.onDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          {isSelectionScope ? "Delete selected tasks" : "Delete task"}
          {shortcut(TASK_TABLE_HOTKEYS.delete)}
        </Item>
      )}
    </>
  );
}

/** Builds "Open in new tab" and "Copy task link" handlers from a task's refId. */
export function useTaskLinkActions(refId: string) {
  const organizationSlug = useRouteParams<{ organizationSlug: string }>()?.organizationSlug ?? "";
  // The task page, never the current page: that may be a thread (OS-2325).
  const taskUrl = useCallback(
    () => `${window.location.origin}${href(appRoute.task(organizationSlug, refId))}`,
    [organizationSlug, refId]
  );

  const handleOpenInNewTab = useCallback(() => {
    window.open(taskUrl(), "_blank");
  }, [taskUrl]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(taskUrl());
  }, [taskUrl]);

  return { handleOpenInNewTab, handleCopyLink };
}
