"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { ArrowUpRight, GitPullRequest, RefreshCw, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toAttachedPullRequest } from "@/convex/lib/contracts/github";
import { EmptyState } from "@/components/custom/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PR_STACK_LAYER_ABOVE_HOTKEY, PR_STACK_LAYER_BELOW_HOTKEY } from "@/lib/browser/hotkeys";
import { getErrorMessage } from "@/lib/errors";
import { useNavigation, type RouteTarget } from "@/lib/navigation";
import type { PullRequestDiff } from "./github-patch";
import { PullRequestChanges } from "./pull-request-changes";
import { MergeStatus } from "./pull-request-merge-status";
import { PullRequestOverviewSkeleton, PullRequestOverviewTab, type OverviewState } from "./pull-request-overview";
import { StackBadge, useStackLayers } from "./pull-request-stack";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import type { PullRequestView } from "./types";
import { useReviewedMarks } from "./use-reviewed-marks";
import type { IntegrationStatus } from "./use-integration-status";

type DiffState = { kind: "loading" } | { kind: "loaded"; diff: PullRequestDiff } | { kind: "error"; message: string };
type Revision = { baseSha: string; headSha: string };
type Held = { request: number; diff: DiffState; overview: OverviewState; seen?: Revision };

function sameRevision(a: Revision, b: Revision): boolean {
  return a.baseSha === b.baseSha && a.headSha === b.headSha;
}

/**
 * One PR: live stored metadata, plus the diff and the Overview's GitHub data
 * read once and held stable until Refresh. A PR Convoy never stored (a search
 * result, an old link) shows the diff's live metadata. Losing access clears what it holds.
 */
