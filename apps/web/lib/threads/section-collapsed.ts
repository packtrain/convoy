/**
 * Client-local persistence for thread-list section collapse state (OS-1173,
 * OS-1394). A browser UI preference only — deliberately not stored on the
 * server. Fail-soft: storage errors fall back to the caller's default.
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

export const PINNED_SECTION_STORAGE_KEY = "convoy.thread-pinned-section-collapsed";
export const DONE_SECTION_STORAGE_KEY = "convoy.thread-done-section-collapsed";
export const CONNECTED_CLIS_SECTION_STORAGE_KEY = "convoy.thread-connected-clis-section-collapsed";

export function readSectionCollapsed(storageKey: string, fallback: boolean): boolean {
  const stored = readLocalString(storageKey);
  return stored === null ? fallback : stored === "1";
}

export function writeSectionCollapsed(storageKey: string, collapsed: boolean): void {
  writeLocalString(storageKey, collapsed ? "1" : "0");
}
