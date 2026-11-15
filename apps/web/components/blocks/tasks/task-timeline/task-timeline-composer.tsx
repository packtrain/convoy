"use client";

import { MessageSquare, MessageSquareMore } from "lucide-react";
import { CommentComposer } from "@/components/blocks/tasks/comments";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import type { TimelineSortDirection, TimelineThreadContext } from "@/lib/tasks/timeline/rows";
import type { Task } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { VIEW_ONLY_REASON } from "@/lib/authz/use-project-permissions";
import { COMPOSER_TRIGGER_RAIL_PADDING_CLASS } from "./rail-geometry";

/**
* The timeline's in-stream composer (OS-1590, `docs/specs/task-timeline.md`). One open at a time,
* the other collapsed to a trigger row; this contributes the swap and nothing else.
*
* Both stay **mounted** when collapsed, hidden with `hidden`: unmounting the comment composer
* would drop its pending uploads, the thread composer its draft provider. The collapsed trigger
* sits on the stream side, so it reads as the next thing after the newest row in either sort
* direction.
*/
export type TimelineComposerMode = "comment" | "thread";

export function TaskTimelineComposer({
  task,
  threadContext,
  mode,
  onModeChange,
  threadFocusRequestKey,
  sortDirection,
  canComment = true,
}: {
  task: Task;
  /** Absent outside a project route, where the thread side is unavailable. */
  threadContext?: TimelineThreadContext;
  mode: TimelineComposerMode;
  onModeChange: (mode: TimelineComposerMode) => void;
  threadFocusRequestKey: number;
  /**
   * Which way the stream reads. Flips this block's internal order so the
   * trigger row always faces the stream.
   */
  sortDirection: TimelineSortDirection;
  /** False for read-only viewers: the comment side is not mounted. */
  canComment?: boolean;
}) {
  // A view-only caller gets one line, not a dead input (docs/specs/read-only-viewer-ux.md).
  if (!canComment && !threadContext) {
    return (
      <p className={cn("px-4 text-sm text-muted-foreground", sortDirection === "asc" && "pb-4")}>
        {VIEW_ONLY_REASON}
      </p>
    );
  }

  // With only one side there is nothing to swap to, so it is the whole
  // composer and needs no trigger row.
  const resolvedMode = !threadContext ? "comment" : !canComment ? "thread" : mode;

  /*
    Both blocks are keyed by **identity, not position**. Reordering a keyless (or
    index-keyed) array would make React reconcile the trigger against the
    composers at slot 0 and remount both — dropping in-flight attachment uploads
    and tearing down the draft provider, which is the exact failure the
    stay-mounted rule above exists to prevent. A keyed reorder moves the
    existing instances.
  */
  const trigger = !threadContext || !canComment ? null : resolvedMode === "thread" ? (
    <ComposerTrigger
      key="trigger"
      icon={MessageSquare}
      label="Add comment..."
      onClick={() => onModeChange("comment")}
    />
  ) : (
    <ComposerTrigger
      key="trigger"
      icon={MessageSquareMore}
      label="Start a thread..."
      onClick={() => onModeChange("thread")}
    />
  );

  const composers = (
    <div key="composers">
      {canComment ? (
        <div className={resolvedMode === "comment" ? "block" : "hidden"}>
          <CommentComposer
            taskId={task._id}
            disabled={task.isArchived}
            // The composer owns the sidebar footer's chrome; in-stream it needs
            // neither the rule nor the padding.
            className="border-t-0 p-0"
          />
        </div>
      ) : null}

      {threadContext ? (
        <div className={resolvedMode === "thread" ? "block" : "hidden"}>
          <TaskThreadComposer
            projectId={threadContext.projectId}
            organizationSlug={threadContext.organizationSlug}
            projectAlias={threadContext.projectAlias}
            task={task}
            focusRequestKey={threadFocusRequestKey}
            composerContainerClassName="p-0"
            composerTextareaClassName="min-h-[88px] p-3"
          />
        </div>
      ) : null}
    </div>
  );

  /*
    Reading newest-first puts this whole block above the stream, so its parts
    invert too: open composer at the outer edge against the panel boundary,
    trigger row on the stream side facing the rows. One flip of one array —
    writing the two orders out as separate JSX branches would let the composers'
    props drift between them.

    Reading oldest-first the composer closes the panel, so it needs the bottom
    padding to sit off the boundary. Reading newest-first it opens the panel
    directly under the header, which already carries its own bottom spacing —
    adding top padding here on top of that leaves a visible gap.
  */
  return (
    <div className={cn("space-y-2 px-4", sortDirection === "asc" && "pb-4")}>
      {sortDirection === "asc" ? [trigger, composers] : [composers, trigger]}
    </div>
  );
}

/** The collapsed side: a row that swaps the other composer in. */
function ComposerTrigger({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      /*
        The left padding centers this icon on the activity rail's gutter column
        rather than flush-left, so the composer reads as part of the same stream.
        Its arithmetic lives in `rail-geometry.ts`.
      */
      className={cn(
        COMPOSER_TRIGGER_RAIL_PADDING_CLASS,
        "flex cursor-pointer items-center gap-2.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}
