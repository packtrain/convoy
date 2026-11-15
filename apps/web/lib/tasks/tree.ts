import type { Task, TaskTreeNode, FlattenedRow } from "./types";
import { isClosedStatus } from "./status-policy";

type TaskTreeLookup = { _id: string; parentId: string | null };

interface BuildTaskTreeOptions {
  /** When true, preserve the input order of root nodes (e.g., for archived tasks sorted by archivedAt) */
  preserveRootOrder?: boolean;
}

/**
 * Build a tree from a flat, pre-sorted task list. Orphaned children (parent not in the
 * list) become roots.
 *
 * @param options.preserveRootOrder - Keep roots in input order instead of sorting by rank
 */
export function buildTaskTree(
  tasks: Task[],
  options?: BuildTaskTreeOptions
): TaskTreeNode[] {
  const taskMap = new Map<string, TaskTreeNode>();
  const roots: TaskTreeNode[] = [];

  // First pass: create nodes with default tree metadata
  for (const task of tasks) {
    taskMap.set(task._id, {
      ...task,
      depth: 0,
      childCount: 0,
      completedChildCount: 0,
      hasChildren: false,
      isExpanded: false,
      children: [],
    });
  }

  // Second pass: build relationships
  for (const task of tasks) {
    const node = taskMap.get(task._id)!;
    if (task.parentId && taskMap.has(task.parentId)) {
      const parent = taskMap.get(task.parentId)!;
      parent.children!.push(node);
      parent.childCount++;
      if (isClosedStatus(task.status)) {
        parent.completedChildCount++;
      }
      parent.hasChildren = true;
    } else {
      // No parent or parent not in list (orphan) - treat as root
      roots.push(node);
    }
  }

  // Third pass: calculate depths using BFS from roots
  function setDepths(nodes: TaskTreeNode[], depth: number): void {
    for (const node of nodes) {
      node.depth = depth;
      if (node.children && node.children.length > 0) {
        // Sort children by rank to maintain order
        node.children.sort((a, b) => a.rank.localeCompare(b.rank));
        setDepths(node.children, depth + 1);
      }
    }
  }
  setDepths(roots, 0);

  // Sort roots by rank unless preserving input order (e.g., for archived tasks sorted by archivedAt)
  if (!options?.preserveRootOrder) {
    roots.sort((a, b) => a.rank.localeCompare(b.rank));
  }

  return roots;
}

/**
 * Flatten a tree for table display, including only children of expanded nodes and
 * inserting an AddTaskPlaceholder after each expanded parent's last child.
 *
 * Nodes are recreated with `isExpanded` set so memoized rows detect the change.
 */
export function flattenTree(
  nodes: TaskTreeNode[],
  expandedIds: Set<string>,
  allowAddTask: boolean = true
): FlattenedRow[] {
  const result: FlattenedRow[] = [];

  function traverse(nodeList: TaskTreeNode[]): void {
    for (const node of nodeList) {
      const isExpanded = expandedIds.has(node._id);
      // Create new object with isExpanded set so memo comparison detects changes
      result.push({ ...node, isExpanded });

      if (!isExpanded) {
        continue;
      }

      if (node.hasChildren && node.children) {
        traverse(node.children);

        if (allowAddTask) {
          result.push({
            rowType: "add-task",
            parentId: node._id,
            depth: (node.depth || 0) + 1,
            clientId: `add-${node._id}`,
          });
        }
      }
    }
  }

  traverse(nodes);
  return result;
}

/**
 * Insert add-subtask placeholders for childless parents that were explicitly
 * revealed by add-input hierarchy navigation.
 */
export function insertChildlessAddTaskPlaceholders(
  rows: FlattenedRow[],
  parentIds: ReadonlySet<string>,
  allowAddTask: boolean = true
): FlattenedRow[] {
  if (!allowAddTask || parentIds.size === 0) {
    return rows;
  }

  let changed = false;
  const result: FlattenedRow[] = [];

  for (const row of rows) {
    result.push(row);

    if (
      !("rowType" in row) &&
      !row.hasChildren &&
      parentIds.has(String(row._id))
    ) {
      changed = true;
      result.push({
        rowType: "add-task",
        parentId: row._id,
        depth: (row.depth || 0) + 1,
        clientId: `add-${row._id}`,
      });
    }
  }

  return changed ? result : rows;
}

