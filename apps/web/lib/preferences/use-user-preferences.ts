"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type {
  CliFavoriteCombo,
  SectionColorStyle,
  SectionHeaderStyle,
  ThreadSortBy,
} from "@/convex/lib/contracts/validators";
import { toast } from "sonner";

export function useUserPreferences() {
  const preferences = useQuery(api.users.preferences.get, {});
  // `withOptimisticUpdate` returns a new mutation on every call, so without
  // this memo every setter below — and the thread sidebar's sort, density and
  // grouping props with them — changes identity each render (OS-1581).
  const baseUpsert = useMutation(api.users.preferences.upsert);
  const upsertMutation = useMemo(
    () =>
      baseUpsert.withOptimisticUpdate((localStore, args) => {
        const current = localStore.getQuery(api.users.preferences.get, {});
        if (!current) return;
        localStore.setQuery(api.users.preferences.get, {}, {
          ...current,
          ...(args.threadSortBy !== undefined && { threadSortBy: args.threadSortBy }),
          ...(args.threadCompactLayout !== undefined && {
            threadCompactLayout: args.threadCompactLayout,
          }),
          ...(args.threadGroupDone !== undefined && {
            threadGroupDone: args.threadGroupDone,
          }),
          ...(args.pullRequestCompactLayout !== undefined && {
            pullRequestCompactLayout: args.pullRequestCompactLayout,
          }),
          ...(args.cliFavoriteCombos !== undefined && {
            cliFavoriteCombos: args.cliFavoriteCombos,
          }),
          ...(args.sectionHeaderStyle !== undefined && { sectionHeaderStyle: args.sectionHeaderStyle }),
          ...(args.sectionColorStyle !== undefined && { sectionColorStyle: args.sectionColorStyle }),
        });
      }),
    [baseUpsert]
  );

  const updatePreference = useCallback(
    async (patch: Parameters<typeof upsertMutation>[0]) => {
      try {
        await upsertMutation(patch);
      } catch {
        toast.error("Failed to update preference");
      }
    },
    [upsertMutation]
  );

  const setThreadSortBy = useCallback(
    (threadSortBy: ThreadSortBy) => updatePreference({ threadSortBy }),
    [updatePreference]
  );
  const setThreadCompactLayout = useCallback(
    (threadCompactLayout: boolean) => updatePreference({ threadCompactLayout }),
    [updatePreference]
  );
  const setThreadGroupDone = useCallback(
    (threadGroupDone: boolean) => updatePreference({ threadGroupDone }),
    [updatePreference]
  );
  const setPullRequestCompactLayout = useCallback(
    (pullRequestCompactLayout: boolean) => updatePreference({ pullRequestCompactLayout }),
    [updatePreference]
  );
  const setCliFavoriteCombos = useCallback(
    (cliFavoriteCombos: CliFavoriteCombo[]) => updatePreference({ cliFavoriteCombos }),
    [updatePreference]
  );

  const setSectionHeaderStyle = useCallback(
    (sectionHeaderStyle: SectionHeaderStyle) => updatePreference({ sectionHeaderStyle }),
    [updatePreference]
  );
  const setSectionColorStyle = useCallback(
    (sectionColorStyle: SectionColorStyle) => updatePreference({ sectionColorStyle }),
    [updatePreference]
  );

  return {
    threadSortBy: preferences?.threadSortBy ?? "created",
    threadCompactLayout: preferences?.threadCompactLayout ?? true,
    threadGroupDone: preferences?.threadGroupDone ?? true,
    pullRequestCompactLayout: preferences?.pullRequestCompactLayout ?? false,
    cliFavoriteCombos: preferences?.cliFavoriteCombos,
    sectionHeaderStyle: preferences?.sectionHeaderStyle ?? "compact",
    sectionColorStyle: preferences?.sectionColorStyle ?? "tint",
    isLoading: preferences === undefined,
    setThreadSortBy,
    setThreadCompactLayout,
    setThreadGroupDone,
    setPullRequestCompactLayout,
    setCliFavoriteCombos,
    setSectionHeaderStyle,
    setSectionColorStyle,
  };
}

/** Read-only task section appearance (OS-2137); setters live on useUserPreferences. */
export function useSectionAppearance() {
  const preferences = useQuery(api.users.preferences.get, {});
  return {
    sectionHeaderStyle: preferences?.sectionHeaderStyle ?? "compact",
    sectionColorStyle: preferences?.sectionColorStyle ?? "tint",
  };
}
