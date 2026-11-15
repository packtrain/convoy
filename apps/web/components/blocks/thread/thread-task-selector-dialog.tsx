"use client";

import { useRef, type MouseEvent } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useTaskSelectorData } from "@/lib/tasks/hooks/use-task-selector-data";
import type { TaskSelectorOption } from "@/lib/tasks/task-selector";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/custom/spinner";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TaskSelectorOptionContent } from "@/components/blocks/tasks/task-selector-option-content";
import { AppLink } from "@/lib/navigation";

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

interface ThreadTaskSelectorDialogProps {
  projectId?: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTask: (task: TaskSelectorOption) => void;
  getTaskHref: (task: TaskSelectorOption) => string;
}

export function ThreadTaskSelectorDialog({ projectId, open, onOpenChange, onSelectTask, getTaskHref }: ThreadTaskSelectorDialogProps) {
  const { query, setQuery, hasQuery, isLoading, isLoadingMore, hasMore, results, loadMore, resetQuery } = useTaskSelectorData({
    projectId,
    // Only while open — one of these is mounted per composer (OS-1719).
    enableSeededResults: open,
    archiveMode: "active",
  });
  const skipNextSelectRef = useRef(false);

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetQuery();
    }
  };

  const handleSelectTask = (task: TaskSelectorOption) => {
    onSelectTask(task);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[32rem] sm:max-w-xl overflow-hidden border-none p-0 outline outline-border" showCloseButton={false}>
        <DialogTitle className="sr-only">Attach task</DialogTitle>
        <DialogDescription className="sr-only">Search active project tasks and select one to attach.</DialogDescription>
        <Command shouldFilter={false} className="rounded-xl">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search tasks..."
            autoFocus
            showClearButton={hasQuery}
            onClear={resetQuery}
          />
          <CommandList className="mt-1 min-h-0 max-h-none flex-1">
            {isLoading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{hasQuery ? "No tasks found" : "No recent tasks available"}</div>
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
