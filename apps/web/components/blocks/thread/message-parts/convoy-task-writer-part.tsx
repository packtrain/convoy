"use client";

import type { ReactNode } from "react";
import { SquarePen } from "lucide-react";
import { PriorityIcon } from "@/components/blocks/tasks/task-table/badges";
import { TaskLabelChip } from "@/components/blocks/tasks/task-label-picker";
import { TaskExternalLinkLabel } from "@/components/blocks/tasks/task-detail-sidebar/task-detail-links";
import { PRIORITY_CONFIG } from "@/lib/tasks/constants";
import type { Priority } from "@/lib/tasks/types";
import type { ConvoyTaskWriterPayload } from "@/lib/ai-tools/convoy-task-writer-tool";
import { AppLink } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { ToolDebugButton } from "./components/collapsible-tool-part";
import { ToolStateIcon } from "./components/tool-state-icon";
import { ToolSurface } from "./components/tool-surface";
import {
  TaskRefLink,
  openTaskInPlace,
  useTaskRefHref,
} from "./convoy-task-reader-part";

interface ConvoyTaskWriterPartProps {
  payload: ConvoyTaskWriterPayload;
  onDebug?: () => void;
  /** Opens the written task in the host's sidebar (OS-1686). */
  onOpenTask?: (refId: string) => void;
}

function buildTitle(payload: ConvoyTaskWriterPayload): string {
  return [payload.action, payload.refId, payload.detail]
    .filter(Boolean)
    .join(" ");
}

function isKnownPriority(value: string): value is Priority {
  return value in PRIORITY_CONFIG;
}

function PriorityChange({ priority }: { priority: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-foreground">
      <span className="text-muted-foreground">Priority →</span>
      {isKnownPriority(priority) ? <PriorityIcon priority={priority} /> : null}
      {priority}
    </span>
  );
}

function LabelChange({ label }: { label: string | null }) {
  if (label === null) {
    return <span className="text-xs text-muted-foreground">Label cleared</span>;
  }
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Label →</span>
      {/* Real label chip; the project color is not fetched here, so no dot. */}
      <TaskLabelChip label={{ name: label }} />
    </span>
  );
}

/**
 * What the row cannot say in its summary, rendered inline after it (OS-1769):
 * an `update_task`'s changed fields and the written link. Status is skipped —
 * the row's `→ <status>` detail already carries it.
 */
function renderInlineChanges(payload: ConvoyTaskWriterPayload): ReactNode {
  if (payload.link) {
    return <TaskExternalLinkLabel link={payload.link} className="flex-1" />;
  }

  if (
    payload.kind !== "update_task" ||
    !(
      payload.priority ||
      payload.label !== undefined ||
      (payload.changes?.length ?? 0) > 0
    )
  ) {
    return null;
  }

  // One line, never wrapping: a second line holding only the row's right half
  // reads as broken. The compact chips stay whole; the plain-text changes join
  // into a single span that truncates.
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 whitespace-nowrap">
      {payload.priority ? <PriorityChange priority={payload.priority} /> : null}
      {payload.label !== undefined ? (
        <LabelChange label={payload.label} />
      ) : null}
      {payload.changes?.length ? (
        <span className="truncate text-xs text-muted-foreground">
          {payload.changes.join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The only write that still needs a body: a multi-task move, whose moved refs
 * are a list. Everything else fits on the row (OS-1686, OS-1769).
 *
 * A plain function, not a component: the caller drops the surrounding surface
 * when this is null, and a `<CompletedBody />` element would be truthy even
 * when the component itself rendered nothing.
 */
function renderCompletedBody(
  payload: ConvoyTaskWriterPayload,
  onOpenTask?: (refId: string) => void
): ReactNode {
  if (payload.kind === "move_tasks_to_list" && payload.taskRefs?.length) {
    return (
      <div className="flex flex-col gap-1.5">
        {payload.taskRefs.map((refId) => (
          <TaskRefLink key={refId} refId={refId} onOpenTask={onOpenTask} />
        ))}
      </div>
    );
  }

  return null;
}

/**
 * A write is a destination, not a disclosure: the summary row opens the task in
 * the sidebar rather than expanding an accordion (OS-1686). A body renders only
 * when it carries more than the row already says.
 */
export function ConvoyTaskWriterPart({
  payload,
  onDebug,
  onOpenTask,
}: ConvoyTaskWriterPartProps) {
  const title = buildTitle(payload);
  const refId = payload.refId;
  const taskHref = useTaskRefHref(refId ?? "");
  // The changes sit inline after the summary and take the row's spare width, so
  // the (short) summary stops flexing (OS-1769).
  const inlineChanges = renderInlineChanges(payload);
  const rowClassName = cn(
    "flex min-w-0 items-center gap-2 text-left text-sm text-muted-foreground",
    inlineChanges ? "shrink-0" : "flex-1"
  );
  const serverBadge = (
    <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-xs text-muted-foreground">
      {payload.server}
    </span>
  );
  // The row's leading icon carries pending and failed states, so neither needs
  // a body of its own (OS-1769).
  const rowContent = (
    <>
      <ToolStateIcon
        state={payload.state}
        errorText={payload.errorText}
        icon={SquarePen}
      />
      <span className="truncate whitespace-nowrap">{title}</span>
      {serverBadge}
    </>
  );

  const body =
    payload.state === "output-available"
      ? renderCompletedBody(payload, onOpenTask)
      : null;

  return (
    <div className="group/tool flex w-full min-w-0 flex-col gap-1">
      <div className="flex w-full min-w-0 items-center gap-2">
        {refId && taskHref ? (
          <AppLink
            href={taskHref}
            onClick={(event) => openTaskInPlace(event, refId, onOpenTask)}
            className={cn(rowClassName, "cursor-pointer hover:text-foreground")}
          >
            {rowContent}
          </AppLink>
        ) : (
          <div className={rowClassName}>{rowContent}</div>
        )}
        {inlineChanges}
        {onDebug && <ToolDebugButton onDebug={onDebug} />}
      </div>
      {body ? (
        <ToolSurface className="flex flex-col gap-1.5">{body}</ToolSurface>
      ) : null}
    </div>
  );
}
