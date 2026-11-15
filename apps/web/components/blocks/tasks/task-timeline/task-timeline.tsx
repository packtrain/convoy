"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { api } from "@/convex/_generated/api";
import { useTaskComments } from "@/lib/tasks/hooks/comments/use-task-comments";
import { useTaskTimeline } from "@/lib/tasks/hooks/detail/use-task-timeline";
import {
  buildTimelineThreadRows,
  groupTimelineRows,
  mergeTimelineRows,
  spliceThreadRows,
  type TimelineThreadContext,
} from "@/lib/tasks/timeline/rows";
import type { Task } from "@/lib/tasks/types";
import { getThreadDisplayStatus } from "@/lib/threads/display-status";
import { TimelineBlockRow } from "./timeline-block";
import { TimelineHeader } from "./timeline-header";
import { TaskTimelineComposer, type TimelineComposerMode } from "./task-timeline-composer";
import { useTimelineViewState } from "./use-timeline-view-state";

/**
 * The task detail sidebar's merged feed (OS-1590, `docs/specs/task-timeline.md`):
 * comments, agent threads and activity in one stream, replacing the three tabs and their
 * pinned footer composer.
 *
 * The merge, ordering, grouping and thread splice are pure functions in
 * `lib/tasks/timeline/rows.ts`; pagination is `useTaskTimeline`; the controls are
 * `TimelineHeader`. This component is the wiring plus loading/empty states.
 */

