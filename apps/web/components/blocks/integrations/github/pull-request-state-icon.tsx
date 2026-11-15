import { getThreadPullRequestPresentation } from "@/lib/threads/pull-request";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "./types";

/** A stored PR's display state: GitHub keeps drafts open. */
export function displayState(pr: Pick<PullRequestSummary, "state" | "draft">) {
  return pr.state === "open" && pr.draft ? "draft" : pr.state;
}

export function PullRequestStateIcon({ pr, className }: { pr: Pick<PullRequestSummary, "state" | "draft">; className?: string }) {
  const presentation = getThreadPullRequestPresentation(displayState(pr));
  const Icon = presentation.icon;
  return <Icon className={cn("size-4 shrink-0", presentation.colorClass, className)} aria-label={presentation.stateLabel} role="img" />;
}
