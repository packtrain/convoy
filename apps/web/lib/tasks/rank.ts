import { LexoRank } from "lexorank";

type RankedTask = { _id: string; rank: string };

export type DuplicateRankRun<T extends RankedTask> = {
  duplicateRank: string;
  startIndex: number;
  endIndex: number;
  insertOffset: number;
  tasks: T[];
  prevDistinctRank: string | undefined;
  nextDistinctRank: string | undefined;
};

function parseRank(rank: string | undefined): LexoRank | null {
  if (!rank) return null;
  try {
    return LexoRank.parse(rank);
  } catch {
    return null;
  }
}

export function calculateRankBetween(
  prev: string | undefined,
  next: string | undefined
): string {
  const prevRank = parseRank(prev);
  const nextRank = parseRank(next);

  if (!prevRank && !nextRank) return LexoRank.middle().toString();
  if (!prevRank && nextRank) return nextRank.genPrev().toString();
  if (prevRank && !nextRank) return prevRank.genNext().toString();
  const prevBound = prevRank!;
  const nextBound = nextRank!;

  // Duplicate or inverted neighbors can happen from legacy/corrupted ranks.
  // `between` throws in those cases; recover by placing after `prev`.
  if (prevBound.toString().localeCompare(nextBound.toString()) >= 0) {
    return prevBound.genNext().toString();
  }

  try {
    return prevBound.between(nextBound).toString();
  } catch {
    return prevBound.genNext().toString();
  }
}

export function detectDuplicateRankRun<T extends RankedTask>(
  siblings: readonly T[],
  insertIndex: number
): DuplicateRankRun<T> | null {
  const prev = siblings[insertIndex - 1];
  const next = siblings[insertIndex];
  if (!prev || !next || prev.rank !== next.rank) return null;

  let startIndex = insertIndex - 1;
  while (
    startIndex > 0 &&
    siblings[startIndex - 1].rank === prev.rank
  ) {
    startIndex--;
  }

  let endIndex = insertIndex + 1;
  while (
    endIndex < siblings.length &&
    siblings[endIndex].rank === prev.rank
  ) {
    endIndex++;
  }

  return {
    duplicateRank: prev.rank,
    startIndex,
    endIndex,
    insertOffset: insertIndex - startIndex,
    tasks: siblings.slice(startIndex, endIndex),
    prevDistinctRank: siblings[startIndex - 1]?.rank,
    nextDistinctRank: siblings[endIndex]?.rank,
  };
}

export function redistributeRanks(
  prev: string | undefined,
  next: string | undefined,
  count: number
): string[] {
  if (count <= 0) return [];

  const prevRank = parseRank(prev);
  const nextRank = parseRank(next);

  if (prevRank && nextRank && prevRank.toString().localeCompare(nextRank.toString()) < 0) {
    try {
      const ranks: string[] = [];
      let lowerBound = prevRank;
      for (let i = 0; i < count; i++) {
        const rank = lowerBound.between(nextRank);
        ranks.push(rank.toString());
        lowerBound = rank;
      }
      return ranks;
    } catch {
      // Fall through to one-sided redistribution below. When a bounded gap
      // is exhausted, preserving strict ordering is more important than
      // staying inside an unusable gap.
    }
  }

  if (prevRank) {
    const ranks: string[] = [];
    let lowerBound = prevRank;
    for (let i = 0; i < count; i++) {
      lowerBound = lowerBound.genNext();
      ranks.push(lowerBound.toString());
    }
    return ranks;
  }

  if (nextRank) {
    const ranks: string[] = [];
    let upperBound = nextRank;
    for (let i = 0; i < count; i++) {
      upperBound = upperBound.genPrev();
      ranks.unshift(upperBound.toString());
    }
    return ranks;
  }

  const ranks: string[] = [];
  let rank = LexoRank.middle();
  for (let i = 0; i < count; i++) {
    ranks.push(rank.toString());
    rank = rank.genNext();
  }
  return ranks;
}

export function resolveInsertIndex(
  ids: string[],
  options?: { afterId?: string; beforeId?: string }
): number {
  if (options?.afterId) {
    const index = ids.indexOf(options.afterId);
    return index === -1 ? ids.length : index + 1;
  }

  if (options?.beforeId) {
    const index = ids.indexOf(options.beforeId);
    // Intentional asymmetry: unresolved "before" falls back to start so
    // "add-at-top" callers keep top insertion behavior.
    return index === -1 ? 0 : index;
  }

  return ids.length;
}
