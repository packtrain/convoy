"use client";

import { useCallback, useState } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { appRoute, parseWorktreeChangesTarget, useNavigation, useRouteParams } from "@/lib/navigation";
import { useCreatedThreadHold } from "@/lib/threads/hooks/use-created-thread-hold";
import { useOpenThreadWorkspaceTask } from "@/lib/threads/hooks/use-open-thread-workspace-task";
import { useThreadWorkspaceTaskSidebar } from "@/lib/threads/hooks/use-thread-workspace-task-sidebar";
import {
  DEFAULT_THREAD_TASKS_PANEL_FILTERS,
  type ThreadTasksPanelFilters,
} from "@/components/blocks/thread/thread-tasks-panel";
import { WorktreeChangesView } from "@/components/blocks/worktrees";
import { NewThreadComposerView } from "./new-thread-composer-view";
import { ThreadTaskPane, type ThreadTaskPaneRenderer } from "./thread-task-pane";
import { ThreadWorkspace } from "./thread-workspace";
import { useThreadShellState } from "./use-thread-shell-state";

interface ThreadWorkspaceHostProps {
  project: Doc<"projects">;
  organizationId: Id<"organizations">;
  onSidebarHighlightChange: (highlight: {
    route: Id<"cliThreads">;
    threadId: Id<"cliThreads">;
  }) => void;
}

/**
 * The threads page's outermost persistent layer (OS-1660,
 * docs/specs/thread-groups.md → Page structure): owns the state and the task
 * pane both threads views share, so a first send swaps only the thread column.
 */
export function ThreadWorkspaceHost({
  project,
  organizationId,
  onSidebarHighlightChange,
}: ThreadWorkspaceHostProps) {
  const params = useRouteParams<{
    organizationSlug: string;
    projectAlias: string;
    threadId?: string;
  }>();
  const navigation = useNavigation();
  const threadId = params.threadId as Id<"cliThreads"> | undefined;
  const projectId = project._id;
  // `?view=changes&profileId&pathId` shows a checkout's uncommitted changes in
  // place of the composer (OS-2036); the threads layout reads the same helper.
  const changesTarget = parseWorktreeChangesTarget(navigation.location.search);

  const shell = useThreadShellState();
  const threadWorkspace = useThreadWorkspaceTaskSidebar({
    projectId,
    projectStatusConfig: project,
    // Re-opening the task already in `task=<REF>` changes no param, so the
    // edge-triggered mirrors can't fire — the opener reveals it (OS-1663).
    onOpenTask: shell.revealTaskTab,
  });
  const openTaskInSidebar = useOpenThreadWorkspaceTask(threadWorkspace.setTask);
  const selectedTask = threadWorkspace.detailsTask ?? null;

  // The push the send still needs: hoisting the shell removed its *cost* (no
  // remount), not the need for the URL to name the thread (OS-1660). Held until
  // the created thread renders without placeholders, so the composer — text and
  // all — stays until then (OS-1665).
  const { awaitCreatedThread } = useCreatedThreadHold();
  const handleCreated = useCallback(
    async (newThreadId: Id<"cliThreads">) => {
      await awaitCreatedThread({ threadId: newThreadId });
      // Keeps an open sidebar task open; read live, since the hold may have outlasted a task switch.
      const live = new URLSearchParams(window.location.search);
      const query = new URLSearchParams();
      for (const key of ["task", "artifact", "archived"]) {
        const value = live.get(key);
        if (value) {
          query.set(key, value);
        }
      }
      navigation.push({
        ...appRoute.projectThreadDetail(
          params.organizationSlug,
          params.projectAlias,
          String(newThreadId)
        ),
        query,
      });
    },
    [awaitCreatedThread, navigation, params.organizationSlug, params.projectAlias]
  );
  // Lifted, so a send preserves them: the view swap remounts the panel itself,
  // which owns these and its `useTasks` subscription (OS-1660).
  const [tasksFilters, setTasksFilters] = useState<ThreadTasksPanelFilters>(
    DEFAULT_THREAD_TASKS_PANEL_FILTERS
  );
  const patchTasksFilters = useCallback(
    (patch: Partial<ThreadTasksPanelFilters>) =>
      setTasksFilters((current) => ({ ...current, ...patch })),
    []
  );

  // The pane follows the showing panel, which each view resolves — the host only
  // forwards it (OS-1660).
  const renderTaskPane: ThreadTaskPaneRenderer = (panel, options) => (
    <ThreadTaskPane
      panel={panel}
      onNavigateToThread={options?.onNavigateToThread}
      projectId={projectId}
      project={project}
      threadWorkspace={threadWorkspace}
      openTaskInSidebar={openTaskInSidebar}
      selectedTask={selectedTask}
      organizationSlug={params.organizationSlug}
      projectAlias={params.projectAlias}
      tasksFilters={tasksFilters}
      onTasksFiltersChange={patchTasksFilters}
    />
  );

  if (threadId) {
    return (
      <ThreadWorkspace
        threadId={threadId}
        projectId={projectId}
        project={project}
        shell={shell}
        threadWorkspace={threadWorkspace}
        openTaskInSidebar={openTaskInSidebar}
        renderTaskPane={renderTaskPane}
        onSidebarHighlightChange={onSidebarHighlightChange}
      />
    );
  }

  if (changesTarget) {
    return <WorktreeChangesView profileId={changesTarget.profileId as Id<"cliProfiles">} pathId={changesTarget.pathId} />;
  }

  return (
    <NewThreadComposerView
      projectId={projectId}
      organizationId={organizationId}
      shell={shell}
      threadWorkspace={threadWorkspace}
      selectedTask={selectedTask}
      renderTaskPane={renderTaskPane}
      onOpenTask={openTaskInSidebar}
      onCreated={handleCreated}
    />
  );
}
