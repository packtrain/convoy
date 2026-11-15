import type { ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskListItem } from "./task-list-types";

export interface TaskListSystemRow {
  key: string;
  label: string;
  icon: ReactNode;
}

export function resolveDefaultTaskList(
  lists: readonly TaskListItem[],
  defaultListId?: Id<"taskLists"> | null
) {
  return (
    lists.find((list) =>
      defaultListId ? list._id === defaultListId : list.isDefault
    ) ?? null
  );
}

export function matchesTaskListMenuQuery(
  list: Pick<TaskListItem, "name" | "ref">,
  normalizedQuery: string
) {
  return (
    !normalizedQuery ||
    list.name.toLocaleLowerCase().includes(normalizedQuery) ||
    list.ref.toLocaleLowerCase().includes(normalizedQuery)
  );
}

export function filterSystemRows<T extends TaskListSystemRow>(
  systemRows: readonly T[],
  normalizedQuery: string
) {
  if (!normalizedQuery) {
    return [...systemRows];
  }

  return systemRows.filter((row) =>
    row.label.toLocaleLowerCase().includes(normalizedQuery)
  );
}
