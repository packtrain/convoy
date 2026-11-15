import type { ActionCtx } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { CheckResultStatus } from "../../../lib/contracts/validators";
import type { McpTaskArtifactSummary, McpTaskFileSummary } from "./artifacts/formatters";
import type { McpTaskCommentSummary } from "./comments/formatters";
import type { McpSubtaskSummary } from "./formatters";
import type { TaskRecordWithId } from "./resolution";

//TODO: move to config file
const MCP_COMMENTS_PAGE_SIZE = 50;

/** A Check's current result; `pending` until an agent reports it. */
type McpTaskCheck = {
  key: string;
  label: string;
  status: CheckResultStatus | "pending";
  note?: string;
  reportedAt?: number;
  added?: true;
};

export type McpTaskResources = {
  artifacts: McpTaskArtifactSummary[];
  files: McpTaskFileSummary[];
  comments: McpTaskCommentSummary[];
  commentsHasMore: boolean;
  subtasks: McpSubtaskSummary[];
  /** Present when the project has checklists or the task has results; null means "No checks". */
  checklist?: { _id: Id<"checklists">; name: string } | null;
  checks?: McpTaskCheck[];
};

export async function getTaskResources(ctx: ActionCtx, apiKey: string, taskId: Id<"tasks">): Promise<McpTaskResources> {
  // Results are typed by the generated api and runtime-validated by each
  // query's `returns` validator — no client-side re-validation.
  const [artifactRows, attachmentRows, commentResult, subtaskRows, taskChecks] = await Promise.all([
    ctx.runQuery(api.tasks.artifacts.listTaskArtifactsByTask, {
      taskId,
      apiKey,
    }),
    ctx.runQuery(api.tasks.attachments.listTaskAttachmentsByTask, {
      taskId,
      apiKey,
    }),
    ctx.runQuery(api.tasks.comments.listByTask, {
      taskId,
      paginationOpts: {
        numItems: MCP_COMMENTS_PAGE_SIZE,
        cursor: null,
      },
      apiKey,
    }),
    ctx.runQuery(api.tasks.core.listByParent, {
      parentId: taskId,
      apiKey,
    }),
    ctx.runQuery(api.checks.checklists.getForTask, { taskId, apiKey }),
  ]);
  const commentPageData = { rows: commentResult.page, hasMore: !commentResult.isDone };

  // Batch-count grandchildren so each subtask summary includes subtaskCount
  const subtaskIds = subtaskRows.map((s) => s._id);
  const childCounts =
    subtaskIds.length > 0
      ? await ctx.runQuery(internal.tasks.core.countChildrenBatch, {
          parentIds: subtaskIds,
        })
      : [];
  const countByParentId = new Map(childCounts.map((c) => [c.parentId, c.count] as const));

  return {
    artifacts: artifactRows.map((artifact) => ({
      _id: artifact._id,
      name: artifact.name,
      contentType: artifact.contentType ?? "markdown",
      source: artifact.source,
      ...(artifact.runId !== undefined && { runId: artifact.runId }),
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    })),
    files: attachmentRows.map((attachment) => ({
      _id: attachment._id,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      contentType: attachment.contentType,
      uploadedAt: attachment.uploadedAt,
      url: attachment.url,
    })),
    comments: commentPageData.rows.map((comment) => ({
      _id: comment._id,
      authorId: comment.authorId,
      authorName: comment.authorName,
      content: comment.content,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isEdited: comment.isEdited,
      attachments: comment.attachments.map((attachment) => ({
        _id: attachment._id,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        contentType: attachment.contentType,
        url: attachment.url,
      })),
    })),
    commentsHasMore: commentPageData.hasMore,
    subtasks: subtaskRows.map((subtask) => ({
      _id: subtask._id,
      refId: subtask.refId,
      name: subtask.name,
      status: subtask.status,
      priority: subtask.priority,
      assignee: subtask.assignee,
      delegatedToAgent: subtask.delegatedToAgent,
      dueDate: subtask.dueDate,
      subtaskCount: countByParentId.get(subtask._id) ?? 0,
    })),
    ...(taskChecks && (taskChecks.checklists.length > 0 || taskChecks.checks.length > 0)
      ? {
          checklist: pickChecklist(taskChecks.checklists, taskChecks.checklistId),
          checks: taskChecks.checks.map(toMcpTaskCheck),
        }
      : {}),
  };
}

/** The `checks.checklists.getForTask` row fields this projection reads. */
type TaskCheckRow = { key: string; label: string; added: boolean; results: { status: CheckResultStatus; note?: string; reportedAt: number }[] };

/** One Check with its current result, shared by `get_task` and `get_checks`. */
export function toMcpTaskCheck({ key, label, added, results: [current] }: TaskCheckRow): McpTaskCheck {
  return {
    key,
    label,
    status: current?.status ?? "pending",
    ...(current?.note !== undefined && { note: current.note }),
    ...(current && { reportedAt: current.reportedAt }),
    ...(added && { added: true as const }),
  };
}

export function pickChecklist(checklists: { _id: Id<"checklists">; name: string }[], checklistId: Id<"checklists"> | null) {
  const checklist = checklists.find((c) => c._id === checklistId);
  return checklist ? { _id: checklist._id, name: checklist.name } : null;
}

export async function enrichTaskWithResources(
  ctx: ActionCtx,
  apiKey: string,
  task: TaskRecordWithId
): Promise<Record<string, unknown> & McpTaskResources> {
  const resources = await getTaskResources(ctx, apiKey, task._id);
  return {
    ...task,
    ...resources,
  };
}
