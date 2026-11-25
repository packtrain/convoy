"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RouteTarget } from "@/lib/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { checksRollup, GithubCheckList } from "./github-checks";
import type { GithubCommenting } from "./pull-request-comments";
import { layersMergedWith, MergeButton, MergeConfirmDialog, mergePlan, stuckLayer, UpdateBranchButton, useMergeMethod } from "./pull-request-merge";
import { StackMap } from "./pull-request-stack";
import type { PullRequestOverview, PullRequestSummary, PullRequestView } from "./types";

export type ReviewerState = "approved" | "changes_requested" | "commented" | "requested";

/**
 * Each reviewer's standing: a re-request wins, then their latest approval or change request, then a comment.
 * The author's own review comments never make them a reviewer, as on GitHub.
 */
export function reviewerStates(overview: PullRequestOverview, author: string): { login: string; state: ReviewerState }[] {
  const states = new Map<string, ReviewerState>();
  for (const review of [...overview.reviews].filter((review) => review.author !== author).sort((a, b) => a.submittedAt - b.submittedAt)) {
    if (review.state === "dismissed") states.delete(review.author);
    else if (review.state !== "commented") states.set(review.author, review.state);
    else if (!states.has(review.author)) states.set(review.author, "commented");
  }
  for (const login of [...overview.requestedReviewers, ...overview.requestedTeams]) states.set(login, "requested");
  return [...states].map(([login, state]) => ({ login, state }));
}

type Tone = "ok" | "pending" | "blocked";
const TONES: Record<Tone, { icon: typeof CircleCheck; className: string }> = {
  ok: { icon: CircleCheck, className: "text-success" },
  pending: { icon: CircleDashed, className: "text-muted-foreground" },
  blocked: { icon: CircleX, className: "text-destructive" },
};

function StatusRow({ tone, title, body, children }: { tone: Tone; title: string; body: string; children?: ReactNode }) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <div className="flex gap-3 border-b px-4 py-3">
      <Icon className={cn("mt-0.5 size-5 shrink-0", className)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{body}</p>
        {children}
      </div>
    </div>
  );
}

function reviewsRow(overview: PullRequestOverview, author: string) {
  const reviewers = reviewerStates(overview, author);
  const named = (state: ReviewerState) => reviewers.filter((reviewer) => reviewer.state === state).map((reviewer) => reviewer.login);
  const [changes, approved, requested] = [named("changes_requested"), named("approved"), named("requested")];
  if (changes.length) return <StatusRow tone="blocked" title="Changes requested" body={`By ${changes.join(", ")}.`} />;
  if (requested.length) return <StatusRow tone="pending" title="Review requested" body={`Waiting on ${requested.join(", ")}.`} />;
  if (approved.length) return <StatusRow tone="ok" title="Changes approved" body={`Approved by ${approved.join(", ")}.`} />;
  return <StatusRow tone="pending" title="No reviews yet" body="Nobody has reviewed this pull request." />;
}

/** The header button's tone: conflicts (for the picked method), branch rules, or failing checks block; recomputing or running checks wait. */
function overallTone(overview: PullRequestOverview, rebaseBlocked: boolean): Tone {
  const checks = checksRollup(overview.checks).state;
  if (overview.mergeable === "conflicting" || rebaseBlocked || overview.mergeBlock || checks === "failure") return "blocked";
  return overview.mergeable === "unknown" || checks === "pending" ? "pending" : "ok";
}

/**
 * GitHub's merge box: reviews, checks, the stack, behind-base, branch rules,
 * mergeability, and conflicts, then the merge button.
 */
