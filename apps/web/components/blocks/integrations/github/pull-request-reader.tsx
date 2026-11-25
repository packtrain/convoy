"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { ArrowLeft, ArrowUpRight, GitPullRequest, RefreshCw, RotateCcw } from "lucide-react";
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
import { AppLink, PULL_REQUEST_TABS, useNavigation, type PullRequestTab, type RouteTarget } from "@/lib/navigation";
import type { DiffState } from "./github-patch";
import { PullRequestChanges, PullRequestChangesSkeleton } from "./pull-request-changes";
import { CommitsSkeleton, PullRequestCommitsTab, usePullRequestCommits } from "./pull-request-commits";
import { GuideMenu, GuideSkeleton, PullRequestGuideTab, usePullRequestGuides } from "./pull-request-guide";
import { useGithubCommenting } from "./pull-request-comments";
import { ReviewButton, usePullRequestReview } from "./pull-request-review";
import { MergeStatus } from "./pull-request-merge-status";
import { PullRequestOverviewSkeleton, PullRequestOverviewTab, resolveConflictsPrompt, type OverviewState } from "./pull-request-overview";
import { StackBadge, useStackLayers } from "./pull-request-stack";
import { PullRequestStateActions } from "./pull-request-state-actions";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import type { PullRequestOverview, PullRequestView } from "./types";
import { useReviewedMarks } from "./use-reviewed-marks";
import { useGenerateGuide } from "./run-pull-request-guide";
import type { IntegrationStatus } from "./use-integration-status";

type Revision = { baseSha: string; headSha: string };
type Held = { request: number; diff: DiffState; overview: OverviewState; seen?: Revision };

