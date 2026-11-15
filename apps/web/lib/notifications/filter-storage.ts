/**
 * Client-local persistence for the notifications inbox all/unread filter
 * (docs/specs/notifications.md). A browser UI preference only — deliberately
 * not stored on the server. Fail-soft: storage errors fall back to the
 * default, "unread".
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const STORAGE_KEY = "convoy.notifications-unread-only";

export function readNotificationsUnreadOnly(): boolean {
  // Unread is the default: only an explicit "all" choice ("0") turns it off.
  return readLocalString(STORAGE_KEY) !== "0";
}

export function writeNotificationsUnreadOnly(unreadOnly: boolean): void {
  writeLocalString(STORAGE_KEY, unreadOnly ? "1" : "0");
}
