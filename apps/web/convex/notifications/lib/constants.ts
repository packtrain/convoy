/** Notifications are deleted (read or not) once older than this. */
export const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Max rows deleted per retention sweep run; a full batch reschedules itself. */
export const RETENTION_SWEEP_BATCH = 1000;

/** Unread badge scan cap; the UI shows "99+" when the count reaches it. */
export const UNREAD_COUNT_CAP = 100;

/** Max rows marked per mark-all-as-read batch; a full batch schedules a sweep. */
export const MARK_ALL_READ_BATCH = 500;

/** Newest rows the toast channel watches; the client cursor picks fresh ones. */
export const TOAST_RECENT_LIMIT = 5;

/**
 * Rows scanned to fill the toast window despite toast-muted types in between.
 * ponytail: a burst of >15 muted rows between two toastable ones can still
 * starve the window; denormalize a toastable flag at fan-out if that ever
 * matters.
 */
export const TOAST_RECENT_SCAN_LIMIT = TOAST_RECENT_LIMIT * 4;
