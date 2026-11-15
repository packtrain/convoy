import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../lib/config/convex-client.js";
import { resolveExecutionWorkspace } from "../../lib/git/worktrees.js";

type Workspace = FunctionReturnType<typeof api.cli.worktrees.getExecutionWorkspace>;

export interface RunWorkspace {
  workingDirectory: string;
  executionWorktree?: Workspace["worktree"];
  workspaceNotice?: { previousPath: string; path: string };
}

export function formatWorkspaceNotice(notice: NonNullable<RunWorkspace["workspaceNotice"]>): string {
  return `The thread previously ran in ${notice.previousPath}. Its working directory is now ${notice.path}. Recheck files before editing.`;
}

/** Validate and persist the claimed target before execution. Spec: cli-worktrees.md. */
export async function resolveRunWorkspace(
  client: ConvoyClient,
  threadId: Id<"cliThreads">,
  sessionId: Id<"cliSessions">,
  current: RunWorkspace,
  snapshot?: Workspace,
): Promise<RunWorkspace> {
  let { workingDirectory, executionWorktree, workspaceNotice } = current;
  if (snapshot || executionWorktree) {
    const workspace = snapshot ?? await client.query(api.cli.worktrees.getExecutionWorkspace, { threadId, sessionId });
    workingDirectory = workspace.path;
    executionWorktree = workspace.worktree;
    workspaceNotice = workspace.previousPath
      ? { previousPath: workspace.previousPath, path: workspace.path }
      : undefined;
  }

  const resolved = await resolveExecutionWorkspace(workingDirectory, executionWorktree);
  if (!executionWorktree || !resolved.repositoryId) {
    return { workingDirectory, executionWorktree, workspaceNotice };
  }
  const changed = resolved.path !== workingDirectory ||
    executionWorktree.repositoryId !== resolved.repositoryId ||
    executionWorktree.worktreeId !== resolved.worktreeId;
  if (!changed) return { workingDirectory, executionWorktree, workspaceNotice };

  await client.mutation(api.cli.worktrees.resolveExecutionWorkspace, {
    threadId,
    sessionId,
    expectedPath: workingDirectory,
    path: resolved.path,
    repositoryId: resolved.repositoryId,
    worktreeId: resolved.worktreeId,
    branch: resolved.branch,
  });
  return {
    workingDirectory: resolved.path,
    executionWorktree: resolved.worktreeId
      ? { ...executionWorktree, repositoryId: resolved.repositoryId, worktreeId: resolved.worktreeId }
      : undefined,
    workspaceNotice: resolved.path !== workingDirectory
      ? { previousPath: workingDirectory, path: resolved.path }
      : workspaceNotice,
  };
}
