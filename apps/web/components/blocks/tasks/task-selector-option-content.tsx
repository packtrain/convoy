"use client";

import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  PriorityIcon,
  StatusBadge,
} from "@/components/blocks/tasks/task-table/badges";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { TaskListIdentity } from "@/components/blocks/project/task-lists/task-list-identity";
import type { TaskSelectorOption } from "@/lib/tasks/task-selector";

function getPriorityMetadataLabel(priority: TaskSelectorOption["priority"]) {
  return priority === "None" ? "No priority" : priority;
}

export function TaskSelectorOptionContent({
  task,
}: {
  task: TaskSelectorOption;
}) {
  const priorityLabel = getPriorityMetadataLabel(task.priority);

  return (
    <div className="flex min-w-0 w-full items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
        <TaskRefWithType
          refId={task.refId}
          taskType={task.taskType}
          typeVariant="icon"
          className="shrink-0"
          refClassName="text-xs text-muted-foreground"
          refInteractive={false}
        />
        <span className="truncate">{task.name}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="sr-only">
          {`Status: ${task.status}. Priority: ${priorityLabel}.`}
        </span>
        {task.list && (
          <TaskListIdentity list={task.list} variant="badge" />
        )}
        <TooltipExt content={task.status}>
          <span aria-hidden="true" className="inline-flex">
            <StatusBadge status={task.status} variant="compact" />
          </span>
        </TooltipExt>
        <TooltipExt content={priorityLabel}>
          <span aria-hidden="true" className="inline-flex">
            <PriorityIcon priority={task.priority} />
          </span>
        </TooltipExt>
      </div>
    </div>
  );
}
