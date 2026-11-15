"use client";

// Isolated Board touch-testing page: swipe between columns, scroll cards,
// long-press to drag. Reorders and cross-group moves apply to local state so
// drops behave like the real board. Not linked from anywhere.
import { useCallback, useState } from "react";
import { KanbanBoard } from "../../o/[organizationSlug]/[projectAlias]/(task-views)/kanban/kanban-board";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { Status } from "@/lib/tasks/status";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  ReorderPosition,
  Task,
  TaskUpdate,
} from "@/lib/tasks/types";

function makeTask(id: number, status: Status, rank: string): Task {
  return {
    _id: `task-${id}` as Id<"tasks">,
    clientId: `task-${id}`,
    ...createDefaultTask({
      refNumber: id,
      refId: `PG-${id}`,
      name: `Playground task ${id}`,
      description: null,
      status,
      taskType: resolveTaskTypeSummary("task"),
      priority: "None",
      rank,
    }),
  };
}

const STATUSES = [
  Status.TODO,
  Status.PLANNING,
  Status.IN_PROGRESS,
  Status.IN_REVIEW,
  Status.BLOCKED,
  Status.DONE,
];

const INITIAL_TASKS: Task[] = Array.from({ length: 30 }, (_, i) =>
  makeTask(
    i + 1,
    STATUSES[i % STATUSES.length],
    `a${String(i).padStart(3, "0")}`
  )
);

function withReassignedRanks(tasks: Task[]): Task[] {
  return tasks.map((task, index) => ({
    ...task,
    rank: `a${String(index).padStart(3, "0")}`,
  }));
}

function reorderList(
  tasks: Task[],
  sourceId: string,
  targetId: string,
  position: ReorderPosition
): Task[] {
  const list = [...tasks];
  const fromIndex = list.findIndex((task) => task._id === sourceId);
  if (fromIndex === -1) {
    return tasks;
  }

  const [moved] = list.splice(fromIndex, 1);
  const targetIndex = list.findIndex((task) => task._id === targetId);
  if (targetIndex === -1) {
    return tasks;
  }

  list.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, moved);
  return withReassignedRanks(list);
}

export default function BoardTouchPlaygroundPage() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);

  const handleReorder = useCallback(
    (
      sourceId: string,
      targetId: string,
      _parentId?: string | null,
      position: ReorderPosition = "before"
    ) => {
      setTasks((prev) => reorderList(prev, sourceId, targetId, position));
    },
    []
  );

  const handleMove = useCallback(
    (
      sourceId: string,
      updates: TaskUpdate,
      rankTarget?: { targetTaskId: string; position: ReorderPosition }
    ) => {
      setTasks((prev) => {
        const next = prev.map((task) =>
          task._id === sourceId
            ? {
                ...task,
                ...(updates.status !== undefined && { status: updates.status }),
                ...(updates.priority !== undefined && {
                  priority: updates.priority,
                }),
              }
            : task
        );
        return rankTarget
          ? reorderList(next, sourceId, rankTarget.targetTaskId, rankTarget.position)
          : next;
      });
    },
    []
  );

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <div
        className="border-b border-border px-3 py-2 text-sm"
        data-testid="board-touch-header"
      >
        Board touch playground
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <KanbanBoard
          tasks={tasks}
          onTaskReorder={handleReorder}
          onTaskMove={handleMove}
        />
      </div>
    </div>
  );
}
