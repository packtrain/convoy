import type { TimelineCursor, TimelineItem, TimelinePage } from "./validators";

/**
 * One source's newest-first read, tagged so `mergeTimelineSources` can tell
 * which source still has rows past the page boundary.
 */
export type TimelineSourceRead = {
  /** Rows this source read, newest first. */
  rows: TimelineItem[];
  /** Per-row cursor position, aligned by index with `rows`. */
  cursors: TimelineCursor[];
  /** How many rows the read asked for; `rows.length === limit` means it capped out. */
  limit: number;
};

/**
 * Newest-first by (`createdAt`, `_creationTime`) — the same total order the
 * `by_task_and_createdAt` index uses, since `_creationTime` is its implicit
 * final field. Matching the index exactly is what makes paging exact.
 *
 * Negative when `a` is newer than `b`.
 */
function compareCursorsDescending(a: TimelineCursor, b: TimelineCursor): number {
  if (a.at !== b.at) return b.at - a.at;
  return b.creationTime - a.creationTime;
}

/**
 * Merge per-source newest-first reads into one page.
 *
 * Exact because every source is index-ordered the way this comparator sorts and the
 * returned cursor is a full position. Deliberately **no** tie-extension: the cursor
 * can resume partway through a millisecond, so a page never exceeds `limit`.
 */
export function mergeTimelineSources(reads: TimelineSourceRead[], limit: number): TimelinePage {
  if (reads.length === 0) {
    return { items: [], nextBefore: null, isDone: true };
  }

  const merged = reads
    .flatMap((read) => read.rows.map((item, index) => ({ item, cursor: read.cursors[index] })))
    .sort((a, b) => compareCursorsDescending(a.cursor, b.cursor));

  const emitted = merged.slice(0, limit);
  const boundary = emitted.at(-1)?.cursor;

  // Structural, not identity-based: a source has more when its read capped out,
  // or when its oldest read row falls past the page boundary. Both are
  // properties of the data, so a future normalization step that copies rows
  // cannot silently break this.
  const anySourceHasMore = reads.some((read) => {
    if (read.rows.length === read.limit) return true;
    const oldest = read.cursors.at(-1);
    if (oldest === undefined) return false;
    if (boundary === undefined) return true;
    return compareCursorsDescending(oldest, boundary) > 0;
  });

  if (boundary === undefined) {
    return { items: [], nextBefore: null, isDone: !anySourceHasMore };
  }

  return {
    items: emitted.map((entry) => entry.item),
    nextBefore: anySourceHasMore ? boundary : null,
    isDone: !anySourceHasMore,
  };
}