/** Waits between mergeability re-reads; after the last, Refresh is left. */
const MERGEABILITY_RETRIES_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

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
  defaultTab = "overview",
  onTabChange,
  backHref,
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
  defaultTab?: PullRequestTab;
  /** The PR page mirrors the tab into its URL. */
  onTabChange?: (tab: PullRequestTab) => void;
  /** The PR page's list, linked from the header on phones, where the browser pane hides. */
  backHref?: RouteTarget;
}) {
  const args = { projectId, repositoryId, number };
  const result = useQuery(api.integrations.github.pullRequests.get, args);
  const tasks = useQuery(api.integrations.github.pullRequests.referencedTasks, args);
  const readDiff = useAction(api.integrations.github.pullRequests.readDiff);
  const readOverview = useAction(api.integrations.github.pullRequests.readOverview);
  const readMergeability = useAction(api.integrations.github.pullRequests.readMergeability);
  const readable = Boolean(result);
  const stored = result?.pullRequest ?? null;
  const marks = useReviewedMarks(repositoryId, number);
  const commits = usePullRequestCommits(args, readable);
  const navigation = useNavigation();
  const [tab, setTab] = useState<PullRequestTab>(defaultTab);
  // Fix's draft for Overview's thread composer.
  const [seed, setSeed] = useState<string>();
  const showTab = (next: PullRequestTab) => {
    setTab(next);
    onTabChange?.(next);
  };
  // The pending comment the review popover jumped to.
  const [reveal, setReveal] = useState<{ path: string; id: string } | null>(null);
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
  const stackLayers = useStackLayers(pr?.stack ? { projectId, repositoryId, stackId: pr.stack.id } : null);
  const layers = stackLayers ?? [];
  const load = () => setRequest((value) => value + 1);
  // GitHub's answer to a write patches the held Overview, so it updates without another read.
  const updateOverview = (change: (overview: PullRequestOverview) => PullRequestOverview) =>
    setHeld((previous) =>
      previous?.overview.kind === "loaded" ? { ...previous, overview: { kind: "loaded", overview: change(previous.overview.overview) } } : previous
    );
  const commenting = useGithubCommenting({
    projectId,
    repositoryId,
    number,
    organizationSlug,
    archived: pr?.archived ?? false,
    returnTo: hrefFor(repositoryId, number),
    onCommentsChange: (change) => updateOverview((overview) => ({ ...overview, comments: change(overview.comments) })),
  });
  const review = usePullRequestReview({
    projectId,
    repositoryId,
    number,
    commenting,
    draftKey: `convoy:github:review-draft:${organizationSlug}:${projectAlias}:${repositoryId}:${number}`,
    headSha: current?.diff.kind === "loaded" ? current.diff.diff.headSha : null,
    author: pr?.author ?? "",
    // A submitted review fulfills its author's request, as GitHub drops them from the requested reviewers.
    onSubmitted: ({ review, comments }) =>
      updateOverview((overview) => ({
        ...overview,
        reviews: [...overview.reviews, review],
        reviewComments: [...overview.reviewComments, ...comments],
        requestedReviewers: overview.requestedReviewers.filter((login) => login !== review.author),
      })),
  });
  const repository = status?.connections.find((connection) => connection.repositoryId === repositoryId)?.repository;
  const attached = repository ? toAttachedPullRequest({ owner: repository.owner, name: repository.name, number }) : null;
  // Live only while the Guide tab shows.
  const guides = usePullRequestGuides(tab === "guide" ? args : "skip");
  const launch = useGenerateGuide(
    attached ? { projectId, organizationSlug, projectAlias, pullRequest: attached } : null,
    stored ? { baseSha: stored.baseSha, headSha: stored.headSha } : null,
    guides.guides,
    // Null while a stacked PR's Layers load, so Generate guide waits for them.
    pr?.stack && !stackLayers ? null : layers,
    // Waits for the Overview too; one that failed to load leaves the threads out.
    overviewState.kind === "loaded" ? overviewState.overview.settledThreads : overviewState.kind === "loading" ? null : []
  );

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

  // GitHub computes mergeability after a push and sends no event, so an unknown answer is re-read alone until it settles.
  const settling =
    current?.overview.kind === "loaded" && current.overview.overview.mergeable === "unknown" && current.diff.kind === "loaded"
      ? { baseSha: current.diff.diff.baseSha, headSha: current.diff.diff.headSha }
      : null;
  const { baseSha: settlingBase, headSha: settlingHead } = settling ?? {};
  useEffect(() => {
    if (!settlingBase || !settlingHead) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    const next = () => {
      timer = setTimeout(() => {
        readMergeability({ projectId, repositoryId, number, baseSha: settlingBase, headSha: settlingHead })
          .then((answer) => {
            if (!live || !answer) return;
            if (answer.mergeable !== "unknown") {
              setHeld((previous) =>
                previous?.request === request && previous.overview.kind === "loaded"
                  ? { ...previous, overview: { kind: "loaded", overview: { ...previous.overview.overview, ...answer } } }
                  : previous
              );
            } else if (++attempt < MERGEABILITY_RETRIES_MS.length) next();
          })
          // A failed re-read leaves Refresh.
          .catch(() => {});
      }, MERGEABILITY_RETRIES_MS[attempt]);
    };
    next();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [number, projectId, readMergeability, repositoryId, request, settlingBase, settlingHead]);

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
  if (!pr) return <PullRequestReaderSkeleton backHref={backHref} />;

  const githubUrl = repository ? `${repository.htmlUrl}/pull/${number}` : null;
  const loadedDiff = diffState.kind === "loaded" ? diffState.diff : null;
  // New only when the stored revision moved past both the diff and what was stored when it loaded.
  const hasNewChanges = Boolean(loadedDiff && current?.seen && !sameRevision(pr, loadedDiff) && !sameRevision(pr, current.seen));
  const layerHref = (layer: number) => hrefFor(repositoryId, layer);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {backHref ? <MobileBackButton href={backHref} /> : null}
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
            projectId={projectId}
            repositoryId={repositoryId}
            commenting={commenting}
            // GitHub rewrites the head; until Refresh, the held Overview stops claiming it is behind or mergeable.
            onResolveLocally={
              attached
                ? () => {
                    setSeed(resolveConflictsPrompt(pr, layers));
                    showTab("overview");
                  }
                : undefined
            }
            onBranchUpdated={() => updateOverview((overview) => ({ ...overview, behindBy: 0, mergeBlock: null, mergeable: "unknown" }))}
          />
        ) : null}
        <ReviewButton
          review={review}
          onJump={({ path, id }) => {
            showTab("diff");
            setReveal({ path, id });
          }}
        />
        <PullRequestStateActions projectId={projectId} repositoryId={repositoryId} pr={pr} commenting={commenting} />
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
      {commenting.connect.dialog}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = PULL_REQUEST_TABS.find((name) => name === value);
          if (next) showTab(next);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b px-4">
          <TabsList variant="underline" className="w-auto border-b-0" aria-label="Pull request content">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guide">Guide</TabsTrigger>
            <TabsTrigger value="commits">Commits</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
          </TabsList>
          {tab === "guide" && guides.shown ? (
            <GuideMenu state={guides} launch={launch} />
          ) : loadedDiff ? (
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
            pullRequest={attached}
            repositoryId={repositoryId}
            commenting={commenting}
            seed={seed}
            onSeed={setSeed}
            onAssigneesChange={(assignees) => updateOverview((overview) => ({ ...overview, assignees }))}
            onRequestedReviewersChange={(requestedReviewers) => updateOverview((overview) => ({ ...overview, requestedReviewers }))}
          />
        </TabsContent>
        <TabsContent value="guide" className="overflow-auto">
          <PullRequestGuideTab
            state={guides}
            launch={launch}
            pullRequest={stored}
            diffState={diffState}
            onRetryDiff={load}
            marks={marks}
            organizationSlug={organizationSlug}
            projectAlias={projectAlias}
          />
        </TabsContent>
        <TabsContent value="commits" className="flex min-h-0 flex-1 flex-col gap-0">
          <PullRequestCommitsTab state={overviewState} commits={commits} onRetry={load} pullRequestUrl={githubUrl} />
        </TabsContent>
        <TabsContent value="diff" className="flex min-h-0 flex-1 flex-col gap-0">
          {diffState.kind === "loading" ? <PullRequestChangesSkeleton /> : null}
          {diffState.kind === "error" ? (
            <div className="m-4 flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-destructive">
              <span className="flex-1">{diffState.message}</span>
              <Button variant="outline" size="sm" onClick={load}>
                <RotateCcw />
                Retry
              </Button>
            </div>
          ) : null}
          {loadedDiff ? (
            <PullRequestChanges
              diff={loadedDiff}
              projectId={projectId}
              repositoryId={repositoryId}
              number={number}
              marks={marks}
              review={review}
              reviewComments={overviewState.kind === "loaded" ? overviewState.overview.reviewComments : []}
              reveal={reveal}
            />
          ) : null}
        </TabsContent>
      </Tabs>
      {launch.dialog}
    </div>
  );
}

