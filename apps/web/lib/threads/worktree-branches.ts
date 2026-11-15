/**
 * Git branch-name helpers for thread worktrees. Sanitization runs in the web
 * composer (prefill); validation runs server-side in `cli/threads.create`.
 * The CLI receives an already-valid branch name and never sanitizes.
 */

export const WORKTREE_BRANCH_MAX_LENGTH = 100;
export const WORKTREE_BRANCH_PREFIX = "feat/";

/**
 * Sanitize an arbitrary string into a valid, lowercase git refname fragment.
 * Strips quotes, collapses separators, limits length.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const fragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return fragment.length > 0 ? fragment : "thread";
}

/** Derive the default worktree branch name from a thread seed (title/first line/task ref). */
export function deriveWorktreeBranchName(seed: string): string {
  const firstLine =
    seed
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return `${WORKTREE_BRANCH_PREFIX}${sanitizeBranchFragment(firstLine)}`;
}

/**
 * Branch prefix per task type for task-attached threads (OS-1094). Unknown
 * types fall back to the generic feat/ prefix.
 */
const TASK_TYPE_BRANCH_PREFIXES: Record<string, string> = {
  feature: "feat/",
  task: "feat/",
  bug: "bug/",
  chore: "chore/",
  epic: "epic/",
  investigation: "spike/",
  idea: "spike/",
};

const TASK_BRANCH_NAME_WORD_LIMIT = 4;

export interface WorktreeBranchTaskSeed {
  refId: string;
  name: string;
  taskTypeKey?: string;
}

/**
 * Derive a worktree branch name from an attached task instead of the prompt
 * text: `<type-prefix>/<ref>-<first words of the task name>`, e.g.
 * `bug/os-808-fix-login-crash`. Prompt-derived names are a poor fit for
 * task-attached threads — automation prompts start with boilerplate and
 * slash-command links.
 */
export function deriveTaskWorktreeBranchName(task: WorktreeBranchTaskSeed): string {
  const prefix = TASK_TYPE_BRANCH_PREFIXES[task.taskTypeKey ?? ""] ?? WORKTREE_BRANCH_PREFIX;
  const nameWords = task.name.trim().split(/\s+/).slice(0, TASK_BRANCH_NAME_WORD_LIMIT).join(" ");
  return `${prefix}${sanitizeBranchFragment(`${task.refId} ${nameWords}`)}`;
}

/**
 * User-facing validation message for a branch name being typed, or null when
 * valid. Empty input returns null too — the caller disables submit instead.
 */
export function getWorktreeBranchNameError(name: string): string | null {
  if (name.length === 0) {
    return null;
  }
  if (name.length > WORKTREE_BRANCH_MAX_LENGTH) {
    return `Branch name must be ${WORKTREE_BRANCH_MAX_LENGTH} characters or less.`;
  }
  if (name.endsWith("/")) {
    return 'Branch name cannot end with "/".';
  }
  if (name.endsWith(".") || name.endsWith(".lock")) {
    return 'Branch name cannot end with "." or ".lock".';
  }
  if (name.startsWith("-") || name.startsWith("/")) {
    return 'Branch name cannot start with "-" or "/".';
  }
  if (name.includes("..") || name.includes("//") || name.includes("@{")) {
    return 'Branch name cannot contain "..", "//", or "@{".';
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    return "Branch name can only contain letters, digits, and ./-_ characters.";
  }
  if (!isValidWorktreeBranchName(name)) {
    return "Invalid branch name.";
  }
  return null;
}

/**
 * Conservative git branch-name check (subset of `git check-ref-format`).
 * Rejects control/space/special characters, leading dashes, `..`, `@{`,
 * trailing `.lock`, and empty segments.
 */
export function isValidWorktreeBranchName(name: string): boolean {
  if (name.length === 0 || name.length > WORKTREE_BRANCH_MAX_LENGTH) {
    return false;
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    return false;
  }
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) {
    return false;
  }
  if (name.endsWith(".") || name.endsWith(".lock")) {
    return false;
  }
  if (name.includes("..") || name.includes("//") || name.includes("@{")) {
    return false;
  }
  // No empty or dot-leading path segments (e.g. "feat/.hidden").
  return name.split("/").every((segment) => segment.length > 0 && !segment.startsWith("."));
}
