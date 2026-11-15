"use client";

import type { WatchTowerScope } from "./watch-tower-view";
import { useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { CliThreadWatchStatus } from "@/convex/lib/contracts/validators";

const PAGE_SIZE = 25;

export type WatchTowerSection = CliThreadWatchStatus;

/**
 * One personal or project Watch Tower section,
 * independently paginated (OS-1253). Pass undefined to skip.
 *
 * Pages can come back empty despite more rows existing (access post-filtering), so this
 * auto-loads until something is visible or the section is exhausted.
 */
export function useWatchTowerSection(
  organizationSlug: string | undefined,
  section: WatchTowerSection,
  project?: { projectAlias: string; scope: WatchTowerScope },
) {
  const args = organizationSlug ? project
    ? { organizationSlug, section, ...project }
    : { organizationSlug, section } : "skip";
  const { results, status, loadMore } = usePaginatedQuery(
    project ? api.cli.threads.lists.listProjectWatchTower : api.cli.threads.lists.listMine,
    args,
    { initialNumItems: PAGE_SIZE }
  );

  useEffect(() => {
    if (results.length === 0 && status === "CanLoadMore") {
      loadMore(PAGE_SIZE);
    }
  }, [results.length, status, loadMore]);

  return {
    threads: results,
    status,
    loadMore: () => loadMore(PAGE_SIZE),
  };
}
