"use client";

import { useMemo, type ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getHiddenTaskTableColumns } from "@/lib/tasks/task-table-columns";
import type { ThreadWorkspaceTaskTarget } from "@/lib/threads/hooks/use-open-thread-workspace-task";
import type { ThreadWorkspaceTaskSidebar } from "@/lib/threads/hooks/use-thread-workspace-task-sidebar";
import {
  ThreadTasksPanel,
  type ThreadTasksPanelFilters,
} from "@/components/blocks/thread/thread-tasks-panel";
import { TaskDetailSidebar } from "@/components/blocks/tasks/task-detail-sidebar";

/**
 * How the host hands the shared pane down: the panel to show, plus the thread
 * switch only the thread view can supply (OS-1716).
 */
export type ThreadTaskPaneRenderer = (
  panel: "tasks" | "task",
  options?: { onNavigateToThread?: (threadId: Id<"cliThreads">) => void }
) => ReactNode;

interface ThreadTaskPaneProps {
  projectId: Id<"projects">;
  project: Doc<"projects"> | null | undefined;
  threadWorkspace: ThreadWorkspaceTaskSidebar;
  openTaskInSidebar: (task: ThreadWorkspaceTaskTarget) => void;
  /** Task details resolved for the `task` tab, or null while it loads. */
  selectedTask: ThreadWorkspaceTaskSidebar["detailsTask"] | null;
  /**
   * Which half to show. The task selection alone can't decide it: `task=<REF>`
   * stays set while the user switches to the Tasks tab, and reading only that
   * rendered the task's details under it (OS-1660).
   */
  panel: "tasks" | "task";
  organizationSlug: string;
  projectAlias: string;
  /** Lifted so the filters and the `useTasks` subscription survive a send. */
  tasksFilters: ThreadTasksPanelFilters;
  onTasksFiltersChange: (patch: Partial<ThreadTasksPanelFilters>) => void;
  /**
   * Host-owned thread switch for the open artifact's send action: it keeps the
   * query string (so the artifact stays open) and selects the tab when the
   * destination is a Group child (OS-1716).
   */
  onNavigateToThread?: (threadId: Id<"cliThreads">) => void;
}

/**
 * The task half of the threads pane — the Tasks list, or one task's details.
 * Rendered from a single position in `ThreadWorkspaceHost` so a first send
 * doesn't remount it: it owns its filters and its `useTasks` subscription, and
 * preserving those needs one render position, not just one hook instance
 * (OS-1660, docs/specs/cli-thread-detail-sidebar.md).
 */
export function ThreadTaskPane({
  projectId,
  project,
  threadWorkspace,
  openTaskInSidebar,
  selectedTask,
  panel,
  organizationSlug,
  projectAlias,
  tasksFilters,
  onTasksFiltersChange,
  onNavigateToThread,
}: ThreadTaskPaneProps) {
  const hiddenTaskTableColumns = useMemo(
    () => getHiddenTaskTableColumns(project?.hiddenTaskTableColumns),
    [project?.hiddenTaskTableColumns]
  );

  if (panel === "task" && selectedTask) {
    return (
      <TaskDetailSidebar
        task={selectedTask}
        onClose={threadWorkspace.closeTaskSidebar}
        projectId={projectId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        allowedStatuses={threadWorkspace.allowedStatuses}
        allTasks={threadWorkspace.allTasks}
        taskOperations={threadWorkspace.taskOperations}
        inputRefs={threadWorkspace.inputRefs}
        focusInput={threadWorkspace.focusInput}
        currentUserId={threadWorkspace.currentUserId}
        onOpenSubtask={threadWorkspace.openTaskByClientId}
        selectedArtifactId={threadWorkspace.artifactId}
        onSelectArtifact={(selectedArtifactId) =>
          threadWorkspace.setTaskArtifact(
            selectedTask.refId,
            selectedArtifactId,
            threadWorkspace.archiveFilter
          )
        }
        onClearArtifactSelection={() => threadWorkspace.setArtifact(null)}
        onNavigateToThread={onNavigateToThread}
        artifactPanelCompact
        headerVariant="thread-workspace"
      />
    );
  }

  return (
    <ThreadTasksPanel
      projectId={projectId}
      filters={tasksFilters}
      onFiltersChange={onTasksFiltersChange}
      defaultListId={project?.defaultListId ?? null}
      hiddenTaskTableColumns={hiddenTaskTableColumns}
      allowedStatuses={threadWorkspace.allowedStatuses}
      currentUserId={threadWorkspace.currentUserId}
      onOpenTask={openTaskInSidebar}
    />
  );
}
