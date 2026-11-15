"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Keyboard } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { useRouteParams } from "@/lib/navigation";
import {
  ARCHIVE_COMPLETED_TASKS_HOTKEY,
  CREATE_TASK_DIALOG_HOTKEY,
  CREATE_TASK_AT_TOP_HOTKEY,
  GO_TO_HOTKEYS,
  GO_TO_PREFIX_HOTKEY,
  MOVE_CLOSED_TASKS_BOTTOM_HOTKEY,
  NEW_THREAD_HOTKEY,
  PLAN_MODE_TOGGLE_SHORTCUT,
  QUICK_THREAD_HOTKEY,
  QUICK_THREAD_SEND_AND_OPEN_SHORTCUT,
  SHORTCUTS_SHEET_HOTKEY,
  SIDEBAR_TOGGLE_SHORTCUT,
  TASK_PANEL_HOTKEYS,
  TASK_QUICK_OPEN_HOTKEY,
  THREAD_ATTACH_FILES_SHORTCUT,
  THREAD_TASKS_SIDEBAR_HOTKEY,
  THREAD_LIST_TOGGLE_HOTKEY,
  THREAD_TOGGLE_DONE_HOTKEY,
  THREAD_TOGGLE_READ_HOTKEY,
  TASK_TABLE_HOTKEYS,
  getHotkeyKeycaps,
  isEditableHotkeyTarget,
  isOverlayHotkeyTarget,
  PR_STACK_LAYER_ABOVE_HOTKEY,
  PR_STACK_LAYER_BELOW_HOTKEY,
} from "@/lib/browser/hotkeys";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { STATUS_SHORTCUT_KEYS, TASK_TYPE_SHORTCUT_KEYS } from "@/lib/tasks/metadata-shortcuts";

interface Shortcut {
  label: string;
  /** Changes task data, so hidden from read-only viewers of the current project. */
  write?: boolean;
  hotkeys?: string[];
  sequence?: {
    prefix: string;
    keys: string[];
  };
}

