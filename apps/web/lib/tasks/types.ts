import { RowData } from "@tanstack/react-table";
import type { Id } from "@/convex/_generated/dataModel";
import { BACKLOG_SYSTEM_LIST } from "@/lib/task-lists/system-lists";
import { Status as StatusValues, type Status as StatusType } from "./status";
import {
  Priority as PriorityValues,
  type Priority as PriorityType,
} from "./priority";
import type { TaskTypeDefinition, TaskTypeSummary } from "./task-types";
import type { TaskExternalLink, TaskExternalLinkKind } from "./external-links";

export const Status = StatusValues;
export type Status = StatusType;
export const Priority = PriorityValues;
export type Priority = PriorityType;
export type { TaskTypeDefinition, TaskTypeSummary };
export type { TaskExternalLink };

// Status-based filters (mutually exclusive)
export const STATUS_FILTER_KEYS = [
  "all",
  "active",
  "done",
  "canceled",
] as const;
export type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];

export type TaskAssigneeInput =
  | { type: "user"; userId: Id<"users"> }
  | { type: "projectAgent"; projectAgentId: Id<"projectAgents"> }
  | null;

export type TaskAssigneeFilter =
  | { type: "me" }
  | { type: "user"; userId: Id<"users"> }
  | { type: "projectAgent"; projectAgentId: Id<"projectAgents"> }
  | { type: "unassigned" }
  | null;

export type AssigneeFilter = TaskAssigneeFilter;

// Archive filter: "active" (non-archived) or "archived" (archived only)
export type ArchiveFilter = "active" | "archived";

// Legacy FilterKey for backwards compatibility (deprecated - use StatusFilterKey + AssigneeFilter)
export type FilterKey = StatusFilterKey | "assigned";

export type PersistedTaskListSummary = {
  type: "list";
  id: Id<"taskLists">;
  ref: string;
  name: string;
  color?: string;
  isArchived: boolean;
};

export type SystemTaskListSummary = {
  type: "system";
  key: typeof BACKLOG_SYSTEM_LIST.key;
  ref: typeof BACKLOG_SYSTEM_LIST.ref;
  name: typeof BACKLOG_SYSTEM_LIST.name;
};

// The task's persisted List row was deleted (archived tasks keep their stale
// listKey). Mirrors the backend's structured "removed" variant. `ref` is
// declared as always-undefined so `task.list?.ref` narrows cleanly.
export type RemovedTaskListSummary = {
  type: "removed";
  name: string;
  ref?: undefined;
};

export type TaskListSummary =
  | PersistedTaskListSummary
  | SystemTaskListSummary
  | RemovedTaskListSummary;

export type TaskAssigneeDetails =
  | {
      type: "user";
      userId: Id<"users">;
      name: string | null;
      avatarUrl: string | null;
    }
  | {
      type: "projectAgent";
      projectAgentId: Id<"projectAgents">;
      name: string;
      appearance: { color: string };
      isDeleted: boolean;
    }
  | null;

// Split assignment model (OS-1335): the assignee is the human accountable for
// the task, delegation is the agent executing it. The two halves of
// TaskAssigneeDetails (which the selector/directory still uses to list both
// kinds of options).
export type TaskUserAssigneeDetails = Extract<NonNullable<TaskAssigneeDetails>, { type: "user" }> | null;
export type TaskDelegatedAgentDetails = Extract<NonNullable<TaskAssigneeDetails>, { type: "projectAgent" }> | null;

// Validation helpers
export function isValidStatusFilter(value: string | null): value is StatusFilterKey {
  return value !== null && STATUS_FILTER_KEYS.includes(value as StatusFilterKey);
}

// Denormalized linked CLI thread work summary (OS-1094), mirrored from the
// thread lifecycle onto the task document.
export type TaskAgentThreadWorkStatus = "pending" | "streaming" | "waiting_input" | "completed" | "failed";

export interface TaskAgentThreadWorkEntry {
  threadId: Id<"cliThreads">;
  threadTitle: string;
  userId: Id<"users">;
  userName: string;
  cliType: string;
  status: TaskAgentThreadWorkStatus;
  source: "assignment_automation" | "manual_attachment" | "workflow_run";
  // Bound Project agent identity (OS-1138); absent for unbound threads.
  projectAgentId?: Id<"projectAgents">;
  agentName?: string;
  // The thread's creation time, snapshotted on first sync (OS-1588) — the
  // timeline's sort key for a foreign thread row.
  createdAt: number;
  updatedAt: number;
}

