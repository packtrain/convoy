import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { Status } from "../../../../lib/tasks/status";
import type { Priority } from "../../../../lib/tasks/priority";
import type { TaskDelegatedAgentDetails, TaskUserAssigneeDetails } from "../../../lib/contracts/taskAssignees";
import { getExternalLinkLabel, type TaskExternalLink } from "../../../../lib/tasks/external-links";
import { resolveTaskTypeSummary } from "../../../lib/contracts/taskTypes";
import { userAssigneeDetailsToActivityValue } from "../assignees";

type Base = { taskId: Id<"tasks">; userId: Id<"users"> };

export const logTaskActivity = {
  async created(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "created",
    });
  },

  async deleted(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "deleted",
    });
  },

  async restored(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "restored",
    });
  },

  async archived(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "archived",
    });
  },

  async unarchived(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "unarchived",
    });
  },

  async statusChanged(ctx: MutationCtx, args: Base & { oldValue?: Status; newValue: Status }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "status_changed",
      changeDetails: {
        type: "status" as const,
        oldValue: args.oldValue,
        newValue: args.newValue,
      },
    });
  },

  async priorityChanged(ctx: MutationCtx, args: Base & { oldValue?: Priority; newValue: Priority }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "priority_changed",
      changeDetails: {
        type: "priority" as const,
        oldValue: args.oldValue,
        newValue: args.newValue,
      },
    });
  },

  async assigneeChanged(
    ctx: MutationCtx,
    args: Base & {
      oldAssignee: TaskUserAssigneeDetails;
      newAssignee: TaskUserAssigneeDetails;
    }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "assignee_changed",
      changeDetails: {
        type: "assignee" as const,
        oldAssignee: userAssigneeDetailsToActivityValue(args.oldAssignee),
        newAssignee: userAssigneeDetailsToActivityValue(args.newAssignee),
        oldUserId: args.oldAssignee?.userId,
        oldUserName: args.oldAssignee?.name ?? undefined,
        newUserId: args.newAssignee?.userId,
        newUserName: args.newAssignee?.name ?? undefined,
      },
    });
  },

  async delegationChanged(
    ctx: MutationCtx,
    args: Base & {
      oldAgent: TaskDelegatedAgentDetails;
      newAgent: TaskDelegatedAgentDetails;
    }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "delegation_changed",
      changeDetails: {
        type: "delegation" as const,
        oldAgentId: args.oldAgent?.projectAgentId,
        oldAgentName: args.oldAgent?.name,
        newAgentId: args.newAgent?.projectAgentId,
        newAgentName: args.newAgent?.name,
      },
    });
  },

  async listChanged(
    ctx: MutationCtx,
    args: Base & {
      oldList: Doc<"taskLists"> | null;
      newList: Doc<"taskLists"> | null;
      oldListId?: Id<"taskLists">;
      newListSystem?: "inbox" | "backlog";
    }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "list_changed",
      changeDetails: {
        type: "list" as const,
        oldListId: args.oldList?._id ?? args.oldListId,
        oldListRef: args.oldList?.ref,
        oldListName: args.oldList?.name,
        newListId: args.newList?._id,
        newListRef: args.newList?.ref,
        newListName: args.newList?.name,
        newListSystem: args.newListSystem,
      },
    });
  },

  async labelChanged(
    ctx: MutationCtx,
    args: Base & {
      oldLabel?: { id: Id<"projectLabels">; name: string; color: string };
      newLabel?: { id: Id<"projectLabels">; name: string; color: string };
    }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "label_changed",
      changeDetails: {
        type: "label" as const,
        oldLabelId: args.oldLabel?.id,
        oldLabelName: args.oldLabel?.name,
        oldLabelColor: args.oldLabel?.color,
        newLabelId: args.newLabel?.id,
        newLabelName: args.newLabel?.name,
        newLabelColor: args.newLabel?.color,
      },
    });
  },

  async parentChanged(
    ctx: MutationCtx,
    args: Base & {
      oldParent: Doc<"tasks"> | null;
      newParent: Doc<"tasks"> | null;
    }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "parent_changed",
      changeDetails: {
        type: "parent" as const,
        oldParentId: args.oldParent?._id,
        oldParentName: args.oldParent?.name,
        newParentId: args.newParent?._id,
        newParentName: args.newParent?.name,
      },
    });
  },

  async dueDateChanged(ctx: MutationCtx, args: Base & { oldValue?: number; newValue?: number }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "due_date_changed",
      changeDetails: {
        type: "due_date" as const,
        oldValue: args.oldValue,
        newValue: args.newValue,
      },
    });
  },

  async nameEdited(ctx: MutationCtx, args: Base & { oldValue: string; newValue: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "name_edited",
      changeDetails: {
        type: "name" as const,
        oldValue: args.oldValue,
        newValue: args.newValue,
      },
    });
  },

  /**
   * No `changeDetails`: the row renders as a flat "updated the description", so
   * storing both full description bodies was write-only weight
   * (docs/specs/task-activity-log.md#description-description_edited).
   */
  async descriptionEdited(ctx: MutationCtx, args: Base): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "description_edited",
    });
  },

  // No `commentAdded`: the merged timeline renders the comment itself, so the row is a
  // duplicate (`docs/specs/task-timeline.md`). Retired at the write site so nothing can start
  // writing these again; the event literal stays in `eventTypeValidator` for historical rows.

  async attachmentAdded(ctx: MutationCtx, args: Base & { fileName: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "attachment_added",
      changeDetails: {
        type: "attachment" as const,
        fileName: args.fileName,
      },
    });
  },

  async attachmentRemoved(ctx: MutationCtx, args: Base & { fileName: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "attachment_removed",
      changeDetails: {
        type: "attachment" as const,
        fileName: args.fileName,
      },
    });
  },

  async artifactAdded(ctx: MutationCtx, args: Base & { fileName: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "artifact_added",
      changeDetails: {
        type: "artifact" as const,
        fileName: args.fileName,
      },
    });
  },

  async artifactUpdated(ctx: MutationCtx, args: Base & { fileName: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "artifact_updated",
      changeDetails: {
        type: "artifact" as const,
        fileName: args.fileName,
      },
    });
  },

  async tagsChanged(ctx: MutationCtx, args: Base & { added: string[]; removed: string[] }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "tags_changed",
      changeDetails: {
        type: "tags" as const,
        added: args.added,
        removed: args.removed,
      },
    });
  },

  /** Takes resolved type keys; names are denormalized here so call sites stay one-liners. */
  async typeChanged(ctx: MutationCtx, args: Base & { oldKey?: string; newKey: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "type_changed",
      changeDetails: {
        type: "task_type" as const,
        oldKey: args.oldKey,
        oldName: args.oldKey ? resolveTaskTypeSummary(args.oldKey).name : undefined,
        newKey: args.newKey,
        newName: resolveTaskTypeSummary(args.newKey).name,
      },
    });
  },

  /**
   * One row per link op. Takes the stored link and denormalizes it here so
   * call sites stay one-liners and the label rule lives in one place.
   */
  async externalLinkChanged(
    ctx: MutationCtx,
    args: Base & { op: "added" | "removed" | "updated"; link: TaskExternalLink }
  ): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "external_link_changed",
      changeDetails: {
        type: "external_link" as const,
        op: args.op,
        linkId: args.link.id,
        kind: args.link.kind,
        label: getExternalLinkLabel(args.link),
        url: "url" in args.link ? args.link.url : undefined,
      },
    });
  },

  async artifactRemoved(ctx: MutationCtx, args: Base & { fileName: string }): Promise<void> {
    await ctx.scheduler.runAfter(0, internal.tasks.activity.logActivity, {
      taskId: args.taskId,
      userId: args.userId,
      eventType: "artifact_removed",
      changeDetails: {
        type: "artifact" as const,
        fileName: args.fileName,
      },
    });
  },
};
