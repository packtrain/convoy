/** Lane slots entering (`before`) and leaving (`after`) a commit's row; each slot waits for one hash. */
export interface GraphRow {
  lane: number;
  before: (string | null)[];
  after: (string | null)[];
}

const firstFree = (lanes: (string | null)[]) => {
  const index = lanes.indexOf(null);
  return index === -1 ? lanes.length : index;
};

/**
 * Lane layout over newest-first (topo-ordered) commits (OS-2536): a commit takes
 * the lane waiting for it, its first parent keeps that lane, extra parents open lanes.
 */
export function layoutGraph(commits: readonly { hash: string; parents: readonly string[] }[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  return commits.map(({ hash, parents }) => {
    const before = [...lanes];
    let lane = lanes.indexOf(hash);
    if (lane === -1) {
      lane = firstFree(lanes);
    }
    // Other lanes waiting for this commit join it here.
    lanes.forEach((waiting, index) => {
      if (waiting === hash && index !== lane) {
        lanes[index] = null;
      }
    });
    const [first, ...rest] = parents;
    lanes[lane] = first ?? null;
    for (const parent of rest) {
      if (!lanes.includes(parent)) {
        lanes[firstFree(lanes)] = parent;
      }
    }
    while (lanes.length > 0 && lanes.at(-1) === null) {
      lanes.pop();
    }
    return { lane, before, after: [...lanes] };
  });
}

/** Lanes the graph column needs for these rows. */
export const graphLanes = (rows: readonly GraphRow[]) =>
  rows.reduce((lanes, row) => Math.max(lanes, row.before.length, row.after.length, row.lane + 1), 1);
