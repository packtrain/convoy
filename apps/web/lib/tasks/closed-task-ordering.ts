import type { Status as TaskStatus } from "./status";
import { isClosedStatus } from "./status-policy";
import { redistributeRanks } from "./rank";

export type ClosedTaskOrderingItem<TId extends string = string> = {
  _id: TId;
  rank: string;
  status: TaskStatus;
};

export type ClosedTaskRankUpdate<TId extends string = string> = {
  id: TId;
  rank: string;
};

export type ClosedTaskOrderingPlan<TId extends string = string> = {
  movedCount: number;
  updates: ClosedTaskRankUpdate<TId>[];
};

export function planClosedTasksToBottom<TId extends string>(
  orderedRoots: readonly ClosedTaskOrderingItem<TId>[]
): ClosedTaskOrderingPlan<TId> {
  const firstClosedIndex = orderedRoots.findIndex((task) =>
    isClosedStatus(task.status)
  );
  if (firstClosedIndex === -1) {
    return { movedCount: 0, updates: [] };
  }

  const lastOpenIndex = orderedRoots.findLastIndex(
    (task) => !isClosedStatus(task.status)
  );
  if (lastOpenIndex < firstClosedIndex) {
    return { movedCount: 0, updates: [] };
  }

  const closedBeforeLastOpen = orderedRoots
    .slice(0, lastOpenIndex + 1)
    .filter((task) => isClosedStatus(task.status));
  const openAfterFirstClosed = orderedRoots
    .slice(firstClosedIndex)
    .filter((task) => !isClosedStatus(task.status));

  if (
    openAfterFirstClosed.length > 0 &&
    openAfterFirstClosed.length < closedBeforeLastOpen.length
  ) {
    // OS-808 asks to move whichever side requires fewer rank writes.
    const previousOpenBeforeFirstClosed = orderedRoots
      .slice(0, firstClosedIndex)
      .findLast((task) => !isClosedStatus(task.status));
    const firstClosed = orderedRoots[firstClosedIndex];
    const ranks = redistributeRanks(
      previousOpenBeforeFirstClosed?.rank,
      firstClosed.rank,
      openAfterFirstClosed.length
    );

    return {
      movedCount: openAfterFirstClosed.length,
      updates: openAfterFirstClosed.map((task, index) => ({
        id: task._id,
        rank: ranks[index],
      })),
    };
  }

  const lastOpen = orderedRoots[lastOpenIndex];
  const nextClosedAfterLastOpen = orderedRoots
    .slice(lastOpenIndex + 1)
    .find((task) => isClosedStatus(task.status));
  const ranks = redistributeRanks(
    lastOpen.rank,
    nextClosedAfterLastOpen?.rank,
    closedBeforeLastOpen.length
  );

  return {
    movedCount: closedBeforeLastOpen.length,
    updates: closedBeforeLastOpen.map((task, index) => ({
      id: task._id,
      rank: ranks[index],
    })),
  };
}
