/**
 * Client-local "last visited organization", used by `/o` to resume where the
 * user left off. A browser-local routing hint only — deliberately not stored
 * on the server, and fail-soft: an unavailable store just means `/o` falls
 * back to the user's first organization.
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const STORAGE_KEY = "lastOrganizationSlug";

export function getLastOrganizationSlug(): string | null {
  return readLocalString(STORAGE_KEY);
}

export function setLastOrganizationSlug(orgSlug: string): void {
  writeLocalString(STORAGE_KEY, orgSlug);
}