/**
 * Get all descendant IDs of a task (for operations like drag-move, cascade delete).
 *
 * @param taskId - ID of the task to get descendants for
 * @param tree - Root nodes of the tree
 * @returns Array of all descendant IDs (not including the task itself)
 */
export function getDescendantIds(
  taskId: string,
  tree: TaskTreeNode[]
): string[] {
  const descendants: string[] = [];

  function findAndCollect(nodes: TaskTreeNode[]): boolean {
    for (const node of nodes) {
      if (node._id === taskId) {
        // Found the target - collect all its descendants
        collectAllDescendants(node.children || []);
        return true;
      }
      if (node.children && findAndCollect(node.children)) {
        return true;
      }
    }
    return false;
  }

  function collectAllDescendants(nodes: TaskTreeNode[]): void {
    for (const node of nodes) {
      descendants.push(node._id);
      if (node.children) {
        collectAllDescendants(node.children);
      }
    }
  }

  findAndCollect(tree);
  return descendants;
}

export function collectTaskAndDescendantIds<T extends TaskTreeLookup>(
  tasks: readonly T[],
  rootIds: Set<string>
): Set<string> {
  const ids = new Set(rootIds);
  const queue = [...rootIds];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const task of tasks) {
      if (task.parentId === parentId && !ids.has(task._id)) {
        ids.add(task._id);
        queue.push(task._id);
      }
    }
  }

  return ids;
}

/**
 * A task's visible ancestor ids, root-most parent first.
 *
 * Resolved only within `tasks`, so a filtered-out parent stops the chain and lets its
 * visible descendants behave like roots in filtered views.
 */
export function getAncestorIds(taskId: string, tasks: Task[]): string[] {
  // This helper favors clarity over micro-optimizations because deep-link ancestry
  // walks are short. If profiling ever shows it on a hot path, hoist the lookup map
  // and switch the accumulation strategy to push+reverse.
  const taskMap = new Map(tasks.map((task) => [String(task._id), task]));
  const ancestors: string[] = [];

  let current = taskMap.get(taskId);
  while (current?.parentId) {
    const parentId = String(current.parentId);
    const parent = taskMap.get(parentId);
    if (!parent) {
      break;
    }

    ancestors.unshift(parentId);
    current = parent;
  }

  return ancestors;
}

/**
 * Find a task node in the tree by ID.
 *
 * @param taskId - ID of the task to find
 * @param tree - Root nodes of the tree
 * @returns The TaskTreeNode if found, undefined otherwise
 */
export function findTaskInTree(
  taskId: string,
  tree: TaskTreeNode[]
): TaskTreeNode | undefined {
  for (const node of tree) {
    if (node._id === taskId) {
      return node;
    }
    if (node.children) {
      const found = findTaskInTree(taskId, node.children);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Get siblings of a task (tasks with the same parentId).
 *
 * @param taskId - ID of the task
 * @param tasks - Flat array of all tasks
 * @returns Array of sibling tasks (same parentId), sorted by rank
 */
export function getSiblings(taskId: string, tasks: Task[]): Task[] {
  const task = tasks.find((t) => t._id === taskId);
  if (!task) return [];

  return tasks
    .filter((t) => t.parentId === task.parentId && t._id !== taskId)
    .sort((a, b) => a.rank.localeCompare(b.rank));
}

/**
 * Get children of a task.
 *
 * @param parentId - ID of the parent task (or null for root-level)
 * @param tasks - Flat array of all tasks
 * @returns Array of child tasks, sorted by rank
 */
export function getChildren(parentId: string | null, tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.parentId === parentId)
    .sort((a, b) => a.rank.localeCompare(b.rank));
}
