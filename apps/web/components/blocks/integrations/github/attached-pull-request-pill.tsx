"use client";

import { useQuery } from "convex/react";
import { GitPullRequest } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { attachedPullRequestName, attachedPullRequestUrl, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { PullRequestLink } from "./pull-request-link";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { Pill, PillAction, PillContent, PillText } from "@/components/ui/pill";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { useGithubIntegrationEnabled } from "@/lib/dev-mode/use-dev-mode";
import { cn } from "@/lib/utils";

type AttachedPullRequestPillProps = {
  pullRequest: AttachedPullRequest;
  /** Resolves the live title and state from this project's connected repositories. */
  projectId?: Id<"projects">;
  /** Composer pills remove instead of linking. */
  onRemove?: () => void;
  className?: string;
};

/** The PR's live state and title when its repository is connected, else its full `owner/name#number`. */
export function AttachedPullRequestPill({ pullRequest, projectId, onRemove, className }: AttachedPullRequestPillProps) {
  const enabled = useGithubIntegrationEnabled();
  const { isAuthenticated } = useAppConvexAuth();
  const { owner, name, number } = pullRequest;
  const live = useQuery(
    api.integrations.github.pullRequests.getAttached,
    enabled && isAuthenticated && projectId ? { projectId, owner, name, number } : "skip"
  );
  const fullName = attachedPullRequestName(pullRequest);
  // A connected repository's PR shows only its number; the tooltip ends with the repository.
  const label = live === null ? fullName : `#${number}`;
  const content = (
    <PillContent>
      {live ? <PullRequestStateIcon pr={live} /> : <GitPullRequest className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="shrink-0 font-medium">{label}</span>
      {live ? <PillText className="text-muted-foreground">{live.title}</PillText> : null}
    </PillContent>
  );
  const tooltip = live ? `#${number} ${live.title} · ${owner}/${name}` : attachedPullRequestUrl(pullRequest);

  return (
    <TooltipExt content={tooltip} delayDuration={500}>
      {onRemove ? (
        <Pill className={cn("max-w-[280px]", className)}>
          {content}
          <PillAction onClick={onRemove} aria-label={`Remove ${fullName}`} />
        </Pill>
      ) : (
        <Pill className={cn("max-w-[280px] pr-2 hover:bg-muted", className)}>
          <PullRequestLink url={attachedPullRequestUrl(pullRequest)} className="flex min-w-0" aria-label={`Open ${fullName}`}>
            {content}
          </PullRequestLink>
        </Pill>
      )}
    </TooltipExt>
  );
}
