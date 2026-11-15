import type { ReorderPosition, TaskUpdate } from "@/lib/tasks/types";
import { calculateRankBetween } from "@/lib/tasks/rank";

/**
 * Pure planning model for Board drag-and-drop: encode/decode dnd-kit ids and map a drop
 * onto a persistence plan.
 *
 * Card rank math never happens here — a plan only names a visible neighbor and a position,
 * and `useTasks` resolves the LexoRank against the full loaded List order (hidden siblings
 * included). Column reordering is the exception: the label list is fully loaded, so
 * `planBoardColumnReorder` computes the rank directly.
 */

export type BoardDropIntent =
  | { type: "group-top"; columnId: string }
  | { type: "group-bottom"; columnId: string }
  | { type: "card"; targetTaskId: string; position: ReorderPosition }
  | { type: "card-into"; targetTaskId: string };

export interface BoardRankTarget {
  targetTaskId: string;
  position: ReorderPosition;
}

export type BoardDropPlan =
  | { kind: "reorder"; rankTarget: BoardRankTarget }
  | { kind: "move"; fieldUpdates: TaskUpdate; rankTarget?: BoardRankTarget }
  // Dropping onto a card's center makes the source its subtask. Reparenting
  // only touches parent + rank (appended under the new parent); the grouping
  // field stays as-is because the card leaves the root-only board anyway.
  | { kind: "make-subtask"; parentTaskId: string };

/** Structural subset of a Board column the planner needs. */
export interface BoardDropColumn {
  id: string;
  cards: ReadonlyArray<{ task: { _id: string } }>;
  /** Grouping-field payload applied on cross-group drops; undefined = not droppable. */
  dropTarget?: TaskUpdate;
  /** Board rows: one entry per axis. Cross-cell drops write only the axes that change. */
  axes?: ReadonlyArray<{ groupId: string; dropTarget?: TaskUpdate }>;
}

/** Field updates for moving a card between groups (or cells); undefined = not droppable. */
export function getBoardMoveUpdates(
  source: BoardDropColumn,
  target: BoardDropColumn
): TaskUpdate | undefined {
  if (!target.axes) {
    return target.dropTarget;
  }

  const changed = target.axes.filter((axis, index) => axis.groupId !== source.axes?.[index]?.groupId);
  if (changed.some((axis) => !axis.dropTarget)) {
    return undefined;
  }
  return Object.assign({}, ...changed.map((axis) => axis.dropTarget));
}

const TASK_DRAG_PREFIX = "task:";
const CARD_DROP_PREFIX = "card:";
const CARD_INTO_DROP_PREFIX = "card-into:";
const COLUMN_TOP_DROP_PREFIX = "column-top:";
const COLUMN_BODY_DROP_PREFIX = "column:";

export function boardTaskDragId(taskId: string): string {
  return `${TASK_DRAG_PREFIX}${taskId}`;
}

export function parseBoardTaskDragId(id: string): string | null {
  if (!id.startsWith(TASK_DRAG_PREFIX)) {
    return null;
  }

  return id.slice(TASK_DRAG_PREFIX.length);
}

export function boardCardDropId(taskId: string, position: ReorderPosition): string {
  return `${CARD_DROP_PREFIX}${taskId}:${position}`;
}

export function boardCardIntoDropId(taskId: string): string {
  return `${CARD_INTO_DROP_PREFIX}${taskId}`;
}

// Column reordering (label grouping): the whole column drags via its header;
// dedicated droppables keep column drops separate from the card drop zones.
const COLUMN_DRAG_PREFIX = "column-drag:";
const COLUMN_REORDER_DROP_PREFIX = "column-reorder:";

export function boardColumnDragId(columnId: string): string {
  return `${COLUMN_DRAG_PREFIX}${columnId}`;
}

export function parseBoardColumnDragId(id: string): string | null {
  if (!id.startsWith(COLUMN_DRAG_PREFIX)) {
    return null;
  }

  return id.slice(COLUMN_DRAG_PREFIX.length);
}

export function boardColumnReorderDropId(columnId: string): string {
  return `${COLUMN_REORDER_DROP_PREFIX}${columnId}`;
}

export function parseBoardColumnReorderDropId(id: string): string | null {
  if (!id.startsWith(COLUMN_REORDER_DROP_PREFIX)) {
    return null;
  }

  return id.slice(COLUMN_REORDER_DROP_PREFIX.length);
}

export function isBoardColumnReorderDropId(id: string): boolean {
  return id.startsWith(COLUMN_REORDER_DROP_PREFIX);
}

