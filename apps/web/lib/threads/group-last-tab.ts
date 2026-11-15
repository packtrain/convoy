/**
 * Client-local "last viewed tab" per thread group (OS-1477,
 * docs/specs/thread-groups.md): opening a group container resolves to this
 * child, falling back to most-recent activity. A browser UI preference only —
 * deliberately not stored on the server. Fail-soft: storage errors fall back
 * to undefined.
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const STORAGE_KEY_PREFIX = "convoy.thread-group-last-tab.";

export function readGroupLastTab(containerId: string): string | undefined {
  return readLocalString(STORAGE_KEY_PREFIX + containerId) ?? undefined;
}

export function writeGroupLastTab(containerId: string, childId: string): void {
  writeLocalString(STORAGE_KEY_PREFIX + containerId, childId);
}
