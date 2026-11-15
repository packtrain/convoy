import { v, type Infer } from "convex/values";
import { taskActivityLogListItemValidator } from "../activity/validators";
import { taskCommentListItemValidator } from "../comments/validators";

/**
 * Which server-side sources the timeline reads. A disabled source runs no read at
 * all, so a narrowed feed is strictly cheaper (docs/specs/task-timeline.md).
 *
 * `threads` is accepted and ignored: thread rows are sourced client-side, never from
 * this merge. Keeping it means the client passes one source object per call site.
 */
export const timelineSourcesValidator = v.object({
  activity: v.boolean(),
  comments: v.boolean(),
  threads: v.boolean(),
});

/**
 * Composite cursor: the position of the last emitted row.
 *
 * `at` alone is not a position — `createdAt` has no uniqueness (one `update` touching
 * three fields writes three rows in the same millisecond), so a scalar watermark
 * can't resume partway through a millisecond without dropping or repeating rows.
 * `_creationTime` is strictly distinct and orders as every index's implicit last
 * field, making (`at`, `creationTime`) a total order matching the index's own.
 */
export const timelineCursorValidator = v.object({
  at: v.number(),
  creationTime: v.number(),
});

/**
 * One merged row. `at` is the sort key (always `createdAt`) hoisted out of the
 * payload so the client can order without discriminating first.
 */
export const timelineItemValidator = v.union(
  v.object({
    kind: v.literal("activity"),
    at: v.number(),
    activity: taskActivityLogListItemValidator,
  }),
  v.object({
    kind: v.literal("comment"),
    at: v.number(),
    comment: taskCommentListItemValidator,
  })
);

export const timelinePageValidator = v.object({
  items: v.array(timelineItemValidator),
  /** Position to resume from, or null when done. Pass back as `before`. */
  nextBefore: v.union(timelineCursorValidator, v.null()),
  isDone: v.boolean(),
});

export type TimelineSources = Infer<typeof timelineSourcesValidator>;
export type TimelineCursor = Infer<typeof timelineCursorValidator>;
export type TimelineItem = Infer<typeof timelineItemValidator>;
export type TimelinePage = Infer<typeof timelinePageValidator>;

export const EMPTY_TIMELINE_PAGE: TimelinePage = {
  items: [],
  nextBefore: null,
  isDone: true,
};