/**
 * Rank plan for dropping a label column at a boundary. `targetLabelId: null`
 * means the drop landed around the leading "No label" column → start of the
 * label list. Returns null for no-op drops (same position) and unknown ids.
 */
export function planBoardColumnReorder({
  orderedRanks,
  draggedLabelId,
  targetLabelId,
  side,
}: {
  /** Labels in current rank order. */
  orderedRanks: readonly { id: string; rank: string }[];
  draggedLabelId: string;
  targetLabelId: string | null;
  side: "left" | "right";
}): { rank: string } | null {
  const ids = orderedRanks.map((label) => label.id);
  const from = ids.indexOf(draggedLabelId);
  if (from === -1) {
    return null;
  }

  const targetIndex = targetLabelId ? ids.indexOf(targetLabelId) : 0;
  if (targetIndex === -1) {
    return null;
  }

  const boundary = targetLabelId ? targetIndex + (side === "right" ? 1 : 0) : 0;
  const without = orderedRanks.filter((label) => label.id !== draggedLabelId);
  const insertIndex = boundary > from ? boundary - 1 : boundary;
  if (insertIndex === from) {
    return null;
  }

  return {
    rank: calculateRankBetween(without[insertIndex - 1]?.rank, without[insertIndex]?.rank),
  };
}

export function boardColumnTopDropId(columnId: string): string {
  return `${COLUMN_TOP_DROP_PREFIX}${columnId}`;
}

export function boardColumnBodyDropId(columnId: string): string {
  return `${COLUMN_BODY_DROP_PREFIX}${columnId}`;
}

