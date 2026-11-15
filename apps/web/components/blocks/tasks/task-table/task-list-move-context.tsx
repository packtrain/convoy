"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useResolvedTaskListResultsController,
  type TaskListResultsController,
} from "@/components/blocks/project/task-lists/use-task-list-results";

interface TaskListMoveContextValue {
  projectId?: Id<"projects">;
  selectedListRef: string | null;
  resultsController?: TaskListResultsController;
  moveTaskToList?: (taskId: string, listRef: string, sectionId?: Id<"taskSections">) => void;
  moveSelectionToList?: (listRef: string, sectionId?: Id<"taskSections">) => void;
  isEnabled: boolean;
}

interface TaskListMoveProviderProps {
  children: ReactNode;
  projectId?: Id<"projects">;
  enabled: boolean;
  resultsController?: TaskListResultsController;
  selectedListRef: string | null;
  moveTaskToList?: (taskId: string, listRef: string, sectionId?: Id<"taskSections">) => void;
  moveSelectionToList?: (listRef: string, sectionId?: Id<"taskSections">) => void;
}

const TaskListMoveContext = createContext<TaskListMoveContextValue | null>(null);

export function TaskListMoveProvider({
  children,
  projectId,
  enabled,
  resultsController: providedResultsController,
  selectedListRef,
  moveTaskToList,
  moveSelectionToList,
}: TaskListMoveProviderProps) {
  const isEnabled = enabled && projectId !== undefined;
  const resultsController = useResolvedTaskListResultsController({
    projectId,
    resultsController: providedResultsController,
    enabled: isEnabled,
  });
  const value = useMemo<TaskListMoveContextValue>(
    () => ({
      projectId,
      selectedListRef,
      resultsController: isEnabled ? resultsController : undefined,
      moveTaskToList: isEnabled ? moveTaskToList : undefined,
      moveSelectionToList: isEnabled ? moveSelectionToList : undefined,
      isEnabled,
    }),
    [
      isEnabled,
      moveSelectionToList,
      moveTaskToList,
      projectId,
      resultsController,
      selectedListRef,
    ]
  );

  return (
    <TaskListMoveContext.Provider value={value}>
      {children}
    </TaskListMoveContext.Provider>
  );
}

export function useTaskListMove(fallback?: TaskListMoveContextValue) {
  const value = useContext(TaskListMoveContext);
  if (value) {
    return value;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error("useTaskListMove must be used within TaskListMoveProvider");
}
