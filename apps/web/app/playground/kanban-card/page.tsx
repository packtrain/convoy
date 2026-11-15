"use client";

import { useState } from "react";
import { KanbanCard } from "@/components/blocks/tasks/kanban-card";
import type { KanbanCardItem } from "@/components/blocks/tasks/kanban-card";
import type { Id } from "@/convex/_generated/dataModel";
import { createDefaultTask } from "@/lib/tasks/defaults";
import { Status } from "@/lib/tasks/status";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import type { Priority, Task, TaskUpdate } from "@/lib/tasks/types";

interface CardSeed {
  id: string;
  refNumber: number;
  refId: string;
  name: string;
  description?: string | null;
  status: Status;
  taskTypeKey?: string;
  priority?: Priority;
  assigneeDisplayName?: string | null;
  dueDate?: string;
}

function dateFromIsoDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  return new Date(`${value}T12:00:00.000Z`).getTime();
}

function createBoardSampleTask(seed: CardSeed): Task {
  return {
    _id: seed.id as Id<"tasks">,
    clientId: seed.id,
    ...createDefaultTask({
      refNumber: seed.refNumber,
      refId: seed.refId,
      name: seed.name,
      description: seed.description ?? null,
      status: seed.status,
      taskType: resolveTaskTypeSummary(seed.taskTypeKey),
      priority: seed.priority ?? "None",
      assignee: seed.assigneeDisplayName
        ? {
            type: "user",
            userId: `${seed.id}-assignee` as Id<"users">,
            name: seed.assigneeDisplayName,
            avatarUrl: null,
          }
        : null,
      dueDate: dateFromIsoDate(seed.dueDate),
    }),
  };
}

const fullMetadataTask = createBoardSampleTask({
  id: "playground-full",
  refNumber: 941,
  refId: "OS-941",
  name: "Create real task board card component",
  description: "Render the shared task model directly and keep Board-only metadata explicit.",
  status: Status.IN_PROGRESS,
  taskTypeKey: "feature",
  priority: "High",
  dueDate: "2026-02-05",
  assigneeDisplayName: "Sam Chen",
});

const sparseTask = createBoardSampleTask({
  id: "playground-sparse",
  refNumber: 942,
  refId: "OS-942",
  name: "Sparse task with only required metadata",
  status: Status.TODO,
});

const progressTask = createBoardSampleTask({
  id: "playground-progress",
  refNumber: 943,
  refId: "OS-943",
  name: "Show subtask progress on board cards",
  description: "Display progress only when the caller provides a non-empty progress value.",
  status: Status.IN_REVIEW,
  taskTypeKey: "task",
  priority: "Medium",
  assigneeDisplayName: "Maya Jones",
});

const planningTask = createBoardSampleTask({
  id: "playground-planning",
  refNumber: 944,
  refId: "OS-944",
  name: "Review grouped Planning status presentation",
  description: "Planning groups include multiple statuses, so each card still exposes its exact status.",
  status: Status.PLAN_REVIEW,
  taskTypeKey: "investigation",
  priority: "High",
  assigneeDisplayName: "Anika Khan",
});

const doneTask = createBoardSampleTask({
  id: "playground-done",
  refNumber: 945,
  refId: "OS-945",
  name: "Completed Board card style",
  status: Status.DONE,
  taskTypeKey: "chore",
  assigneeDisplayName: "Jon Lee",
});

const canceledTask = createBoardSampleTask({
  id: "playground-canceled",
  refNumber: 946,
  refId: "OS-946",
  name: "Canceled Board card style",
  status: Status.CANCELED,
  taskTypeKey: "feature",
  priority: "Low",
});

const INITIAL_CARDS: KanbanCardItem[] = [
  { task: fullMetadataTask },
  { task: sparseTask },
  {
    task: progressTask,
    subtaskProgress: { completed: 3, total: 5 },
    presentation: { hideStatus: true },
  },
  {
    task: planningTask,
    presentation: { emphasizeStatus: true },
  },
  {
    task: doneTask,
    subtaskProgress: { completed: 4, total: 4 },
    presentation: { hideStatus: true },
  },
  {
    task: canceledTask,
    presentation: { hideStatus: true },
  },
];

export default function KanbanCardPlaygroundPage() {
  const [cards, setCards] = useState(INITIAL_CARDS);

  const handleTaskUpdate = (
    taskId: KanbanCardItem["task"]["_id"],
    updates: TaskUpdate
  ) => {
    setCards((currentCards) =>
      currentCards.map((card) => {
        if (card.task._id !== taskId) {
          return card;
        }

        const assigneeDisplayUpdates =
          "assignee" in updates
            ? {
                assignee: updates.assigneeDetails ?? null,
              }
            : {};
        const nextAssignee =
          "assignee" in updates
            ? updates.assigneeDetails ?? null
            : card.task.assignee;

        return {
          ...card,
          task: {
            ...card.task,
            ...updates,
            assignee: nextAssignee,
            ...assigneeDisplayUpdates,
          },
        };
      })
    );
  };

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Kanban card</h1>
          <p className="text-sm text-muted-foreground">
            Real task data variants for Board card review.
          </p>
        </header>

        <section className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <KanbanCard
              key={card.task.clientId}
              task={card.task}
              subtaskProgress={card.subtaskProgress}
              presentation={card.presentation}
              onTaskUpdate={handleTaskUpdate}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
