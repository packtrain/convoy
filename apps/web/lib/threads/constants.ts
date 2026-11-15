export const THREAD_TITLE_MAX_LENGTH = 120;

/**
 * Query param on the project threads index that opens the new-thread composer
 * on mobile (where the bare index shows the thread list instead). Ignored on
 * desktop, where the index always is the new-thread screen.
 */
export const NEW_THREAD_QUERY_PARAM = "new";

/** Max threads per batch action (Watch Tower bulk read/done/delete, OS-1255). */
export const THREAD_BATCH_ACTION_MAX = 50;

/**
 * Max rows one batch action may touch once group cascades are expanded
 * (selected rows + their live children, OS-1475). A selected container costs
 * its whole group: at ~3 document reads per cascaded child, this keeps a batch
 * transaction near 3k reads, well under Convex's ~16k ceiling. Without it, 50
 * maxed-out groups would be ~15k and abort with no explanation.
 */
export const THREAD_BATCH_FANOUT_MAX = 1000;

/**
 * Max children ever parented under one group container (OS-1474) — counted
 * including soft-deleted rows, so it bounds physical fan-out.
 * Backend rejects at the cap; the "+" affordances disable at it too.
 */
export const MAX_GROUP_CHILDREN = 100;

/**
 * Max rows the non-paginated Pinned section reads (OS-1173). Pins are
 * user-curated and few, so this is a safety ceiling rather than a real limit —
 * but it does silently truncate, so it must stay well above any plausible pin
 * count.
 */
export const PINNED_THREADS_MAX = 100;

/**
 * Max threads one task's thread list reads (OS-636). Neither surface that reads it
 * — the task sidebar, `list_task_threads` — paginates, and nothing caps threads per
 * task on the write side, so this is what keeps an agent-spawned pile from growing
 * past Convex's read limits with no cursor to recover. Truncates silently, so it
 * stays well above any plausible per-task count.
 */
export const TASK_THREADS_MAX = 100;

/**
 * Page size for the shared-threads view (OS-1576). Paginated rather than
 * capped: a `take(N)` ceiling truncates silently, and a shared thread the
 * owner cannot find is a link they cannot revoke.
 */
export const SHARED_THREADS_PAGE_SIZE = 50;

export const THREAD_SIDEBAR_RESIZE_BOUNDS = {
  min: 256,
  max: 640,
  default: 320,
  storageKey: "thread-sidebar-width",
} as const;

export const THREAD_DETAIL_SIDEBAR_RESIZE_BOUNDS = {
  min: 400,
  max: 900,
  default: 400,
  storageKey: "thread-detail-sidebar-width",
} as const;


export const THREAD_CHANGES_FILE_TREE_RESIZE_BOUNDS = {
  min: 160,
  max: 600,
  default: 224,
  storageKey: "convoy.thread-changes-file-tree-width",
} as const;
