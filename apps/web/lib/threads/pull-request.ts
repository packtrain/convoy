import {
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type { CliThreadPullRequest } from "@/convex/lib/contracts/validators";

export type ThreadPullRequest = CliThreadPullRequest;

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

/** Native-tooltip text: `PR #123 · Open — <title>`. */
export function formatThreadPullRequestTooltip(pullRequest: ThreadPullRequest): string {
  const { stateLabel } = getThreadPullRequestPresentation(pullRequest.state);
  return `${formatThreadPullRequestRef(pullRequest)} · ${stateLabel} — ${pullRequest.title}`;
}
