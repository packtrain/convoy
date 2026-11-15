"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Spinner } from "@/components/custom/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskSelectorOptionContent } from "@/components/blocks/tasks/task-selector-option-content";
import { TASK_QUICK_OPEN_HOTKEY } from "@/lib/browser/hotkeys";
import { useDynamicTargetHotkey } from "@/lib/browser/use-dynamic-target-hotkey";
import { AppLink, appRoute, buildProjectRouteTarget, href, useNavigation } from "@/lib/navigation";
import { getLastProjectAlias } from "@/lib/routing/last-project-storage";
import {
  getTaskSelectorArchiveFilter,
  getTaskSelectorListRef,
  type TaskSelectorOption,
} from "@/lib/tasks/task-selector";
import type { ArchiveFilter } from "@/lib/tasks/types";
import { useTaskSelectorData } from "@/lib/tasks/hooks/use-task-selector-data";

const TAB_LABELS: Record<ArchiveFilter, string> = {
  active: "Active",
  archived: "Archived",
};

function subscribeToLastProjectStorage(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getServerLastProjectAliasSnapshot() {
  return null;
}

function useLastProjectAliasSnapshot(organizationSlug: string) {
  return useSyncExternalStore(
    subscribeToLastProjectStorage,
    () => getLastProjectAlias(organizationSlug),
    getServerLastProjectAliasSnapshot
  );
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function taskRouteTarget(
  organizationSlug: string,
  projectAlias: string,
  task: TaskSelectorOption
) {
  const archiveFilter = getTaskSelectorArchiveFilter(task);
  return buildProjectRouteTarget(appRoute.project(organizationSlug, projectAlias).pathname, {
    task: task.refId,
    archived: archiveFilter === "archived" ? "true" : undefined,
    list: getTaskSelectorListRef(task) ?? undefined,
  });
}

interface GlobalTaskQuickOpenProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  projectAlias: string | null;
}

export function GlobalTaskQuickOpen({ organizationId, organizationSlug, projectAlias }: GlobalTaskQuickOpenProps) {
  const navigation = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextSelectRef = useRef(false);
  const [open, setOpen] = useState(false);
  const lastProjectAlias = useLastProjectAliasSnapshot(organizationSlug);
  const resolvedProjectAlias = projectAlias ?? lastProjectAlias;

  const project = useQuery(
    api.projects.core.getByAlias,
    resolvedProjectAlias
      ? {
          organizationId,
          alias: resolvedProjectAlias,
        }
      : "skip"
  );

  const projectId = project?._id;
  const { query, setQuery, tab, setTab, hasQuery, isLoading, isLoadingMore, hasMore, results, loadMore, resetQuery } = useTaskSelectorData({
    projectId,
    // Only while open: the dialog is mounted app-wide, and a closed one held a
    // live subscription to the newest tasks for the whole session (OS-1719).
    enableSeededResults: open,
  });

  const resetDialogState = useCallback(() => {
    resetQuery();
    setTab("active");
  }, [resetQuery, setTab]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        resetDialogState();
      }
    },
    [resetDialogState]
  );

  const focusSearchInput = useCallback(() => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) {
      focusSearchInput();
    }
  }, [focusSearchInput, open]);

  useDynamicTargetHotkey(
    TASK_QUICK_OPEN_HOTKEY,
    (event) => {
      if (!project) {
        return;
      }

      event.preventDefault();
      setOpen(true);
      focusSearchInput();
    },
    {
      ignoreInputs: true,
    }
  );

  const getTaskHref = useCallback(
    (task: TaskSelectorOption) => {
      return href(
        taskRouteTarget(
          organizationSlug,
          project?.alias ?? resolvedProjectAlias ?? "",
          task
        )
      );
    },
    [organizationSlug, project?.alias, resolvedProjectAlias]
  );

  const handleSelectTask = useCallback(
    (task: TaskSelectorOption) => {
      if (!project) {
        return;
      }

      navigation.push(taskRouteTarget(organizationSlug, project.alias, task));
      handleOpenChange(false);
    },
    [handleOpenChange, navigation, organizationSlug, project]
  );

  const emptyMessage = useMemo(() => {
    if (hasQuery) {
      return "No tasks found";
    }
    if (tab === "archived") {
      return "Type to search archived tasks";
    }
    return "No recent tasks available";
  }, [hasQuery, tab]);

  if (!project && !open) {
    return null;
  }

  const dialogOpen = open && Boolean(project);

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[32rem] sm:max-w-xl overflow-hidden border-none p-0 outline outline-border" showCloseButton={false}>
        <DialogTitle className="sr-only">Find task</DialogTitle>
        <DialogDescription className="sr-only">Search project tasks and open one in the task list.</DialogDescription>
        <Command shouldFilter={false} className="h-full rounded-xl">
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={project ? `Find task in ${project.alias}...` : "Find task..."}
            showClearButton={hasQuery}
            onClear={resetQuery}
          />
          <Tabs value={tab} onValueChange={(value) => setTab(value as ArchiveFilter)} className="px-1 pt-1">
            <TabsList variant="underline">
              {(Object.keys(TAB_LABELS) as ArchiveFilter[]).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {TAB_LABELS[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <CommandList className="mt-1 min-h-0 max-h-none flex-1">
            {isLoading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">Searching...</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</div>
            ) : (
              <div className="space-y-1 p-1">
                {results.map((task) => (
                  <CommandItem
                    key={task._id}
                    asChild
                    className="w-full [&>svg:last-child]:hidden"
                    value={String(task._id)}
                    onSelect={() => {
                      if (skipNextSelectRef.current) {
                        skipNextSelectRef.current = false;
                        return;
                      }

                      handleSelectTask(task);
                    }}
                  >
                    <AppLink
                      href={getTaskHref(task)}
                      onClick={(event) => {
                        skipNextSelectRef.current = true;
                        event.stopPropagation();

                        if (isModifiedClick(event)) {
                          return;
                        }

                        event.preventDefault();
                        handleSelectTask(task);
                      }}
                    >
                      <TaskSelectorOptionContent task={task} />
                    </AppLink>
                  </CommandItem>
                ))}
                {hasMore && (
                  <CommandItem
                    value="load-more"
                    className="w-full justify-center text-muted-foreground [&>svg:last-child]:hidden"
                    onSelect={loadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <Spinner className="text-muted-foreground" text="Loading…" textClassName="text-current" textPlacement="inline" />
                    ) : (
                      "Load more"
                    )}
                  </CommandItem>
                )}
              </div>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
