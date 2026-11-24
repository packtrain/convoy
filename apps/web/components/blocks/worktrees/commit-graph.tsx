import type { GraphRow } from "@/lib/worktrees/commit-graph";
import { cn } from "@/lib/utils";

const LANE_WIDTH = 14;
const PAD = 8;
const COLORS = ["var(--info)", "var(--warning)", "var(--success)", "var(--chart-4)", "var(--chart-5)"];
const color = (lane: number) => COLORS[lane % COLORS.length];
const x = (lane: number) => PAD + lane * LANE_WIDTH;

/** Pixel width of a graph column with this many lanes. */
export const graphWidth = (lanes: number) => PAD * 2 + (lanes - 1) * LANE_WIDTH;

function edge(x1: number, y1: number, x2: number, y2: number) {
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const middle = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}

/**
 * One row's slice of the commit graph (OS-2536): lines passing through, lanes
 * joining the node, and edges to its parents. Open lanes run off the bottom edge.
 */
export function GraphCell({
  row,
  hash,
  parents,
  lanes,
  height,
  head,
  selected,
}: {
  row: GraphRow;
  hash: string;
  parents: readonly string[];
  lanes: number;
  height: number;
  /** Fills the node: the checkout's HEAD. */
  head: boolean;
  /** An open node takes the row's tint; the row must carry `group` for hover. */
  selected: boolean;
}) {
  const middle = height / 2;
  const nodeX = x(row.lane);
  const paths: { d: string; lane: number }[] = [];
  row.before.forEach((waiting, index) => {
    if (waiting !== null) {
      paths.push({ d: waiting === hash ? edge(x(index), 0, nodeX, middle) : edge(x(index), 0, x(index), height), lane: index });
    }
  });
  for (const parent of parents) {
    const target = row.after[row.lane] === parent ? row.lane : row.after.indexOf(parent);
    if (target !== -1) {
      paths.push({ d: edge(nodeX, middle, x(target), height), lane: target });
    }
  }
  return (
    <svg width={graphWidth(lanes)} height={height} className="shrink-0" aria-hidden="true">
      {paths.map((path, index) => (
        <path key={index} d={path.d} fill="none" stroke={color(path.lane)} strokeWidth={1.5} />
      ))}
      <circle
        cx={nodeX}
        cy={middle}
        r={parents.length > 1 ? 3 : 4}
        fill={head ? color(row.lane) : undefined}
        className={cn(!head && (selected ? "fill-muted" : "fill-background group-hover:fill-muted"))}
        stroke={color(row.lane)}
        strokeWidth={1.5}
      />
    </svg>
  );
}
