"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  SYSTEM_TASK_LISTS,
  type SystemTaskListKey,
} from "@/lib/task-lists/system-lists";
import type { TaskListRowActions } from "./task-list-actions-menu";
import { TaskListFormDialog } from "./task-list-form-dialog";
import type { TaskListItem } from "./task-list-types";

// Pin actions for system (virtual) Lists like Backlog. Present only for users
// with the list:pin permission, mirroring `TaskListRowActions.onPin/onUnpin`.
export interface TaskListSystemActions {
  onPin?: (key: SystemTaskListKey) => void;
  onUnpin?: (key: SystemTaskListKey) => void;
}

interface UseTaskListActionsOptions {
  projectId?: Id<"projects">;
}

interface UseTaskListActionsResult {
  canManageLists: boolean;
  // Undefined without list:manage, so a viewer gets no row menu at all.
  rowActions: TaskListRowActions | undefined;
  // Pin/unpin handlers for system Lists (Backlog). Separate from rowActions
  // because system Lists are keyed by project + key, not a List id.
  systemActions: TaskListSystemActions;
  // Render once alongside the rows that use `rowActions` (edit form dialog +
  // archive/default/delete confirmations).
  dialogs: ReactNode;
}

function systemListName(key: SystemTaskListKey): string {
  return SYSTEM_TASK_LISTS.find((list) => list.key === key)?.name ?? "List";
}

// Canonical handlers and dialogs behind the task List `...` actions menu.
// Reused by List management surfaces and sidebar pinned List items.
export function useTaskListActions({
  projectId,
}: UseTaskListActionsOptions): UseTaskListActionsResult {
  const setDefaultList = useMutation(api.tasks.lists.setDefault);
  const archiveList = useMutation(api.tasks.lists.archive);
  const unarchiveList = useMutation(api.tasks.lists.unarchive);
  const removeList = useMutation(api.tasks.lists.remove);
  const pinList = useMutation(api.tasks.lists.pin);
  const unpinList = useMutation(api.tasks.lists.unpin);
  const pinSystemList = useMutation(api.tasks.lists.pinSystemList);
  const unpinSystemList = useMutation(api.tasks.lists.unpinSystemList);
  const { canManageLists, canPinLists } = useProjectPermissions(projectId ?? null);
  const [editList, setEditList] = useState<TaskListItem | null>(null);
  const [archiveConfirmList, setArchiveConfirmList] = useState<TaskListItem | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [defaultConfirmList, setDefaultConfirmList] = useState<TaskListItem | null>(null);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [deleteList, setDeleteList] = useState<TaskListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleArchive = async () => {
    if (!archiveConfirmList) {
      return;
    }

    setIsArchiving(true);
    try {
      await archiveList({ id: archiveConfirmList._id });
      toast.success("List archived");
      setArchiveConfirmList(null);
    } catch (error) {
      showConvexErrorToast(error, "Failed to archive list");
    } finally {
      setIsArchiving(false);
    }
  };

  const handleUnarchive = async (list: TaskListItem) => {
    try {
      await unarchiveList({ id: list._id });
      toast.success("List unarchived");
    } catch (error) {
      showConvexErrorToast(error, "Failed to unarchive list");
    }
  };

  const handleSetDefault = async () => {
    if (!defaultConfirmList) {
      return;
    }

    setIsSettingDefault(true);
    try {
      await setDefaultList({ id: defaultConfirmList._id });
      toast.success(`"${defaultConfirmList.name}" is now the default list`);
      setDefaultConfirmList(null);
    } catch (error) {
      showConvexErrorToast(error, "Failed to update default list");
    } finally {
      setIsSettingDefault(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteList) {
      return;
    }

    setIsDeleting(true);
    try {
      await removeList({ id: deleteList._id });
      toast.success("List deleted");
      setDeleteList(null);
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete list");
    } finally {
      setIsDeleting(false);
    }
  };

  const handlePin = async (list: TaskListItem) => {
    try {
      await pinList({ id: list._id });
      toast.success(`"${list.name}" pinned to sidebar`);
    } catch (error) {
      showConvexErrorToast(error, "Failed to pin list");
    }
  };

  const handleUnpin = async (list: TaskListItem) => {
    try {
      await unpinList({ id: list._id });
      toast.success(`"${list.name}" unpinned from sidebar`);
    } catch (error) {
      showConvexErrorToast(error, "Failed to unpin list");
    }
  };

  const handlePinSystem = async (key: SystemTaskListKey) => {
    if (!projectId) {
      return;
    }
    const name = systemListName(key);
    try {
      await pinSystemList({ projectId, key });
      toast.success(`"${name}" pinned to sidebar`);
    } catch (error) {
      showConvexErrorToast(error, "Failed to pin list");
    }
  };

  const handleUnpinSystem = async (key: SystemTaskListKey) => {
    if (!projectId) {
      return;
    }
    const name = systemListName(key);
    try {
      await unpinSystemList({ projectId, key });
      toast.success(`"${name}" unpinned from sidebar`);
    } catch (error) {
      showConvexErrorToast(error, "Failed to unpin list");
    }
  };

  // Losing List access mid-session closes whatever is open, so nothing submits.
  if (!canManageLists && (editList || archiveConfirmList || defaultConfirmList || deleteList)) {
    setEditList(null);
    setArchiveConfirmList(null);
    setDefaultConfirmList(null);
    setDeleteList(null);
  }

  const rowActions: TaskListRowActions | undefined = canManageLists
    ? {
        onEdit: setEditList,
        onSetDefault: setDefaultConfirmList,
        ...(canPinLists ? { onPin: handlePin, onUnpin: handleUnpin } : {}),
        onArchive: setArchiveConfirmList,
        onUnarchive: handleUnarchive,
        onDelete: setDeleteList,
      }
    : undefined;

  const systemActions: TaskListSystemActions =
    canPinLists && projectId
      ? { onPin: handlePinSystem, onUnpin: handleUnpinSystem }
      : {};

  const dialogs = (
    <>
      {projectId ? (
        <TaskListFormDialog
          projectId={projectId}
          list={editList}
          open={editList !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditList(null);
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(archiveConfirmList)}
        title="Archive list"
        text={
          archiveConfirmList
            ? `Archive "${archiveConfirmList.name}"? It will be hidden from the header dropdown and can be restored from settings.`
            : undefined
        }
        onClose={() => setArchiveConfirmList(null)}
        busy={isArchiving}
        confirm={{
          label: "Archive",
          autoCloseOnClick: false,
          onClick: handleArchive,
        }}
      />

      <ConfirmDialog
        open={Boolean(defaultConfirmList)}
        title="Set default list"
        text={
          defaultConfirmList
            ? `"${defaultConfirmList.name}" will become the default list. New active tasks without an explicit list will be created there, and the default header view will show tasks from "${defaultConfirmList.name}". Existing tasks will not move.`
            : undefined
        }
        onClose={() => setDefaultConfirmList(null)}
        busy={isSettingDefault}
        confirm={{
          label: "Set as default",
          autoCloseOnClick: false,
          onClick: handleSetDefault,
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteList)}
        title="Delete list"
        text={
          deleteList ? `Delete "${deleteList.name}"? This cannot be undone.` : undefined
        }
        onClose={() => setDeleteList(null)}
        busy={isDeleting}
        confirm={{
          label: "Delete",
          variant: "destructive",
          autoCloseOnClick: false,
          onClick: handleDelete,
        }}
      />
    </>
  );

  return { canManageLists, rowActions, systemActions, dialogs };
}
