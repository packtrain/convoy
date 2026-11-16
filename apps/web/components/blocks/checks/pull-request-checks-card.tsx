"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import { RunPullRequestChecksButton } from "./run-pull-request-checks";
import { ChecksCard, type FailedCheck } from "./task-evidence-card";

/**
 * The PR Overview's Pull request checks card, with Run checks. Hidden while the project has no
 * Pull request checklist and the PR no results. Spec: docs/specs/github-integration.md → Pull request checks.
 */
export function PullRequestChecksCard({
  projectId,
  organizationSlug,
  projectAlias,
  pullRequest,
  onFix,
}: {
  projectId: Id<"projects">;
  organizationSlug: string;
  projectAlias: string;
  pullRequest: AttachedPullRequest;
  onFix?: (failed: FailedCheck[]) => void;
}) {
  const { owner, name, number } = pullRequest;
  const data = useQuery(api.checks.checklists.getForPullRequest, { projectId, owner, name, number });
  if (!data || (data.checklistId === null && data.checks.length === 0)) return null;
  return (
    <ChecksCard
      data={data}
      title={(count) => `Pull request checks: ${count}`}
      projectRoute={{ organizationSlug, projectAlias }}
      onFix={onFix}
      action={
        <RunPullRequestChecksButton
          projectId={projectId}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          pullRequest={pullRequest}
          data={data}
        />
      }
    />
  );
}