// Mirrors `convex/lib/contracts/agentThreadWork.ts` (the client-side copy —
// that module can't be imported here without pulling the backend runtime
// registry into the bundle). Keep both in sync.
const UNRESOLVED_AGENT_THREAD_WORK_STATUSES: ReadonlySet<TaskAgentThreadWorkStatus> = new Set([
  "pending",
  "streaming",
  "waiting_input",
]);

/** Entries that still represent active/attention-needing work (these prompt before another automation run). */
export function getUnresolvedAgentThreadWork(entries: TaskAgentThreadWorkEntry[] | undefined): TaskAgentThreadWorkEntry[] {
  return (entries ?? []).filter((entry) => UNRESOLVED_AGENT_THREAD_WORK_STATUSES.has(entry.status));
}

export interface Task {
  _id: Id<"tasks">;
  clientId: string;
  refNumber: number;
  refId: string; // "ABC-5" (computed from project alias + refNumber)
  name: string;
  description: string | null;
  taskType: TaskTypeSummary;
  priority: Priority;
  dueDate: number | null;
  status: Status;
  list?: TaskListSummary | null;
  assignee: TaskUserAssigneeDetails;
  delegatedToAgent: TaskDelegatedAgentDetails;
  // Draft-only create input for cases where the UI knows the assignee ID but
  // does not have display details yet, e.g. a project-agent URL filter.
  assigneeInput?: TaskAssigneeInput;
  tags: string[];
  labelId?: Id<"projectLabels"> | null;
  sectionId?: Id<"taskSections"> | null;
  externalLinks?: TaskExternalLink[];
  agentThreadWork?: TaskAgentThreadWorkEntry[];
  // Denormalized resource counts (OS-882); optional so drafts and
  // placeholder rows don't need to set them — render with `?? 0`.
  attachmentCount?: number;
  artifactCount?: number;
  rank: string;
  parentId: string | null; // Reference to parent task (null = top-level)
  createdBy?: string;
  createdByName?: string | null;
  createdAt: number;
  isArchived: boolean;
  archivedAt?: number;
  archivedBy?: string;
}

// Fields the backend update mutation accepts (excluding `id` and `apiKey`).
// Used as the canonical shape for `updateTask` callbacks across hooks.
export interface TaskMutationFields {
  name?: string;
  description?: string | null;
  priority?: Priority;
  status?: Status;
  dueDate?: number | null;
  assigneeId?: Id<"users"> | null;
  delegatedToAgentId?: Id<"projectAgents"> | null;
  taskTypeKey?: string | null;
  tags?: string[];
  labelId?: Id<"projectLabels"> | null;
  sectionId?: Id<"taskSections"> | null;
  rank?: string;
}

// Superset passed through UI layers — includes client-only fields for optimistic updates.
export type TaskUpdate = TaskMutationFields & {
  _id?: Id<"tasks">;
  // Client-only optimistic display details for the split assignment fields.
  assigneeDetails?: TaskUserAssigneeDetails;
  delegatedToAgentDetails?: TaskDelegatedAgentDetails;
  taskType?: TaskTypeSummary;
};

// Tree node for table rendering with hierarchy metadata
export interface TaskTreeNode extends Task {
  depth: number; // 0 = top-level
  childCount: number; // Direct children count
  completedChildCount: number; // Children counted complete for subtask progress
  hasChildren: boolean; // For expand icon
  isExpanded: boolean; // UI state
  children?: TaskTreeNode[]; // For nested operations
}

// Placeholder row for inline "Add task" in subtask list
export interface AddTaskPlaceholder {
  rowType: "add-task";
  parentId: string;
  depth: number;
  clientId: string; // For React key: `add-${parentId}`
}

export interface InlineTaskDraftRow {
  rowType: "draft-task";
  clientId: string;
  parentId: string | null;
  depth: number;
  value: string;
  beforeClientId?: string;
  afterClientId?: string;
  afterPlacement?: "after-subtree" | "after-anchor";
  placementBeforeClientId?: string;
  tabTargetAddInputId?: string;
}

// Full-width row the TaskTable host renders itself (OS-2104 task sections prototype).
export interface TaskSectionRow {
  rowType: "section";
  kind?: "group-header" | "group-add" | "section-add";
  groupId?: string;
  clientId: string;
  /** Row height in px; defaults to the task row height. */
  height?: number;
}

