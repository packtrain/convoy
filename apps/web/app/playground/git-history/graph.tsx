import type { Commit } from "./fixtures";

/** Lane slots entering (`before`) and leaving (`after`) a row; each slot waits for one hash. */
export interface GraphRow {
  lane: number;
  before: (string | null)[];
  after: (string | null)[];
  parents: string[];
}

const firstFree = (lanes: (string | null)[]) => {
  const index = lanes.indexOf(null);
  return index === -1 ? lanes.length : index;
};

/** Lane layout over newest-first commits: a commit takes the lane waiting for it, its first parent keeps it. */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  return commits.map((commit) => {
    const before = [...lanes];
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = firstFree(lanes);
    }
    // Every other lane waiting for this commit ends here (a branch joining).
    lanes.forEach((hash, index) => {
      if (hash === commit.hash && index !== lane) lanes[index] = null;
    });
    const [first, ...rest] = commit.parents;
    lanes[lane] = first ?? null;
    for (const parent of rest) {
      if (!lanes.includes(parent)) lanes[firstFree(lanes)] = parent;
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    return { lane, before, after: [...lanes], parents: commit.parents };
  });
}

export const graphLanes = (rows: GraphRow[]) => Math.max(1, ...rows.map((row) => Math.max(row.before.length, row.after.length, row.lane + 1)));

const LANE_WIDTH = 14;
const PAD = 8;
const COLORS = ["var(--info)", "var(--warning)", "var(--success)", "var(--chart-4)", "var(--chart-5)"];
const color = (lane: number) => COLORS[lane % COLORS.length];
const x = (lane: number) => PAD + lane * LANE_WIDTH;
export const graphWidth = (lanes: number) => PAD * 2 + (lanes - 1) * LANE_WIDTH;

function edge(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const middle = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}

/** One row's slice of the graph: pass-through lines, lanes joining the node, and edges to its parents. */
export function GraphCell({ row, hash, lanes, height, head }: { row: GraphRow; hash: string; lanes: number; height: number; head: boolean }) {
  const middle = height / 2;
  const nodeX = x(row.lane);
  const paths: { d: string; lane: number }[] = [];
  row.before.forEach((waiting, index) => {
    if (waiting === null) return;
    paths.push(waiting === hash ? { d: edge(x(index), 0, nodeX, middle), lane: index } : { d: edge(x(index), 0, x(index), height), lane: index });
  });
  for (const parent of row.parents) {
    const target = row.after[row.lane] === parent ? row.lane : row.after.indexOf(parent);
    if (target !== -1) paths.push({ d: edge(nodeX, middle, x(target), height), lane: target });
  }
  const merge = row.parents.length > 1;
  return (
    <svg width={graphWidth(lanes)} height={height} className="shrink-0 overflow-visible" aria-hidden="true">
      {paths.map((path, index) => (
        <path key={index} d={path.d} fill="none" stroke={color(path.lane)} strokeWidth={1.5} />
      ))}
      <circle
        cx={nodeX}
        cy={middle}
        r={merge ? 3 : 4}
        fill={head ? color(row.lane) : "var(--background)"}
        stroke={color(row.lane)}
        strokeWidth={1.5}
      />
    </svg>
  );
}
