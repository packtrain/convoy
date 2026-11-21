"use client";

import {
  startTransition,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BOARD_GROUP_BY_OPTIONS,
  type ListGroupBy,
} from "@/lib/navigation/project-state";
import { useAssignableTaskAssignees } from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { useTaskSections } from "@/lib/tasks/hooks/use-task-sections";
import { useSectionAppearance } from "@/lib/preferences/use-user-preferences";
import { ROW_HEIGHT } from "@/lib/tasks/constants";
import {
  createDefaultTaskFromInput,
  getFilterDefaultsFromFilters,
} from "@/lib/tasks/defaults";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import {
  hasProjectPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import { toast } from "sonner";
import { getRootDragTasks } from "@/lib/tasks/task-drag";
import { filterTaskByFilters } from "@/lib/tasks/filters";
import { buildTaskTree } from "@/lib/tasks/tree";
import {
  getTaskGroupTarget,
  isAddTaskPlaceholder,
  isInlineTaskDraftRow,
} from "@/lib/tasks/types";
import type {
  AddTaskOptions,
  AssigneeFilter,
  FlattenedRow,
  InlineTaskDraftRow,
  Status,
  StatusFilterKey,
  Task,
  TaskSectionRow,
  TaskUpdate,
  ReorderMultipleFn,
} from "@/lib/tasks/types";
import { buildBoardTaskColumns } from "./groups";
import { groupIndex, groupOfRow, groupRows } from "./rows";
import { useCollapsedGroups } from "./preferences";
import { GroupAddRow, GroupHeader } from "./group-header";
import {
  AddSectionInput,
  SectionHeader,
  SPACIOUS_SECTION_HEADER_HEIGHT,
  sectionStyle,
  useSectionActions,
} from "./section-header";

export function useTaskGrouping({
  projectId,
  userId,
  listRef,
  groupBy = "none",
  tasks,
  allowedStatuses,
  statusFilter,
  assigneeFilter,
  archived,
  addTask,
  updateTask,
  setParent,
  moveTask,
  reorderMultiple,
}: {
  projectId: Id<"projects">;
  userId?: string;
  listRef: string | null;
  groupBy?: ListGroupBy;
  tasks: Task[];
  allowedStatuses?: Status[];
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  archived: boolean;
  addTask: (
    task: Omit<Task, "_id" | "clientId">,
    position?: AddTaskOptions,
  ) => string | null;
  updateTask: (id: string, update: TaskUpdate) => void;
  setParent: (id: string, parentId: string | null, rank?: string) => void;
  moveTask: (
    id: string,
    update: TaskUpdate,
    target?: { targetTaskId: string; position: "before" | "after" },
  ) => void;
  reorderMultiple: ReorderMultipleFn;
}) {
  const requiredDirectory = BOARD_GROUP_BY_OPTIONS.find(
    (option) => option.value === groupBy,
  )?.directory;
  const directory = useAssignableTaskAssignees(
    requiredDirectory === "assignees" ? projectId : undefined,
  );
  const labels = useProjectLabels(
    requiredDirectory === "labels" ? projectId : undefined,
  );
  const { sections, isLoading: sectionsLoading } = useTaskSections(
    requiredDirectory === "sections" ? projectId : undefined,
    listRef,
  );
  // Until its directory loads, a grouping would put every task in the empty group.
  const isLoading =
    (requiredDirectory === "assignees" && directory.isLoading) ||
    (requiredDirectory === "labels" && labels.isLoading) ||
    (requiredDirectory === "sections" && sectionsLoading);
  const { sectionHeaderStyle, sectionColorStyle } = useSectionAppearance();
  const headerHeight =
    groupBy === "section" && sectionHeaderStyle === "spacious"
      ? SPACIOUS_SECTION_HEADER_HEIGHT
      : ROW_HEIGHT;
  const { myRole } = useProjectPermissions(projectId);
  const canCreate =
    !archived && hasProjectPermission(myRole, ProjectPermission.TASK_CREATE);
  const canMove =
    !archived && hasProjectPermission(myRole, ProjectPermission.TASK_UPDATE);
  const canManageSections =
    !archived && hasProjectPermission(myRole, ProjectPermission.LIST_MANAGE);
  const sectionActions = useSectionActions(projectId, listRef, sections);
  const scope = `${userId ?? "anonymous"}:${projectId}:${listRef ?? "default"}:${archived}:${groupBy}`;
  const { collapsed, replace: replaceCollapsed, toggle: toggleCollapsed } = useCollapsedGroups(scope);
  const groups = useMemo(
    () =>
      groupBy === "none"
        ? []
        : buildBoardTaskColumns({
            tasks,
            boardGroupBy: groupBy,
            allowedStatuses,
            assignableUsers: directory.users.map((option) => ({
              _id: option.value.userId,
              name: option.label,
              avatarUrl: option.details.avatarUrl,
            })),
            projectAgents: directory.projectAgents,
            labels: labels.labels,
            sections,
          }),
    [
      groupBy,
      tasks,
      allowedStatuses,
      directory.users,
      directory.projectAgents,
      labels.labels,
      sections,
    ],
  );
  const rowGroups = useMemo(() => groupIndex(tasks, groups), [tasks, groups]);
  const rowStyleByGroup = useMemo(
    () =>
      new Map(
        groups.map((group) => [
          group.id,
          sectionStyle(group.section?.color, sectionColorStyle),
        ]),
      ),
    [groups, sectionColorStyle],
  );
  const getRowStyle = useCallback(
    (row: FlattenedRow): CSSProperties | undefined => {
      if (groupBy !== "section") return undefined;
      const groupId = groupOfRow(
        row,
        rowGroups.byId,
        tasks,
        rowGroups.groupByRoot,
      );
      return groupId ? rowStyleByGroup.get(groupId) : undefined;
    },
    [groupBy, rowGroups, tasks, rowStyleByGroup],
  );
  const collapseAll = useCallback(() => {
    replaceCollapsed(new Set([...collapsed, ...groups.map((group) => group.id)]));
  }, [collapsed, groups, replaceCollapsed]);
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) =>
        filterTaskByFilters(task, statusFilter, assigneeFilter, userId),
      ),
    [tasks, statusFilter, assigneeFilter, userId],
  );
  const counts = useMemo(
    () =>
      groupRows(buildTaskTree(visibleTasks), groups, tasks, new Set()).counts,
    [visibleTasks, groups, tasks],
  );
  const visibleIds = useMemo(
    () => new Set(visibleTasks.map((task) => task.clientId)),
    [visibleTasks],
  );
  const transformRows = useCallback(
    (rows: FlattenedRow[]) =>
      groupBy === "none"
        ? rows
        : groupRows(rows, groups, tasks, collapsed).visible,
    [groupBy, groups, tasks, collapsed],
  );
  const presentRows = useCallback(
    (rows: FlattenedRow[]) => {
      if (groupBy === "none") return rows;
      const { presented } = groupRows(
        rows,
        groups,
        tasks,
        collapsed,
        canCreate,
        headerHeight,
      );
      return groupBy === "section" && canManageSections
        ? [
            ...presented,
            {
              rowType: "section" as const,
              kind: "section-add" as const,
              clientId: "section-add",
              height: ROW_HEIGHT,
            },
          ]
        : presented;
    },
    [
      groupBy,
      groups,
      tasks,
      collapsed,
      canCreate,
      headerHeight,
      canManageSections,
    ],
  );
  const renderHeader = useCallback(
    (
      row: TaskSectionRow,
      options?: {
        mobile?: boolean;
        onNavigate?: (id: string, direction: "prev" | "next") => void;
        onFocusPrevious?: (id: string) => void;
      },
    ) => {
      if (row.kind === "section-add")
        return (
          <AddSectionInput
            create={(name) => void sectionActions.create(name)}
            sections={sections}
            actions={sectionActions}
            className="border-b pr-2 hover:bg-muted/50"
            style={{
              height: ROW_HEIGHT,
              paddingLeft: options?.mobile ? 12 : 24,
            }}
          />
        );
      const section = getTaskGroupTarget(row.clientId);
      const adding = section?.kind === "group-add";
      const group = groups.find(
        (group) => group.id === (row.groupId ?? section?.groupId),
      );
      if (!group) return null;
      if (adding) {
        if (!canCreate || !group.createDefaults) return null;
        return (
          <GroupAddRow
            key={`${scope}:${row.clientId}`}
            style={rowStyleByGroup.get(group.id)}
            group={group}
            mobile={options?.mobile}
            onNavigate={(direction) =>
              options?.onNavigate?.(row.clientId, direction)
            }
            onFocusPrevious={
              options?.onFocusPrevious &&
              (() => options.onFocusPrevious?.(row.clientId))
            }
            create={(value) => {
              const task = createDefaultTaskFromInput(value, {
                ...getFilterDefaultsFromFilters(
                  statusFilter,
                  assigneeFilter,
                  userId,
                ),
                ...group.createDefaults,
              });
              if (!task) return false;
              const last = group.cards
                .filter((card) => visibleIds.has(card.task.clientId))
                .at(-1)?.task;
              return (
                addTask(task, {
                  ...(last ? { afterId: String(last._id) } : {}),
                  ...group.createOptions,
                }) !== null
              );
            }}
          />
        );
      }
      const toggle = () => startTransition(() => toggleCollapsed(group.id));
      if (groupBy === "section") {
        return (
          <SectionHeader
            key={`${scope}:${group.id}`}
            section={group.section ?? null}
            colorStyle={sectionColorStyle}
            spacious={sectionHeaderStyle === "spacious"}
            collapsed={collapsed.has(group.id)}
            toggle={toggle}
            sections={sections}
            actions={canManageSections ? sectionActions : undefined}
            mobile={options?.mobile}
            onNavigate={(direction) =>
              options?.onNavigate?.(row.clientId, direction)
            }
          />
        );
      }
      return (
        <GroupHeader
          key={`${scope}:${group.id}`}
          group={group}
          mobile={options?.mobile}
          onNavigate={(direction) =>
            options?.onNavigate?.(row.clientId, direction)
          }
          count={counts.get(group.id) ?? 0}
          collapsed={collapsed.has(group.id)}
          toggle={toggle}
        />
      );
    },
    [
      counts,
      visibleIds,
      groups,
      scope,
      collapsed,
      canCreate,
      statusFilter,
      assigneeFilter,
      userId,
      addTask,
      groupBy,
      sections,
      sectionActions,
      sectionColorStyle,
      sectionHeaderStyle,
      canManageSections,
      rowStyleByGroup,
      toggleCollapsed,
    ],
  );
  const drop = useCallback(
    (
      ids: string[],
      targetClientId: string,
      position: "before" | "after" | "inside",
    ): boolean => {
      if (groupBy === "none") return false;
      // Header drops go first in the group; footer ("Add task...") drops go last.
      const section = getTaskGroupTarget(targetClientId);
      const target = tasks.find((task) => task.clientId === targetClientId);
      const header = section !== null;
      const footer = section?.kind === "group-add";
      if (!header && (!target || target.parentId || position === "inside"))
        return false;
      const group = groups.find((group) =>
        header
          ? group.id === section.groupId
          : group.cards.some((card) => card.task.clientId === targetClientId),
      );
      if (ids.includes(targetClientId)) return true;
      if (!canMove || !group?.dropTarget) {
        toast.error(
          group?.dropDisabledReason ?? "Tasks cannot be moved to this group.",
        );
        return true;
      }
      const sources = tasks.filter((task) => ids.includes(task.clientId));
      const sourceIds = new Set(sources.map((task) => String(task._id)));
      const roots = getRootDragTasks(tasks, new Set(ids));
      const visibleGroupIds = group.cards
        .filter((card) => visibleIds.has(card.task.clientId))
        .map((card) => card.task.clientId);
      if (roots.length === 1 && !roots[0].parentId) {
        const sourceIndex = visibleGroupIds.indexOf(roots[0].clientId);
        const targetIndex = visibleGroupIds.indexOf(targetClientId);
        if (
          sourceIndex >= 0 &&
          ((header &&
            sourceIndex === (footer ? visibleGroupIds.length - 1 : 0)) ||
            (!header &&
              (sourceIndex === targetIndex ||
                (position === "before" && sourceIndex + 1 === targetIndex) ||
                (position === "after" && sourceIndex - 1 === targetIndex))))
        )
          return true;
      }
      const sameGroup = (source: Task) =>
        group.cards.some((card) => card.task._id === source._id);
      if (
        !header &&
        roots.every((source) => !source.parentId && sameGroup(source))
      )
        return false;
      const anchorable = (card: (typeof group.cards)[number]) =>
        visibleIds.has(card.task.clientId) &&
        !sourceIds.has(String(card.task._id));
      const anchor = footer
        ? group.cards.findLast(anchorable)?.task
        : header
          ? group.cards.find(anchorable)?.task
          : target;
      const placement =
        footer || (!header && position === "after") ? "after" : "before";
      for (const source of roots) {
        if (source.parentId) setParent(String(source._id), null);
      }
      if (roots.length === 1) {
        const source = roots[0];
        moveTask(
          String(source._id),
          sameGroup(source) ? {} : group.dropTarget,
          anchor
            ? { targetTaskId: String(anchor._id), position: placement }
            : undefined,
        );
      } else if (roots.length) {
        if (anchor)
          reorderMultiple(
            roots.map((source) => String(source._id)),
            String(anchor._id),
            null,
            placement,
          );
        for (const source of roots) {
          if (!sameGroup(source))
            updateTask(String(source._id), group.dropTarget);
        }
      }
      return true;
    },
    [
      visibleIds,
      groupBy,
      tasks,
      groups,
      canMove,
      setParent,
      updateTask,
      moveTask,
      reorderMultiple,
    ],
  );
  const resolveDraft = useCallback(
    (draft: InlineTaskDraftRow) => {
      if (draft.parentId) return undefined;
      const anchorId = draft.beforeClientId ?? draft.afterClientId;
      const group = groups.find((group) =>
        group.cards.some((card) => card.task.clientId === anchorId),
      );
      return group?.createDefaults
        ? { defaults: group.createDefaults, options: group.createOptions }
        : undefined;
    },
    [groups],
  );
  /** Expands the collapsed group that holds the task's root. */
  const reveal = useCallback(
    (clientId: string) => {
      let root = tasks.find((task) => task.clientId === clientId);
      const seen = new Set<string>();
      while (root?.parentId && !seen.has(root.clientId)) {
        seen.add(root.clientId);
        root = tasks.find((task) => task._id === root?.parentId);
      }
      const group = groups.find((group) =>
        group.cards.some((card) => card.task.clientId === root?.clientId),
      );
      if (group && collapsed.has(group.id)) {
        const next = new Set(collapsed);
        next.delete(group.id);
        replaceCollapsed(next);
      }
    },
    [groups, tasks, collapsed, replaceCollapsed],
  );
  const navigate = useCallback(
    (rows: FlattenedRow[], currentId: string, direction: "prev" | "next") => {
      const ordered = groupRows(rows, groups, tasks, new Set()).visible.filter(
        (row) => !isAddTaskPlaceholder(row) && !isInlineTaskDraftRow(row),
      );
      const section = getTaskGroupTarget(currentId);
      const presented = groupRows(
        rows,
        groups,
        tasks,
        new Set(),
        true,
      ).presented;
      let target: FlattenedRow | undefined;
      if (section) {
        const index = presented.findIndex((row) => row.clientId === currentId);
        const step = direction === "prev" ? -1 : 1;
        for (
          let i = index + step;
          index >= 0 && i >= 0 && i < presented.length;
          i += step
        ) {
          const row = presented[i];
          if (!("rowType" in row)) {
            target = row;
            break;
          }
        }
      } else {
        const index = ordered.findIndex((row) => row.clientId === currentId);
        target =
          index < 0
            ? undefined
            : ordered[index + (direction === "prev" ? -1 : 1)];
      }
      if (!target) return undefined;
      reveal(target.clientId);
      return target.clientId;
    },
    [groups, tasks, reveal],
  );
  return {
    resolveDraft,
    navigate,
    reveal,
    collapseAll,
    enabled: groupBy !== "none",
    isLoading,
    allowRootCreation: groupBy === "none",
    transformRows,
    presentRows,
    renderHeader,
    drop,
    canMove,
    getRowStyle,
    createSection: canManageSections ? sectionActions.create : undefined,
  };
}

export type TaskGrouping = ReturnType<typeof useTaskGrouping>;
