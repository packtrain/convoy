import { v } from "convex/values";
import { priorityValidator } from "./validators";
import { taskAssigneeActivityValueValidator } from "./taskAssignees";
import { taskExternalLinkKindValidator } from "./taskExternalLinks";

/**
 * The stored shape of a `taskActivityLogs` row (docs/specs/task-activity-log.md).
 * Here rather than in `tasks/lib/activity/` because `convex/schema.ts` defines the
 * table and may not reach into a domain lib.
 */
export const eventTypeValidator = v.union(
  v.literal("created"),
  v.literal("status_changed"),
  v.literal("priority_changed"),
  v.literal("assignee_changed"),
  v.literal("delegation_changed"),
  v.literal("list_changed"),
  v.literal("label_changed"),
  v.literal("parent_changed"),
  v.literal("due_date_changed"),
  v.literal("name_edited"),
  v.literal("description_edited"),
  v.literal("deleted"),
  v.literal("restored"),
  v.literal("archived"),
  v.literal("unarchived"),
  v.literal("comment_added"),
  v.literal("attachment_added"),
  v.literal("attachment_removed"),
  v.literal("artifact_added"),
  v.literal("artifact_updated"),
  v.literal("artifact_removed"),
  v.literal("tags_changed"),
  v.literal("type_changed"),
  v.literal("external_link_changed"),
  v.literal("thread_attached")
);

export const changeDetailsValidator = v.union(
  // Status change
  v.object({
    type: v.literal("status"),
    oldValue: v.optional(v.string()),
    newValue: v.string(),
  }),
  // Priority change
  v.object({
    type: v.literal("priority"),
    oldValue: v.optional(priorityValidator),
    newValue: priorityValidator,
  }),
  // Assignee (human owner) change. The activity-value union still accepts the
  // projectAgent variant so historical agent-assignment rows keep validating.
  v.object({
    type: v.literal("assignee"),
    oldAssignee: v.optional(taskAssigneeActivityValueValidator),
    newAssignee: v.optional(taskAssigneeActivityValueValidator),
    oldUserId: v.optional(v.id("users")),
    oldUserName: v.optional(v.string()),
    newUserId: v.optional(v.id("users")),
    newUserName: v.optional(v.string()),
  }),
  // Delegation (agent executor) change (OS-1335). Names are denormalized so
  // history survives agent deletion.
  v.object({
    type: v.literal("delegation"),
    oldAgentId: v.optional(v.id("projectAgents")),
    oldAgentName: v.optional(v.string()),
    newAgentId: v.optional(v.id("projectAgents")),
    newAgentName: v.optional(v.string()),
  }),
  // List change
  v.object({
    type: v.literal("list"),
    oldListId: v.optional(v.id("taskLists")),
    oldListRef: v.optional(v.string()),
    oldListName: v.optional(v.string()),
    newListId: v.optional(v.id("taskLists")),
    newListRef: v.optional(v.string()),
    newListName: v.optional(v.string()),
    newListSystem: v.optional(
      v.union(v.literal("inbox"), v.literal("backlog"))
    ),
  }),
  // Label change. Names/colors are denormalized so history survives label
  // hard-deletion (labels have no soft-delete).
  v.object({
    type: v.literal("label"),
    oldLabelId: v.optional(v.id("projectLabels")),
    oldLabelName: v.optional(v.string()),
    oldLabelColor: v.optional(v.string()),
    newLabelId: v.optional(v.id("projectLabels")),
    newLabelName: v.optional(v.string()),
    newLabelColor: v.optional(v.string()),
  }),
  // Parent change
  v.object({
    type: v.literal("parent"),
    oldParentId: v.optional(v.id("tasks")),
    oldParentName: v.optional(v.string()),
    newParentId: v.optional(v.id("tasks")),
    newParentName: v.optional(v.string()),
  }),
  // Due date change
  v.object({
    type: v.literal("due_date"),
    oldValue: v.optional(v.number()),
    newValue: v.optional(v.number()),
  }),
  // Name change
  v.object({
    type: v.literal("name"),
    oldValue: v.string(),
    newValue: v.string(),
  }),
  // Description change
  v.object({
    type: v.literal("description"),
    oldValue: v.optional(v.string()),
    newValue: v.optional(v.string()),
  }),
  // Comment reference
  v.object({
    type: v.literal("comment"),
    commentId: v.string(),
  }),
  // Attachment change
  v.object({
    type: v.literal("attachment"),
    fileName: v.string(),
  }),
  // Artifact change
  v.object({
    type: v.literal("artifact"),
    fileName: v.string(),
  }),
  // Tag set delta for one edit. Both arrays are always present; the emitter
  // skips no-op edits, so at least one is non-empty.
  v.object({
    type: v.literal("tags"),
    added: v.array(v.string()),
    removed: v.array(v.string()),
  }),
  // Task type change. Names are denormalized alongside keys so renaming a
  // built-in type does not rewrite history.
  v.object({
    type: v.literal("task_type"),
    oldKey: v.optional(v.string()),
    oldName: v.optional(v.string()),
    newKey: v.string(),
    newName: v.string(),
  }),
  // External link change — one shape for all ops and all kinds, fully
  // denormalized so the row survives link removal. `linkId` correlates rows
  // about the same link across ops.
  v.object({
    type: v.literal("external_link"),
    op: v.union(v.literal("added"), v.literal("removed"), v.literal("updated")),
    linkId: v.string(),
    kind: taskExternalLinkKindValidator,
    label: v.string(),
    url: v.optional(v.string()),
  }),
  // Thread attached after creation (OS-1713). Title denormalized so the row
  // survives thread deletion.
  v.object({
    type: v.literal("thread"),
    threadId: v.id("cliThreads"),
    threadTitle: v.string(),
  })
);
