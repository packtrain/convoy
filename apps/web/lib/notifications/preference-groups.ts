import { NOTIFICATION_TYPES, type NotificationType } from "@/convex/lib/contracts/notifications";

/**
 * UI grouping of notification types for the settings matrix and the per-row
 * settings dropdown (docs/specs/notifications.md). Grouping is presentation
 * only — storage and the fan-out gate stay per-type.
 */
export type NotificationPreferenceGroup = {
  id: "tasks" | "threads";
  label: string;
  types: { type: NotificationType; label: string; description: string }[];
};

// The canonical per-type catalog. `satisfies Record<NotificationType, ...>`
// makes coverage compile-enforced: a new validator literal without an entry
// here fails the build instead of silently missing from the settings UI.
const TYPE_META = {
  "task.created": {
    group: "tasks",
    label: "Task created",
    description: "When someone else creates a task and assigns it to you.",
  },
  "task.status_changed": {
    group: "tasks",
    label: "Status changed",
    description:
      "When someone else changes the status of a task you created or are assigned to. Done and Canceled are covered by Task completed.",
  },
  "task.completed": {
    group: "tasks",
    label: "Task completed",
    description:
      "When someone else moves a task you created or are assigned to into Done or Canceled.",
  },
  "task.assignee_changed": {
    group: "tasks",
    label: "Assignee changed",
    description:
      "When someone else changes the assignee on a task you created, or assigns a task to you.",
  },
  "task.deleted": {
    group: "tasks",
    label: "Task deleted",
    description: "When someone else deletes a task you created or are assigned to.",
  },
  "task.archived": {
    group: "tasks",
    label: "Task archived",
    description: "When someone else archives a task you created or are assigned to.",
  },
  "task.comment_added": {
    group: "tasks",
    label: "New comment",
    description: "When someone else comments on a task you created or are assigned to.",
  },
  "thread.completed": {
    group: "threads",
    label: "Run finished",
    description: "When an agent finishes a run in a thread you own.",
  },
  "thread.failed": {
    group: "threads",
    label: "Run failed",
    description: "When an agent run fails in a thread you own.",
  },
  "thread.waiting_input": {
    group: "threads",
    label: "Waiting for input",
    description: "When an agent in a thread you own needs your input to continue.",
  },
} satisfies Record<NotificationType, { group: "tasks" | "threads"; label: string; description: string }>;

function buildGroup(id: "tasks" | "threads", label: string): NotificationPreferenceGroup {
  return {
    id,
    label,
    types: NOTIFICATION_TYPES.filter((type) => TYPE_META[type].group === id).map((type) => ({
      type,
      label: TYPE_META[type].label,
      description: TYPE_META[type].description,
    })),
  };
}

const TASKS_GROUP = buildGroup("tasks", "Tasks");
const THREADS_GROUP = buildGroup("threads", "Agent runs");

export const NOTIFICATION_PREFERENCE_GROUPS: NotificationPreferenceGroup[] = [TASKS_GROUP, THREADS_GROUP];

/** Total by construction: TYPE_META covers every NotificationType. */
export function groupForNotificationType(type: NotificationType): NotificationPreferenceGroup {
  return TYPE_META[type].group === "tasks" ? TASKS_GROUP : THREADS_GROUP;
}
