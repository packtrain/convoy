import type { Id } from "@/convex/_generated/dataModel";
import {
  appRoute,
  href,
  withProjectTaskAndArchive,
} from "@/lib/navigation";
import type { TaskTypeSummary } from "@/lib/tasks/task-types";

export interface ThreadTaskSummary {
  _id: Id<"tasks">;
  refId: string;
  name: string;
  taskType: TaskTypeSummary;
  isArchived: boolean;
}

export function buildProjectTaskUrl(
  organizationSlug: string,
  projectAlias: string,
  task: ThreadTaskSummary
): string {
  return href(withProjectTaskAndArchive(
    appRoute.project(organizationSlug, projectAlias).pathname,
    {},
    task.refId,
    task.isArchived
  ));
}

export function areThreadTasksEqual(
  previousTask: ThreadTaskSummary | undefined,
  nextTask: ThreadTaskSummary | undefined
) {
  if (previousTask === nextTask) {
    return true;
  }

  if (!previousTask || !nextTask) {
    return false;
  }

  return (
    previousTask._id === nextTask._id &&
    previousTask.refId === nextTask.refId &&
    previousTask.name === nextTask.name &&
    previousTask.isArchived === nextTask.isArchived &&
    previousTask.taskType.key === nextTask.taskType.key &&
    previousTask.taskType.name === nextTask.taskType.name &&
    previousTask.taskType.icon === nextTask.taskType.icon &&
    previousTask.taskType.color === nextTask.taskType.color &&
    previousTask.taskType.isSystem === nextTask.taskType.isSystem
  );
}
