import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { buildTaskTree, flattenTree } from "@/lib/tasks/tree";
import type { FlattenedRow, Task, TaskTreeNode } from "@/lib/tasks/types";
import type { TaskExternalLink } from "@/lib/tasks/external-links";

interface TaskRecord {
  _id: Task["_id"];
  clientId: string;
  refNumber: number;
  refId: string;
  name: string;
  description: string | null;
  taskType: Task["taskType"];
  priority: Task["priority"];
  dueDate?: number | null;
  status: Task["status"];
  list?: Task["list"];
  assignee?: Task["assignee"];
  delegatedToAgent?: Task["delegatedToAgent"];
  tags: string[];
  labelId?: Task["labelId"];
  sectionId?: Task["sectionId"];
  externalLinks?: TaskExternalLink[];
  agentThreadWork?: Task["agentThreadWork"];
  attachmentCount?: number;
  artifactCount?: number;
  rank: Task["rank"];
  parentId?: string | null;
  createdBy?: string;
  createdByName?: string | null;
  createdAt: number;
  isArchived: boolean;
  archivedAt?: number | null;
  archivedBy?: string | null;
}

interface UseTaskTreeStateOptions {
  preserveRootOrder?: boolean;
  allowAddTask?: boolean;
}

export function useMappedTasks<TTaskRecord extends TaskRecord>(
  sourceTasks: readonly TTaskRecord[] | undefined
): Task[] {
  return useMemo(() => {
    if (!sourceTasks) return [];

    return sourceTasks.map((task) => ({
      _id: task._id,
      clientId: task.clientId,
      refNumber: task.refNumber,
      refId: task.refId,
      name: task.name,
      description: task.description,
      taskType: task.taskType,
      priority: task.priority,
      dueDate: task.dueDate ?? null,
      status: task.status,
      list: task.list ?? null,
      assignee: task.assignee ?? null,
      delegatedToAgent: task.delegatedToAgent ?? null,
      tags: task.tags,
      labelId: task.labelId ?? null,
      sectionId: task.sectionId ?? null,
      externalLinks: task.externalLinks ?? [],
      agentThreadWork: task.agentThreadWork,
      attachmentCount: task.attachmentCount ?? 0,
      artifactCount: task.artifactCount ?? 0,
      rank: task.rank,
      parentId: task.parentId ? String(task.parentId) : null,
      createdBy: task.createdBy ? String(task.createdBy) : undefined,
      createdByName: task.createdByName ?? null,
      createdAt: task.createdAt,
      isArchived: task.isArchived,
      archivedAt: task.archivedAt ?? undefined,
      archivedBy: task.archivedBy ? String(task.archivedBy) : undefined,
    }));
  }, [sourceTasks]);
}

export function useTaskTreeState(
  tasks: Task[],
  options?: UseTaskTreeStateOptions
): {
  taskTree: TaskTreeNode[];
  flattenedTasks: FlattenedRow[];
  expandedIds: Set<string>;
  toggleExpanded: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
} {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const preserveRootOrder = options?.preserveRootOrder;
  const allowAddTask = options?.allowAddTask ?? true;

  const taskTree = useMemo(
    () => buildTaskTree(tasks, { preserveRootOrder }),
    [tasks, preserveRootOrder]
  );

  const flattenedTasks = useMemo(
    () => flattenTree(taskTree, expandedIds, allowAddTask),
    [taskTree, expandedIds, allowAddTask]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const allParentIds = tasks
      .filter((task) => tasks.some((child) => child.parentId === task._id))
      .map((task) => task._id);
    setExpandedIds(new Set(allParentIds));
  }, [tasks]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  return {
    taskTree,
    flattenedTasks,
    expandedIds,
    toggleExpanded,
    expandAll,
    collapseAll,
  };
}

export function useTaskInputState(tasks: Task[]): {
  tasksRef: RefObject<Task[]>;
  inputRefs: RefObject<Map<string, HTMLInputElement>>;
  rowRefs: RefObject<Map<string, HTMLElement>>;
  registerInput: (id: string, el: HTMLInputElement | null) => void;
  registerRow: (id: string, el: HTMLElement | null) => void;
  focusInput: (id: string, cursorPosition?: "start" | "end") => void;
  getAdjacentId: (currentClientId: string, direction: "prev" | "next") => string | null;
} {
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const tasksRef = useRef<Task[]>(tasks);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const registerInput = useCallback((id: string, el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const focusInput = useCallback((id: string, cursorPosition?: "start" | "end") => {
    setTimeout(() => {
      const input = inputRefs.current.get(id);
      if (!input) return;

      input.focus();
      if (cursorPosition === "end") {
        input.setSelectionRange(input.value.length, input.value.length);
      } else if (cursorPosition === "start") {
        input.setSelectionRange(0, 0);
      }
    }, 0);
  }, []);

  const getAdjacentId = useCallback(
    (currentClientId: string, direction: "prev" | "next"): string | null => {
      const clientIds = tasksRef.current.map((task) => task.clientId);
      const currentIndex = clientIds.indexOf(currentClientId);

      if (direction === "prev" && currentIndex > 0) {
        return clientIds[currentIndex - 1];
      }
      if (direction === "next" && currentIndex < clientIds.length - 1) {
        return clientIds[currentIndex + 1];
      }
      return null;
    },
    []
  );

  return {
    tasksRef,
    inputRefs,
    rowRefs,
    registerInput,
    registerRow,
    focusInput,
    getAdjacentId,
  };
}
