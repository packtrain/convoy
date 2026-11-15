import type { Id } from "@/convex/_generated/dataModel";
import { THREAD_BATCH_ACTION_MAX } from "./constants";

/**
 * Canonical thread batch-selection state shared by Watch Tower and the
 * project thread sidebar (OS-1255, OS-1249). Pure transitions only — owners
 * keep their own React state and any extra scoping (e.g. Watch Tower
 * sections) around it.
 */
export interface ThreadBatchSelection {
  ids: Id<"cliThreads">[];
  anchorId: Id<"cliThreads"> | null;
}

export const EMPTY_THREAD_BATCH_SELECTION: ThreadBatchSelection = {
  ids: [],
  anchorId: null,
};

/**
 * Toggle a thread in the selection. Shift+click selects the visible range
 * from the last anchor; the clicked thread always becomes the new anchor.
 */
export function toggleThreadBatchSelection(
  base: ThreadBatchSelection,
  orderedVisibleIds: Id<"cliThreads">[],
  threadId: Id<"cliThreads">,
  shiftKey: boolean
): ThreadBatchSelection {
  const anchorIndex = base.anchorId
    ? orderedVisibleIds.indexOf(base.anchorId)
    : -1;
  const targetIndex = orderedVisibleIds.indexOf(threadId);
  let ids: Id<"cliThreads">[];
  if (shiftKey && anchorIndex !== -1 && targetIndex !== -1) {
    const [from, to] =
      anchorIndex < targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];
    ids = [...new Set([...base.ids, ...orderedVisibleIds.slice(from, to + 1)])];
  } else if (base.ids.includes(threadId)) {
    ids = base.ids.filter((id) => id !== threadId);
  } else {
    ids = [...base.ids, threadId];
  }
  // ponytail: silently clamp at the batch cap; owners show "(max)" in their header
  ids = ids.slice(0, THREAD_BATCH_ACTION_MAX);
  return { ids, anchorId: threadId };
}

/**
 * Reactive updates can remove or move selected threads; intersecting keeps
 * counts and action payloads scoped to what is actually rendered.
 */
export function intersectVisibleThreadIds(
  selectedIds: Id<"cliThreads">[],
  visibleIds: Id<"cliThreads">[]
): Id<"cliThreads">[] {
  const visible = new Set(visibleIds);
  return selectedIds.filter((id) => visible.has(id));
}
