import { Skeleton } from "@/components/ui/skeleton";

const BOARD_SKELETON_CARD_COUNTS = [3, 2, 4, 1];

function BoardColumnSkeleton({ cardCount }: { cardCount: number }) {
  return (
    <div className="flex min-h-full w-[92.5vw] min-w-[92.5vw] flex-none flex-col border-r border-border max-md:first:border-l md:w-80 md:min-w-80">
      {/* h-10 matches BoardColumn's header exactly, so the board doesn't shift
          when the real columns replace the skeleton. */}
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <Skeleton className="size-4" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex flex-col gap-3 p-3">
        {Array.from({ length: cardCount }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Board-shaped loading state shared by the shell and the board route. */
export function BoardSkeleton() {
  return (
    <div data-testid="task-view-skeleton-board" className="h-full flex-1 overflow-hidden">
      <div className="flex h-full min-w-max px-[3.75vw] md:px-0">
        {BOARD_SKELETON_CARD_COUNTS.map((cardCount, i) => (
          <BoardColumnSkeleton key={i} cardCount={cardCount} />
        ))}
      </div>
    </div>
  );
}