export function TaskTimeline({
  task,
  threadContext,
  composerMode,
  onComposerModeChange,
  threadFocusRequestKey,
  canComment = true,
}: {
  task: Task;
  /** Absent outside a project route: no thread source, no thread composer. */
  threadContext?: TimelineThreadContext;
  composerMode: TimelineComposerMode;
  onComposerModeChange: (mode: TimelineComposerMode) => void;
  threadFocusRequestKey: number;
  canComment?: boolean;
}) {
  const { sources, sortDirection, toggleSource, setSortDirection } = useTimelineViewState();

  const { items, nextBefore, isDone, isLoading, isLoadingMore, loadMore } = useTaskTimeline({
    taskId: task._id,
    sources,
  });

  // The thread source needs a project route to build hrefs, so outside one it is
  // unavailable regardless of the stored pref — which is also why the header
  // hides that toggle rather than showing it dead.
  const threadsEnabled = !!threadContext && sources.threads;

  // With nothing on there is no feed to describe, which the stream region says
  // in its own words: an empty feed the viewer caused is not an empty task.
  const hasEnabledSource = sources.activity || sources.comments || threadsEnabled;

  // The same query the removed Threads tab used, skipped entirely when the thread source is off
  // or unavailable — a disabled source is a read that does not happen, not one filtered
  // afterwards. `threadsEnabled` already implies a `threadContext`; it is re-tested only because
  // that boolean doesn't narrow the optional object for TS.
  const ownThreads = useQuery(
    api.cli.threads.lists.listByAssociatedTask,
    threadsEnabled && threadContext
      ? { projectId: threadContext.projectId, taskId: task._id }
      : "skip"
  );

  // Comment edit/delete only — the timeline paginates through its own cursor,
  // so this hook's pagination arm goes unused here.
  const { updateComment, deleteComment } = useTaskComments(task._id);

  // The scalar, not the `nextBefore` object: it is a fresh identity on every
  // page re-delivery (any comment edit, activity write, or streaming thread
  // tick), and depending on the object re-ran the whole merge — a sort over the
  // full loaded window — even when the floor was unchanged.
  const threadFloor = nextBefore?.at ?? null;

  const blocks = useMemo(() => {
    const threadRows = threadsEnabled
      ? buildTimelineThreadRows({
          // `undefined` while in flight, deliberately not `[]`: the empty own-id
          // set would make the viewer's own threads match the "not mine" test
          // and flash as foreign rows.
          ownThreads,
          agentThreadWork: task.agentThreadWork,
          deriveOwnStatus: getThreadDisplayStatus,
        })
      : [];

    return groupTimelineRows(
      mergeTimelineRows({
        items,
        // Threads load whole, so drop the ones older than the loaded stream —
        // otherwise a year-old thread sits above content not yet fetched.
        threadRows: spliceThreadRows(threadRows, threadFloor),
        direction: sortDirection,
      })
    );
  }, [threadsEnabled, ownThreads, task.agentThreadWork, items, threadFloor, sortDirection]);

  /*
    `Load more` walks backwards in time whichever way the stream reads, so it
    sits at whichever end holds the oldest row: the top in ascending display,
    the bottom in descending. Gated on `isDone` and never on an empty page —
    when the data divides evenly the last content page still reports
    `isDone: false` and the *next* page is the empty one.
  */
  const loadMoreButton = isDone ? null : (
    <Button
      variant="ghost"
      size="sm"
      onClick={loadMore}
      disabled={isLoadingMore}
      className="w-full cursor-pointer"
    >
      {isLoadingMore ? (
        <Spinner
          text="Loading…"
          textPlacement="inline"
          className="text-muted-foreground"
          textClassName="text-current"
        />
      ) : (
        "Load more"
      )}
    </Button>
  );

  const stream = (
    <div key="stream" data-testid="task-timeline-stream-region">
      {/*
        Every source off is the viewer's own doing, so say that rather than
        "No activity yet" — which would read as a claim about the task. Checked
        before the loading state: with nothing enabled there is no page to wait
        for.
      */}
      {!hasEnabledSource ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Every source is hidden. Turn one on to see this task&apos;s activity.
        </p>
      ) : null}

      {hasEnabledSource && isLoading ? <TimelineSkeleton /> : null}

      {/*
        Gated on `isDone` too, not just `isLoading`. `isLoading` goes false the
        moment page 0 resolves, and a resolved page can render zero blocks while
        older rows remain: retired `comment_added` rows are dropped client-side
        (`isRenderableActivity`) and the server does not filter them, so a page
        arrives non-empty and groups to nothing. Without `isDone` that showed
        "No activity yet" directly above a `Load more` button.
      */}
      {hasEnabledSource && !isLoading && isDone && blocks.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">No activity yet</p>
      ) : null}

      {/*
        Rendered whenever the first page has resolved, not only when there are
        blocks: a page can group to zero visible rows with older rows still
        behind it (see the empty state above), and gating this whole section on
        `blocks.length` would strand the reader with no way to reach them.
      */}
      {hasEnabledSource && !isLoading ? (
        <div data-testid="task-timeline-stream" className="px-4 py-2 empty:hidden">
          {sortDirection === "asc" ? loadMoreButton : null}

          {blocks.map((block) => (
            <TimelineBlockRow
              key={block.key}
              block={block}
              threadContext={threadContext}
              onUpdateComment={updateComment}
              onDeleteComment={deleteComment}
            />
          ))}

          {sortDirection === "desc" ? loadMoreButton : null}
        </div>
      ) : null}
    </div>
  );

  const composer = (
    <TaskTimelineComposer
      key="composer"
      task={task}
      threadContext={threadContext}
      mode={composerMode}
      onModeChange={onComposerModeChange}
      threadFocusRequestKey={threadFocusRequestKey}
      sortDirection={sortDirection}
      canComment={canComment}
    />
  );

  /*
    The composer sits at the end the newest row is at: below the stream reading
    oldest-first, above it reading newest-first. So the whole surface reverses
    with the sort, not just the row order.

    Keyed by identity so the flip reorders the existing instances instead of
    reconciling composer-against-stream and remounting both — see
    `TaskTimelineComposer`, whose draft provider and pending uploads a remount
    would discard.

    The header is not in the flip: it labels the section and owns the control
    that does the flipping, so it stays put at the top.
  */
  return (
    <div className="flex flex-col">
      <TimelineHeader
        sources={sources}
        sortDirection={sortDirection}
        onToggleSource={toggleSource}
        onSortDirectionChange={setSortDirection}
        hasThreadSource={!!threadContext}
      />

      {sortDirection === "asc" ? [stream, composer] : [composer, stream]}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div data-testid="task-timeline-loading-skeleton" className="space-y-3 px-4 py-4">
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
