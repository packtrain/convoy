"use client";

import { useCallback, useMemo } from "react";
import type { ArchiveFilter } from "@/lib/tasks/types";
import { type NavigationHistoryMode, useNavigation } from "./core";
import { href, routeTarget, type RouteTarget } from "./target";

type ThreadNavigationOptions = { history?: NavigationHistoryMode };

interface ThreadNavigationState {
  pathname: string;
  taskRefId: string | null;
  attachedTaskRefId: string | null;
  artifactId: string | null;
  /**
   * Artifact open as its own sidebar tab, independent of the task selection —
   * unlike `artifact`, which is nested in the task tab. See
   * `docs/specs/cli-thread-detail-sidebar.md`.
   */
  threadArtifactId: string | null;
  archiveFilter: ArchiveFilter;
  taskTarget: (taskRefId: string | null, archiveFilter?: ArchiveFilter) => RouteTarget;
  taskArtifactTarget: (
    taskRefId: string | null,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter
  ) => RouteTarget;
  threadArtifactTarget: (artifactId: string | null) => RouteTarget;
  attachedTaskTarget: (taskRefId: string | null) => RouteTarget;
  taskHref: (taskRefId: string | null, archiveFilter?: ArchiveFilter) => string;
  openTask: (
    taskRefId: string | null,
    archiveFilter?: ArchiveFilter,
    options?: ThreadNavigationOptions
  ) => void;
  selectTaskArtifact: (
    taskRefId: string | null,
    artifactId: string | null,
    archiveFilter?: ArchiveFilter,
    options?: ThreadNavigationOptions
  ) => void;
  selectArtifact: (
    artifactId: string | null,
    options?: ThreadNavigationOptions
  ) => void;
  selectThreadArtifact: (
    artifactId: string | null,
    options?: ThreadNavigationOptions
  ) => void;
  closeThreadArtifact: (options?: ThreadNavigationOptions) => void;
  closeTaskSidebar: (options?: ThreadNavigationOptions) => void;
  setAttachedTask: (
    taskRefId: string | null,
    options?: ThreadNavigationOptions
  ) => void;
}

function applyNullableParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined
) {
  if (value === undefined) {
    return;
  }

  if (value) {
    params.set(key, value);
    return;
  }

  params.delete(key);
}

interface UrlLocation {
  pathname: string;
  search: string;
}

function buildFromCurrentSearch(
  { pathname, search }: UrlLocation,
  update: (params: URLSearchParams) => void
) {
  const nextParams = new URLSearchParams(search);
  update(nextParams);
  return routeTarget(pathname, { query: nextParams });
}

/**
 * Actions build from this, not the render's copy: Next writes the URL in its
 * commit without an event, so that copy can still name the previous page (OS-2067).
 */
function liveLocation(): UrlLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

function readArchiveFilter(params: URLSearchParams): ArchiveFilter {
  return params.get("archived") === "true" ? "archived" : "active";
}

function buildTaskTarget(
  location: UrlLocation,
  nextTaskRefId: string | null,
  nextArchiveFilter?: ArchiveFilter
) {
  return buildTaskArtifactTarget(location, nextTaskRefId, null, nextArchiveFilter);
}

function buildTaskArtifactTarget(
  location: UrlLocation,
  nextTaskRefId: string | null,
  nextArtifactId: string | null,
  nextArchiveFilter?: ArchiveFilter
) {
  return buildFromCurrentSearch(location, (nextParams) => {
    applyNullableParam(nextParams, "task", nextTaskRefId);

    if (nextTaskRefId === null) {
      nextParams.delete("artifact");
      nextParams.delete("archived");
      return;
    }

    applyNullableParam(nextParams, "artifact", nextArtifactId);
    if (nextArchiveFilter === "archived") {
      nextParams.set("archived", "true");
    } else if (nextArchiveFilter === "active") {
      nextParams.delete("archived");
    }
  });
}

// Deliberately touches nothing else: the artifact tab is a host tab, so it
// outlives task changes (which is why the task targets never clear it).
function buildThreadArtifactTarget(location: UrlLocation, nextArtifactId: string | null) {
  return buildFromCurrentSearch(location, (nextParams) => {
    applyNullableParam(nextParams, "threadArtifact", nextArtifactId);
  });
}

function buildAttachedTaskTarget(location: UrlLocation, nextAttachedTaskRefId: string | null) {
  return buildFromCurrentSearch(location, (nextParams) => {
    applyNullableParam(nextParams, "attachedTask", nextAttachedTaskRefId);
  });
}

