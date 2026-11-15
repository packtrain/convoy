import type { ReactNode } from "react";
import { User } from "lucide-react";
import { AgentAvatar } from "@/components/blocks/agents/agent-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import type {
  KanbanCardItem,
  KanbanCardPresentation,
} from "@/components/blocks/tasks/kanban-card";
import { taskAssigneeToKey } from "@/lib/tasks/assignees";
import type { AssignableTaskAssigneeOption } from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/tasks/constants";
import { filterTaskByFilters } from "@/lib/tasks/filters";
import {
  BUILT_IN_TASK_TYPES,
  type TaskTypeSummary,
} from "@/lib/tasks/task-types";
import { Status, type Status as TaskStatus } from "@/lib/tasks/status";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskSection } from "@/lib/tasks/hooks/use-task-sections";
import type { BoardGroupBy } from "@/lib/navigation/project-state";
import type {
  AddTaskOptions,
  AssigneeFilter,
  Priority,
  StatusFilterKey,
  Task,
  TaskTreeNode,
  TaskUpdate,
} from "@/lib/tasks/types";
import { cn, getInitials } from "@/lib/utils";
export type BoardAssignableUser = {
  _id: Id<"users">;
  name: string;
  avatarUrl?: string | null;
};

export type BoardAssignableProjectAgent = Extract<
  AssignableTaskAssigneeOption,
  { type: "projectAgent" }
>;

type BoardStatusCardPresentationRule =
  | "hide-status"
  | "emphasize-status"
  | "hide-primary-status";

export interface BoardStatusColumnConfig {
  id: string;
  title: string;
  primaryStatus: TaskStatus;
  statuses: TaskStatus[];
  cardPresentation: BoardStatusCardPresentationRule;
}

export interface BoardStatusColumn extends BoardStatusColumnConfig {
  cards: KanbanCardItem[];
  createStatus: TaskStatus | null;
}

export interface BoardTaskColumn {
  id: string;
  title: string;
  metadata?: ReactNode;
  cards: KanbanCardItem[];
  createDefaults?: Partial<Omit<Task, "_id" | "clientId">>;
  createOptions?: Pick<AddTaskOptions, "assigneeId">;
  createDisabledReason?: string;
  /** Grouping-field payload applied on cross-group drops; undefined = not droppable. */
  dropTarget?: TaskUpdate;
  dropDisabledReason?: string;
  /** Section grouping only; null is "No section". */
  section?: TaskSection | null;
}

type BoardColumnBuilderArgs = {
  tasks: Task[];
  taskTree?: TaskTreeNode[];
  statusFilter?: StatusFilterKey;
  assigneeFilter?: AssigneeFilter;
  currentUserId?: string;
};

type PreparedBoardTasks = {
  progressByTaskId: Map<string, { completed: number; total: number }>;
  visibleRootTasks: Task[];
};

const STATUS_BOARD_COLUMNS: BoardStatusColumnConfig[] = [
  {
    id: "todo",
    title: Status.TODO,
    primaryStatus: Status.TODO,
    statuses: [Status.TODO, Status.TRIAGE],
    cardPresentation: "hide-primary-status",
  },
  {
    id: "planning",
    title: Status.PLANNING,
    primaryStatus: Status.PLANNING,
    statuses: [Status.PLANNING, Status.PLAN_REVIEW],
    cardPresentation: "emphasize-status",
  },
  {
    id: "in-progress",
    title: Status.IN_PROGRESS,
    primaryStatus: Status.IN_PROGRESS,
    statuses: [Status.IN_PROGRESS],
    cardPresentation: "hide-status",
  },
  {
    id: "in-review",
    title: Status.IN_REVIEW,
    primaryStatus: Status.IN_REVIEW,
    statuses: [Status.IN_REVIEW],
    cardPresentation: "hide-status",
  },
  {
    id: "blocked",
    title: Status.BLOCKED,
    primaryStatus: Status.BLOCKED,
    statuses: [Status.BLOCKED],
    cardPresentation: "hide-status",
  },
  {
    id: "done",
    title: Status.DONE,
    primaryStatus: Status.DONE,
    statuses: [Status.DONE, Status.CANCELED],
    cardPresentation: "hide-status",
  },
];

const PRIORITY_BOARD_ORDER: Priority[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "None",
];

const UNASSIGNED_ASSIGNEE_ID = "assignee:unassigned";

