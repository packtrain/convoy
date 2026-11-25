"use client";

import { ArrowUpRight, GitPullRequest } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { attachedPullRequestName, attachedPullRequestUrl, isSameRepository, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { EmptyState } from "@/components/custom/empty-state";
import { Button } from "@/components/ui/button";
import { appRoute } from "@/lib/navigation";
import { PullRequestReader, PullRequestReaderSkeleton } from "./pull-request-reader";
import { useIntegrationStatus } from "./use-integration-status";
import { PullRequestWatchButton } from "./pull-request-watch";

/** The thread sidebar's Attached pull request tab: the PR reader when its repository is connected here, a GitHub link otherwise. */
export function AttachedPullRequestReader({
  projectId,
  threadId,
  pullRequest,
  organizationSlug,
  projectAlias,
  canWatch,
}: {
  projectId: Id<"projects">;
  threadId: Id<"cliThreads">;
  pullRequest: AttachedPullRequest;
  organizationSlug: string;
  projectAlias: string;
  /** Only the thread owner sees and toggles the Pull request watch. */
  canWatch: boolean;
}) {
  const status = useIntegrationStatus(projectId);
  if (status === undefined) return <PullRequestReaderSkeleton />;
  const connection = status?.connections.find(
    (candidate) => candidate.status === "active" && isSameRepository(candidate.repository, pullRequest)
  );
  if (!connection) {
    return (
      <EmptyState
        fill
        icon={GitPullRequest}
        title={attachedPullRequestName(pullRequest)}
        description="This repository isn't connected to the project, so the pull request opens on GitHub."
        action={
          <Button variant="outline" asChild>
            <a href={attachedPullRequestUrl(pullRequest)} target="_blank" rel="noreferrer">
              <ArrowUpRight />
              Open on GitHub
            </a>
          </Button>
        }
      />
    );
  }
  return (
    <PullRequestReader
      key={pullRequest.ref}
      stackHotkeys={false}
      projectId={projectId}
      repositoryId={connection.repositoryId}
      number={pullRequest.number}
      status={status}
      hrefFor={(repositoryId, number) => appRoute.projectPullRequest(organizationSlug, projectAlias, repositoryId, number)}
      titleHref={appRoute.projectPullRequest(organizationSlug, projectAlias, connection.repositoryId, pullRequest.number)}
      organizationSlug={organizationSlug}
      projectAlias={projectAlias}
      headerAction={canWatch ? <PullRequestWatchButton threadId={threadId} /> : undefined}
    />
  );
}
