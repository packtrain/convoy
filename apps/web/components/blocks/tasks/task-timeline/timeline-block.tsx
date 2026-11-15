"use client";

import { CommentItem } from "@/components/blocks/tasks/comments";
import type { Id } from "@/convex/_generated/dataModel";
import type { TimelineBlock, TimelineThreadContext } from "@/lib/tasks/timeline/rows";
import { TimelineActivityGroup } from "./timeline-activity-group";
import { TimelineThreadRowCard } from "./timeline-thread-row";

/**
 * One rendered stream block (OS-1589). Each kind delegates to the component that already
 * owns it — the timeline contributes layout, not new presentation.
 *
 * Thread rows need route params for their href, so they are skipped outside a project
 * route rather than rendered dead (where the sidebar also hides the threads toggle).
 */
export function TimelineBlockRow({
  block,
  threadContext,
  onUpdateComment,
  onDeleteComment,
}: {
  block: TimelineBlock;
  threadContext?: TimelineThreadContext;
  onUpdateComment: (commentId: Id<"taskComments">, content: string) => Promise<void>;
  onDeleteComment: (commentId: Id<"taskComments">) => Promise<void>;
}) {
  if (block.kind === "activity-group") {
    return <TimelineActivityGroup activities={block.activities} />;
  }

  if (block.kind === "comment") {
    // The comment *is* the row — not an "added a comment" pointer to it, which
    // is why `comment_added` activity rows are retired.
    return (
      <div className="py-3">
        <CommentItem comment={block.comment} onUpdate={onUpdateComment} onDelete={onDeleteComment} />
      </div>
    );
  }

  if (!threadContext) {
    return null;
  }

  return (
    <TimelineThreadRowCard
      thread={block.thread}
      organizationSlug={threadContext.organizationSlug}
      projectAlias={threadContext.projectAlias}
    />
  );
}
