"use client";

import { useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";

interface CreateArtifactArgs {
  name: string;
  content?: string;
  contentType?: "markdown" | "html";
  runId?: string;
}

interface UpdateArtifactArgs {
  artifactId: Id<"taskArtifacts">;
  name?: string;
  content?: string;
  runId?: string;
}

export function useTaskArtifacts(taskId: Id<"tasks"> | undefined) {
  const artifacts = useQuery(
    api.tasks.artifacts.listTaskArtifactsByTask,
    taskId ? { taskId } : "skip"
  );

  const createMutation = useMutation(api.tasks.artifacts.createTaskArtifact);
  const updateMutation = useMutation(api.tasks.artifacts.updateTaskArtifact);
  const deleteMutation = useMutation(api.tasks.artifacts.deleteTaskArtifact);

  const createArtifact = useCallback(
    async (args: CreateArtifactArgs) => {
      if (!taskId) {
        throw new Error("Task ID is required to create an artifact");
      }
      return await createMutation({ taskId, ...args });
    },
    [taskId, createMutation]
  );

  const updateArtifact = useCallback(
    async (args: UpdateArtifactArgs) => {
      await updateMutation(args);
    },
    [updateMutation]
  );

  const deleteArtifact = useCallback(
    async (artifactId: Id<"taskArtifacts">) => {
      await deleteMutation({ artifactId });
    },
    [deleteMutation]
  );

  return {
    artifacts,
    createArtifact,
    updateArtifact,
    deleteArtifact,
  };
}

export function useTaskArtifact(artifactId: string | null | undefined) {
  return useQuery(
    api.tasks.artifacts.getTaskArtifactSafe,
    artifactId ? { artifactId } : "skip"
  );
}

/** Update mutation for surfaces that render an artifact without its task context (full page). */
export function useUpdateTaskArtifact() {
  const updateMutation = useMutation(api.tasks.artifacts.updateTaskArtifact);

  return useCallback(
    async (args: UpdateArtifactArgs) => {
      await updateMutation(args);
    },
    [updateMutation]
  );
}

/**
 * Owning-task context for surfaces that render an artifact without a task
 * sidebar (full page): the task itself (for back links and thread handoff)
 * plus whether artifacts must render read-only (parity with the sidebar panel).
 * `isReadOnly` is `undefined` while the task or role is loading; treat that as
 * read-only until resolved.
 */
export function useArtifactOwningTask(taskId: Id<"tasks"> | undefined) {
  const task = useQuery(api.tasks.core.getById, taskId ? { id: taskId } : "skip");
  // Same rule as the sidebar panel: archived or no task write access.
  const { myRole, readOnlyReason } = useProjectPermissions(task?.projectId ?? null);
  return {
    task,
    // A null task (deleted/inaccessible) stays read-only defensively; the
    // artifact query itself already gates view access.
    isReadOnly:
      task === undefined || (task !== null && myRole === undefined)
        ? undefined
        : task === null || task.isArchived || readOnlyReason !== null,
  };
}
