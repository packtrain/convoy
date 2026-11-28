import { isWorktreeParent, type CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";
import {
  deriveTaskWorktreeBranchName,
  deriveWorktreeBranchName,
  isValidWorktreeBranchName,
} from "./worktree-branches";

/**
 * What a new thread runs on, relative to the selected working directory:
 * the checkout as-is, an existing worktree, or a new worktree based on a
 * branch (created by the CLI when it claims the thread).
 */
export type BaseRefSelection =
  | { type: "current" }
  | { type: "worktree"; pathId: string }
  | {
      type: "branch";
      /** Base ref for the new worktree; absent = the repo's default branch. */
      baseRef?: string;
      startFromOrigin: boolean;
      /** User-provided new-branch name; auto-derived from the message when absent. */
      branch?: string;
    };

export interface BaseRefPathEntry {
  id: string;
  path: string;
  label: string;
  gitRemoteUrl?: string;
  kind?: CliProfilePathEntry["kind"];
  parentPathId?: string;
  branch?: string;
}

export function sanitizeBaseRefSelection(value: unknown): BaseRefSelection | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === "current") {
    return { type: "current" };
  }

  if (value.type === "worktree" && typeof value.pathId === "string") {
    return { type: "worktree", pathId: value.pathId };
  }

  if (value.type === "branch") {
    const baseRef = typeof value.baseRef === "string" ? value.baseRef : undefined;
    const branch = typeof value.branch === "string" ? value.branch : undefined;
    // A bare branch selection (no base, no name) is valid: it means a new
    // worktree from the repo's default branch with an auto-derived name —
    // agent-automation workspace preferences seed exactly that (OS-1094).
    return {
      type: "branch",
      baseRef,
      startFromOrigin: value.startFromOrigin === true,
      branch,
    };
  }

  return undefined;
}

/**
 * Whether a persisted selection is still consistent with the selected
 * working directory (worktree entries must belong to it).
 */
export function isBaseRefSelectionValid(
  selection: BaseRefSelection,
  pathId: string,
  paths: Array<Pick<BaseRefPathEntry, "id" | "kind" | "parentPathId">>
): boolean {
  if (selection.type !== "worktree") {
    return true;
  }
  const entry = paths.find((path) => path.id === selection.pathId);
  return entry?.kind === "worktree" && entry.parentPathId === pathId;
}

/**
 * Prefer a task-derived branch name for bare new-worktree selections
 * (OS-1094): `<type-prefix>/<ref>-<task name words>` instead of the
 * prompt-derived fallback. Explicit user-entered branch names win.
 */
export function withTaskBranchFallback(
  selection: BaseRefSelection | undefined,
  task: { refId: string; name: string; taskType?: { key: string } } | null | undefined
): BaseRefSelection | undefined {
  if (!task || selection?.type !== "branch" || selection.branch) {
    return selection;
  }
  return {
    ...selection,
    branch: deriveTaskWorktreeBranchName({ refId: task.refId, name: task.name, taskTypeKey: task.taskType?.key }),
  };
}

export interface ResolvedThreadTarget {
  pathId: string;
  worktree?: {
    parentPathId: string;
    branch: string;
    baseRef?: string;
    startFromOrigin?: boolean;
  };
}

/**
 * Combine the working-directory selection with the base-ref selection into
 * the `cli.threads.create` payload. Invalid/stale selections fall back to
 * running in the selected path directly.
 */
export function resolveThreadTarget({
  selection,
  pathId,
  paths,
  messageSeed,
}: {
  selection: BaseRefSelection | undefined;
  pathId: string;
  paths: BaseRefPathEntry[];
  messageSeed: string;
}): ResolvedThreadTarget {
  if (!selection || selection.type === "current") {
    return { pathId };
  }

  if (selection.type === "worktree") {
    return isBaseRefSelectionValid(selection, pathId, paths) ? { pathId: selection.pathId } : { pathId };
  }

  const parent = paths.find((path) => path.id === pathId);
  if (parent && !isWorktreeParent(paths, parent)) {
    return { pathId };
  }

  const override = selection.branch?.trim();
  const branch = override && isValidWorktreeBranchName(override) ? override : deriveWorktreeBranchName(messageSeed);

  return {
    pathId,
    worktree: {
      parentPathId: pathId,
      branch,
      baseRef: selection.baseRef,
      startFromOrigin: selection.startFromOrigin || undefined,
    },
  };
}
