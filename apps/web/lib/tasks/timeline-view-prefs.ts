/**
 * Client-local persistence for the task timeline's view preferences (OS-1591): which
 * sources the stream shows and which way it reads.
 *
 * Per-viewer browser UI state, deliberately not server or project config — "what I want
 * to look at" is not a shared, `canEdit`-gated setting. Every read fails soft to the
 * default, so unavailable storage never narrows the feed.
 */

import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";

const SOURCE_KEYS: Record<keyof TimelineSources, string> = {
  activity: "convoy.task-timeline-source-activity",
  comments: "convoy.task-timeline-source-comments",
  threads: "convoy.task-timeline-source-threads",
};

const SORT_DIRECTION_KEY = "convoy.task-timeline-sort-direction";

/** Every source on, oldest-first — the state the feed ships in. */
export const DEFAULT_TIMELINE_SOURCES: TimelineSources = {
  activity: true,
  comments: true,
  threads: true,
};

export const DEFAULT_TIMELINE_SORT_DIRECTION: TimelineSortDirection = "asc";

/**
 * Only an explicit `"0"` turns a source off.
 *
 * Why `changes-view-prefs`'s `storedIs` shorthand doesn't carry over: there an absent
 * key means the non-stored default. Here the default is **on**, so an absent — or
 * corrupt — key must read as on rather than as "not off".
 */
function readSource(key: string): boolean {
  return readLocalString(key) !== "0";
}

export function readTimelineSources(): TimelineSources {
  return {
    activity: readSource(SOURCE_KEYS.activity),
    comments: readSource(SOURCE_KEYS.comments),
    threads: readSource(SOURCE_KEYS.threads),
  };
}

export function writeTimelineSource(source: keyof TimelineSources, enabled: boolean): void {
  writeLocalString(SOURCE_KEYS[source], enabled ? "1" : "0");
}

/** Anything unrecognized reads as the default rather than as the other value. */
export function readTimelineSortDirection(): TimelineSortDirection {
  return readLocalString(SORT_DIRECTION_KEY) === "desc" ? "desc" : "asc";
}

export function writeTimelineSortDirection(direction: TimelineSortDirection): void {
  writeLocalString(SORT_DIRECTION_KEY, direction);
}
