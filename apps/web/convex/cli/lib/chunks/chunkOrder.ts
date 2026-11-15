export type ChunkOrderComparable = {
  createdAt: number;
  messageId: string;
  chunkOrder: number;
};

export function compareChunkOrder(
  a: ChunkOrderComparable,
  b: ChunkOrderComparable
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }

  if (a.messageId !== b.messageId) {
    return a.messageId < b.messageId ? -1 : 1;
  }

  return a.chunkOrder - b.chunkOrder;
}

export function compareChunkOrderDesc(
  a: ChunkOrderComparable,
  b: ChunkOrderComparable
): number {
  return compareChunkOrder(b, a);
}

/**
 * K-way merge of per-group chunk arrays — each group already sorted ascending
 * in composite order — into one ascending stream. Avoids an `Array.sort` over
 * the combined set, keeping work bounded by the group/row counts.
 */
export function mergeOrderedChunkGroups<T extends ChunkOrderComparable>(
  groups: T[][]
): T[] {
  const positions = groups.map(() => 0);
  const merged: T[] = [];

  while (true) {
    let nextGroupIndex = -1;
    let nextChunk: T | null = null;

    for (const [groupIndex, group] of groups.entries()) {
      const candidate = group[positions[groupIndex]];
      if (!candidate) {
        continue;
      }
      if (!nextChunk || compareChunkOrder(candidate, nextChunk) < 0) {
        nextChunk = candidate;
        nextGroupIndex = groupIndex;
      }
    }

    if (!nextChunk || nextGroupIndex === -1) {
      break;
    }

    merged.push(nextChunk);
    positions[nextGroupIndex] += 1;
  }

  return merged;
}
