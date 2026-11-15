"use client";

import { useRef, useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { MOBILE_NAV_BAR_CLEARANCE } from "@/lib/mobile/constants";
import type { Id } from "@/convex/_generated/dataModel";
import { useTaskSelectorData } from "@/lib/tasks/hooks/use-task-selector-data";
import {
  getTaskSelectorArchiveFilter,
  getTaskSelectorListRef,
  type TaskSearchHrefBuilder,
  type TaskSearchSelectHandler,
} from "@/lib/tasks/task-selector";
import type { ArchiveFilter } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/custom/search-input";
import { ActionButton } from "@/components/custom/action-button";
import { EmptyMessage } from "@/components/custom/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskSelectorOptionContent } from "@/components/blocks/tasks/task-selector-option-content";
import { AppLink } from "@/lib/navigation";

const TAB_LABELS: Record<ArchiveFilter, string> = {
  active: "Active",
  archived: "Archived",
};

interface MobileSearchPanelProps {
  projectId?: Id<"projects">;
  onSelectTask: TaskSearchSelectHandler;
  getTaskHref: TaskSearchHrefBuilder;
  onClose: () => void;
}

export function MobileSearchPanel({ projectId, onSelectTask, getTaskHref, onClose }: MobileSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { query, setQuery, tab, setTab, hasQuery, isLoading, isLoadingMore, hasMore, results, loadMore, resetQuery } = useTaskSelectorData({
    projectId,
    enableSeededResults: false,
  });

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSelect = (index: number) => {
    const task = results[index];
    if (!task) return;
    onSelectTask(
      task.refId,
      getTaskSelectorArchiveFilter(task),
      getTaskSelectorListRef(task)
    );
    resetQuery();
    onClose();
  };

  const isModifiedClick = (event: MouseEvent<HTMLAnchorElement>) =>
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  return (
    <div className="flex h-full flex-col">
      {/* Header with search input */}
      <div className="border-b border-border px-3 py-1.5">
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length > 0) {
              e.preventDefault();
              setActiveIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, results.length - 1)));
            } else if (e.key === "ArrowUp" && results.length > 0) {
              e.preventDefault();
              setActiveIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === "Enter" && activeIndex >= 0) {
              e.preventDefault();
              handleSelect(activeIndex);
            }
          }}
          placeholder="Search tasks..."
          className="h-10 rounded-lg border-0 bg-muted/50 shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-muted/50"
          inputClassName="text-base"
          autoComplete="off"
          showClearButton={hasQuery}
          onClear={() => {
            setQuery("");
            setActiveIndex(-1);
            inputRef.current?.focus();
          }}
        />
      </div>

      {/* Tabs */}
      {hasQuery && (
        <div className="border-b border-border">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as ArchiveFilter);
              setActiveIndex(-1);
            }}
          >
            <TabsList variant="underline" className="px-4">
              {(Object.keys(TAB_LABELS) as ArchiveFilter[]).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {TAB_LABELS[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-2 pb-0">
        {!hasQuery ? (
          <EmptyMessage size="loose">Search for tasks by name or reference</EmptyMessage>
        ) : isLoading ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">Searching...</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">No tasks found</p>
        ) : (
          <div className="space-y-0.5">
            {results.map((task, index) => {
              const taskArchiveFilter = getTaskSelectorArchiveFilter(task);
              return (
                <AppLink
                  key={task._id}
                  href={getTaskHref(
                    task.refId,
                    taskArchiveFilter,
                    getTaskSelectorListRef(task)
                  )}
                  className={cn(
                    "block w-full cursor-pointer rounded-lg px-3 py-2.5 text-left active:bg-muted",
                    index === activeIndex && "bg-muted"
                  )}
                  onClick={(e) => {
                    if (isModifiedClick(e)) return;
                    e.preventDefault();
                    handleSelect(index);
                  }}
                >
                  <TaskSelectorOptionContent task={task} />
                </AppLink>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="py-2">
            <ActionButton
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 w-full"
              onClick={loadMore}
              busy={isLoadingMore}
              showIcon={false}
            >
              Show more
            </ActionButton>
          </div>
        )}

        <div className="shrink-0" style={{ height: MOBILE_NAV_BAR_CLEARANCE }} />
      </div>
    </div>
  );
}