export function PullRequestReader({
  projectId,
  repositoryId,
  number,
  status,
  hrefFor,
  organizationSlug,
  projectAlias,
  stackHotkeys = true,
}: {
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  status: IntegrationStatus | null;
  hrefFor: (repositoryId: string, number: number) => RouteTarget;
  organizationSlug: string;
  projectAlias: string;
  /** Off in the thread sidebar, where Shift+K/J would leave the thread. */
  stackHotkeys?: boolean;
}) {
  const args = { projectId, repositoryId, number };
  const result = useQuery(api.integrations.github.pullRequests.get, args);
  const tasks = useQuery(api.integrations.github.pullRequests.referencedTasks, args);
  const readDiff = useAction(api.integrations.github.pullRequests.readDiff);
  const readOverview = useAction(api.integrations.github.pullRequests.readOverview);
  const readable = Boolean(result);
  const stored = result?.pullRequest ?? null;
  const marks = useReviewedMarks(repositoryId, number);
  const navigation = useNavigation();
  const [tab, setTab] = useState("overview");
  // Bumped by Refresh/Retry; a held result for an older request reads as loading.
  const [request, setRequest] = useState(0);
  // `seen` is the stored revision when the diff arrived; it may lag the live diff.
  const [held, setHeld] = useState<Held | null>(null);
  if (!readable && held) {
    // Access lost: drop the held patches, not just hide them.
    setHeld(null);
  } else if (held && !held.seen && held.diff.kind === "loaded" && stored) {
    setHeld({ ...held, seen: { baseSha: stored.baseSha, headSha: stored.headSha } });
  }
  const current = readable && held?.request === request ? held : null;
  const diffState: DiffState = current?.diff ?? { kind: "loading" };
  const overviewState: OverviewState = current?.overview ?? { kind: "loading" };
  // The held diff's PR stays put until Refresh, like the diff itself.
  const heldPr = held?.diff.kind === "loaded" ? held.diff.diff.pullRequest : null;
  const pr: PullRequestView | null = stored ?? (readable ? heldPr : null);
  const layers = useStackLayers(pr?.stack ? { projectId, repositoryId, stackId: pr.stack.id } : null) ?? [];
  const load = () => setRequest((value) => value + 1);

  useEffect(() => {
    if (!readable) return;
    let live = true;
    // Later updates of the same request keep what it already holds, `seen` included.
    const update = (change: Partial<Held>) =>
      live &&
      setHeld((previous) => ({
        ...(previous?.request === request ? previous : { request, diff: { kind: "loading" }, overview: { kind: "loading" } }),
        ...change,
      }));
    const args = { projectId, repositoryId, number };
    const failed = (fallback: string) => (error: unknown) => ({ kind: "error" as const, message: getErrorMessage(error, fallback) });
    // The overview is read for the diff's revision, so both describe what is on screen.
    readDiff(args).then(
      (diff) => {
        update({ diff: { kind: "loaded", diff } });
        readOverview({ ...args, baseSha: diff.baseSha, headSha: diff.headSha })
          .then((overview) => update({ overview: { kind: "loaded", overview } }))
          .catch((error: unknown) => update({ overview: failed("Could not load the overview")(error) }));
      },
      (error: unknown) => {
        const state = failed("Could not load the changes")(error);
        update({ diff: state, overview: state });
      }
    );
    return () => {
      live = false;
    };
  }, [number, projectId, readDiff, readOverview, readable, repositoryId, request]);

  // GitHub's stack shortcuts: Shift+K opens the Layer above, Shift+J the one below.
  const at = layers.findIndex((layer) => layer.number === number);
  useHotkey(PR_STACK_LAYER_ABOVE_HOTKEY, () => navigation.push(hrefFor(repositoryId, layers[at + 1].number)), { enabled: stackHotkeys && at >= 0 && at < layers.length - 1 });
  useHotkey(PR_STACK_LAYER_BELOW_HOTKEY, () => navigation.push(hrefFor(repositoryId, layers[at - 1].number)), { enabled: stackHotkeys && at > 0 });

  if (result === null || (!pr && diffState.kind === "error")) {
    return (
      <EmptyState
        fill
        icon={GitPullRequest}
        title="This pull request isn't available"
        description={
          result === null ? "The project's GitHub connection was removed, or you no longer have access." : diffState.kind === "error" ? diffState.message : ""
        }
        action={
          result === null ? null : (
            <Button variant="outline" onClick={load}>
              <RotateCcw />
              Retry
            </Button>
          )
        }
      />
    );
  }
  if (!pr) return <PullRequestReaderSkeleton />;

  const repository = status?.connections.find((connection) => connection.repositoryId === repositoryId)?.repository;
  const githubUrl = repository ? `${repository.htmlUrl}/pull/${number}` : null;
  const loadedDiff = diffState.kind === "loaded" ? diffState.diff : null;
  // New only when the stored revision moved past both the diff and what was stored when it loaded.
  const hasNewChanges = Boolean(loadedDiff && current?.seen && !sameRevision(pr, loadedDiff) && !sameRevision(pr, current.seen));
  const layerHref = (layer: number) => hrefFor(repositoryId, layer);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <PullRequestStateIcon pr={pr} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={pr.title}>
          {pr.title}
        </h1>
        {pr.archived ? <Badge variant="secondary">Archived</Badge> : null}
        <StackBadge header pr={pr} projectId={projectId} hrefFor={layerHref} />
        {pr.state === "open" ? (
          <MergeStatus
            overview={overviewState.kind === "loaded" ? overviewState.overview : null}
            layers={layers}
            current={pr}
            hrefFor={layerHref}
          />
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh from GitHub"
          title="Refresh from GitHub"
          disabled={diffState.kind === "loading"}
          onClick={load}
        >
          <RefreshCw className={cn(diffState.kind === "loading" && "animate-spin")} />
        </Button>
        {githubUrl ? (
          <Button variant="ghost" size="icon-sm" aria-label="Open on GitHub" title="Open on GitHub" asChild>
            <a href={githubUrl} target="_blank" rel="noreferrer">
              <ArrowUpRight />
            </a>
          </Button>
        ) : null}
      </header>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b px-4">
          <TabsList variant="underline" className="w-auto border-b-0" aria-label="Pull request content">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guide">Guide</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
          </TabsList>
          {loadedDiff ? (
            <span className="truncate font-mono text-xs text-muted-foreground" aria-label="Displayed revision">
              {pr.baseRef} → {loadedDiff.headSha.slice(0, 7)}
            </span>
          ) : null}
        </div>
        {hasNewChanges ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b bg-accent/50 px-5 py-3 text-sm md:px-8">
            <div>
              <span className="font-medium">New changes available</span>
              <p className="text-xs text-muted-foreground">What you&apos;re reading stays in place until you refresh.</p>
            </div>
            <Button variant="outline" size="sm" onClick={load}>
              <RotateCcw />
              Refresh
            </Button>
          </div>
        ) : null}
        {/* A container, so the Overview stacks in the narrow thread sidebar too. */}
        <TabsContent value="overview" className="@container overflow-auto">
          <PullRequestOverviewTab
            pr={pr}
            summary={pr}
            state={overviewState}
            onRetry={load}
            tasks={tasks}
            layers={layers}
            hrefFor={layerHref}
            organizationSlug={organizationSlug}
            projectId={projectId}
            projectAlias={projectAlias}
            pullRequest={repository ? toAttachedPullRequest({ owner: repository.owner, name: repository.name, number }) : null}
          />
        </TabsContent>
        <TabsContent value="guide" className="overflow-auto">
          <EmptyState icon={GitPullRequest} title="No guide yet" description="Guides that walk through a pull request step by step aren't available yet." />
        </TabsContent>
        <TabsContent value="diff" className="flex min-h-0 flex-1 flex-col gap-0">
          {diffState.kind === "loading" ? <Skeleton className="m-4 h-48 rounded-lg" aria-label="Loading changes" /> : null}
          {diffState.kind === "error" ? (
            <div className="m-4 flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-destructive">
              <span className="flex-1">{diffState.message}</span>
              <Button variant="outline" size="sm" onClick={load}>
                <RotateCcw />
                Retry
              </Button>
            </div>
          ) : null}
          {loadedDiff ? <PullRequestChanges diff={loadedDiff} projectId={projectId} repositoryId={repositoryId} number={number} marks={marks} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** The reader's header, tab row, and Overview, outlined until the PR loads. */
export function PullRequestReaderSkeleton() {
  return (
    <div aria-label="Loading pull request" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-4 w-1/3" />
      </header>
      <div className="flex h-[41px] shrink-0 items-center gap-6 border-b px-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-10" />
      </div>
      <div className="@container overflow-auto">
        <PullRequestOverviewSkeleton />
      </div>
    </div>
  );
}
