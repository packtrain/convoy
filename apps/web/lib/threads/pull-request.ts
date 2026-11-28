import {
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type { CliThreadPullRequest, CliThreadRepoPullRequest } from "@/convex/lib/contracts/validators";

/** A Branch pull request; `repo` names its repo in a multi-repo folder (OS-2523). */
export type ThreadPullRequest = CliThreadPullRequest & { repo?: string };

/** A thread's Branch pull requests: one per repo in a multi-repo folder, else the branch's one. */
export function threadPullRequests(thread: { pullRequest?: CliThreadPullRequest; repoPullRequests?: CliThreadRepoPullRequest[] }): ThreadPullRequest[] {
  return thread.repoPullRequests ?? (thread.pullRequest ? [thread.pullRequest] : []);
}

/** The PRs of the repo a view is scoped to (the Changes tab's repo switcher), else all of them. */
export function repoScopedPullRequests(pullRequests: ThreadPullRequest[], repo: string | undefined): ThreadPullRequest[] {
  return repo === undefined ? pullRequests : pullRequests.filter((pullRequest) => pullRequest.repo === repo);
}

export interface ThreadPullRequestPresentation {
  icon: LucideIcon;
  colorClass: string;
  stateLabel: "Open" | "Draft" | "Merged" | "Closed";
}

/**
 * Single source of truth for how a PR state renders (OS-1370): the row badge,
 * the branch hover card, and any future surface resolve icon + color + label
 * from here so no surface can drift.
 */
const PR_STATE_PRESENTATION: Record<ThreadPullRequest["state"], ThreadPullRequestPresentation> = {
  open: {
    icon: GitPullRequestArrow,
    colorClass: "text-success",
    stateLabel: "Open",
  },
  draft: {
    icon: GitPullRequestDraft,
    colorClass: "text-muted-foreground",
    stateLabel: "Draft",
  },
  merged: {
    icon: GitMerge,
    colorClass: "text-violet-600 dark:text-violet-300/90",
    stateLabel: "Merged",
  },
  closed: {
    icon: GitPullRequestClosed,
    colorClass: "text-destructive",
    stateLabel: "Closed",
  },
};

export function isThreadPullRequestState(value: string | undefined): value is ThreadPullRequest["state"] {
  return value !== undefined && Object.hasOwn(PR_STATE_PRESENTATION, value);
}

export function getThreadPullRequestPresentation(
  state: ThreadPullRequest["state"]
): ThreadPullRequestPresentation {
  return PR_STATE_PRESENTATION[state];
}

/** Compact reference rendered next to the badge icon: GitLab reads `!7`, everything else `#7`. */
export function formatThreadPullRequestShortRef(
  pullRequest: Pick<ThreadPullRequest, "provider" | "number">
): string {
  if (pullRequest.provider === "gitlab") {
    return `!${pullRequest.number}`;
  }
  return `#${pullRequest.number}`;
}

/** Provider-specific change-request reference: GitLab reads `MR !7`, everything else `PR #7`. */
export function formatThreadPullRequestRef(pullRequest: Pick<ThreadPullRequest, "provider" | "number">): string {
  if (pullRequest.provider === "gitlab") {
    return `MR !${pullRequest.number}`;
  }
  return `PR #${pullRequest.number}`;
}

/** Native-tooltip text: `PR #123 · Open — <title>`, after `<repo> · ` in a multi-repo folder. */
export function formatThreadPullRequestTooltip(pullRequest: ThreadPullRequest): string {
  const { stateLabel } = getThreadPullRequestPresentation(pullRequest.state);
  return `${pullRequest.repo ? `${pullRequest.repo} · ` : ""}${formatThreadPullRequestRef(pullRequest)} · ${stateLabel} — ${pullRequest.title}`;
}
