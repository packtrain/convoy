"use client";

import { useCallback, useMemo } from "react";
import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import {
  dragHasResourceForProject,
  readResourceDragPayload,
} from "@/lib/tasks/resource-drag";

/**
 * Drops the moved resource from every cached Resources list holding it, so the
 * pill leaves the source task on drop instead of after the round trip. The
 * update only receives the *target* task id, hence the all-queries sweep — same
 * reason as `use-sidebar-task-drop`. The target's own list is left to the server
 * response: it is rarely mounted (one task sidebar at a time) and the drag
 * payload has no full row to insert.
 */
function dropFromCachedLists<Rows extends { _id: string }[]>(
  localStore: OptimisticLocalStore,
  query: FunctionReference<"query", "public", { taskId: Id<"tasks">; apiKey?: string }, Rows>,
  resourceId: string
): void {
  for (const { args, value } of localStore.getAllQueries(query)) {
    if (!value) {
      continue;
    }
    const remaining = value.filter((row) => row._id !== resourceId);
    if (remaining.length !== value.length) {
      // Filtering `Rows` yields the same element type; TS just can't prove the
      // result is still `Rows` through the generic.
      localStore.setQuery(query, args, remaining as Rows);
    }
  }
}

export interface ResourceDropHandlers {
  /** Cheap gate for `dragover`, where payload values are unreadable. */
  hasResourceDrag: (dataTransfer: DataTransfer) => boolean;
  dropResource: (dataTransfer: DataTransfer, taskId: string) => void;
}

/**
 * Makes task rows drop targets for artifact and attachment drags from the
 * Resources section (OS-1711). Flat handlers, not per-target props: the
 * virtualized table needs stable callback identity for row memoization.
 */
export function useResourceTaskDrop(
  projectId: string | undefined
): ResourceDropHandlers {
  const moveArtifact = useMutation(
    api.tasks.artifacts.moveTaskArtifact
  ).withOptimisticUpdate((localStore, args) => {
    dropFromCachedLists(
      localStore,
      api.tasks.artifacts.listTaskArtifactsByTask,
      args.artifactId
    );
  });
  const moveAttachment = useMutation(
    api.tasks.attachments.moveTaskAttachment
  ).withOptimisticUpdate((localStore, args) => {
    dropFromCachedLists(
      localStore,
      api.tasks.attachments.listTaskAttachmentsByTask,
      args.attachmentId
    );
  });

  const hasResourceDrag = useCallback(
    (dataTransfer: DataTransfer) =>
      projectId ? dragHasResourceForProject(dataTransfer, projectId) : false,
    [projectId]
  );

  const dropResource = useCallback(
    (dataTransfer: DataTransfer, taskId: string) => {
      const payload = readResourceDragPayload(dataTransfer);
      // Same task is a no-op; another project is rejected server-side anyway.
      if (
        !payload ||
        payload.projectId !== projectId ||
        payload.taskId === taskId
      ) {
        return;
      }

      void (async () => {
        try {
          if (payload.kind === "artifact") {
            await moveArtifact({
              artifactId: payload.resourceId as Id<"taskArtifacts">,
              taskId: taskId as Id<"tasks">,
            });
          } else {
            await moveAttachment({
              attachmentId: payload.resourceId as Id<"taskAttachments">,
              taskId: taskId as Id<"tasks">,
            });
          }
          toast.success(`"${payload.name}" moved`);
        } catch (error) {
          showConvexErrorToast(error, `Failed to move ${payload.kind}`);
        }
      })();
    },
    [moveArtifact, moveAttachment, projectId]
  );

  // Memoized so the container is as stable as the callbacks it holds:
  // `useTableDnd` takes it as a dependency.
  return useMemo(
    () => ({ hasResourceDrag, dropResource }),
    [hasResourceDrag, dropResource]
  );
}
