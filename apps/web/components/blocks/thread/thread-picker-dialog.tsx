"use client";

import { useMemo, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { useCliThreads } from "@/lib/threads/hooks/use-cli-threads";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/custom/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CompactThreadDestinationContent } from "./compact-thread-destination-content";

interface ThreadPickerDialogProps {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (threadId: Id<"cliThreads">) => void;
}

/** cmdk quick-open for picking any project thread, filtered by title. */
export function ThreadPickerDialog({
  projectId,
  open,
  onOpenChange,
  onSelect,
}: ThreadPickerDialogProps) {
  const [query, setQuery] = useState("");
  const { threads, isLoading, hasMore, isLoadingMore, loadMore } = useCliThreads(
    open ? projectId : undefined,
    { sortBy: "lastActivity" }
  );
  // `listByProject` pages the roots, and a container is a root — but it has no
  // composer of its own (its URL redirects to a child tab), so picking one
  // dropped the caller's message on a draft key nothing reads (OS-1716).
  const selectableThreads = useMemo(
    () => threads.filter((thread) => thread.kind === undefined),
    [threads]
  );

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="h-[32rem] sm:max-w-xl overflow-hidden border-none p-0 outline outline-border"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Select thread</DialogTitle>
        <DialogDescription className="sr-only">
          Search project threads and select one.
        </DialogDescription>
        <Command className="rounded-xl">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search threads..."
            autoFocus
            showClearButton={query.length > 0}
            onClear={() => setQuery("")}
          />
          <CommandList className="mt-1 min-h-0 max-h-[none] flex-1">
            {isLoading ? (
              <div className="space-y-1 p-1" aria-busy="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex flex-col gap-1.5 px-2 py-1.5">
                    <Skeleton className="h-4 w-3/4 rounded-sm" />
                    <Skeleton className="h-3 w-1/3 rounded-sm" />
                  </div>
                ))}
              </div>
            ) : selectableThreads.length === 0 && !hasMore ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">No threads found</div>
            ) : (
              <div className="space-y-1 p-1">
                {selectableThreads.map((thread) => (
                  <CommandItem
                    key={thread._id}
                    className="group w-full cursor-pointer p-0"
                    showCheckIcon={false}
                    value={`${thread.title} ${thread._id}`}
                    onSelect={() => {
                      onSelect(thread._id);
                      handleOpenChange(false);
                    }}
                  >
                    <CompactThreadDestinationContent
                      thread={thread}
                      className="w-full px-2 py-1.5"
                    />
                  </CommandItem>
                ))}
                {hasMore && (
                  <CommandItem
                    value="-"
                    forceMount
                    className="w-full cursor-pointer justify-center text-muted-foreground"
                    showCheckIcon={false}
                    onSelect={loadMore}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <Spinner
                        className="text-muted-foreground"
                        text="Loading…"
                        textClassName="text-current"
                        textPlacement="inline"
                      />
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