function AssigneeColumnMetadata({
  user,
  projectAgent,
}: {
  user?: BoardAssignableUser;
  projectAgent?: BoardAssignableProjectAgent["details"];
}) {
  if (projectAgent) {
    return (
      <AgentAvatar
        name={projectAgent.name}
        color={projectAgent.appearance.color}
        size="xs"
      />
    );
  }
  if (!user) {
    return <User className="h-4 w-4 text-muted-foreground" />;
  }

  return (
    <Avatar className="size-5">
      {user.avatarUrl ? (
        <AvatarImage src={user.avatarUrl} alt={user.name} />
      ) : null}
      <AvatarFallback className="text-[10px]">
        {getInitials(user.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function getColumnPresentation(
  column: BoardStatusColumnConfig,
  task: Task,
): KanbanCardPresentation {
  switch (column.cardPresentation) {
    case "hide-status":
      return { hideStatus: true };
    case "emphasize-status":
      return { emphasizeStatus: true };
    case "hide-primary-status":
      return task.status === column.primaryStatus
        ? { hideStatus: true }
        : { emphasizeStatus: true };
    default: {
      const exhaustiveRule: never = column.cardPresentation;
      return exhaustiveRule;
    }
  }
}

function buildProgressByTaskId(taskTree?: TaskTreeNode[]) {
  return new Map(
    (taskTree ?? [])
      .filter((node) => node.childCount > 0)
      .map((node) => [
        String(node._id),
        {
          completed: node.completedChildCount,
          total: node.childCount,
        },
      ]),
  );
}

function getVisibleRootTasks({
  tasks,
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: {
  tasks: Task[];
  statusFilter?: StatusFilterKey;
  assigneeFilter?: AssigneeFilter;
  currentUserId?: string;
}) {
  return tasks.filter(
    (task) =>
      !task.parentId &&
      filterTaskByFilters(task, statusFilter, assigneeFilter, currentUserId),
  );
}

function prepareBoardTasks(args: BoardColumnBuilderArgs): PreparedBoardTasks {
  return {
    progressByTaskId: buildProgressByTaskId(args.taskTree),
    visibleRootTasks: getVisibleRootTasks(args),
  };
}

function toKanbanCard(
  task: Task,
  progressByTaskId: Map<string, { completed: number; total: number }>,
  presentation?: KanbanCardPresentation,
): KanbanCardItem {
  return {
    task,
    subtaskProgress: progressByTaskId.get(String(task._id)),
    presentation,
  };
}

function bucketCardsByKey(
  tasks: Task[],
  progressByTaskId: PreparedBoardTasks["progressByTaskId"],
  getKey: (task: Task) => string | null | undefined,
  getPresentation?: (task: Task) => KanbanCardPresentation | undefined,
): Map<string, KanbanCardItem[]> {
  const cardsByKey = new Map<string, KanbanCardItem[]>();

  for (const task of tasks) {
    const key = getKey(task);
    if (!key) {
      continue;
    }

    const cards = cardsByKey.get(key) ?? [];
    cards.push(toKanbanCard(task, progressByTaskId, getPresentation?.(task)));
    cardsByKey.set(key, cards);
  }

  return cardsByKey;
}

function toTaskTypeSummary(taskType: TaskTypeSummary): TaskTypeSummary {
  return {
    key: taskType.key,
    name: taskType.name,
    icon: taskType.icon,
    color: taskType.color,
    isSystem: taskType.isSystem,
  };
}

/**
 * Resolves the status a group applies to created and dropped tasks: the
 * configured primary status when allowed, else the first allowed status from
 * the group membership, else null (group is not a create/drop target).
 */
export function resolveStatusGroupTarget(
  column: BoardStatusColumnConfig,
  allowedStatuses: TaskStatus[] | undefined,
): TaskStatus | null {
  if (!allowedStatuses) {
    return column.primaryStatus;
  }

  const allowedStatusSet = new Set(allowedStatuses);
  if (allowedStatusSet.has(column.primaryStatus)) {
    return column.primaryStatus;
  }

  return column.statuses.find((status) => allowedStatusSet.has(status)) ?? null;
}

export function getVisibleBoardColumns<
  TColumn extends Pick<BoardStatusColumn, "statuses" | "cards">,
>(allowedStatuses: TaskStatus[] | undefined, columns: TColumn[]): TColumn[] {
  if (!allowedStatuses) {
    return columns;
  }

  const allowedStatusSet = new Set(allowedStatuses);
  return columns.filter(
    ({ statuses, cards }) =>
      statuses.some((status) => allowedStatusSet.has(status)) ||
      cards.length > 0,
  );
}

export function buildStatusBoardColumns({
  tasks,
  taskTree,
  allowedStatuses,
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: {
  tasks: Task[];
  taskTree?: TaskTreeNode[];
  allowedStatuses?: TaskStatus[];
  statusFilter?: StatusFilterKey;
  assigneeFilter?: AssigneeFilter;
  currentUserId?: string;
}): BoardStatusColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks({
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  });

  const columns = STATUS_BOARD_COLUMNS.map((column) => {
    const statusSet = new Set(column.statuses);
    const cardsByStatus = bucketCardsByKey(
      visibleRootTasks,
      progressByTaskId,
      (task) => (statusSet.has(task.status) ? column.id : null),
      (task) => getColumnPresentation(column, task),
    );

    return {
      ...column,
      createStatus: resolveStatusGroupTarget(column, allowedStatuses),
      cards: cardsByStatus.get(column.id) ?? [],
    };
  });

  return getVisibleBoardColumns(allowedStatuses, columns);
}

export function buildAssigneeBoardColumns({
  tasks,
  taskTree,
  assignableUsers = [],
  projectAgents = [],
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: BoardColumnBuilderArgs & {
  assignableUsers?: readonly BoardAssignableUser[];
  projectAgents?: readonly BoardAssignableProjectAgent[];
}): BoardTaskColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks({
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  });
  const assignableUserIds = new Set(
    assignableUsers.map((user) => String(user._id)),
  );
  const projectAgentIds = new Set(
    projectAgents.map((agent) => String(agent.value.projectAgentId)),
  );
  const staleUsers = new Map<string, BoardAssignableUser>();
  const staleProjectAgents = new Map<
    string,
    NonNullable<Task["delegatedToAgent"]>
  >();
  // Executor-first grouping (OS-1335): a delegated task sits in its agent's
  // column; otherwise it sits in its owner's column.
  const cardsByAssignee = bucketCardsByKey(
    visibleRootTasks,
    progressByTaskId,
    (task) =>
      taskAssigneeToKey(task.delegatedToAgent ?? task.assignee) ?? "unassigned",
  );

  for (const task of visibleRootTasks) {
    const delegatedToAgent = task.delegatedToAgent;
    if (delegatedToAgent) {
      if (!projectAgentIds.has(delegatedToAgent.projectAgentId)) {
        staleProjectAgents.set(
          delegatedToAgent.projectAgentId,
          delegatedToAgent,
        );
      }
      continue;
    }

    const assignee = task.assignee;
    if (!assignee || assignableUserIds.has(assignee.userId)) {
      continue;
    }

    if (!staleUsers.has(assignee.userId)) {
      staleUsers.set(assignee.userId, {
        _id: assignee.userId as Id<"users">,
        name: assignee.name ?? "Unknown assignee",
        avatarUrl: assignee.avatarUrl,
      });
    }
  }

  const userGroups = [...assignableUsers, ...staleUsers.values()];
  return [
    {
      id: UNASSIGNED_ASSIGNEE_ID,
      title: "No assignee",
      metadata: <AssigneeColumnMetadata />,
      createDefaults: {
        assignee: null,
        delegatedToAgent: null,
        assigneeInput: undefined,
      },
      dropTarget: {
        assigneeId: null,
        delegatedToAgentId: null,
        assigneeDetails: null,
        delegatedToAgentDetails: null,
      },
      cards: cardsByAssignee.get("unassigned") ?? [],
    },
    ...projectAgents.map((agent) => ({
      id: `assignee:projectAgent:${String(agent.value.projectAgentId)}`,
      title: agent.label,
      metadata: <AssigneeColumnMetadata projectAgent={agent.details} />,
      // Dropping/creating on an agent column delegates; the owner is kept (or
      // auto-set to the acting user by the server when the task has none).
      createDefaults: {
        assigneeInput: undefined,
        delegatedToAgent: agent.details,
      },
      dropTarget: {
        delegatedToAgentId: agent.value.projectAgentId,
        delegatedToAgentDetails: agent.details,
      },
      cards:
        cardsByAssignee.get(taskAssigneeToKey(agent.value) ?? "unassigned") ??
        [],
    })),
    ...[...staleProjectAgents.values()].map((agent) => ({
      id: `assignee:projectAgent:${String(agent.projectAgentId)}:stale`,
      title: agent.name,
      metadata: <AssigneeColumnMetadata projectAgent={agent} />,
      cards:
        cardsByAssignee.get(
          taskAssigneeToKey({
            type: "projectAgent",
            projectAgentId: agent.projectAgentId,
          }) ?? "unassigned",
        ) ?? [],
      dropDisabledReason: "This agent is no longer available",
    })),
    ...userGroups.map((user) => ({
      id: `assignee:${String(user._id)}`,
      title: user.name,
      metadata: <AssigneeColumnMetadata user={user} />,
      createDefaults: {
        assigneeInput: undefined,
        delegatedToAgent: null,
        assignee: {
          type: "user" as const,
          userId: user._id,
          name: user.name,
          avatarUrl: user.avatarUrl ?? null,
        },
      },
      // Dropping on a user column makes them the owner AND clears delegation.
      dropTarget: {
        assigneeId: user._id,
        delegatedToAgentId: null,
        assigneeDetails: {
          type: "user" as const,
          userId: user._id,
          name: user.name,
          avatarUrl: user.avatarUrl ?? null,
        },
        delegatedToAgentDetails: null,
      },
      cards:
        cardsByAssignee.get(
          taskAssigneeToKey({ type: "user", userId: user._id }) ?? "unassigned",
        ) ?? [],
    })),
  ];
}

export type BoardLabel = {
  _id: Id<"projectLabels">;
  name: string;
  color: string;
  rank: string;
};

export const NO_LABEL_COLUMN_ID = "label:none";

function LabelColumnMetadata({ color }: { color?: string }) {
  return (
    <span
      className={cn(
        "size-2.5 rounded-full",
        !color && "bg-muted-foreground/40",
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function buildLabelBoardColumns({
  tasks,
  taskTree,
  labels = [],
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: BoardColumnBuilderArgs & {
  labels?: readonly BoardLabel[];
}): BoardTaskColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks({
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  });
  const cardsByLabel = bucketCardsByKey(
    visibleRootTasks,
    progressByTaskId,
    (task) => (task.labelId ? String(task.labelId) : NO_LABEL_COLUMN_ID),
  );

  return [
    // "No label" leads (the unlabeled backlog reads left-to-right into the
    // labeled columns). Create without a label; drop clears the label (null
    // flows through the backend's clearable(labelId)).
    {
      id: NO_LABEL_COLUMN_ID,
      title: "No label",
      metadata: <LabelColumnMetadata />,
      createDefaults: { labelId: null },
      dropTarget: { labelId: null },
      cards: cardsByLabel.get(NO_LABEL_COLUMN_ID) ?? [],
    },
    // One column per label in rank order (the query pre-sorts — do not re-sort
    // here). Empty columns MUST render: the board is built before tasks are
    // labeled. With zero labels the board degrades to a lone "No label" column.
    ...labels.map((label) => ({
      id: `label:${String(label._id)}`,
      title: label.name,
      metadata: <LabelColumnMetadata color={label.color} />,
      createDefaults: { labelId: label._id },
      dropTarget: { labelId: label._id },
      cards: cardsByLabel.get(String(label._id)) ?? [],
    })),
  ];
}

export function buildPriorityBoardColumns({
  tasks,
  taskTree,
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: BoardColumnBuilderArgs): BoardTaskColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks({
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  });
  const cardsByPriority = bucketCardsByKey(
    visibleRootTasks,
    progressByTaskId,
    (task) => task.priority,
  );

  return PRIORITY_BOARD_ORDER.map((priority) => {
    const config = PRIORITY_CONFIG[priority];
    const Icon = config.icon;

    return {
      id: `priority:${priority.toLowerCase()}`,
      title: priority,
      metadata: <Icon className={cn("h-4 w-4", config.color)} />,
      createDefaults: { priority },
      dropTarget: { priority },
      cards: cardsByPriority.get(priority) ?? [],
    };
  });
}

export function buildTaskTypeBoardColumns({
  tasks,
  taskTree,
  statusFilter = "all",
  assigneeFilter = null,
  currentUserId,
}: BoardColumnBuilderArgs): BoardTaskColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks({
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  });
  const builtInTypeKeys = new Set(
    BUILT_IN_TASK_TYPES.map((taskType) => taskType.key),
  );
  const legacyTypes = new Map<string, Task["taskType"]>();
  const cardsByType = bucketCardsByKey(
    visibleRootTasks,
    progressByTaskId,
    (task) => task.taskType.key,
  );

  for (const task of visibleRootTasks) {
    if (builtInTypeKeys.has(task.taskType.key)) {
      continue;
    }

    legacyTypes.set(task.taskType.key, task.taskType);
  }

  return [
    ...BUILT_IN_TASK_TYPES.map(toTaskTypeSummary),
    ...legacyTypes.values(),
  ].map((taskType) => ({
    id: `type:${taskType.key}`,
    title: taskType.name,
    metadata: <TaskType taskType={taskType} variant="icon" />,
    createDefaults: { taskType },
    dropTarget: { taskTypeKey: taskType.key },
    cards: cardsByType.get(taskType.key) ?? [],
  }));
}

export const NO_SECTION_COLUMN_ID = "section:none";

/** "No section" first, then the List's sections in rank order. */
function buildSectionColumns({
  sections = [],
  ...args
}: BoardColumnBuilderArgs & {
  sections?: readonly TaskSection[];
}): BoardTaskColumn[] {
  const { progressByTaskId, visibleRootTasks } = prepareBoardTasks(args);
  const known = new Set(sections.map((section) => String(section._id)));
  // Unknown ids (deleted, or from another List mid-sync) fall back to No section.
  const cardsBySection = bucketCardsByKey(
    visibleRootTasks,
    progressByTaskId,
    (task) =>
      task.sectionId && known.has(String(task.sectionId))
        ? String(task.sectionId)
        : NO_SECTION_COLUMN_ID,
  );
  return [
    {
      id: NO_SECTION_COLUMN_ID,
      title: "No section",
      section: null,
      createDefaults: { sectionId: null },
      dropTarget: { sectionId: null },
      cards: cardsBySection.get(NO_SECTION_COLUMN_ID) ?? [],
    },
    ...sections.map((section) => ({
      id: `section:${String(section._id)}`,
      title: section.name,
      section,
      createDefaults: { sectionId: section._id },
      dropTarget: { sectionId: section._id },
      cards: cardsBySection.get(String(section._id)) ?? [],
    })),
  ];
}

export function buildStatusTaskColumns(
  args: BoardColumnBuilderArgs & {
    allowedStatuses?: TaskStatus[];
  },
): BoardTaskColumn[] {
  return buildStatusBoardColumns(args).map((column) => {
    const config = STATUS_CONFIG[column.primaryStatus];
    const Icon = config.icon;

    return {
      id: column.id,
      title: column.title,
      metadata: <Icon className={cn("h-4 w-4", config.color)} />,
      cards: column.cards,
      createDefaults: column.createStatus
        ? { status: column.createStatus }
        : undefined,
      createDisabledReason: column.createStatus
        ? undefined
        : "No enabled status is available for this board group",
      dropTarget: column.createStatus
        ? { status: column.createStatus }
        : undefined,
      dropDisabledReason: column.createStatus
        ? undefined
        : "No enabled status is available for this board group",
    };
  });
}

export function buildBoardTaskColumns({
  boardGroupBy,
  assignableUsers,
  projectAgents,
  allowedStatuses,
  labels,
  sections,
  tasks,
  taskTree,
  statusFilter,
  assigneeFilter,
  currentUserId,
}: BoardColumnBuilderArgs & {
  sections?: readonly TaskSection[];
  boardGroupBy: BoardGroupBy;
  assignableUsers?: readonly BoardAssignableUser[];
  projectAgents?: readonly BoardAssignableProjectAgent[];
  allowedStatuses?: TaskStatus[];
  labels?: readonly BoardLabel[];
}): BoardTaskColumn[] {
  const commonArgs = {
    tasks,
    taskTree,
    statusFilter,
    assigneeFilter,
    currentUserId,
  };

  switch (boardGroupBy) {
    case "owner":
      return buildOwnerColumns({ ...commonArgs, assignableUsers });
    case "assignee":
      return buildAssigneeBoardColumns({
        ...commonArgs,
        assignableUsers,
        projectAgents,
      });
    case "priority":
      return buildPriorityBoardColumns(commonArgs);
    case "type":
      return buildTaskTypeBoardColumns(commonArgs);
    case "label":
      return buildLabelBoardColumns({ ...commonArgs, labels });
    case "status":
      return buildStatusTaskColumns({ ...commonArgs, allowedStatuses });
    case "section":
      return buildSectionColumns({ ...commonArgs, sections });
    default: {
      const exhaustiveGroupBy: never = boardGroupBy;
      return exhaustiveGroupBy;
    }
  }
}

export interface BoardTaskCell extends BoardTaskColumn {
  rowId: string;
  columnId: string;
  /** [row, column] payloads; cross-cell drops write only the axes that change. */
  axes: [BoardCellAxis, BoardCellAxis];
}

type BoardCellAxis = { groupId: string; dropTarget?: TaskUpdate };

/** Owner and Assignee both write `assigneeId`; a cell is impossible when they disagree. */
function ownerConflictReason(row: BoardTaskColumn, column: BoardTaskColumn) {
  const ownerA = row.dropTarget?.assigneeId;
  const ownerB = column.dropTarget?.assigneeId;
  if (ownerA === undefined || ownerB === undefined || ownerA === ownerB) return undefined;
  const assignee = row.id.startsWith("assignee:") ? row : column;
  return assignee.id === UNASSIGNED_ASSIGNEE_ID
    ? "No assignee means no owner"
    : `Assigning ${assignee.title} makes them the owner`;
}

/**
 * Board rows × columns. A cell holds the cards in both groups and applies both
 * groups' values; see task-board-rows.md.
 */
export function buildBoardCells({
  boardRowGroupBy,
  ...args
}: Parameters<typeof buildBoardTaskColumns>[0] & {
  boardRowGroupBy: BoardGroupBy;
}) {
  const columns = buildBoardTaskColumns(args);
  const rows = buildBoardTaskColumns({ ...args, boardGroupBy: boardRowGroupBy });
  // Owner × Assignee cells always write the joint owner and delegation, so a
  // one-axis move never triggers the server's automatic owner.
  const coupled =
    [args.boardGroupBy, boardRowGroupBy].sort().join() === "assignee,owner";
  const cells = rows.flatMap((row) => {
    const rowCards = new Map(row.cards.map((card) => [card.task.clientId, card]));
    return columns.map((column): BoardTaskCell => {
      const reason = ownerConflictReason(row, column);
      const possible = reason === undefined;
      const dropTarget =
        possible && row.dropTarget && column.dropTarget
          ? { ...row.dropTarget, ...column.dropTarget }
          : undefined;
      return {
        id: `${row.id}|${column.id}`,
        rowId: row.id,
        columnId: column.id,
        title: `${column.title} · ${row.title}`,
        // Column order is List rank order; status presentation comes from either axis.
        cards: column.cards.flatMap((card) => {
          const rowCard = rowCards.get(card.task.clientId);
          return rowCard ? [card.presentation ? card : rowCard] : [];
        }),
        createDefaults:
          possible && row.createDefaults && column.createDefaults
            ? { ...row.createDefaults, ...column.createDefaults }
            : undefined,
        createOptions:
          row.createOptions || column.createOptions
            ? { ...row.createOptions, ...column.createOptions }
            : undefined,
        createDisabledReason:
          reason ?? row.createDisabledReason ?? column.createDisabledReason,
        dropTarget,
        dropDisabledReason:
          reason ?? row.dropDisabledReason ?? column.dropDisabledReason,
        axes: [
          { groupId: row.id, dropTarget: coupled ? dropTarget : row.dropTarget },
          { groupId: column.id, dropTarget: coupled ? dropTarget : column.dropTarget },
        ],
      };
    });
  });
  return { rows, columns, cells };
}

function buildOwnerColumns(
  args: BoardColumnBuilderArgs & {
    assignableUsers?: readonly BoardAssignableUser[];
  },
): BoardTaskColumn[] {
  const columns = buildAssigneeBoardColumns({
    ...args,
    tasks: args.tasks.map((task) => ({ ...task, delegatedToAgent: null })),
  });
  const tasksById = new Map(args.tasks.map((task) => [task.clientId, task]));
  return columns.map((column) => {
    const createDefaults = { assignee: column.createDefaults?.assignee };
    const dropTarget = {
      assigneeId: column.dropTarget?.assigneeId,
      assigneeDetails: column.dropTarget?.assigneeDetails,
    };
    return {
      ...column,
      id: column.id.replace("assignee:", "owner:"),
      title: column.id === UNASSIGNED_ASSIGNEE_ID ? "No owner" : column.title,
      createDefaults: column.createDefaults ? createDefaults : undefined,
      createOptions: { assigneeId: column.dropTarget?.assigneeId },
      dropTarget: column.dropTarget ? dropTarget : undefined,
      cards: column.cards.map((card) => ({
        ...card,
        task: tasksById.get(card.task.clientId) ?? card.task,
      })),
    };
  });
}
