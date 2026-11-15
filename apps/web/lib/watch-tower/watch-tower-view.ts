/**
 * Watch Tower's browser-local view preferences (OS-1595) and the canonical
 * section list both layouts render from. Device-wide, not per-org, and
 * deliberately never server-stored. Fail-soft: unreadable or malformed
 * payloads fall back to the defaults.
 */

import type { CliThreadWatchStatus } from "@/convex/lib/contracts/validators";
import {
  readLocalJson,
  readLocalString,
  writeLocalJson,
  writeLocalString,
} from "@/lib/browser/local-storage";

export type WatchStatus = CliThreadWatchStatus;

/** Fixed section order, shared by the list and the board (columns left to right). */
export const WATCH_TOWER_SECTIONS: ReadonlyArray<Readonly<{
  status: WatchStatus;
  title: string;
  description: string;
  teamTitle: string;
  teamDescription: string;
}>> = [
  {
    status: "running",
    title: "Running",
    description: "Agents currently working.",
    teamTitle: "Running",
    teamDescription: "Agents currently working.",
  },
  {
    status: "waiting_input",
    title: "Waiting for your input",
    description: "Agents asked a question and are blocked until you answer.",
    teamTitle: "Waiting for input",
    teamDescription: "Waiting for the thread owner's input.",
  },
  {
    status: "failed",
    title: "Failed",
    description: "Runs that stopped with an error and can be retried.",
    teamTitle: "Failed",
    teamDescription: "Runs that stopped with an error.",
  },
  {
    status: "needs_review",
    title: "Needs your review",
    description: "Finished threads you haven't marked as done yet.",
    teamTitle: "Needs review",
    teamDescription: "Finished threads awaiting their owner's review.",
  },
  {
    status: "done",
    title: "Done",
    description: "Threads you marked as done, newest first.",
    teamTitle: "Done",
    teamDescription: "Threads marked done by their owner.",
  },
];

/** Matches the project task views' vocabulary (`ProjectViewMode`). */
export type WatchTowerViewMode = "list" | "board";

const VIEW_MODE_STORAGE_KEY = "convoy.watch-tower.view-mode";
const HIDDEN_SECTIONS_STORAGE_KEY = "convoy.watch-tower.hidden-sections";

export const DEFAULT_WATCH_TOWER_VIEW_MODE: WatchTowerViewMode = "list";

function isViewMode(value: unknown): value is WatchTowerViewMode {
  return value === "list" || value === "board";
}

export function readWatchTowerViewMode(): WatchTowerViewMode {
  const stored = readLocalString(VIEW_MODE_STORAGE_KEY);
  return isViewMode(stored) ? stored : DEFAULT_WATCH_TOWER_VIEW_MODE;
}

export function writeWatchTowerViewMode(mode: WatchTowerViewMode): void {
  writeLocalString(VIEW_MODE_STORAGE_KEY, mode);
}

/**
 * Hidden sections are shared by both layouts — the same "what do I care about"
 * question hides a list section and its board column.
 */
export function readHiddenWatchTowerSections(): Set<string> {
  const parsed = readLocalJson(HIDDEN_SECTIONS_STORAGE_KEY);
  if (!Array.isArray(parsed)) return new Set();
  const valid = new Set<string>(WATCH_TOWER_SECTIONS.map((section) => section.status));
  return new Set(
    parsed.filter((key): key is string => typeof key === "string" && valid.has(key))
  );
}

export function writeHiddenWatchTowerSections(hidden: Set<string>): void {
  writeLocalJson(HIDDEN_SECTIONS_STORAGE_KEY, [...hidden]);
}

export type WatchTowerScope = "mine" | "all";
const SCOPE_STORAGE_KEY = "convoy.watch-tower.project-scope";

export function readWatchTowerScope(projectKey: string): WatchTowerScope {
  return readLocalString(`${SCOPE_STORAGE_KEY}.${projectKey}`) === "mine" ? "mine" : "all";
}

export function writeWatchTowerScope(projectKey: string, scope: WatchTowerScope): void {
  writeLocalString(`${SCOPE_STORAGE_KEY}.${projectKey}`, scope);
}

/** Team buckets describe the owner's state, not work assigned to the viewer. */
export function watchTowerSections(scope: WatchTowerScope) {
  if (scope === "mine") return WATCH_TOWER_SECTIONS;
  return WATCH_TOWER_SECTIONS.map((section) => ({
    ...section,
    title: section.teamTitle,
    description: section.teamDescription,
  }));
}
