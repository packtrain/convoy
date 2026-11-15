"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { Status } from "@/lib/tasks/types";
import type { useTasks } from "@/lib/tasks/hooks/use-tasks";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import type { TaskListResultsController } from "@/components/blocks/project/task-lists/use-task-list-results";
import type { useProjectNavigationState } from "@/lib/navigation";

type ProjectNavigationState = ReturnType<typeof useProjectNavigationState>;
type ActiveTaskResult = ReturnType<typeof useTasks>;

interface ProjectTaskViewsContextValue {
  organizationSlug: string;
  projectAlias: string;
  org: Doc<"organizations">;
  project: Doc<"projects">;
  allowedStatuses: Status[];
  navigationState: ProjectNavigationState;
  selectedList: TaskListItem | null;
  taskListResultsController: TaskListResultsController;
  activeTaskResult: ActiveTaskResult;
  currentMoveSourceListRef: string | null;
  currentUserId?: string;
  /** The List's sections are still loading, so its grouping is not known yet. */
  isListGroupingLoading: boolean;
  showTaskRank: boolean;
  openMembersSettings: () => void;
  openAiAgentsSettings: () => void;
  setHeaderAddTaskAction: (action: (() => void) | null) => void;
  /**
   * Pages report whether their task detail surface is open so shared shell
   * chrome (e.g. the mobile nav bar) can hide behind it.
   */
  setDetailSurfaceOpen: (open: boolean) => void;
}

const ProjectTaskViewsContext =
  createContext<ProjectTaskViewsContextValue | null>(null);

export function ProjectTaskViewsProvider({
  value,
  children,
}: {
  value: ProjectTaskViewsContextValue;
  children: ReactNode;
}) {
  return (
    <ProjectTaskViewsContext.Provider value={value}>
      {children}
    </ProjectTaskViewsContext.Provider>
  );
}

export function useProjectTaskViews() {
  const context = useContext(ProjectTaskViewsContext);

  if (!context) {
    throw new Error("useProjectTaskViews must be used within ProjectTaskViewsProvider");
  }

  return context;
}
