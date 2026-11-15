import { Skeleton } from "@/components/ui/skeleton";
import { TaskViewTableSkeleton } from "@/components/blocks/tasks/task-view-table-skeleton";
import type { ProjectViewMode } from "@/lib/navigation";
import { BoardSkeleton } from "@/components/blocks/board/board-skeleton";

export { TaskViewTableSkeleton };

// Full-screen shell skeleton: header placeholder + view body. Shared by the shell's own loading
// gate and the route-level `loading.tsx`, so route entry and first paint look identical.
// `viewMode` is optional because `loading.tsx` runs on the server before client view state is
// known; it defaults to the list/table layout.
export function TaskViewShellSkeleton({
  viewMode,
}: {
  viewMode?: ProjectViewMode;
}) {
  return (
    <div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
      {/* The project header is desktop-only (hidden md:flex), so its skeleton is too. */}
      <div className="hidden items-center justify-between border-b border-border px-4 py-3 md:flex">
        <Skeleton className="h-6 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      {viewMode === "board" ? <BoardSkeleton /> : <TaskViewTableSkeleton />}
    </div>
  );
}
