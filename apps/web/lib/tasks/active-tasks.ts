import type { Id } from "@/convex/_generated/dataModel";
import { isClosedStatus } from "@/lib/tasks/status-policy";
import type { Task } from "@/lib/tasks/types";

/** Top-level tasks that are not Done/Canceled. Subtrees follow their root. */
export function getActiveRootTaskIds(tasks: Task[]): Id<"tasks">[] {
  return tasks
    .filter((task) => !task.parentId && !isClosedStatus(task.status))
    .map((task) => task._id as Id<"tasks">);
}
