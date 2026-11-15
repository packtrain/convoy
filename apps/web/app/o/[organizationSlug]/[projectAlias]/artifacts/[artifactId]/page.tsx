"use client";

import { useCallback } from "react";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { TaskArtifactPanel } from "@/components/blocks/tasks/task-artifact-panel";
import { TaskArtifactPanelSkeleton } from "@/components/blocks/tasks/task-artifact-panel-skeleton";
import { appRoute, useRouteParams, withProjectTaskArtifact } from "@/lib/navigation";
import {
  useArtifactOwningTask,
  useTaskArtifact,
  useUpdateTaskArtifact,
} from "@/lib/tasks/hooks/use-task-artifacts";

export default function ArtifactFullPage() {
  const { organizationSlug, projectAlias, artifactId } = useRouteParams<{
    organizationSlug: string;
    projectAlias: string;
    artifactId: string;
  }>();
  // Auth is gated by the organization layout; invalid/inaccessible IDs resolve to null.
  const artifact = useTaskArtifact(artifactId);
  const updateArtifact = useUpdateTaskArtifact();
  // Owning task context: archived-task read-only parity with the sidebar
  // panel, plus the back-to-task link and thread-handoff wiring.
  const { task, isReadOnly } = useArtifactOwningTask(artifact?.taskId);
  const noop = useCallback(() => undefined, []);

  if (artifact === undefined) {
    return (
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <TaskArtifactPanelSkeleton />
      </div>
    );
  }

  if (artifact === null) {
    return (
      <div className="flex h-svh flex-col">
        <NotFoundState title="Artifact not found" />
      </div>
    );
  }

  // Back to the artifact opened over the task sidebar on the project list view.
  const backTarget = task
    ? withProjectTaskArtifact(
        appRoute.project(organizationSlug, projectAlias).pathname,
        {},
        task.refId,
        artifact._id,
        task.isArchived ? true : undefined
      )
    : undefined;

  return (
    <TaskArtifactPanel
      selectedArtifactId={artifact._id}
      fullPage
      backTarget={backTarget}
      onClose={noop}
      onInvalidSelection={noop}
      onUpdateArtifact={updateArtifact}
      disabled={isReadOnly !== false}
      projectId={task?.projectId}
      taskId={task?._id}
      taskRefId={task?.refId}
    />
  );
}
