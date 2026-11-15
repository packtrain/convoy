/**
 * Browser-local UI state of the worktrees module (OS-2036). A preference,
 * never server state; storage failures fall back to defaults.
 */

import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";

const EXPANDED_PROFILES_KEY = "convoy.worktree-list-expanded-profiles";

/** CLI profiles whose checkout list is expanded in Connected CLIs. */
export function readExpandedProfileIds(): string[] {
  const stored = readLocalJson(EXPANDED_PROFILES_KEY);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
}

export function writeExpandedProfileIds(ids: string[]): void {
  writeLocalJson(EXPANDED_PROFILES_KEY, ids);
}
