export const PROJECT_TASK_TABLE_COLUMNS = [
  { id: "priority", label: "Priority" },
  { id: "assignee", label: "Assignee" },
  { id: "label", label: "Label" },
  { id: "dueDate", label: "Due date" },
  { id: "tags", label: "Tags" },
] as const;

export type TaskTableColumnId =
  (typeof PROJECT_TASK_TABLE_COLUMNS)[number]["id"];

export type ProjectTaskTableColumnConfig = {
  id: TaskTableColumnId;
  label: string;
};

export const CONFIGURABLE_TASK_TABLE_COLUMNS: readonly TaskTableColumnId[] =
  PROJECT_TASK_TABLE_COLUMNS.map((column) => column.id);

const TASK_TABLE_COLUMN_SET: ReadonlySet<string> = new Set(
  CONFIGURABLE_TASK_TABLE_COLUMNS
);

export function isTaskTableColumnId(
  value: unknown
): value is TaskTableColumnId {
  return typeof value === "string" && TASK_TABLE_COLUMN_SET.has(value);
}

/** Hidden for projects that never saved a visibility setting. Spec: docs/specs/task-table-column-visibility.md */
export const DEFAULT_HIDDEN_TASK_TABLE_COLUMNS: readonly TaskTableColumnId[] = ["tags"];

export function getHiddenTaskTableColumns(
  columnIds?: readonly TaskTableColumnId[] | null
): TaskTableColumnId[] {
  return normalizeHiddenTaskTableColumns(
    (columnIds ?? DEFAULT_HIDDEN_TASK_TABLE_COLUMNS).filter(isTaskTableColumnId)
  );
}

export function normalizeHiddenTaskTableColumns(
  columnIds: readonly TaskTableColumnId[]
): TaskTableColumnId[] {
  const hiddenSet = new Set(columnIds);
  return CONFIGURABLE_TASK_TABLE_COLUMNS.filter((columnId) =>
    hiddenSet.has(columnId)
  );
}
