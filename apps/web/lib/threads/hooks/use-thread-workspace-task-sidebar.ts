"use client";

import { useEffect, useMemo, useCallback, useReducer, useRef } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAllowedTaskStatuses, type ProjectStatusConfig } from "@/lib/tasks/status-policy";
import type { Status as TaskStatus } from "@/lib/tasks/status";
import { useTasks } from "@/lib/tasks/hooks/use-tasks";
import type { ArchiveFilter, Task } from "@/lib/tasks/types";
import type { ThreadComposerAttachedTask } from "@/components/blocks/thread/thread-composer";
import { useThreadNavigationState } from "@/lib/navigation";

interface UseThreadWorkspaceTaskSidebarArgs {
  projectId?: Id<"projects">;
  projectStatusConfig?: ProjectStatusConfig | null;
  /**
   * Reveals the surface hosting the task detail. Re-opening the task already in
   * `task=<REF>` builds an identical URL that the navigation layer discards, so
   * the param never changes and a mirror keyed off it cannot fire (OS-1663).
   */
  onOpenTask?: () => void;
}

interface SyncDetailsTaskAction {
  nextResolvedTask: Task | undefined;
  selectedTaskLookup: ReturnType<typeof useQuery>;
  taskRefId: string | null;
}

type GetByRefsTaskResult = FunctionReturnType<
  typeof api.tasks.core.getByRefs
>["results"][number]["task"];

function toComposerAttachedTask(task: Task | null | undefined): ThreadComposerAttachedTask | null {
  if (!task) {
    return null;
  }

  return {
    _id: task._id,
    refId: task.refId,
    name: task.name,
    taskType: task.taskType,
  };
}

function normalizeTask(task: GetByRefsTaskResult | undefined): Task | undefined {
  if (!task) {
    return undefined;
  }

  return {
    _id: task._id,
    clientId: task.clientId,
    refNumber: task.refNumber,
    refId: task.refId,
    name: task.name,
    description: task.description,
    taskType: task.taskType,
    priority: task.priority,
    dueDate: task.dueDate ?? null,
    status: task.status,
    list: task.list,
    assignee: task.assignee ?? null,
    delegatedToAgent: task.delegatedToAgent ?? null,
    tags: task.tags,
    labelId: task.labelId,
    externalLinks: task.externalLinks,
    agentThreadWork: task.agentThreadWork,
    attachmentCount: task.attachmentCount,
    artifactCount: task.artifactCount,
    rank: task.rank,
    parentId: task.parentId ? String(task.parentId) : null,
    createdBy: task.createdBy ? String(task.createdBy) : undefined,
    createdByName: task.createdByName ?? null,
    createdAt: task.createdAt,
    isArchived: task.isArchived,
    archivedAt: task.archivedAt ?? undefined,
    archivedBy: task.archivedBy ? String(task.archivedBy) : undefined,
  };
}

/**
 * The slice of this hook the threads views consume. Named because the host owns
 * one instance and hands it to both of them (OS-1660); a `ReturnType` alias
 * would drag in the whole URL-state surface neither view touches.
 */
export interface ThreadWorkspaceTaskSidebar {
  taskRefId: string | null;
  detailsTask: Task | undefined;
  attachedTask: ThreadComposerAttachedTask | null;
  artifactId: string | null;
  threadArtifactId: string | null;
  archiveFilter: ArchiveFilter;
  setTask: (
    taskRefId: string | null,
    archiveFilter?: ArchiveFilter,
    options?: { history?: "push" | "replace" }
  ) => void;
  setTaskArtifact: (
    taskRefId: string,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter
  ) => void;
  setArtifact: (artifactId: string | null) => void;
  selectThreadArtifact: (artifactId: string | null) => void;
  closeThreadArtifact: (options?: { history?: "push" | "replace" }) => void;
  closeTaskSidebar: (options?: { history?: "push" | "replace" }) => void;
  setAttachedTask: (taskRefId: string | null) => void;
  openTaskByClientId: (clientId: string) => void;
  taskLinkHref: (task: Pick<Task, "refId" | "isArchived">) => string;
  allowedStatuses: TaskStatus[];
  allTasks: Task[];
  currentUserId: string | undefined;
  taskOperations: ThreadWorkspaceTaskOperations;
  inputRefs: TasksResult["inputRefs"];
  focusInput: TasksResult["focusInput"];
}

