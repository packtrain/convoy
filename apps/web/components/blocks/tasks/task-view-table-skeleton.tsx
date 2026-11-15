import { Skeleton } from "@/components/ui/skeleton";
import { ROW_HEIGHT } from "@/lib/tasks/constants";

// Body-only skeleton for a task list/table view. Used by the task-views page
// (inside the shell skeleton and on its own during view transitions) and by
// the thread Tasks panel while a list switch reloads. Rows use the real row
// height so nothing shifts when data arrives.
export function TaskViewTableSkeleton() {
  return (
    <div data-testid="task-view-skeleton-table" className="flex-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          data-testid="task-view-skeleton-row"
          className="flex items-center gap-3 border-b border-border px-4"
          style={{ height: ROW_HEIGHT }}
        >
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// Card-layout counterpart, shaped like `KanbanCard` in `MobileTaskList`.
export function TaskViewCardsSkeleton() {
  return (
    <div data-testid="task-view-skeleton-cards" className="flex-1 space-y-2 px-3 pt-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card dark:border-transparent"
        >
          <div className="px-3 pt-3 pb-1">
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <Skeleton className="h-4 w-16" />
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="size-4" />
              <Skeleton className="size-4 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
