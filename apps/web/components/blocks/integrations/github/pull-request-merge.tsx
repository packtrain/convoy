"use client";

import { useId, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ChevronDown, CircleAlert, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/custom/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";
import { showConvexErrorToast } from "@/lib/errors";
import type { GithubCommenting } from "./pull-request-comments";
import { reviewerStates } from "./pull-request-merge-status";
import { writeBlocker } from "./pull-request-state-actions";
import type { PullRequestOverview, PullRequestSummary, PullRequestView } from "./types";

// Merge and Update branch as the member's Linked GitHub account (docs/specs/github-integration.md → Merge and update branch).

type Method = FunctionArgs<typeof api.integrations.github.merges.merge>["method"];
type Target = {
  projectId: Id<"projects">;
  repositoryId: string;
  pr: PullRequestView;
  commenting: GithubCommenting;
  overview: PullRequestOverview;
};

const METHODS: Record<Method, { label: string; option: string; confirm: string; body: (commits: number, base: string) => string }> = {
  merge: {
    label: "Merge pull request",
    option: "Create a merge commit",
    confirm: "Confirm merge",
    body: (n, base) => `Adds ${n === 1 ? "the commit" : `all ${n} commits`} to ${base} with a merge commit.`,
  },
  squash: {
    label: "Squash and merge",
    option: "Squash and merge",
    confirm: "Confirm squash and merge",
    body: (n, base) => `Combines ${n === 1 ? "the commit" : `the ${n} commits`} into one commit on ${base}.`,
  },
  rebase: {
    label: "Rebase and merge",
    option: "Rebase and merge",
    confirm: "Confirm rebase and merge",
    body: (n, base) => `Adds ${n === 1 ? "the commit" : `the ${n} commits`} on top of ${base}, without a merge commit.`,
  },
};
const ALL_METHODS: Method[] = ["merge", "squash", "rebase"];

/** The open Layers below `pr` that GitHub merges with it, bottom first; null while the stack loads. */
export function layersMergedWith(layers: PullRequestSummary[], pr: PullRequestView): PullRequestSummary[] | null {
  if (!pr.stack) return [];
  const index = layers.findIndex((layer) => layer.number === pr.number);
  return index < 0 ? null : layers.slice(0, index).filter((layer) => layer.state === "open");
}

/** A Layer below that stops a stack merge, as GitHub merges bottom up. */
export function stuckLayer(below: PullRequestSummary[]): { layer: PullRequestSummary; reason: string } | null {
  const layer = below.find((candidate) => candidate.draft || candidate.conflicts);
  return layer ? { layer, reason: `#${layer.number} ${layer.draft ? "is a draft" : "has conflicts"}` } : null;
}

/** Why Merge is disabled, or null. Blocking problems each have their own Merge status row too. */
function mergeBlocker({ pr, commenting, overview }: Target, below: PullRequestSummary[] | null): string | null {
  const access = writeBlocker(commenting.account, commenting.role, "write");
  if (access) return access;
  if (pr.draft) return "Mark it ready for review first";
  if (below === null) return "Loading the stack…";
  if (overview.mergeable === "conflicting") return "Resolve the conflicts first";
  if (overview.mergeable === "unknown") return "GitHub is checking mergeability";
  if (overview.mergeBlock === "behind") return "Update the branch first";
  if (overview.mergeBlock === "blocked") return "The base branch's rules aren't met";
  return stuckLayer(below)?.reason ?? null;
}

/** What doesn't block the merge but deserves a second look before confirming. */
function mergeWarnings(overview: PullRequestOverview, author: string): string[] {
  const pending = reviewerStates(overview, author).filter((reviewer) => reviewer.state === "requested").length;
  const failed = overview.checks.filter((check) => check.state === "failure").length;
  return [
    pending ? `${pending} ${pending === 1 ? "review is" : "reviews are"} still pending.` : null,
    failed ? `${failed} ${failed === 1 ? "check" : "checks"} failed.` : null,
    overview.checks.some((check) => check.state === "pending") ? "Checks are still running." : null,
    overview.behindBy ? `This branch is out-of-date with ${overview.baseRef}.` : null,
  ].filter((warning) => warning !== null);
}

const methodKey = (githubUserId: number) => `convoy:github:merge-method:${githubUserId}`;

/** The member's last picked merge method, kept per GitHub account in this browser, as GitHub remembers it. */
export function useMergeMethod(commenting: GithubCommenting): [Method | null, (method: Method) => void] {
  const githubUserId = commenting.account?.githubUserId;
  const [picked, setPicked] = useState<{ githubUserId?: number; method: Method } | null>(null);
  const stored = githubUserId === undefined ? null : readLocalString(methodKey(githubUserId));
  const remembered = ALL_METHODS.find((method) => method === stored) ?? null;
  const pick = (method: Method) => {
    setPicked({ githubUserId, method });
    if (githubUserId !== undefined) writeLocalString(methodKey(githubUserId), method);
  };
  return [picked && picked.githubUserId === githubUserId ? picked.method : remembered, pick];
}

/** GitHub's default commit title for a single PR; sent only when the member changes it. */
function defaultTitle(method: Method, pr: PullRequestView): string {
  return method === "squash" ? `${pr.title} (#${pr.number})` : `Merge pull request #${pr.number} from ${pr.headRef}`;
}

/** What a merge would do with the member's `picked` method: the method, the Layers it takes along, and what blocks it. */
export function mergePlan(target: Target, layers: PullRequestSummary[], picked: Method | null) {
  const { pr, overview } = target;
  const allowed = overview.mergeSettings?.methods.length ? overview.mergeSettings.methods : ALL_METHODS;
  const method = picked && allowed.includes(picked) ? picked : allowed.includes("squash") ? "squash" : allowed[0];
  const below = layersMergedWith(layers, pr);
  const count = (below?.length ?? 0) + 1;
  const { label } = METHODS[method];
  // Without an active Linked GitHub account, Merge opens the connect popup instead.
  const connect = target.commenting.connect.needed;
  return {
    allowed,
    method,
    below: below ?? [],
    count,
    label: count > 1 ? `${method === "merge" ? "Merge" : label} ${count} pull requests` : label,
    connect,
    blocker: connect ? null : mergeBlocker(target, below),
  };
}
export type MergePlan = ReturnType<typeof mergePlan>;

/** The Merge status popover's split button: the method menu, and the button that opens the confirm popup. */
export function MergeButton({
  plan,
  overview,
  onPick,
  onMerge,
}: {
  plan: MergePlan;
  overview: PullRequestOverview;
  onPick: (method: Method) => void;
  onMerge: () => void;
}) {
  return (
    <div className="space-y-2 p-4">
      <ButtonGroup>
        <Button size="sm" disabled={plan.blocker !== null} onClick={onMerge}>
          {plan.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              aria-label="Merge method"
              disabled={plan.blocker !== null}
              className="border-l border-primary-foreground/20"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            <DropdownMenuRadioGroup
              value={plan.method}
              onValueChange={(value) => {
                const method = plan.allowed.find((candidate) => candidate === value);
                if (method) onPick(method);
              }}
            >
              {plan.allowed.map((value) => (
                <DropdownMenuRadioItem key={value} value={value} className="items-start py-2">
                  <span>
                    <span className="block font-medium">{METHODS[value].option}</span>
                    <span className="block text-xs text-muted-foreground">
                      {METHODS[value].body(overview.commitCount, overview.baseRef)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {plan.blocker ? <p className="text-xs text-muted-foreground">{plan.blocker}</p> : null}
    </div>
  );
}

/** The confirm popup, mounted outside the popover so closing it keeps the popup. Merging… holds it open until GitHub answers. */
export function MergeConfirmDialog({ plan, onClose, ...target }: Target & { plan: MergePlan; onClose: () => void }) {
  const { projectId, repositoryId, pr, overview } = target;
  const merge = useAction(api.integrations.github.merges.merge);
  const { method, below, count } = plan;
  const autoDeletes = overview.mergeSettings?.deleteBranchOnMerge === true;
  const [merging, setMerging] = useState(false);
  const [title, setTitle] = useState(() => defaultTitle(method, pr));
  const [deleteBranch, setDeleteBranch] = useState(autoDeletes);
  const titleId = useId();
  const deleteId = useId();
  const { label, confirm, body } = METHODS[method];
  const stacked = Boolean(pr.stack);
  const warnings = mergeWarnings(overview, pr.author);

  const run = () => {
    setMerging(true);
    // The first line is the commit title and the rest its body; an unchanged title leaves GitHub's own.
    const [first = "", ...rest] = !stacked && method !== "rebase" ? title.split("\n") : [];
    const commitTitle = first.trim() && first.trim() !== defaultTitle(method, pr) ? first : undefined;
    const commitMessage = rest.join("\n").trim() || undefined;
    merge({
      projectId,
      repositoryId,
      number: pr.number,
      method,
      headSha: overview.headSha,
      commitTitle,
      commitMessage,
      layersBelow: stacked ? below.map((layer) => layer.number) : undefined,
      // The repository deletes merged branches itself.
      deleteBranch: deleteBranch && !autoDeletes,
    })
      .then(({ status, branchesKept }) => {
        const what = count > 1 ? `${count} pull requests` : `#${pr.number}`;
        if (status === "merged") toast.success(`Merged ${what}`);
        else if (status === "enqueued") toast.success(`Added ${what} to the merge queue`);
        else toast(`GitHub is still merging ${what}. It shows as merged here once it's done.`);
        const kept = branchesKept.map((number) => `#${number}`).join(", ");
        if (kept && status !== "merged") toast.warning(`Delete the branch of ${kept} on GitHub once the merge lands`);
        else if (kept) toast.warning(`Convoy couldn't delete the branch of ${kept}`);
        onClose();
      })
      .catch((error: unknown) => {
        showConvexErrorToast(error, "Could not merge");
        setMerging(false);
      });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !merging && onClose()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!merging}>
        <DialogHeader>
          <DialogTitle>{count > 1 ? plan.label : `${label} #${pr.number}`}</DialogTitle>
          <DialogDescription>
            Into {overview.baseRef} from <span className="font-mono text-xs">{pr.headRef}</span>
          </DialogDescription>
        </DialogHeader>
        {warnings.map((warning) => (
          <p key={warning} className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4 shrink-0 text-warning" />
            {warning}
          </p>
        ))}
        {stacked ? (
          <div className="space-y-2">
            <ol aria-label="Pull requests to merge" className="divide-y rounded-lg border">
              {[...below, pr].map((layer) => (
                <li key={layer.number} className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
                  <Layers className="size-4 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 text-muted-foreground">#{layer.number}</span>
                  <span className="min-w-0 truncate">{layer.title}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">Bottom first. Each pull request keeps its default commit message.</p>
          </div>
        ) : method === "rebase" ? (
          <p className="text-sm text-muted-foreground">{body(overview.commitCount, overview.baseRef)}</p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={titleId} className="text-xs">
              Commit message
            </Label>
            <Textarea id={titleId} value={title} rows={3} disabled={merging} onChange={(event) => setTitle(event.target.value)} />
          </div>
        )}
        <div className="flex items-center gap-2" title={autoDeletes ? "The repository deletes merged branches" : undefined}>
          <Checkbox
            id={deleteId}
            checked={deleteBranch}
            disabled={merging || autoDeletes}
            onCheckedChange={(checked) => setDeleteBranch(checked === true)}
          />
          <Label htmlFor={deleteId} className="text-sm font-normal">
            Delete the {count > 1 ? "branches" : "branch"} after merging
          </Label>
        </div>
        <DialogFooter>
          {merging ? null : (
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </DialogClose>
          )}
          <Button size="sm" disabled={merging || (!stacked && method !== "rebase" && !title.split("\n")[0].trim())} onClick={run}>
            {merging ? (
              <>
                <Spinner />
                Merging…
              </>
            ) : (
              confirm
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** GitHub's Update branch; `onUpdated` clears the held behind-base and mergeability until a refresh. */
export function UpdateBranchButton({ projectId, repositoryId, pr, commenting, overview, onUpdated }: Target & { onUpdated: () => void }) {
  const update = useAction(api.integrations.github.merges.updateBranch);
  const [pending, setPending] = useState(false);
  const blocker = commenting.connect.needed ? null : writeBlocker(commenting.account, commenting.role, "write");
  const run = () => {
    if (commenting.connect.needed) return commenting.connect.prompt();
    setPending(true);
    update({ projectId, repositoryId, number: pr.number, headSha: overview.headSha })
      .then(() => {
        toast.success(`Updating ${pr.headRef} with ${overview.baseRef}`);
        onUpdated();
      })
      .catch((error: unknown) => showConvexErrorToast(error, "Could not update the branch"))
      .finally(() => setPending(false));
  };
  return (
    // A span keeps the reason's tooltip on a disabled button.
    <span title={blocker ?? undefined} className="mt-3 inline-flex">
      <Button variant="outline" size="sm" disabled={pending || blocker !== null} onClick={run}>
        {pending ? <Spinner /> : null}
        Update branch
      </Button>
    </span>
  );
}
