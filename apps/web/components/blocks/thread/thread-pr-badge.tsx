"use client";

import { GitPullRequest } from "lucide-react";
import { PullRequestLink } from "@/components/blocks/integrations";
import { attachedPullRequestName, attachedPullRequestUrl, parseAttachedPullRequest, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { cn } from "@/lib/utils";
import {
  formatThreadPullRequestShortRef,
  formatThreadPullRequestTooltip,
  getThreadPullRequestPresentation,
  type ThreadPullRequest,
} from "@/lib/threads/pull-request";

/**
 * PR badge for thread rows (OS-1370): state icon plus the short ref (`#123` / `!7`),
 * opening Convoy's reader for a connected repository and GitHub in a new tab otherwise.
 * Renders as a *sibling* of the row's overlay AppLink, so clicking it doesn't navigate to
 * the thread. Where a surface renders the whole row as an anchor, `nestedInLink` switches
 * to a `role="link"` span — an `<a>` inside an `<a>` is invalid HTML and breaks hydration.
 */
export function ThreadPrBadge({
  pullRequest,
  className,
  iconClassName,
  nestedInLink = false,
}: {
  pullRequest: ThreadPullRequest;
  className?: string;
  iconClassName?: string;
  nestedInLink?: boolean;
}) {
  const presentation = getThreadPullRequestPresentation(pullRequest.state);
  const tooltip = formatThreadPullRequestTooltip(pullRequest);
  const Icon = presentation.icon;
  const badgeClassName = cn(
    "pointer-events-auto inline-flex shrink-0 cursor-pointer items-center gap-1",
    className
  );
  const content = (
    <>
      <Icon aria-hidden className={cn("size-3.5", presentation.colorClass, iconClassName)} />
      <span className={cn("text-xs tabular-nums", presentation.colorClass)}>
        {formatThreadPullRequestShortRef(pullRequest)}
      </span>
    </>
  );

  return (
    <PullRequestLink url={pullRequest.url} nestedInLink={nestedInLink} title={tooltip} aria-label={tooltip} className={badgeClassName}>
      {content}
    </PullRequestLink>
  );
}

/** The Attached pull request's `#number` on thread rows, muted like the task ref; hidden when it is the branch's PR (OS-2193). */
export function ThreadAttachedPrBadge({ attached, branchPullRequest }: { attached: AttachedPullRequest; branchPullRequest?: ThreadPullRequest }) {
  if (branchPullRequest && parseAttachedPullRequest(branchPullRequest.url)?.ref === attached.ref) return null;
  const label = `Attached pull request ${attachedPullRequestName(attached)}`;
  return (
    <PullRequestLink
      url={attachedPullRequestUrl(attached)}
      title={label}
      aria-label={label}
      className="pointer-events-auto inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <GitPullRequest aria-hidden className="size-3.5" />
      <span className="tabular-nums">#{attached.number}</span>
    </PullRequestLink>
  );
}