// Discriminated union for flattened rows (task nodes or local draft/add-task placeholders)
export type FlattenedRow = TaskTreeNode | AddTaskPlaceholder | InlineTaskDraftRow;

// Drag-reorder insertion side relative to the drop target.
export type ReorderPosition = "before" | "after";

// Shared signatures for the drag-reorder callbacks threaded from useTasks down
// through the table controller and DnD layers. Keep these as the single source
// of truth so the param shape (and naming) cannot drift across consumers.
export type ReorderTasksFn = (
  sourceId: string,
  targetId: string,
  parentId?: string | null,
  position?: ReorderPosition
) => void;

export type ReorderMultipleFn = (
  ids: string[],
  targetId: string,
  parentId?: string | null,
  position?: ReorderPosition
) => void;

// Type guard for add-task placeholder rows
export function isAddTaskPlaceholder(
  row: FlattenedRow
): row is AddTaskPlaceholder {
  return (row as AddTaskPlaceholder).rowType === "add-task";
}

export function isInlineTaskDraftRow(
  row: FlattenedRow
): row is InlineTaskDraftRow {
  return (row as InlineTaskDraftRow).rowType === "draft-task";
}

export function isTaskSectionRow(row: FlattenedRow | TaskSectionRow): row is TaskSectionRow {
  return (row as TaskSectionRow).rowType === "section";
}

// Local task type for playground/performance testing (no backend)
export interface LocalTask {
  id: string;
  name: string;
  priority: Priority;
  dueDate: string;
  status: Status;
  assignee: TaskUserAssigneeDetails;
  tags: string[];
  rank: string;
  parentId: string | null;
}

// Options for adding a new task
export interface AddTaskOptions {
  /** Explicit Owner-group choice, including no owner while delegating. */
  assigneeId?: Id<"users"> | null;
  parentId?: string;
  afterId?: string;
  beforeId?: string;
}

// Extend TanStack Table's TableMeta type
// Uses string IDs for compatibility with existing components
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateTask: (id: string, updates: TaskUpdate) => void;
    deleteTask: (id: string) => void;
    beginInlineTaskDraft: (options: {
      parentId?: string | null;
      beforeClientId?: string;
      afterClientId?: string;
    }) => void;
    focusInput: (id: string, cursorPosition?: "start" | "end") => void;
    getAdjacentId: (currentId: string, direction: "prev" | "next") => string | null;
    statusFilter: StatusFilterKey;
    assigneeFilter: AssigneeFilter;
    currentUserId?: string;
    projectId?: Id<"projects">;
    allowedStatuses?: Status[];
    onInviteClick?: () => void;
    onAddAgentClick?: () => void;
    // Tree-related (optional for now, will be used in Phase 3)
    toggleExpanded?: (id: string) => void;
    expandedIds?: Set<string>;
    // Default parent for new tasks created via "Add task" input
    defaultParentId?: Id<"tasks">;
    // Archive-related
    archiveFilter?: ArchiveFilter;
    doneTaskCount?: number;
    onArchiveAllDone?: () => void;
    onCollapseAll?: () => void;
    canMoveClosedToBottom?: boolean;
    onMoveClosedToBottom?: () => void;
    // Move active (non-closed) top-level tasks to another List
    activeRootTaskCount?: number;
    onMoveActiveToList?: (listRef: string) => void;
    moveSourceListRef?: string | null;
    // Name-column sizing
    isNameColumnAutoWidth?: boolean;
    onSetNameColumnAutoWidth?: () => void;
    // Shared project labels for the Label column (resolved once at table level)
    projectLabels?: readonly ProjectLabelSummary[];
    projectLabelsById?: Map<string, ProjectLabelSummary>;
    // False for read-only viewers: cells render values, not editors (docs/specs/read-only-viewer-ux.md)
    canUpdateTask?: boolean;
    // False for viewers: the Runs cell shows badges but opens nothing
    canUseThreads?: boolean;
  }
}

// Minimal label shape the table/pickers need; mirrors api.tasks.labels.list items.
export interface ProjectLabelSummary {
  _id: Id<"projectLabels">;
  name: string;
  color: string;
  rank: string;
}

// Attachment Types

export interface TaskAttachment {
  _id: string;
  taskId: string;
  storageId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
  url: string | null;
}

