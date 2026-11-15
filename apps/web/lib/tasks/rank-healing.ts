import type { Id } from "@/convex/_generated/dataModel";
import { detectDuplicateRankRun, redistributeRanks } from "@/lib/tasks/rank";

type RankHealingTask = {
  _id: string;
  rank: string;
};

type RankUpdate = { id: Id<"tasks">; rank: string };

export function buildDuplicateRankHealingUpdates(
  siblings: readonly RankHealingTask[],
  insertIndex: number,
  insertedIds: readonly string[]
): RankUpdate[] | null {
  const duplicateRun = detectDuplicateRankRun(siblings, insertIndex);
  if (!duplicateRun) return null;

  const ranks = redistributeRanks(
    duplicateRun.prevDistinctRank,
    duplicateRun.nextDistinctRank,
    duplicateRun.tasks.length + insertedIds.length
  );
  const rankedItems = [
    ...duplicateRun.tasks.slice(0, duplicateRun.insertOffset),
    ...insertedIds.map((id) => ({ _id: id })),
    ...duplicateRun.tasks.slice(duplicateRun.insertOffset),
  ];

  return rankedItems.map((item, index) => ({
    id: item._id as Id<"tasks">,
    rank: ranks[index],
  }));
}
