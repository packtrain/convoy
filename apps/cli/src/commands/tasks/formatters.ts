import { api } from "../../convex/_generated/api.js";
import type { FunctionReturnType } from "convex/server";

type TaskCore = NonNullable<FunctionReturnType<typeof api.tasks.core.getById>>;
type TaskCommentPage = FunctionReturnType<typeof api.tasks.comments.listByTask>;
export type TaskCommentSummary = TaskCommentPage["page"][number];
export type TaskArtifactSummary = FunctionReturnType<typeof api.tasks.artifacts.listTaskArtifactsByTask>[number];
export type TaskExternalLinkSummary = TaskCore["externalLinks"][number];
export type AgentThreadWorkSummary = NonNullable<TaskCore["agentThreadWork"]>[number];

export function formatTaskSummaryLine(task: { refId: string; name: string; status: string; priority: string; _id: string }): string {
  return `${task.refId.padEnd(10)} ${task.status.padEnd(12)} ${task.priority.padEnd(8)} ${task.name} (${task._id})`;
}

export function formatExternalLinkLine(link: TaskExternalLinkSummary): string {
  const label = (() => {
    switch (link.kind) {
      case "commit":
        return `${link.sha.slice(0, 7)}${link.title ? ` ${link.title}` : ""}`;
      case "branch":
        return link.name;
      case "pull_request":
        return link.title ?? link.identifier ?? link.url;
      default:
        return link.title ?? link.url;
    }
  })();
  const url = "url" in link ? link.url : undefined;
  const urlSuffix = url !== undefined && url !== label ? ` ${url}` : "";
  return `[${link.kind}] ${label} (${link.id})${urlSuffix}`;
}

export function formatArtifactSummaryLine(artifact: TaskArtifactSummary): string {
  const runIdSuffix = artifact.runId ? ` runId=${artifact.runId}` : "";
  return `${artifact.name} (${artifact._id}) [${artifact.fileName}]${runIdSuffix}`;
}

/**
 * One CLI run on the task, from the task's denormalized summary — so this covers
 * every user's threads, not just the caller's. `threads get`/`threads send` take
 * the id.
 */
export function formatAgentThreadWorkLine(entry: AgentThreadWorkSummary): string {
  const agentSuffix = entry.agentName ? ` via ${entry.agentName}` : "";
  return `[${entry.status}] ${entry.threadTitle} (${entry.threadId}) ${entry.cliType} ${entry.userName}${agentSuffix}`;
}

export function formatCommentSummaryLine(comment: TaskCommentSummary): string {
  const createdAt = new Date(comment.createdAt).toISOString();
  const editedSuffix = comment.isEdited ? " (edited)" : "";
  const content = comment.content.replace(/\s+/g, " ").trim();
  return `${comment.authorName} at ${createdAt}${editedSuffix}: ${content}`;
}
