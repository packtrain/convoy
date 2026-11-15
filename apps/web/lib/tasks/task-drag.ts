import type { Task } from "@/lib/tasks/types";

// Cross-surface task drag payload. The task table writes it on drag start so
// drop targets outside the table (e.g. sidebar Lists) can accept the drag.
export const TASK_DRAG_MIME = "application/x-convoy-tasks";
const TASK_DRAG_PROJECT_MIME_PREFIX = "application/x-convoy-tasks-project-";

export interface TaskDragPayload {
  projectId: string;
  // Root task ids only; descendants follow their parent server-side.
  taskIds: string[];
  // Root task refIds, index-aligned with taskIds. Optional so payloads from
  // older producers stay valid; consumers needing refs must handle absence.
  taskRefIds?: string[];
}

// DataTransfer values are unreadable during dragover, so the project scope is
// also encoded into the type name for target gating. Browsers lowercase
// custom types; Convex ids are already lowercase, normalize defensively.
function taskDragProjectMime(projectId: string): string {
  return `${TASK_DRAG_PROJECT_MIME_PREFIX}${projectId.toLowerCase()}`;
}

export function setTaskDragPayload(
  dataTransfer: DataTransfer,
  payload: TaskDragPayload
): void {
  dataTransfer.setData(TASK_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData(taskDragProjectMime(payload.projectId), "");
}

export function dragHasTasksForProject(
  dataTransfer: DataTransfer,
  projectId: string
): boolean {
  return dataTransfer.types.includes(taskDragProjectMime(projectId));
}

export function readTaskDragPayload(
  dataTransfer: DataTransfer
): TaskDragPayload | null {
  const raw = dataTransfer.getData(TASK_DRAG_MIME);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  const { projectId, taskIds, taskRefIds } = candidate;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return null;
  }
  if (
    !Array.isArray(taskIds) ||
    taskIds.length === 0 ||
    !taskIds.every((id): id is string => typeof id === "string" && id.length > 0)
  ) {
    return null;
  }

  // Invalid refIds drop only themselves, not the payload — id-based consumers
  // must keep working with payloads from any producer version.
  const validRefIds =
    Array.isArray(taskRefIds) &&
    taskRefIds.length === taskIds.length &&
    taskRefIds.every(
      (ref): ref is string => typeof ref === "string" && ref.length > 0
    )
      ? taskRefIds
      : undefined;

  return validRefIds
    ? { projectId, taskIds, taskRefIds: validRefIds }
    : { projectId, taskIds };
}

// Roots among the dragged rows: tasks whose parent is not also dragged.
// Mirrors getRootSelectedTasks in the task-table controller — children move
// with their parent, so passing them as separate roots would flatten them.
export function getRootDragTasks(
  tasks: Task[],
  draggedClientIds: ReadonlySet<string>
): Task[] {
  const draggedTasks = tasks.filter((task) =>
    draggedClientIds.has(task.clientId)
  );
  const draggedTaskIds = new Set(draggedTasks.map((task) => String(task._id)));
  return draggedTasks.filter(
    (task) => !task.parentId || !draggedTaskIds.has(task.parentId)
  );
}