export function MergeStatus({
  overview,
  layers,
  current,
  hrefFor,
  projectId,
  repositoryId,
  commenting,
  onBranchUpdated,
}: {
  overview: PullRequestOverview | null;
  layers: PullRequestSummary[];
  current: PullRequestView;
  hrefFor: (number: number) => RouteTarget;
  projectId: Id<"projects">;
  repositoryId: string;
  commenting: GithubCommenting;
  onBranchUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useMergeMethod(commenting);
  const [confirming, setConfirming] = useState(false);
  const rollup = overview ? checksRollup(overview.checks) : null;
  const below = layersMergedWith(layers, current) ?? [];
  const stuck = stuckLayer(below);
  const target = overview ? { projectId, repositoryId, pr: current, commenting, overview } : null;
  const plan = target ? mergePlan(target, layers, picked) : null;
  const rebaseBlocked = plan?.method === "rebase" && overview?.rebaseConflicts === true;
  const tone = overview ? overallTone(overview, rebaseBlocked) : null;
  const Icon = tone ? TONES[tone].icon : Loader2;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={!overview}>
          <Icon className={tone ? TONES[tone].className : "animate-spin"} />
          Merge status
        </Button>
      </PopoverTrigger>
      {overview && rollup && target && plan ? (
        <PopoverContent align="end" aria-label="Merge status" className="max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0">
          <p className="border-b px-4 py-3 text-sm font-medium">Merge status</p>
          {current.stack && layers.length ? (
            <div className="border-b p-2">
              <p className="px-2 py-1 text-xs text-muted-foreground">Stack #{current.stack.number}</p>
              <StackMap layers={layers} current={current.number} hrefFor={hrefFor} />
            </div>
          ) : null}
          {reviewsRow(overview, current.author)}
          <StatusRow tone={rollup.state === "success" ? "ok" : rollup.state === "failure" ? "blocked" : "pending"} title={rollup.title} body={rollup.body}>
            {overview.checks.length ? <GithubCheckList checks={overview.checks} className="mt-2" /> : null}
          </StatusRow>
          {below.length ? (
            <StatusRow
              tone={stuck ? "blocked" : "ok"}
              title={stuck ? stuck.reason : `Merges ${below.map((layer) => `#${layer.number}`).join(", ")} first`}
              body={stuck ? "Every Layer below has to be mergeable first." : "GitHub merges a stack from the bottom up."}
            />
          ) : null}
          {overview.behindBy || overview.mergeBlock === "behind" ? (
            <StatusRow
              tone={overview.mergeBlock === "behind" ? "blocked" : "pending"}
              title="This branch is out-of-date with the base branch"
              body={
                overview.mergeBlock === "behind"
                  ? `The base branch requires branches to be up to date with ${overview.baseRef} before merging.`
                  : `${overview.behindBy} ${overview.behindBy === 1 ? "commit" : "commits"} behind ${overview.baseRef}.`
              }
            >
              <UpdateBranchButton {...target} onUpdated={onBranchUpdated} />
            </StatusRow>
          ) : null}
          {overview.mergeBlock === "blocked" ? (
            <StatusRow tone="blocked" title="Merging is blocked" body="The base branch's rules aren't met yet, such as required reviews or checks." />
          ) : null}
          {overview.mergeable === "unknown" ? (
            <StatusRow tone="pending" title="Checking mergeability…" body={`GitHub is checking the latest commit for conflicts with ${overview.baseRef}.`} />
          ) : overview.mergeable === "conflicting" ? (
            <StatusRow tone="blocked" title="This branch has conflicts that must be resolved" body="Resolve them on GitHub or locally, then push.">
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <a href={`${overview.htmlUrl}/conflicts`} target="_blank" rel="noreferrer">
                  Resolve on GitHub
                  <ArrowUpRight />
                </a>
              </Button>
            </StatusRow>
          ) : rebaseBlocked ? (
            <StatusRow
              tone="blocked"
              title="This branch cannot be rebased due to conflicts"
              body={`Rebase it onto ${overview.baseRef} locally and push, or pick another merge method.`}
            />
          ) : (
            <StatusRow tone="ok" title="No conflicts with base branch" body="Merging can be performed automatically." />
          )}
          <MergeButton
            plan={plan}
            overview={overview}
            onPick={setPicked}
            onMerge={() => {
              setOpen(false);
              if (plan.connect) commenting.connect.prompt();
              else setConfirming(true);
            }}
          />
        </PopoverContent>
      ) : null}
      {/* Outside the content, so closing the popover keeps the confirm popup. */}
      {confirming && target && plan ? <MergeConfirmDialog {...target} plan={plan} onClose={() => setConfirming(false)} /> : null}
    </Popover>
  );
}
