import { Status, type Task, type StatusFilterKey, type AssigneeFilter, type FilterKey } from "./types";
import { taskMatchesAssigneeFilter } from "./assignee-filters";
import { isClosedStatus } from "./status-policy";

/**
 * Check if a task passes the status filter.
 */
function passesStatusFilter(task: Task, statusFilter: StatusFilterKey): boolean {
  switch (statusFilter) {
    case "active":
      return !isClosedStatus(task.status);
    case "done":
      return task.status === Status.DONE;
    case "canceled":
      return task.status === Status.CANCELED;
    case "all":
      return true;
    default: {
      const exhaustiveStatusFilter: never = statusFilter;
      return exhaustiveStatusFilter;
    }
  }
}

/**
 * Check if a task passes the assignee filter.
 */
/**
 * Closed-only status views (`done`/`canceled`) show top-level tasks only. A
 * closed subtask whose parent is filtered out must not be promoted to a root
 * row. This mirrors the server's root-only result for closed statuses now that
 * non-backlog views are filtered client-side (OS-902).
 */
export function isClosedOnlyStatusFilter(statusFilter: StatusFilterKey): boolean {
  return statusFilter === "done" || statusFilter === "canceled";
}

/**
 * Filter a task based on separate status and assignee filters.
 * Both filters must pass for the task to be included.
 */
export function filterTaskByFilters(
  task: Task,
  statusFilter: StatusFilterKey,
  assigneeFilter: AssigneeFilter,
  currentUserId?: string
): boolean {
  if (!passesStatusFilter(task, statusFilter)) return false;
  // Closed-only views are top-level only.
  if (isClosedOnlyStatusFilter(statusFilter) && task.parentId != null) {
    return false;
  }
  return taskMatchesAssigneeFilter(task, assigneeFilter, currentUserId);
}

/**
 * Legacy filter function for backwards compatibility.
 * @deprecated Use filterTaskByFilters with separate status and assignee filters.
 */
export function filterTask(
  task: Task,
  filterKey: FilterKey,
  currentUserId?: string
): boolean {
  // Convert legacy FilterKey to new filter types
  if (filterKey === "assigned") {
    return filterTaskByFilters(task, "all", { type: "me" }, currentUserId);
  }
  return filterTaskByFilters(task, filterKey, null, currentUserId);
}
