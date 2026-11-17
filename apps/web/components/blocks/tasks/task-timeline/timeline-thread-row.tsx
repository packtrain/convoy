"use client";

import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import { ThreadWorkflowRowBadge } from "@/components/blocks/thread/thread-workflow-row-badge";
import { AppLink, appRoute } from "@/lib/navigation";
import { slashCommandDisplayText } from "@/lib/slash-commands/display";
import type { TimelineThreadRow } from "@/lib/tasks/timeline/rows";
import { cn } from "@/lib/utils";
import { THREAD_CARD_RAIL_OFFSET_CLASS } from "./rail-geometry";

/**
* A thread in the timeline: the same `CompactThreadRowContent` the Threads field and Runs
* popover use, in a bordered card so a thread reads as an object in the stream rather than
* another activity line (OS-1589). `forceStatusIndicator` and `showStatusLabel` are on because
* in a mixed stream the glyph alone isn't enough — a completed run's indicator is a blank.
*
* Every row is clickable, **including a foreign thread that is not shared** — that row lands
* on `Thread not found`. Pre-empting it would mean denormalizing `sharedAt` onto
* `agentThreadWork`: a drift class and an extra hot-path write, to avoid a dead end reached
* only by clicking someone else's unshared run.
*/
/** Back-to-back cards join into one rounded group with dividers between them. */
const STACKED_CARD_CLASS =
  "py-1 [[data-timeline-thread-card]+&]:pt-0 [[data-timeline-thread-card]+&]:*:rounded-t-none [[data-timeline-thread-card]+&]:*:border-t-0 has-[+[data-timeline-thread-card]]:pb-0 has-[+[data-timeline-thread-card]]:*:rounded-b-none";

export function TimelineThreadRowCard({
  thread,
  organizationSlug,
  projectAlias,
}: {
  thread: TimelineThreadRow;
  organizationSlug: string;
  projectAlias: string;
}) {
  const label = slashCommandDisplayText(thread.title || "New thread");

  return (
    /*
      Seats the card's status dot on the activity rail's icon column — the line
      every other row in the stream hangs off. The offset and its arithmetic live
      in `rail-geometry.ts`; it comes off *both* sides so the card only shifts,
      staying symmetric in the sidebar rather than looking indented.
    */
    <div data-timeline-thread-card className={cn(THREAD_CARD_RAIL_OFFSET_CLASS, STACKED_CARD_CLASS)}>
      <div className="group relative rounded-md border border-border bg-card transition-colors hover:bg-muted">
        {/*
          The link is a positioned overlay rather than a wrapper, matching
          `ThreadListItem`: the row content is `pointer-events-none`, so
          anything interactive inside it can opt back in without nesting
          controls in an anchor.
        */}
        <AppLink href={appRoute.projectThreadDetail(organizationSlug, projectAlias, String(thread.threadId))} className="absolute inset-0 z-0">
          <span className="sr-only">Open thread {label}</span>
        </AppLink>
        <CompactThreadRowContent
          title={thread.title}
          status={thread.status}
          cliType={thread.cliType}
          // Displays "2m" from last activity while the stream sorts the row by
          // `createdAt` — deliberately different values; see the spec's
          // Ordering section before "fixing" one to match the other.
          lastActivityAt={thread.lastActivityAt}
          // The blue unread dot and the done check, the same two the Threads
          // field and thread list show. Both are per-viewer state that only an
          // own thread carries.
          isUnread={thread.hasUnread}
          isDone={thread.isDone}
          forceStatusIndicator
          // A thread is the only row kind in the stream whose state outlives
          // its own creation, and the glyph alone doesn't carry it — a
          // completed run's indicator is a blank spacer, so an unlabelled card
          // said nothing at all about how the run ended.
          showStatusLabel
          // Present only on another user's thread; the owner's name is the whole
          // attribution (no avatar, no message count).
          userName={thread.userName}
          // The stream mixes plain threads with workflow rows and nothing else
          // tells them apart (OS-1879). Plain glyph — no color, no link.
          titlePrefix={thread.isWorkflowRun ? <ThreadWorkflowRowBadge /> : undefined}
        />
      </div>
    </div>
  );
}
