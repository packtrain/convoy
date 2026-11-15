import type { Id } from "@/convex/_generated/dataModel";
import type {
  ArchiveFilter,
  Priority,
  Status,
  TaskAssigneeDetails,
  TaskListSummary,
  TaskTypeSummary,
} from "@/lib/tasks/types";

export interface TaskSelectorOption {
  _id: Id<"tasks">;
  parentId: Id<"tasks"> | null;
  refId: string;
  name: string;
  list: TaskListSummary | null;
  taskType: TaskTypeSummary;
  status: Status;
  priority: Priority;
  assignee: TaskAssigneeDetails;
  createdByName: string | null;
  isArchived: boolean;
}

export type TaskSearchSelectHandler = (
  taskRefId: string,
  archiveFilter: ArchiveFilter,
  listRef: string | null
) => void;

export type TaskSearchHrefBuilder = (
  taskRefId: string,
  archiveFilter: ArchiveFilter,
  listRef: string | null
) => string;

export function getTaskSelectorArchiveFilter(
  task: Pick<TaskSelectorOption, "isArchived">
): ArchiveFilter {
  return task.isArchived ? "archived" : "active";
}

export function getTaskSelectorListRef(
  task: Pick<TaskSelectorOption, "isArchived" | "list">
): string | null {
  if (task.isArchived) {
    return null;
  }

  return task.list?.ref ?? null;
}
