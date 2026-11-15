"use client";

import { useCallback, useState, type DragEvent } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import {
  dragHasTasksForProject,
  readTaskDragPayload,
} from "@/lib/tasks/task-drag";
import { collectTaskAndDescendantIds } from "@/lib/tasks/tree";

interface SidebarTaskDropTarget {
  // Identifies which target is currently hovered (e.g. a List id or a
  // project-level marker); compared against `dropTargetKey` for highlight.
  key: string;
  // Target List identifier for tasks.moveToList — exactly one must be set.
  listId?: string;
  listRef?: string;
}

interface SidebarTaskDropProps {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

// Makes sidebar rows drop targets for task drags from the task table. Only
// drags carrying tasks of the same project are accepted; drops reuse the
// existing tasks.moveToList mutation (OS-979). Read-only viewers get no targets.
export function useSidebarTaskDrop(projectId: string): {
  dropTargetKey: string | null;
  getDropTargetProps: (target: SidebarTaskDropTarget) => SidebarTaskDropProps | undefined;
} {
  const { canUpdateTask } = useProjectPermissions(projectId as Id<"projects">);
  // Optimistically strip the moved tasks from every cached task-list view
  // except ones showing the target List, so the drag source updates
  // instantly. The drop hook doesn't know which view is on screen, hence the
  // all-queries sweep (unlike the view-scoped update in use-tasks.ts).
  const moveToList = useMutation(api.tasks.core.move.toList).withOptimisticUpdate(
    (localStore, args) => {
      const rootIds = new Set(args.rootIds.map(String));
      const targetRef = args.listRef?.trim().toUpperCase() || null;

      for (const { args: queryArgs, value } of localStore.getAllQueries(
        api.tasks.core.listByProject
      )) {
        if (!value) {
          continue;
        }
        const queryRef = queryArgs.listRef?.trim().toUpperCase() ?? null;
        // Views of the target List keep their rows: a ref target matches the
        // same ref; a listId target is the default List, shown by the
        // default view (no listRef).
        if (queryRef === targetRef) {
          continue;
        }
        const idsToMove = collectTaskAndDescendantIds(value, rootIds);
        if (idsToMove.size === 0) {
          continue;
        }
        localStore.setQuery(
          api.tasks.core.listByProject,
          queryArgs,
          value.filter((task) => !idsToMove.has(task._id))
        );
      }
    }
  );
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const getDropTargetProps = useCallback(
    (target: SidebarTaskDropTarget): SidebarTaskDropProps | undefined => canUpdateTask ? ({
      onDragOver: (event) => {
        if (!dragHasTasksForProject(event.dataTransfer, projectId)) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTargetKey(target.key);
      },
      onDragLeave: (event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && event.currentTarget.contains(related)) {
          return;
        }
        setDropTargetKey((current) =>
          current === target.key ? null : current
        );
      },
      onDrop: (event) => {
        setDropTargetKey((current) =>
          current === target.key ? null : current
        );
        const payload = readTaskDragPayload(event.dataTransfer);
        if (!payload || payload.projectId !== projectId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        // Ids come from our own drag payload; the mutation's v.id validator
        // re-checks them server-side.
        const rootIds = payload.taskIds as Id<"tasks">[];
        void (async () => {
          try {
            const result = await moveToList({
              rootIds,
              ...(target.listRef
                ? { listRef: target.listRef }
                : { listId: target.listId }),
            });
            toast.success(
              rootIds.length === 1
                ? `Task moved to "${result.list.name}"`
                : `${rootIds.length} tasks moved to "${result.list.name}"`
            );
          } catch (error) {
            showConvexErrorToast(error, "Failed to move tasks");
          }
        })();
      },
    }) : undefined,
    [canUpdateTask, moveToList, projectId]
  );

  return { dropTargetKey, getDropTargetProps };
}