interface ShortcutGroup {
  title: string;
  /** Hidden inside a project without threads access (viewers). */
  threads?: boolean;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { label: "Show keyboard shortcuts", hotkeys: [SHORTCUTS_SHEET_HOTKEY] },
      { label: "Toggle sidebar", hotkeys: [SIDEBAR_TOGGLE_SHORTCUT] },
      { label: "Find task", hotkeys: [TASK_QUICK_OPEN_HOTKEY] },
      { label: "Open new task dialog", write: true, hotkeys: [CREATE_TASK_DIALOG_HOTKEY] },
      { label: "Create inline task at top", write: true, hotkeys: [CREATE_TASK_AT_TOP_HOTKEY] },
      {
        label: "Archive completed tasks",
        write: true,
        hotkeys: [ARCHIVE_COMPLETED_TASKS_HOTKEY],
      },
      {
        label: "Move closed to bottom",
        write: true,
        hotkeys: [MOVE_CLOSED_TASKS_BOTTOM_HOTKEY],
      },
    ],
  },
  {
    title: "Go to",
    shortcuts: [
      { label: "Go to inbox", sequence: { prefix: GO_TO_PREFIX_HOTKEY, keys: [GO_TO_HOTKEYS.inbox] } },
      {
        label: "Go to Watch Tower",
        sequence: { prefix: GO_TO_PREFIX_HOTKEY, keys: [GO_TO_HOTKEYS.watchTower] },
      },
      { label: "Go to threads", sequence: { prefix: GO_TO_PREFIX_HOTKEY, keys: [GO_TO_HOTKEYS.threads] } },
      { label: "Go to settings", sequence: { prefix: GO_TO_PREFIX_HOTKEY, keys: [GO_TO_HOTKEYS.settings] } },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      {
        label: "Move up / down",
        hotkeys: [
          TASK_TABLE_HOTKEYS.navigateUp,
          TASK_TABLE_HOTKEYS.navigateDown,
          TASK_TABLE_HOTKEYS.navigateUpAlt,
          TASK_TABLE_HOTKEYS.navigateDownAlt,
        ],
      },
      { label: "Expand subtasks", hotkeys: [TASK_TABLE_HOTKEYS.expand] },
      { label: "Collapse subtasks", hotkeys: [TASK_TABLE_HOTKEYS.collapse] },
    ],
  },
  {
    title: "Selection",
    shortcuts: [
      {
        label: "Extend selection",
        hotkeys: [TASK_TABLE_HOTKEYS.extendUp, TASK_TABLE_HOTKEYS.extendDown],
      },
      { label: "Clear selection", hotkeys: [TASK_TABLE_HOTKEYS.clearSelection] },
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      { label: "Edit / create task below", write: true, hotkeys: [TASK_TABLE_HOTKEYS.edit] },
      { label: "Exit editing", write: true, hotkeys: ["Escape"] },
      { label: "Toggle status", write: true, hotkeys: [TASK_TABLE_HOTKEYS.toggleStatus] },
      {
        label: "Set status",
        write: true,
        sequence: {
          prefix: TASK_TABLE_HOTKEYS.setStatusPrefix,
          keys: STATUS_SHORTCUT_KEYS,
        },
      },
      {
        label: "Set task type",
        write: true,
        sequence: {
          prefix: TASK_TABLE_HOTKEYS.setTypePrefix,
          keys: TASK_TYPE_SHORTCUT_KEYS,
        },
      },
      { label: "Delete empty task", write: true, hotkeys: ["Backspace"] },
    ],
  },
  {
    title: "Task properties",
    shortcuts: [
      { label: "Set priority", write: true, hotkeys: [TASK_TABLE_HOTKEYS.setPriority] },
      { label: "Set assignee", write: true, hotkeys: [TASK_TABLE_HOTKEYS.setAssignee] },
      { label: "Assign to me", write: true, hotkeys: [TASK_TABLE_HOTKEYS.assignToMe] },
      { label: "Set label", write: true, hotkeys: [TASK_TABLE_HOTKEYS.setLabel] },
      { label: "Set due date", write: true, hotkeys: [TASK_TABLE_HOTKEYS.setDueDate] },
      { label: "Move to list", write: true, hotkeys: [TASK_TABLE_HOTKEYS.moveToList] },
    ],
  },
  {
    title: "Task panel",
    shortcuts: [
      { label: "Close task panel", hotkeys: [TASK_PANEL_HOTKEYS.close] },
      {
        label: "Next / previous task",
        hotkeys: [TASK_PANEL_HOTKEYS.next, TASK_PANEL_HOTKEYS.previous],
      },
    ],
  },
  {
    title: "Board",
    shortcuts: [
      { label: "Open card details", hotkeys: ["Enter"] },
      { label: "Pick up card", write: true, hotkeys: ["Space"] },
      {
        label: "Move picked-up card",
        write: true,
        hotkeys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
      },
      { label: "Drop card", write: true, hotkeys: ["Space", "Enter"] },
      { label: "Cancel move", write: true, hotkeys: ["Escape"] },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { label: "Open task details", hotkeys: [TASK_TABLE_HOTKEYS.openDetails] },
      { label: "Delete selected", write: true, hotkeys: [TASK_TABLE_HOTKEYS.delete] },
      { label: "Duplicate task", write: true, hotkeys: [TASK_TABLE_HOTKEYS.duplicate] },
      { label: "Indent (make subtask)", write: true, hotkeys: [TASK_TABLE_HOTKEYS.indent] },
      { label: "Outdent", write: true, hotkeys: [TASK_TABLE_HOTKEYS.outdent] },
      {
        label: "Reorder up / down",
        write: true,
        hotkeys: [TASK_TABLE_HOTKEYS.reorderUp, TASK_TABLE_HOTKEYS.reorderDown],
      },
      { label: "Copy task link (on ref)", hotkeys: ["Mod+Click"] },
    ],
  },
  {
    title: "Threads",
    threads: true,
    shortcuts: [
      { label: "New thread", hotkeys: [NEW_THREAD_HOTKEY] },
      { label: "Quick thread", hotkeys: [QUICK_THREAD_HOTKEY] },
      { label: "Start quick thread and open it", hotkeys: [QUICK_THREAD_SEND_AND_OPEN_SHORTCUT] },
      { label: "Toggle tasks sidebar", hotkeys: [THREAD_TASKS_SIDEBAR_HOTKEY] },
      { label: "Show / hide thread list", hotkeys: [THREAD_LIST_TOGGLE_HOTKEY] },
      { label: "Mark thread as done / not done", hotkeys: [THREAD_TOGGLE_DONE_HOTKEY] },
      { label: "Mark thread as read / unread", hotkeys: [THREAD_TOGGLE_READ_HOTKEY] },
      { label: "Attach files or photos", hotkeys: [THREAD_ATTACH_FILES_SHORTCUT] },
      { label: "Toggle plan mode", hotkeys: [PLAN_MODE_TOGGLE_SHORTCUT] },
      { label: "Exit thread multiselect", hotkeys: ["Escape"] },
      { label: "Exit shared threads view", hotkeys: ["Escape"] },
      { label: "Expand focused workflow rail", hotkeys: ["Enter", "Space"] },
      { label: "Close focused workflow rail", hotkeys: ["Escape"] },
    ],
  },
  {
    title: "Pull requests",
    shortcuts: [{ label: "Open the stack layer above / below", hotkeys: [PR_STACK_LAYER_ABOVE_HOTKEY, PR_STACK_LAYER_BELOW_HOTKEY] }],
  },
];

