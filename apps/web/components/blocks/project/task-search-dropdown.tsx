"use client";

import type { MouseEvent } from "react";
import { useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskSelectorOptionContent } from "@/components/blocks/tasks/task-selector-option-content";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { AppLink } from "@/lib/navigation";

const TAB_LABELS: Record<ArchiveFilter, string> = {
  active: "Active",
  archived: "Archived",
};

interface TaskSearchDropdownProps {
  projectId?: Id<"projects">;
  onSelectTask: TaskSearchSelectHandler;
  getTaskHref: TaskSearchHrefBuilder;
}

export function TaskSearchDropdown({ projectId, onSelectTask, getTaskHref }: TaskSearchDropdownProps) {
  const listboxId = "task-search-results";
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { query, setQuery, tab, setTab, hasQuery, isLoading, isLoadingMore, hasMore, results, loadMore, resetQuery } = useTaskSelectorData({
    projectId,
    enableSeededResults: false,
  });

  const effectiveActiveIndex = open && results.length > 0 ? Math.min(Math.max(activeIndex, 0), results.length - 1) : -1;

  const handleSelect = (index: number) => {
    const task = results[index];
    if (!task) {
      return;
    }

    onSelectTask(
      task.refId,
      getTaskSelectorArchiveFilter(task),
      getTaskSelectorListRef(task)
    );
    resetQuery();
    setOpen(false);
  };

  const handleClearSearch = () => {
    resetQuery();
    setActiveIndex(-1);
    setOpen(false);
  };

  const isModifiedClick = (event: MouseEvent<HTMLAnchorElement>) =>
    event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

  return (
    <Popover open={open && hasQuery} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <SearchInput
            value={query}
            onFocus={() => {
              if (hasQuery) {
                setOpen(true);
              }
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setQuery(nextValue);
              setActiveIndex(-1);
              setOpen(nextValue.trim().length > 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                if (!hasQuery || results.length === 0) return;
                event.preventDefault();
                setOpen(true);
                setActiveIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, results.length - 1)));
                return;
              }

              if (event.key === "ArrowUp") {
                if (!hasQuery || results.length === 0) return;
                event.preventDefault();
                setOpen(true);
                setActiveIndex((prev) => Math.max(prev - 1, 0));
                return;
              }

              if (event.key === "Enter") {
                if (!hasQuery || !open || effectiveActiveIndex < 0 || effectiveActiveIndex >= results.length) {
                  return;
                }
                event.preventDefault();
                handleSelect(effectiveActiveIndex);
                return;
              }

              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && hasQuery}
            aria-controls={listboxId}
            aria-activedescendant={effectiveActiveIndex >= 0 ? `${listboxId}-${effectiveActiveIndex}` : undefined}
            placeholder="Search"
            className="h-8 w-96 rounded-full border-border bg-background"
            inputClassName="placeholder:text-muted-foreground"
            showClearButton={hasQuery}
            onClear={handleClearSearch}
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="end"
        className="w-130 p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target as Node;
          if (anchorRef.current?.contains(target)) {
            event.preventDefault();
          }
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as ArchiveFilter);
            setActiveIndex(-1);
          }}
        >
          <TabsList variant="underline">
            {(Object.keys(TAB_LABELS) as ArchiveFilter[]).map((value) => (
              <TabsTrigger key={value} value={value}>
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="max-h-80 overflow-y-auto p-2 pt-0">
          {isLoading ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">No tasks found</div>
          ) : (
            <div id={listboxId} role="listbox" className="space-y-1">
              {results.map((task, index) => {
                const taskArchiveFilter = getTaskSelectorArchiveFilter(task);

                return (
                  <AppLink
                    key={task._id}
                    id={`${listboxId}-${index}`}
                    href={getTaskHref(
                      task.refId,
                      taskArchiveFilter,
                      getTaskSelectorListRef(task)
                    )}
                    role="option"
                    aria-selected={index === effectiveActiveIndex}
                    className={cn(
                      "block w-full cursor-pointer rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-none",
                      index === effectiveActiveIndex && "bg-muted"
                    )}
                    onClick={(event) => {
                      if (isModifiedClick(event)) {
                        return;
                      }

                      event.preventDefault();
                      handleSelect(index);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <TaskSelectorOptionContent task={task} />
                  </AppLink>
                );
              })}
              {hasMore && (
                <ActionButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full cursor-pointer justify-center rounded-md text-muted-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    loadMore();
                  }}
                  busy={isLoadingMore}
                  showIcon={false}
                >
                  Load more
                </ActionButton>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