/** Each tab's body while the PR loads, in the wrapper its `TabsContent` uses. */
const TAB_SKELETONS: Record<PullRequestTab, ReactNode> = {
  overview: (
    <div className="@container overflow-auto">
      <PullRequestOverviewSkeleton />
    </div>
  ),
  guide: (
    <div className="overflow-auto">
      <GuideSkeleton />
    </div>
  ),
  commits: (
    <div className="flex min-h-0 flex-1 flex-col">
      <CommitsSkeleton />
    </div>
  ),
  diff: (
    <div className="flex min-h-0 flex-1 flex-col">
      <PullRequestChangesSkeleton />
    </div>
  ),
};

function MobileBackButton({ href }: { href: RouteTarget }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Back to pull requests" title="Back to pull requests" className="-ml-2 md:hidden" asChild>
      <AppLink href={href}>
        <ArrowLeft />
      </AppLink>
    </Button>
  );
}

/** The reader's header, tab row, and the open tab, outlined until the PR loads. */
export function PullRequestReaderSkeleton({ tab = "overview", backHref }: { tab?: PullRequestTab; backHref?: RouteTarget }) {
  return (
    <div aria-label="Loading pull request" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {backHref ? <MobileBackButton href={backHref} /> : null}
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-4 w-1/3" />
      </header>
      <div className="flex h-[41px] shrink-0 items-center gap-6 border-b px-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-10" />
      </div>
      {TAB_SKELETONS[tab]}
    </div>
  );
}