export function useThreadNavigationState(): ThreadNavigationState {
  const navigation = useNavigation();
  const pathname = navigation.location.pathname;
  const currentSearch = navigation.location.search;
  const currentParams = useMemo(
    () => new URLSearchParams(currentSearch),
    [currentSearch]
  );

  const taskRefId = currentParams.get("task");
  const attachedTaskRefId = currentParams.get("attachedTask");
  const artifactId = currentParams.get("artifact");
  const threadArtifactId = currentParams.get("threadArtifact");
  const archiveFilter = readArchiveFilter(currentParams);

  const taskTarget = useCallback(
    (nextTaskRefId: string | null, nextArchiveFilter?: ArchiveFilter) =>
      buildTaskTarget({ pathname, search: currentSearch }, nextTaskRefId, nextArchiveFilter),
    [currentSearch, pathname]
  );

  const taskArtifactTarget = useCallback(
    (
      nextTaskRefId: string | null,
      nextArtifactId: string | null,
      nextArchiveFilter?: ArchiveFilter
    ) =>
      buildTaskArtifactTarget(
        { pathname, search: currentSearch },
        nextTaskRefId,
        nextArtifactId,
        nextArchiveFilter
      ),
    [currentSearch, pathname]
  );

  const threadArtifactTarget = useCallback(
    (nextArtifactId: string | null) =>
      buildThreadArtifactTarget({ pathname, search: currentSearch }, nextArtifactId),
    [currentSearch, pathname]
  );

  const attachedTaskTarget = useCallback(
    (nextAttachedTaskRefId: string | null) =>
      buildAttachedTaskTarget({ pathname, search: currentSearch }, nextAttachedTaskRefId),
    [currentSearch, pathname]
  );

  const navigate = useCallback(
    (
      target: RouteTarget,
      options: ThreadNavigationOptions | undefined
    ) => {
      if (options?.history === "replace") {
        navigation.replace(target);
        return;
      }
      navigation.push(target);
    },
    [navigation]
  );

  // Every consumer puts these in effect dependency arrays, and several of those effects write
  // back to the URL. Fresh closures per render would re-run them after every commit, so a URL
  // write that doesn't land would retry forever — React #185. Tied to the URL instead, they
  // re-run exactly when it changes.
  const taskHref = useCallback(
    (nextTaskRefId: string | null, nextArchiveFilter?: ArchiveFilter) =>
      href(taskTarget(nextTaskRefId, nextArchiveFilter)),
    [taskTarget]
  );

  // Actions build from `liveLocation()`; `navigate` already changes with the URL.
  const openTask = useCallback(
    (
      nextTaskRefId: string | null,
      nextArchiveFilter?: ArchiveFilter,
      options?: ThreadNavigationOptions
    ) => navigate(buildTaskTarget(liveLocation(), nextTaskRefId, nextArchiveFilter), options),
    [navigate]
  );

  const selectTaskArtifact = useCallback(
    (
      nextTaskRefId: string | null,
      nextArtifactId: string | null,
      nextArchiveFilter?: ArchiveFilter,
      options?: ThreadNavigationOptions
    ) =>
      navigate(
        buildTaskArtifactTarget(liveLocation(), nextTaskRefId, nextArtifactId, nextArchiveFilter),
        options
      ),
    [navigate]
  );

  const selectArtifact = useCallback(
    (nextArtifactId: string | null, options?: ThreadNavigationOptions) => {
      const location = liveLocation();
      const params = new URLSearchParams(location.search);
      navigate(
        buildTaskArtifactTarget(location, params.get("task"), nextArtifactId, readArchiveFilter(params)),
        options
      );
    },
    [navigate]
  );

  const selectThreadArtifact = useCallback(
    (nextArtifactId: string | null, options?: ThreadNavigationOptions) =>
      navigate(buildThreadArtifactTarget(liveLocation(), nextArtifactId), options),
    [navigate]
  );

  const closeThreadArtifact = useCallback(
    (options?: ThreadNavigationOptions) =>
      navigate(buildThreadArtifactTarget(liveLocation(), null), options),
    [navigate]
  );

  const closeTaskSidebar = useCallback(
    (options?: ThreadNavigationOptions) => navigate(buildTaskTarget(liveLocation(), null), options),
    [navigate]
  );

  const setAttachedTask = useCallback(
    (nextAttachedTaskRefId: string | null, options?: ThreadNavigationOptions) =>
      navigate(buildAttachedTaskTarget(liveLocation(), nextAttachedTaskRefId), options),
    [navigate]
  );

  return useMemo(
    () => ({
      pathname,
      taskRefId,
      attachedTaskRefId,
      artifactId,
      threadArtifactId,
      archiveFilter,
      taskTarget,
      taskArtifactTarget,
      threadArtifactTarget,
      attachedTaskTarget,
      taskHref,
      openTask,
      selectTaskArtifact,
      selectArtifact,
      selectThreadArtifact,
      closeThreadArtifact,
      closeTaskSidebar,
      setAttachedTask,
    }),
    [
      archiveFilter,
      artifactId,
      attachedTaskRefId,
      attachedTaskTarget,
      closeTaskSidebar,
      closeThreadArtifact,
      openTask,
      pathname,
      selectArtifact,
      selectTaskArtifact,
      selectThreadArtifact,
      setAttachedTask,
      taskArtifactTarget,
      taskHref,
      taskRefId,
      taskTarget,
      threadArtifactId,
      threadArtifactTarget,
    ]
  );
}
