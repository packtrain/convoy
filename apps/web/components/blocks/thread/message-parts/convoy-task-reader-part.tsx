"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { ListTodo } from "lucide-react";
import { StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { STATUS_CONFIG } from "@/lib/tasks/constants";
import type { Status } from "@/lib/tasks/types";
import type {
  ConvoyTaskReaderPayload,
  ConvoyTaskSummary,
} from "@/lib/ai-tools/convoy-task-reader-tool";
import { TASK_REF_PATTERN } from "@/lib/ai-tools/convoy-task-writer-tool";
import {
  AppLink,
  appRoute,
  href,
  shouldHandleInPlaceNavigation,
  useRouteParams,
  withProjectTaskAndArchive,
} from "@/lib/navigation";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolSurface } from "./components/tool-surface";

interface ConvoyTaskReaderPartProps {
  payload: ConvoyTaskReaderPayload;
  onDebug?: () => void;
  /** Opens the task in the host's sidebar instead of navigating (OS-1686). */
  onOpenTask?: (refId: string) => void;
}

const KIND_TITLES: Record<ConvoyTaskReaderPayload["kind"], string> = {
  get_task: "Get task",
  get_tasks: "Get tasks",
  list_tasks: "List tasks",
  search_tasks: "Search tasks",
};

function isKnownStatus(value: string): value is Status {
  return value in STATUS_CONFIG;
}

function buildTitle(payload: ConvoyTaskReaderPayload): string {
  const base = KIND_TITLES[payload.kind];
  return payload.inputHint ? `${base} ${payload.inputHint}` : base;
}

/**
 * Builds the project task URL for a ref, or null when it cannot be linked:
 * writers may pass raw Convex ids, and the URL needs project route params.
 */
export function useTaskRefHref(refId: string): string | null {
  const params = useRouteParams<{
    organizationSlug?: string;
    projectAlias?: string;
  }>();
  const organizationSlug = params?.organizationSlug;
  const projectAlias = params?.projectAlias;

  if (!organizationSlug || !projectAlias || !TASK_REF_PATTERN.test(refId)) {
    return null;
  }

  return href(
    withProjectTaskAndArchive(
      appRoute.project(organizationSlug, projectAlias).pathname,
      {},
      refId,
      false
    )
  );
}

/**
 * Opens the task in the host's sidebar on a plain left click. The `href` stays
 * the real page URL, so ⌘/ctrl-click, middle click and "copy link address" are
 * untouched (OS-1686, same contract as the artifact links).
 */
export function openTaskInPlace(
  event: ReactMouseEvent<HTMLAnchorElement>,
  refId: string,
  onOpenTask?: (refId: string) => void
) {
  if (!onOpenTask || !shouldHandleInPlaceNavigation(event)) {
    return;
  }
  event.preventDefault();
  onOpenTask(refId);
}

export function TaskRefLink({
  refId,
  onOpenTask,
}: {
  refId: string;
  onOpenTask?: (refId: string) => void;
}) {
  const taskHref = useTaskRefHref(refId);
  const className = "shrink-0 text-xs font-medium text-muted-foreground";

  if (!taskHref) {
    return <span className={className}>{refId}</span>;
  }

  return (
    <AppLink
      href={taskHref}
      onClick={(event) => openTaskInPlace(event, refId, onOpenTask)}
      className={`${className} cursor-pointer transition-colors hover:text-foreground hover:underline`}
    >
      {refId}
    </AppLink>
  );
}

function TaskRow({
  task,
  onOpenTask,
}: {
  task: ConvoyTaskSummary;
  onOpenTask?: (refId: string) => void;
}) {
  const status =
    task.status && isKnownStatus(task.status) ? task.status : undefined;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {status ? (
        <StatusIcon status={status} className="size-3.5 shrink-0" />
      ) : null}
      <TaskRefLink refId={task.refId} onOpenTask={onOpenTask} />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {task.name}
      </span>
      {task.listName ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {task.listName}
        </span>
      ) : null}
    </div>
  );
}

export function ConvoyTaskReaderPart({
  payload,
  onDebug,
  onOpenTask,
}: ConvoyTaskReaderPartProps) {
  const taskCount = payload.tasks?.length;

  return (
    <CollapsibleToolPart
      icon={ListTodo}
      title={buildTitle(payload)}
      trailing={
        <>
          {taskCount !== undefined && payload.kind !== "get_task" ? (
            <span className="shrink-0 text-xs text-muted-foreground/70">
              {taskCount} {taskCount === 1 ? "task" : "tasks"}
            </span>
          ) : null}
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground">
            {payload.server}
          </span>
        </>
      }
      state={payload.state}
      errorText={payload.errorText}
      onDebug={onDebug}
      // Pending and failed reads have no rows to disclose (OS-1769).
      hasBody={payload.tasks !== undefined}
      renderChildren={() => (
        <ToolSurface className="flex flex-col gap-1.5">
          {payload.tasks === undefined ? null : (
            <>
              {payload.tasks.length === 0 &&
              !payload.unresolvedIdentifiers?.length ? (
                <p className="text-xs text-muted-foreground">No tasks found</p>
              ) : null}
              {payload.tasks.map((task) => (
                <TaskRow
                  key={task.refId}
                  task={task}
                  onOpenTask={onOpenTask}
                />
              ))}
              {payload.unresolvedIdentifiers?.map((identifier) => (
                <p
                  key={identifier}
                  className="text-xs text-muted-foreground"
                >
                  {identifier} — not found
                </p>
              ))}
            </>
          )}
        </ToolSurface>
      )}
    />
  );
}