export interface TaskArtifact {
  _id: string;
  taskId: string;
  name: string;
  fileName: string;
  content: string;
  source: "user" | "agent";
  runId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface UploadProgress {
  id: string; // Unique ID for React key (supports duplicate filenames)
  fileName: string;
  progress: number; // 0-100
  status: "uploading" | "saving" | "done" | "error";
  error?: string;
}

// Activity Log Types

export type ActivityEventType =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assignee_changed"
  | "delegation_changed"
  | "list_changed"
  | "label_changed"
  | "parent_changed"
  | "due_date_changed"
  | "name_edited"
  | "description_edited"
  | "deleted"
  | "restored"
  | "archived"
  | "unarchived"
  | "tags_changed"
  | "type_changed"
  | "external_link_changed"
  | "thread_attached"
  | "comment_added"
  | "attachment_added"
  | "attachment_removed"
  | "artifact_added"
  | "artifact_updated"
  | "artifact_removed";

export type ActivityChangeDetails =
  | { type: "status"; oldValue?: string; newValue: string }
  | { type: "priority"; oldValue?: Priority; newValue: Priority }
  | {
      type: "assignee";
      oldUserId?: Id<"users">;
      oldUserName?: string;
      newUserId?: Id<"users">;
      newUserName?: string;
      // Typed activity values (OS-1037); legacy rows may carry agent variants.
      oldAssignee?: { type: "user" | "projectAgent"; name?: string };
      newAssignee?: { type: "user" | "projectAgent"; name?: string };
    }
  | {
      type: "delegation";
      oldAgentId?: Id<"projectAgents">;
      oldAgentName?: string;
      newAgentId?: Id<"projectAgents">;
      newAgentName?: string;
    }
  | {
      type: "list";
      oldListId?: Id<"taskLists">;
      oldListRef?: string;
      oldListName?: string;
      newListId?: Id<"taskLists">;
      newListRef?: string;
      newListName?: string;
      newListSystem?: "inbox" | "backlog";
    }
  | {
      type: "label";
      oldLabelId?: Id<"projectLabels">;
      oldLabelName?: string;
      oldLabelColor?: string;
      newLabelId?: Id<"projectLabels">;
      newLabelName?: string;
      newLabelColor?: string;
    }
  | {
      type: "parent";
      oldParentId?: Id<"tasks">;
      oldParentName?: string;
      newParentId?: Id<"tasks">;
      newParentName?: string;
    }
  | { type: "due_date"; oldValue?: number; newValue?: number }
  | { type: "name"; oldValue: string; newValue: string }
  | { type: "description"; oldValue?: string; newValue?: string }
  | { type: "comment"; commentId: string }
  | { type: "attachment"; fileName: string }
  | { type: "artifact"; fileName: string }
  | { type: "tags"; added: string[]; removed: string[] }
  | {
      type: "task_type";
      oldKey?: string;
      oldName?: string;
      newKey: string;
      newName: string;
    }
  | {
      type: "external_link";
      op: "added" | "removed" | "updated";
      linkId: string;
      kind: TaskExternalLinkKind;
      label: string;
      url?: string;
    }
  | { type: "thread"; threadId: Id<"cliThreads">; threadTitle: string };

export interface ActivityLog {
  _id: Id<"taskActivityLogs">;
  _creationTime: number;
  taskId: Id<"tasks">;
  userId: Id<"users">;
  userName: string;
  userAvatarUrl: string | null;
  eventType: ActivityEventType;
  changeDetails?: ActivityChangeDetails;
  createdAt: number;
}

// Comment Types

export interface TaskCommentAttachment {
  _id: Id<"taskCommentAttachments">;
  fileName: string;
  fileSize: number;
  contentType: string;
  url: string | null;
}

export interface Comment {
  _id: Id<"taskComments">;
  _creationTime: number;
  taskId: Id<"tasks">;
  authorId: Id<"users">;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
  isEdited: boolean;
  attachments: TaskCommentAttachment[];
  canEdit: boolean;
  canDelete: boolean;
}


export function getTaskGroupTarget(clientId: string): { kind: "group-header" | "group-add"; groupId: string } | null {
  if (clientId.startsWith("group:")) return { kind: "group-header", groupId: clientId.slice(6) };
  if (clientId.startsWith("group-add:")) return { kind: "group-add", groupId: clientId.slice(10) };
  return null;
}

export function isGroupHeaderRow(row: FlattenedRow | TaskSectionRow): row is TaskSectionRow {
  return isTaskSectionRow(row) && (row.kind ?? getTaskGroupTarget(row.clientId)?.kind) === "group-header";
}
