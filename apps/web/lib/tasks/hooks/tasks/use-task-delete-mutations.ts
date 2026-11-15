"use client";

import { useCallback } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { taskIdsToStrings } from "@/lib/tasks/id-utils";

type CascadeMode = "delete_all" | "keep_children";

type DeleteTasksResult = {
  deletedIds: Id<"tasks">[];
};

type RemoveMutation = (args: {
  id: Id<"tasks">;
  cascadeMode?: CascadeMode;
}) => Promise<DeleteTasksResult>;

type BulkRemoveMutation = (args: {
  ids: Id<"tasks">[];
  cascadeMode?: CascadeMode;
}) => Promise<DeleteTasksResult>;

type RestoreMutation = (args: {
  id: Id<"tasks">;
}) => Promise<null>;

export function useTaskDeleteMutations({
  removeMutation,
  bulkRemoveMutation,
  restoreMutation,
}: {
  removeMutation: RemoveMutation;
  bulkRemoveMutation: BulkRemoveMutation;
  restoreMutation: RestoreMutation;
}) {
  const deleteTask = useCallback(
    async (id: string): Promise<string[]> => {
      const result = await removeMutation({ id: id as Id<"tasks"> });
      return taskIdsToStrings(result.deletedIds);
    },
    [removeMutation]
  );

  const bulkDelete = useCallback(
    async (ids: string[]): Promise<string[]> => {
      const result = await bulkRemoveMutation({ ids: ids as Id<"tasks">[] });
      return taskIdsToStrings(result.deletedIds);
    },
    [bulkRemoveMutation]
  );

  const bulkDeleteWithChildren = useCallback(
    async (ids: string[], cascadeMode: CascadeMode): Promise<string[]> => {
      const result = await bulkRemoveMutation({
        ids: ids as Id<"tasks">[],
        cascadeMode,
      });
      return taskIdsToStrings(result.deletedIds);
    },
    [bulkRemoveMutation]
  );

  const restoreTask = useCallback(
    async (id: string): Promise<void> => {
      await restoreMutation({ id: id as Id<"tasks"> });
    },
    [restoreMutation]
  );

  return {
    deleteTask,
    bulkDelete,
    bulkDeleteWithChildren,
    restoreTask,
  };
}
