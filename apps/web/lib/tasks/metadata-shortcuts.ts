import { TASK_TABLE_HOTKEYS } from "@/lib/browser/hotkeys";
import {
  BUILT_IN_TASK_TYPES,
  type BuiltInTaskTypeKey,
} from "@/lib/tasks/task-types";
import { Status } from "@/lib/tasks/types";

export interface StatusShortcutTarget {
  key: string;
  status: Status;
}

export interface TaskTypeShortcutTarget {
  key: string;
  taskTypeKey: BuiltInTaskTypeKey;
}

export const STATUS_SHORTCUT_TARGETS: readonly StatusShortcutTarget[] = [
  { key: "O", status: Status.TODO },
  { key: "T", status: Status.TRIAGE },
  { key: "L", status: Status.PLANNING },
  { key: "V", status: Status.PLAN_REVIEW },
  { key: "P", status: Status.IN_PROGRESS },
  { key: "R", status: Status.IN_REVIEW },
  { key: "B", status: Status.BLOCKED },
  { key: "D", status: Status.DONE },
  { key: "C", status: Status.CANCELED },
] as const;

export const TASK_TYPE_SHORTCUT_TARGETS: readonly TaskTypeShortcutTarget[] = [
  { key: "T", taskTypeKey: "task" },
  { key: "B", taskTypeKey: "bug" },
  { key: "F", taskTypeKey: "feature" },
  { key: "E", taskTypeKey: "epic" },
  { key: "I", taskTypeKey: "investigation" },
  { key: "C", taskTypeKey: "chore" },
  { key: "D", taskTypeKey: "idea" },
] as const;

const TASK_TYPE_NAME_BY_KEY = new Map(
  BUILT_IN_TASK_TYPES.map((taskType) => [taskType.key, taskType.name])
);

export function getStatusShortcutLabel(target: StatusShortcutTarget) {
  return target.status;
}

export function getTaskTypeShortcutLabel(target: TaskTypeShortcutTarget) {
  return TASK_TYPE_NAME_BY_KEY.get(target.taskTypeKey) ?? target.taskTypeKey;
}

export const STATUS_SHORTCUT_KEYS = STATUS_SHORTCUT_TARGETS.map(
  ({ key }) => key
);

export const TASK_TYPE_SHORTCUT_KEYS = TASK_TYPE_SHORTCUT_TARGETS.map(
  ({ key }) => key
);

/** Single-key task property shortcuts (docs/specs/keyboard-navigation.md). */
export type TaskPropertyShortcut =
  | "priority"
  | "assignee"
  | "assignToMe"
  | "label"
  | "dueDate"
  | "moveToList";

export const TASK_PROPERTY_SHORTCUT_KEYS: Readonly<Record<TaskPropertyShortcut, string>> = {
  priority: TASK_TABLE_HOTKEYS.setPriority,
  assignee: TASK_TABLE_HOTKEYS.setAssignee,
  assignToMe: TASK_TABLE_HOTKEYS.assignToMe,
  label: TASK_TABLE_HOTKEYS.setLabel,
  dueDate: TASK_TABLE_HOTKEYS.setDueDate,
  moveToList: TASK_TABLE_HOTKEYS.moveToList,
};

const TASK_PROPERTY_SHORTCUT_BY_KEY = new Map(
  (Object.entries(TASK_PROPERTY_SHORTCUT_KEYS) as [TaskPropertyShortcut, string][]).map(
    ([property, key]) => [key, property]
  )
);

/** The property for a bare key press; modified presses never match. */
export function matchTaskPropertyShortcut(event: KeyboardEvent): TaskPropertyShortcut | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key.length !== 1) {
    return null;
  }
  return TASK_PROPERTY_SHORTCUT_BY_KEY.get(event.key.toUpperCase()) ?? null;
}
