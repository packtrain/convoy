"use client";

import { GitPullRequest } from "lucide-react";
import { PullRequestLink } from "@/components/blocks/integrations";
import { attachedPullRequestName, attachedPullRequestUrl, parseAttachedPullRequest, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { shouldHandleInPlaceNavigation } from "@/lib/navigation";
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

const MAX_SHOWN_PULL_REQUESTS = 3;

/** A thread's Branch pull requests, one badge each: at most 3, then "+N" listing the rest on hover (OS-2523). */
export function ThreadPrBadges({
  pullRequests,
  ...badge
}: { pullRequests: ThreadPullRequest[] } & Omit<Parameters<typeof ThreadPrBadge>[0], "pullRequest">) {
  const rest = pullRequests.slice(MAX_SHOWN_PULL_REQUESTS);
  return (
    <>
      {pullRequests.slice(0, MAX_SHOWN_PULL_REQUESTS).map((pullRequest) => (
        <ThreadPrBadge key={pullRequest.url} pullRequest={pullRequest} {...badge} />
      ))}
      {rest.length > 0 ? (
        <span className={cn("inline-flex shrink-0 items-center text-xs tabular-nums text-muted-foreground", badge.className)} title={rest.map(formatThreadPullRequestTooltip).join("\n")}>
          +{rest.length}
        </span>
      ) : null}
    </>
  );
}

/** The Attached pull request's `#number` in the thread header; a plain click opens the PR tab, a modified one GitHub (OS-2405). */
export function ThreadAttachedPrRefLink({ attached, onOpen }: { attached: AttachedPullRequest; onOpen: () => void }) {
  const label = `Attached pull request ${attachedPullRequestName(attached)}`;
  return (
    <a
      href={attachedPullRequestUrl(attached)}
      title={label}
      aria-label={label}
      onClick={(event) => {
        if (!shouldHandleInPlaceNavigation(event)) return;
        event.preventDefault();
        // Inside a thread tab, whose own click would reselect the thread.
        event.stopPropagation();
        onOpen();
      }}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <GitPullRequest aria-hidden className="size-3.5" />
      <span className="tabular-nums">#{attached.number}</span>
    </a>
  );
}

/** The Attached pull request's `#number` on thread rows, muted like the task ref; hidden when it is a Branch pull request (OS-2193). */
export function ThreadAttachedPrBadge({ attached, branchPullRequests }: { attached: AttachedPullRequest; branchPullRequests: ThreadPullRequest[] }) {
  if (branchPullRequests.some((pullRequest) => parseAttachedPullRequest(pullRequest.url)?.ref === attached.ref)) return null;
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