function ShortcutKeys({ hotkeys }: { hotkeys: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {hotkeys.map((hotkey, index) => (
        <span key={hotkey} className="flex items-center gap-0.5">
          {index > 0 && <span className="text-muted-foreground text-xs">/</span>}
          {getHotkeyKeycaps(hotkey).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </span>
      ))}
    </div>
  );
}

function ShortcutSequence({ sequence }: { sequence: NonNullable<Shortcut["sequence"]> }) {
  return (
    <div className="flex max-w-72 flex-wrap items-center justify-end gap-1.5">
      <Kbd>{sequence.prefix}</Kbd>
      <span className="text-muted-foreground text-xs">then</span>
      <div className="flex flex-wrap items-center justify-end gap-0.5">
        {sequence.keys.map((key, index) => (
          <span key={key} className="flex items-center gap-0.5">
            {index > 0 && <span className="text-muted-foreground text-xs">/</span>}
            <Kbd>{key}</Kbd>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Outside a project every shortcut is listed; inside one, write shortcuts need task
 * write access and thread shortcuts need threads access.
 */
function useShortcutAccess(organizationId: Id<"organizations"> | undefined) {
  const { projectAlias } = useRouteParams<{ projectAlias?: string }>();
  // Already subscribed by the sidebar's project list, so Convex dedupes this.
  const projects = useQuery(
    api.projects.core.listByOrganization,
    organizationId && projectAlias ? { organizationId } : "skip"
  );
  const projectId = projects?.find((project) => project.alias === projectAlias)?._id ?? null;
  const { canUpdateTask, canUseThreads } = useProjectPermissions(projectId);
  return {
    canUseWriteShortcuts: !projectAlias || canUpdateTask,
    canUseThreadShortcuts: !projectAlias || canUseThreads,
  };
}

// Mounted only while the dialog is open, so closed dialogs subscribe to nothing.
function ShortcutGroups({ organizationId }: { organizationId?: Id<"organizations"> }) {
  const { canUseWriteShortcuts, canUseThreadShortcuts } = useShortcutAccess(organizationId);
  const groups = SHORTCUT_GROUPS.filter((group) => canUseThreadShortcuts || !group.threads)
    .map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter((shortcut) => canUseWriteShortcuts || !shortcut.write),
    }))
    .filter((group) => group.shortcuts.length > 0);

  return (
    <div className="max-h-96 space-y-5 overflow-y-auto pr-1">
      {groups.map((group) => (
        <div key={group.title}>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3>
          <div className="rounded-lg border divide-y">
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.label} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{shortcut.label}</span>
                {shortcut.sequence ? (
                  <ShortcutSequence sequence={shortcut.sequence} />
                ) : (
                  <ShortcutKeys hotkeys={shortcut.hotkeys ?? []} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: Id<"organizations">;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ShortcutGroups organizationId={organizationId} />
      </DialogContent>
    </Dialog>
  );
}

export function KeyboardShortcutsButton({ organizationId }: { organizationId?: Id<"organizations"> }) {
  const [open, setOpen] = useState(false);

  // ? is Shift+/ on most layouts, so only Ctrl, Cmd and Alt rule it out.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SHORTCUTS_SHEET_HOTKEY || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.defaultPrevented || isEditableHotkeyTarget(event.target) || isOverlayHotkeyTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => setOpen(true)} tooltip="Keyboard shortcuts" className="cursor-pointer" size="sm">
            <Keyboard className="size-4" />
            <span>Keyboard shortcuts</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <KeyboardShortcutsDialog open={open} onOpenChange={setOpen} organizationId={organizationId} />
    </>
  );
}
