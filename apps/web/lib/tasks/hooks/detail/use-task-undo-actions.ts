"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { getMutationErrorMessage } from "@/lib/errors";
import { getArchiveUndoToastMessage } from "@/lib/tasks/archive-undo";
import { getDeleteUndoToastMessage, restoreDeletedTasks } from "@/lib/tasks/delete-undo";

type UndoTaskOperation = (id: string) => Promise<void>;
type BulkUndoTaskOperation = (ids: string[]) => Promise<void>;
type UndoableTaskOperation = () => Promise<string[]>;

export function useTaskUndoActions({
  restoreTask,
  bulkUnarchive,
}: {
  restoreTask: UndoTaskOperation;
  bulkUnarchive: BulkUndoTaskOperation;
}) {
  const undoRestoreInFlightRef = useRef<Set<string>>(new Set());
  const undoUnarchiveInFlightRef = useRef<Set<string>>(new Set());

  const handleUndoRestore = useCallback(
    async (deletedIds: string[]) => {
      if (deletedIds.length === 0) return;

      const undoKey = [...deletedIds].sort().join(",");
      if (undoRestoreInFlightRef.current.has(undoKey)) return;
      undoRestoreInFlightRef.current.add(undoKey);

      try {
        const { failed, succeeded } = await restoreDeletedTasks(
          deletedIds,
          restoreTask
        );

        if (succeeded === 0 && failed === 0) return;

        if (failed === 0) {
          const restoredLabel =
            succeeded === 1
              ? "Task restored"
              : `${succeeded} tasks restored`;
          toast.success(restoredLabel);
          return;
        }

        const failedLabel =
          failed === 1
            ? "Failed to restore 1 task"
            : `Failed to restore ${failed} tasks`;
        toast.error(failedLabel);
      } finally {
        undoRestoreInFlightRef.current.delete(undoKey);
      }
    },
    [restoreTask]
  );

  const showDeleteUndoToast = useCallback(
    (deletedIds: string[], singleTaskTitle?: string) => {
      if (deletedIds.length === 0) return;

      const message = getDeleteUndoToastMessage(
        deletedIds.length,
        singleTaskTitle
      );
      const toastId = toast.message(message, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            toast.dismiss(toastId);
            void handleUndoRestore(deletedIds);
          },
        },
      });
    },
    [handleUndoRestore]
  );

  const handleUndoUnarchive = useCallback(
    async (archivedIds: string[]) => {
      if (archivedIds.length === 0) return;

      const undoKey = [...archivedIds].sort().join(",");
      if (undoUnarchiveInFlightRef.current.has(undoKey)) return;
      undoUnarchiveInFlightRef.current.add(undoKey);

      try {
        await bulkUnarchive(archivedIds);

        const restoredLabel =
          archivedIds.length === 1
            ? "Task unarchived"
            : `${archivedIds.length} tasks unarchived`;
        toast.success(restoredLabel);
      } catch {
        toast.error("Failed to unarchive tasks");
      } finally {
        undoUnarchiveInFlightRef.current.delete(undoKey);
      }
    },
    [bulkUnarchive]
  );

  const showArchiveUndoToast = useCallback(
    (archivedIds: string[], singleTaskTitle?: string) => {
      if (archivedIds.length === 0) return;

      const message = getArchiveUndoToastMessage(
        archivedIds.length,
        singleTaskTitle
      );
      const toastId = toast.message(message, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            toast.dismiss(toastId);
            void handleUndoUnarchive(archivedIds);
          },
        },
      });
    },
    [handleUndoUnarchive]
  );

  const executeArchiveWithUndo = useCallback(
    (
      archiveOperation: UndoableTaskOperation,
      errorMessage: string,
      singleTaskTitle?: string
    ) => {
      void archiveOperation()
        .then((archivedIds) =>
          showArchiveUndoToast(archivedIds, singleTaskTitle)
        )
        .catch((error: unknown) => toast.error(getMutationErrorMessage(error, errorMessage)));
    },
    [showArchiveUndoToast]
  );

  const executeDeleteWithUndo = useCallback(
    (
      deleteOperation: UndoableTaskOperation,
      errorMessage: string,
      singleTaskTitle?: string
    ) => {
      void deleteOperation()
        .then((deletedIds) => showDeleteUndoToast(deletedIds, singleTaskTitle))
        .catch((error: unknown) => toast.error(getMutationErrorMessage(error, errorMessage)));
    },
    [showDeleteUndoToast]
  );

  return {
    executeArchiveWithUndo,
    executeDeleteWithUndo,
  };
}
