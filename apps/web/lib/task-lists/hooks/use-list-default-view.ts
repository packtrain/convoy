"use client";

import { useCallback } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskListItem } from "@/components/blocks/project/task-lists/task-list-types";
import {
  resolveDefaultView,
  type DefaultViewSettings,
  type ResolvedDefaultView,
} from "@/lib/navigation";
import { isSystemListRef } from "@/lib/task-lists/system-lists";

interface ListDefaultViewNavigationArgs {
  project:
    | (DefaultViewSettings & { defaultListId?: Id<"taskLists"> })
    | null
    | undefined;
  results: readonly TaskListItem[];
  setSelectedListRef: (
    listRef: string | null,
    defaultView?: ResolvedDefaultView
  ) => void;
  selectedListHref: (
    listRef: string | null,
    defaultView?: ResolvedDefaultView
  ) => string;
}

/**
 * Wraps the navigation state's List-switch handlers so each switch resolves
 * the target List's own default view (OS-1566), falling back to the project
 * default. Lists come from the already-loaded active-List results, so this
 * adds no query.
 */
export function useListDefaultViewNavigation({
  project,
  results,
  setSelectedListRef,
  selectedListHref,
}: ListDefaultViewNavigationArgs) {
  const resolveFor = useCallback(
    (listRef: string | null): ResolvedDefaultView | undefined => {
      // `null` is the default-List picker row, which carries no ref — resolve
      // it through the project pointer, or its override never applies. System
      // refs (Backlog) have no List row and inherit the project default.
      const list =
        listRef === null
          ? (results.find(
              (candidate) => candidate._id === project?.defaultListId
            ) ?? null)
          : isSystemListRef(listRef)
            ? null
            : (results.find((candidate) => candidate.ref === listRef) ?? null);

      // Only a List that actually overrides may change the on-screen view.
      // Inheriting Lists and Backlog keep whatever the user is looking at —
      // otherwise the layout toggle is unusable in a Board-default project.
      const resolved = resolveDefaultView(project, list);
      return resolved.fromList ? resolved : undefined;
    },
    [project, results]
  );

  const selectList = useCallback(
    (listRef: string | null) => setSelectedListRef(listRef, resolveFor(listRef)),
    [resolveFor, setSelectedListRef]
  );

  const getListHref = useCallback(
    (listRef: string | null) => selectedListHref(listRef, resolveFor(listRef)),
    [resolveFor, selectedListHref]
  );

  return { selectList, getListHref };
}
