"use client";

import { useCallback, useState } from "react";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import {
  readTimelineSortDirection,
  readTimelineSources,
  writeTimelineSortDirection,
  writeTimelineSource,
} from "@/lib/tasks/timeline-view-prefs";

/**
* The timeline's view state: which sources are on, and which way the stream reads (OS-1591).
* Colocated with the timeline because nothing else reads these prefs.
*
* Both are read **synchronously in the `useState` initializer**, not in an effect: `sources` is
* part of `useTaskTimeline`'s window key, so correcting afterwards would subscribe the first page
* under the wrong source set and re-subscribe. Writes are fire-and-forget — a storage refusal
* must not stop the toggle taking effect.
*/
export interface TimelineViewState {
  sources: TimelineSources;
  sortDirection: TimelineSortDirection;
  toggleSource: (source: keyof TimelineSources, enabled: boolean) => void;
  setSortDirection: (direction: TimelineSortDirection) => void;
}

export function useTimelineViewState(): TimelineViewState {
  const [sources, setSources] = useState<TimelineSources>(readTimelineSources);
  const [sortDirection, setSortDirectionState] = useState<TimelineSortDirection>(
    readTimelineSortDirection
  );

  // The persist call sits beside `setState`, never inside its updater: React
  // invokes updaters twice under StrictMode, which would double-write storage.
  const toggleSource = useCallback((source: keyof TimelineSources, enabled: boolean) => {
    writeTimelineSource(source, enabled);
    setSources((current) =>
      current[source] === enabled ? current : { ...current, [source]: enabled }
    );
  }, []);

  const setSortDirection = useCallback((direction: TimelineSortDirection) => {
    writeTimelineSortDirection(direction);
    setSortDirectionState(direction);
  }, []);

  return { sources, sortDirection, toggleSource, setSortDirection };
}
