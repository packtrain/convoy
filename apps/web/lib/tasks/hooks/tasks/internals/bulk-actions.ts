import { useCallback, type RefObject } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { showBatchDoneToast, showBatchProgressToast } from "@/lib/batch-progress-toast";
import { showConvexErrorToast, toastMutationRejection } from "@/lib/errors";
import { getActiveRootTaskIds } from "@/lib/tasks/active-tasks";
import type { Task } from "@/lib/tasks/types";
import type { TaskAssigneeChange } from "@/lib/tasks/assignees";
import { taskIdsToStrings } from "@/lib/tasks/id-utils";
import { pendingDetailsFromUpdate } from "@/lib/tasks/optimistic-assignees";
import { toast } from "sonner";
import type { OptimisticAssigneeDetailsStore } from "./optimistic-assignee-details";
import type { TaskArchiveState } from "./archive-state";
import type { TaskBulkMutationHandles } from "./bulk-mutations";
import type { TaskListMoveMutationHandles } from "./list-move-mutations";

const MOVE_ACTIVE_BATCH_SIZE = 15;

export function useTaskBulkActions({
  assigneeDetails,
  bulkUpdateMutation,
  moveToListMutation,
  bulkArchiveMutation,
  bulkUnarchiveMutation,
  archiveState,
  tasksRef,
}: {
  assigneeDetails: OptimisticAssigneeDetailsStore;
  bulkUpdateMutation: TaskBulkMutationHandles["bulkUpdateMutation"];
  moveToListMutation: TaskListMoveMutationHandles["moveToListMutation"];
  bulkArchiveMutation: TaskBulkMutationHandles["bulkArchiveMutation"];
  bulkUnarchiveMutation: TaskBulkMutationHandles["bulkUnarchiveMutation"];
  archiveState: TaskArchiveState;
  tasksRef: RefObject<Task[]>;
}) {
  const bulkUpdateStatus = useCallback(
    (ids: string[], status: Task["status"]) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], status }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateAssignee = useCallback(
    (ids: string[], change: TaskAssigneeChange) => {
      const pendingChangeDetails = pendingDetailsFromUpdate(change);
      if (pendingChangeDetails) {
        assigneeDetails.queueForIds(ids, pendingChangeDetails);
      }
      bulkUpdateMutation({
        ids: ids as Id<"tasks">[],
        ...(change.assigneeId !== undefined && { assigneeId: change.assigneeId }),
        ...(change.delegatedToAgentId !== undefined && { delegatedToAgentId: change.delegatedToAgentId }),
      }).catch(toastMutationRejection);
    },
    [assigneeDetails, bulkUpdateMutation]
  );

  const bulkUpdatePriority = useCallback(
    (ids: string[], priority: Task["priority"]) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], priority }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateDueDate = useCallback(
    (ids: string[], dueDate: number | null) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], dueDate }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const bulkUpdateTaskType = useCallback(
    (ids: string[], taskTypeKey: string | null) => {
      bulkUpdateMutation({ ids: ids as Id<"tasks">[], taskTypeKey }).catch(toastMutationRejection);
    },
    [bulkUpdateMutation]
  );

  const moveToList = useCallback(
    (rootIds: string[], listRef: string, sectionId?: Id<"taskSections">) => {
      moveToListMutation({ rootIds: rootIds as Id<"tasks">[], listRef, sectionId }).catch(toastMutationRejection);
    },
    [moveToListMutation]
  );

  const moveActiveToList = useCallback(
    async (listRef: string) => {
      const rootIds = getActiveRootTaskIds(tasksRef.current);
      if (rootIds.length === 0) return;

      const total = rootIds.length;
      const toastId = `move-active-${listRef}`;
      let moved = 0;
      showBatchProgressToast({ toastId, completed: moved, total, label: "Moving" });
      try {
        for (let i = 0; i < rootIds.length; i += MOVE_ACTIVE_BATCH_SIZE) {
          const batch = rootIds.slice(i, i + MOVE_ACTIVE_BATCH_SIZE);
          await moveToListMutation({ rootIds: batch, listRef });
          moved += batch.length;
          showBatchProgressToast({ toastId, completed: moved, total, label: "Moving" });
        }
        showBatchDoneToast({ toastId, total, label: "Moved", itemLabel: "task" });
      } catch (error) {
        showConvexErrorToast(error, "Failed to move tasks");
        toast.dismiss(toastId);
      }
    },
    [moveToListMutation, tasksRef]
  );

  const bulkArchive = useCallback(
    async (ids: string[]): Promise<string[]> => {
      const result = await bulkArchiveMutation({ ids: ids as Id<"tasks">[] });
      return taskIdsToStrings(result.archivedRootIds);
    },
    [bulkArchiveMutation]
  );

  const bulkUnarchive = useCallback(
    async (ids: string[]): Promise<void> => {
      const pendingIds = archiveState.addPendingUnarchivedTasks(ids);
      try {
        await bulkUnarchiveMutation({ ids: ids as Id<"tasks">[] });
        archiveState.clearArchivedSnapshots(pendingIds);
      } catch (error) {
        if (pendingIds.length > 0) {
          archiveState.removePendingUnarchivedTasks(pendingIds);
        }
        throw error;
      }
    },
    [archiveState, bulkUnarchiveMutation]
  );

  return {
    bulkUpdateStatus,
    bulkUpdateAssignee,
    bulkUpdatePriority,
    bulkUpdateDueDate,
    bulkUpdateTaskType,
    moveToList,
    moveActiveToList,
    bulkArchive,
    bulkUnarchive,
  };
}
