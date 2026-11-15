import { ROW_HEIGHT } from "@/lib/tasks/constants";
import type { BoardTaskColumn } from "./groups";
import {
  isAddTaskPlaceholder,
  isInlineTaskDraftRow,
  type FlattenedRow,
  type Task,
  type TaskSectionRow,
} from "@/lib/tasks/types";

/** Group id of the root task a row belongs to. */
export function groupOfRow(
  row: FlattenedRow,
  byId: ReadonlyMap<string, Task>,
  tasks: Task[],
  groupByRoot: ReadonlyMap<string, string>,
): string | undefined {
  let root: Task | undefined = isInlineTaskDraftRow(row)
    ? row.parentId
      ? byId.get(row.parentId)
      : tasks.find(
          (task) => task.clientId === (row.beforeClientId ?? row.afterClientId),
        )
    : isAddTaskPlaceholder(row)
      ? byId.get(row.parentId)
      : row;
  const seen = new Set<string>();
  while (root?.parentId && !seen.has(String(root._id))) {
    seen.add(String(root._id));
    const parent = byId.get(root.parentId);
    if (!parent) break;
    root = parent;
  }
  return root ? groupByRoot.get(String(root._id)) : undefined;
}

export function groupIndex(tasks: Task[], groups: BoardTaskColumn[]) {
  return {
    byId: new Map(tasks.map((task) => [String(task._id), task])),
    groupByRoot: new Map(
      groups.flatMap((group) =>
        group.cards.map((card) => [String(card.task._id), group.id] as const),
      ),
    ),
  };
}

export function groupRows(
  rows: FlattenedRow[],
  groups: BoardTaskColumn[],
  tasks: Task[],
  collapsed: ReadonlySet<string>,
  canCreate = false,
  headerHeight = ROW_HEIGHT,
) {
  const { byId, groupByRoot } = groupIndex(tasks, groups);
  const buckets = new Map<string, FlattenedRow[]>();
  const loose: FlattenedRow[] = [];
  for (const row of rows) {
    const groupId = groupOfRow(row, byId, tasks, groupByRoot);
    if (!groupId) {
      loose.push(row);
      continue;
    }
    const bucket = buckets.get(groupId) ?? [];
    bucket.push(row);
    buckets.set(groupId, bucket);
  }
  const visible: FlattenedRow[] = [...loose];
  const presented: (FlattenedRow | TaskSectionRow)[] = [...loose];
  const counts = new Map<string, number>();
  for (const group of groups) {
    const bucket = buckets.get(group.id) ?? [];
    counts.set(
      group.id,
      bucket.filter(
        (row) =>
          !isAddTaskPlaceholder(row) &&
          !isInlineTaskDraftRow(row) &&
          row.depth === 0,
      ).length,
    );
    presented.push({
      rowType: "section",
      clientId: `group:${group.id}`,
      kind: "group-header",
      groupId: group.id,
      height: headerHeight,
    });
    if (!collapsed.has(group.id)) {
      visible.push(...bucket);
      presented.push(...bucket);
      if (canCreate && group.createDefaults) {
        presented.push({
          rowType: "section",
          kind: "group-add",
          groupId: group.id,
          clientId: `group-add:${group.id}`,
          height: ROW_HEIGHT,
        });
      }
    }
  }
  return { visible, presented, counts };
}