type TasksResult = ReturnType<typeof useTasks>;

type ThreadWorkspaceTaskOperations = Pick<
  TasksResult,
  | "updateTask"
  | "deleteTask"
  | "addTask"
  | "reorderTasks"
  | "reorderMultiple"
  | "setParent"
  | "setParentMultiple"
  | "bulkUpdateStatus"
  | "bulkUpdateAssignee"
  | "bulkUpdatePriority"
  | "bulkUpdateDueDate"
  | "bulkUpdateTaskType"
  | "moveToList"
  | "bulkArchive"
  | "bulkDelete"
  | "duplicateTask"
  | "unarchiveTask"
>;

export function useThreadWorkspaceTaskSidebar({
  projectId,
  projectStatusConfig,
  onOpenTask,
}: UseThreadWorkspaceTaskSidebarArgs) {
  const urlState = useThreadNavigationState();
  const {
    taskRefId,
    attachedTaskRefId,
    archiveFilter,
    openTask: navigateToTask,
    selectTaskArtifact,
    selectArtifact,
    closeTaskSidebar,
    taskHref,
    setAttachedTask,
  } = urlState;

  // Every user-initiated open goes through this; the URL-correcting effects
  // below keep using `navigateToTask`, since a correction must not reveal a
  // surface the user closed.
  const openTask = useCallback(
    (
      nextTaskRefId: string | null,
      nextArchiveFilter?: ArchiveFilter,
      options?: { history?: "push" | "replace" }
    ) => {
      navigateToTask(nextTaskRefId, nextArchiveFilter, options);
      onOpenTask?.();
    },
    [navigateToTask, onOpenTask]
  );

  const selectedTaskLookup = useQuery(
    api.tasks.core.getByRefs,
    projectId && taskRefId
      ? { projectId, refs: [taskRefId] }
      : "skip"
  );
  const attachedTaskLookup = useQuery(
    api.tasks.core.getByRefs,
    projectId && attachedTaskRefId
      ? { projectId, refs: [attachedTaskRefId] }
      : "skip"
  );
  const currentUser = useQuery(api.users.core.current);

  const resolvedDetailsTask = useMemo(
    () => normalizeTask(selectedTaskLookup?.results[0]?.task),
    [selectedTaskLookup]
  );
  const attachedTask = useMemo(
    () => toComposerAttachedTask(normalizeTask(attachedTaskLookup?.results[0]?.task)),
    [attachedTaskLookup]
  );
  const [detailsTask, syncDetailsTask] = useReducer(
    (state: Task | undefined, action: SyncDetailsTaskAction) => {
      if (action.nextResolvedTask) {
        return action.nextResolvedTask;
      }

      if (!action.taskRefId) {
        return undefined;
      }

      if (action.selectedTaskLookup === undefined) {
        return state;
      }

      return undefined;
    },
    resolvedDetailsTask
  );

  useEffect(() => {
    syncDetailsTask({
      nextResolvedTask: resolvedDetailsTask,
      selectedTaskLookup,
      taskRefId,
    });
  }, [resolvedDetailsTask, selectedTaskLookup, taskRefId]);

  // The selected task is resolved project-wide, so the editable task
  // collection must be scoped to its owning list — otherwise descendants of
  // a non-default-list task are missing and the subtask table renders empty
  // (OS-1520).
  const tasksResult = useTasks(
    projectId,
    archiveFilter,
    "all",
    detailsTask?.list?.ref ?? null
  );

  // Both effects below correct the URL, then rely on the corrected URL to stop them re-running. A
  // write that doesn't land (history throttling, a router-restored URL) leaves the condition
  // true, so without a guard the correction retries every commit until React throws #185. Each
  // distinct URL state is attempted once; the ref clears as soon as the URL settles.
  const attemptedTaskCorrectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!taskRefId || selectedTaskLookup === undefined) {
      attemptedTaskCorrectionRef.current = null;
      return;
    }

    const correctionKey = `${taskRefId}:${archiveFilter}`;
    const selectedResult = selectedTaskLookup.results[0]?.task ?? null;
    if (!selectedResult) {
      if (attemptedTaskCorrectionRef.current === correctionKey) {
        return;
      }
      attemptedTaskCorrectionRef.current = correctionKey;
      closeTaskSidebar({ history: "replace" });
      return;
    }

    const expectedArchiveFilter = selectedResult.isArchived ? "archived" : "active";
    if (expectedArchiveFilter === archiveFilter) {
      attemptedTaskCorrectionRef.current = null;
      return;
    }

    if (attemptedTaskCorrectionRef.current === correctionKey) {
      return;
    }
    attemptedTaskCorrectionRef.current = correctionKey;
    navigateToTask(selectedResult.refId, expectedArchiveFilter, {
      history: "replace",
    });
  }, [archiveFilter, closeTaskSidebar, selectedTaskLookup, navigateToTask, taskRefId]);

  const attemptedAttachedTaskClearRef = useRef<string | null>(null);
  useEffect(() => {
    if (!attachedTaskRefId || attachedTaskLookup === undefined) {
      attemptedAttachedTaskClearRef.current = null;
      return;
    }

    if (attachedTaskLookup.results[0]?.task) {
      attemptedAttachedTaskClearRef.current = null;
      return;
    }

    if (attemptedAttachedTaskClearRef.current === attachedTaskRefId) {
      return;
    }
    attemptedAttachedTaskClearRef.current = attachedTaskRefId;
    setAttachedTask(null, { history: "replace" });
  }, [attachedTaskLookup, attachedTaskRefId, setAttachedTask]);

  const allTasks = useMemo(() => {
    if (!detailsTask) {
      return tasksResult.tasks;
    }

    return tasksResult.tasks.some((task) => task._id === detailsTask._id)
      ? tasksResult.tasks
      : [detailsTask, ...tasksResult.tasks];
  }, [detailsTask, tasksResult.tasks]);

  const openTaskByClientId = useCallback(
    (clientId: string) => {
      const task = allTasks.find((candidate) => candidate.clientId === clientId);
      if (!task?.refId) {
        return;
      }

      openTask(task.refId, task.isArchived ? "archived" : "active");
    },
    [allTasks, openTask]
  );

  const allowedStatuses = useMemo(
    () => getAllowedTaskStatuses(projectStatusConfig),
    [projectStatusConfig]
  );

  const taskLinkHref = useCallback(
    (task: Pick<Task, "refId" | "isArchived">) =>
      taskHref(task.refId, task.isArchived ? "archived" : "active"),
    [taskHref]
  );

  return {
    ...urlState,
    // Shadows the raw navigate `urlState` spreads in, so a consumer reaching for
    // either name gets the revealing opener.
    openTask,
    detailsTask,
    attachedTask,
    currentUserId: currentUser?._id ? String(currentUser._id) : undefined,
    allowedStatuses,
    allTasks,
    openTaskByClientId,
    taskLinkHref,
    setTask: openTask,
    setTaskArtifact: selectTaskArtifact,
    setArtifact: selectArtifact,
    closeTaskSidebar,
    setAttachedTask,
    taskOperations: {
      updateTask: tasksResult.updateTask,
      deleteTask: tasksResult.deleteTask,
      addTask: tasksResult.addTask,
      reorderTasks: tasksResult.reorderTasks,
      reorderMultiple: tasksResult.reorderMultiple,
      setParent: tasksResult.setParent,
      setParentMultiple: tasksResult.setParentMultiple,
      bulkUpdateStatus: tasksResult.bulkUpdateStatus,
      bulkUpdateAssignee: tasksResult.bulkUpdateAssignee,
      bulkUpdatePriority: tasksResult.bulkUpdatePriority,
      bulkUpdateDueDate: tasksResult.bulkUpdateDueDate,
      bulkUpdateTaskType: tasksResult.bulkUpdateTaskType,
      moveToList: tasksResult.moveToList,
      bulkArchive: tasksResult.bulkArchive,
      bulkDelete: tasksResult.bulkDelete,
      duplicateTask: tasksResult.duplicateTask,
      unarchiveTask: tasksResult.unarchiveTask,
    },
    inputRefs: tasksResult.inputRefs,
    focusInput: tasksResult.focusInput,
  };
}