export function parseBoardDropId(id: string): BoardDropIntent | null {
  if (id.startsWith(CARD_INTO_DROP_PREFIX)) {
    return { type: "card-into", targetTaskId: id.slice(CARD_INTO_DROP_PREFIX.length) };
  }

  if (id.startsWith(CARD_DROP_PREFIX)) {
    const rest = id.slice(CARD_DROP_PREFIX.length);
    // Task ids never contain ":", so the last separator splits id and position.
    const separatorIndex = rest.lastIndexOf(":");
    if (separatorIndex <= 0) {
      return null;
    }

    const targetTaskId = rest.slice(0, separatorIndex);
    const position = rest.slice(separatorIndex + 1);
    if (position !== "before" && position !== "after") {
      return null;
    }

    return { type: "card", targetTaskId, position };
  }

  if (id.startsWith(COLUMN_TOP_DROP_PREFIX)) {
    return { type: "group-top", columnId: id.slice(COLUMN_TOP_DROP_PREFIX.length) };
  }

  if (id.startsWith(COLUMN_BODY_DROP_PREFIX)) {
    return { type: "group-bottom", columnId: id.slice(COLUMN_BODY_DROP_PREFIX.length) };
  }

  return null;
}

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function isPointWithinRect(point: BoardPoint, rect: BoardRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

function getCardTaskIds(column: BoardDropColumn): string[] {
  return column.cards.map((card) => String(card.task._id));
}

function resolveRankTarget(
  intent: BoardDropIntent,
  cardTaskIds: readonly string[]
): BoardRankTarget | null {
  if (intent.type === "card") {
    return { targetTaskId: intent.targetTaskId, position: intent.position };
  }

  // Empty groups have no rank anchor: a drop only changes the grouping field.
  if (cardTaskIds.length === 0) {
    return null;
  }

  return intent.type === "group-top"
    ? { targetTaskId: cardTaskIds[0], position: "before" }
    : { targetTaskId: cardTaskIds[cardTaskIds.length - 1], position: "after" };
}

function isSameGroupNoOp(
  sourceTaskId: string,
  rankTarget: BoardRankTarget,
  cardTaskIds: readonly string[]
): boolean {
  if (rankTarget.targetTaskId === sourceTaskId) {
    return true;
  }

  const sourceIndex = cardTaskIds.indexOf(sourceTaskId);
  const targetIndex = cardTaskIds.indexOf(rankTarget.targetTaskId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return false;
  }

  // Dropping onto the facing edge of an adjacent visible card leaves the
  // visible order unchanged.
  if (rankTarget.position === "before") {
    return targetIndex === sourceIndex + 1;
  }

  return targetIndex === sourceIndex - 1;
}

export function planBoardDrop({
  sourceTaskId,
  dropId,
  columns,
}: {
  sourceTaskId: string;
  dropId: string;
  columns: readonly BoardDropColumn[];
}): BoardDropPlan | null {
  const intent = parseBoardDropId(dropId);
  if (!intent) {
    return null;
  }

  const sourceColumn = columns.find((column) =>
    getCardTaskIds(column).includes(sourceTaskId)
  );
  if (!sourceColumn) {
    return null;
  }

  if (intent.type === "card-into") {
    // Board cards are all root tasks, so the only circular-parent case a drop
    // can produce is self-parenting; deeper cycles are re-checked server-side.
    if (intent.targetTaskId === sourceTaskId) {
      return null;
    }

    const hasTarget = columns.some((column) =>
      getCardTaskIds(column).includes(intent.targetTaskId)
    );
    return hasTarget ? { kind: "make-subtask", parentTaskId: intent.targetTaskId } : null;
  }

  const targetColumn =
    intent.type === "card"
      ? columns.find((column) => getCardTaskIds(column).includes(intent.targetTaskId))
      : columns.find((column) => column.id === intent.columnId);
  if (!targetColumn) {
    return null;
  }

  const targetCardTaskIds = getCardTaskIds(targetColumn);
  const rankTarget = resolveRankTarget(intent, targetCardTaskIds);

  if (targetColumn.id === sourceColumn.id) {
    if (!rankTarget || isSameGroupNoOp(sourceTaskId, rankTarget, targetCardTaskIds)) {
      return null;
    }

    return { kind: "reorder", rankTarget };
  }

  const fieldUpdates = getBoardMoveUpdates(sourceColumn, targetColumn);
  if (!fieldUpdates) {
    return null;
  }

  return {
    kind: "move",
    fieldUpdates,
    ...(rankTarget ? { rankTarget } : {}),
  };
}

export type BoardKeyboardDirection = "up" | "down" | "left" | "right";

export interface BoardKeyboardZone {
  id: string;
  rect: BoardRect;
}

function rectCenter(rect: BoardRect): BoardPoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function containsX(rect: BoardRect, x: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width;
}

/**
 * Where a keyboard-dragged card's center goes next. Up/down step through the
 * card edge zones of its column; left/right enter the neighboring column at
 * the nearest card edge, or its body when it is empty. Null means stay put.
 */
export function planBoardKeyboardTarget({
  direction,
  center,
  zones,
}: {
  direction: BoardKeyboardDirection;
  center: BoardPoint;
  zones: readonly BoardKeyboardZone[];
}): BoardPoint | null {
  const edgeZones = zones
    .map((zone) => ({ zone, intent: parseBoardDropId(zone.id) }))
    .filter((entry) => entry.intent?.type === "card")
    .map(({ zone, intent }) => ({
      rect: zone.rect,
      center: rectCenter(zone.rect),
      position: intent?.type === "card" ? intent.position : "before",
    }));

  if (direction === "up" || direction === "down") {
    const position = direction === "down" ? "after" : "before";
    const candidates = edgeZones.filter(
      (zone) =>
        zone.position === position &&
        containsX(zone.rect, center.x) &&
        (direction === "down" ? zone.center.y > center.y + 1 : zone.center.y < center.y - 1)
    );
    if (candidates.length === 0) return null;
    const nearest = candidates.reduce((best, zone) =>
      Math.abs(zone.center.y - center.y) < Math.abs(best.center.y - center.y) ? zone : best
    );
    return nearest.center;
  }

  const columns = zones
    .filter((zone) => parseBoardDropId(zone.id)?.type === "group-bottom")
    .map((zone) => ({ rect: zone.rect, center: rectCenter(zone.rect) }))
    .filter((column) =>
      direction === "right" ? column.center.x > center.x + 1 : column.center.x < center.x - 1
    );
  if (columns.length === 0) return null;
  const column = columns.reduce((best, candidate) => {
    const distance = (entry: typeof candidate) =>
      Math.abs(entry.center.x - center.x) * 1000 + Math.abs(entry.center.y - center.y);
    return distance(candidate) < distance(best) ? candidate : best;
  });

  const columnEdges = edgeZones.filter((zone) => containsX(column.rect, zone.center.x));
  if (columnEdges.length === 0) {
    const top = column.rect.top + 1;
    const bottom = column.rect.top + column.rect.height - 1;
    return { x: column.center.x, y: Math.min(Math.max(center.y, top), bottom) };
  }
  return columnEdges.reduce((best, zone) =>
    Math.abs(zone.center.y - center.y) < Math.abs(best.center.y - center.y) ? zone : best
  ).center;
}
