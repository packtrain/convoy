/**
 * User-facing error messages thrown by the notifications domain. Specs and
 * tests assert on these strings — keep them in sync with `docs/specs/`.
 */
export const errors = {
  // Also thrown for rows owned by another user — don't leak existence.
  NOTIFICATION_NOT_FOUND: "Notification not found",
  PREFERENCE_ENTRIES_INVALID: "Invalid notification preference entries",
};
