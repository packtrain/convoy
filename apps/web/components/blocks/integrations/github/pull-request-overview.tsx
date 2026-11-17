"use client";

import { useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  GitCommitHorizontal,
  GitPullRequest,
  Layers,
  MessageSquare,
  RotateCcw,
  X,
} from "lucide-react";
import { PullRequestChecksCard, TaskEvidenceCard } from "@/components/blocks/checks";
import { EmptyValue } from "@/components/blocks/tasks/task-table/badges";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { TimelineHeader, TimelineThreadRowCard } from "@/components/blocks/tasks/task-timeline";
import { TaskThreadComposer } from "@/components/blocks/tasks/task-thread-composer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachedPullRequest } from "@/convex/lib/contracts/github";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";
import { AppLink, appRoute, type RouteTarget } from "@/lib/navigation";
import type { TimelineSortDirection, TimelineThreadRow } from "@/lib/tasks/timeline/rows";
import { cn } from "@/lib/utils";
import { checksRollup, GithubCheckList, ROLLUP_ICONS } from "./github-checks";
import { GithubMarkdown } from "./github-markdown";
import { reviewerStates, type ReviewerState } from "./pull-request-merge-status";
import { layerBelow, StackMap } from "./pull-request-stack";
import { displayState, PullRequestStateIcon } from "./pull-request-state-icon";
import { PullRequestThreadsComposeButton, PullRequestThreadsProperty, toTimelineThreadRow, usePullRequestThreads } from "./pull-request-threads";
import type { PullRequestOverview, PullRequestSummary, PullRequestView, ReferencedTask } from "./types";

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

export type OverviewState = { kind: "loading" } | { kind: "loaded"; overview: PullRequestOverview } | { kind: "error"; message: string };

/** A card whose header unfolds what it hides, with a chevron showing the state. */
function FoldCard({
  icon,
  title,
  subtitle,
  label,
  open,
  onToggle,
  action,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** What unfolding shows; omit when nothing is hidden. */
  label?: string;
  open: boolean;
  onToggle: () => void;
  /** Sits above the header's fold button, e.g. Fix. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative flex items-center gap-3 p-3 pr-10">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium tabular-nums">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </div>
        {action ? <div className="relative z-10 ml-auto shrink-0">{action}</div> : null}
        {label ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? `Hide ${label}` : `Show ${label}`}
            className="absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronRight
              className={cn(
                "absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform",
                open && "rotate-90"
              )}
            />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** A FoldCard's outline while its data loads. */
function CardSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} className="flex items-center gap-3 rounded-lg border p-3">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="flex flex-col">
        <span className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-28" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-56" />
        </span>
      </div>
    </div>
  );
}

/** Activity's header, composer, a comment row, and an activity rail while the overview loads. */
function ActivitySkeleton({ composer }: { composer?: ReactNode }) {
  return (
    <section aria-label="Loading activity" className="mt-8">
      <div className="flex items-center justify-between py-2">
        <h3 className="text-sm font-medium text-foreground">Activity</h3>
        <Skeleton className="size-7 rounded-md" />
      </div>
      {composer}
      <div className="flex gap-3 py-3">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-40" />
          </span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      {/* The rail pulses with the circles and sits between them, not behind (pulsing is translucent). */}
      <div className="py-2.5">
        <div className="flex h-5 items-center gap-2 pl-1">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="ml-[13.5px] h-3 w-px rounded-none" />
        <div className="flex h-5 items-center gap-2 pl-1">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3.5 w-72" />
        </div>
      </div>
    </section>
  );
}

/** A one-line property value while the overview loads. */
const PropertySkeleton = () => <Skeleton className="h-4 w-32" aria-label="Loading" />;

function CommitsCard({ overview }: { overview: PullRequestOverview }) {
  const [open, setOpen] = useState(false);
  const latest = overview.commits.at(-1);
  return (
    <FoldCard
      icon={<GitCommitHorizontal className="size-4.5" />}
      title={`Commits: ${overview.commitCount}`}
      subtitle={latest ? `Latest: ${latest.message} · ${ago(latest.committedAt)}` : "No commits"}
      label={overview.commits.length ? "commits" : undefined}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      {open ? (
        <ol className="divide-y border-t">
          {overview.commits.map((commit) => (
            <li key={commit.sha} className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={commit.message}>
                {commit.message}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{commit.author}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{ago(commit.committedAt)}</span>
              <a
                href={commit.url}
                target="_blank"
                rel="noreferrer"
                title="Open commit on GitHub"
                className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {commit.sha.slice(0, 7)}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </FoldCard>
  );
}

/** Only failing and pending rows until the header unfolds the passed ones. Convoy's own runs show in the Pull request checks card. */
function GithubChecksCard({ overview, onFix }: { overview: PullRequestOverview; onFix?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const checks = overview.checks.filter((check) => !check.fromConvoy);
  const rollup = checksRollup(checks);
  const failed = checks.filter((check) => check.state === "failure");
  const rows = open ? checks : checks.filter((check) => check.state !== "success");
  return (
    <FoldCard
      icon={ROLLUP_ICONS[rollup.state]}
      title={`GitHub checks: ${rollup.passed}/${checks.length}`}
      subtitle={rollup.body}
      label={rollup.passed ? `${rollup.passed} passed checks` : undefined}
      open={open}
      onToggle={() => setOpen(!open)}
      action={
        onFix && failed.length ? (
          <Button size="xs" variant="ghost" onClick={() => onFix(bulletList("Fix the failing GitHub checks:", failed.map((check) => [check.name, check.summary])))}>
            Fix
          </Button>
        ) : null
      }
    >
      {rows.length ? <GithubCheckList checks={rows} className="rounded-none border-0 border-t text-sm" /> : null}
    </FoldCard>
  );
}

const REVIEWER_LABELS: Record<ReviewerState, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  requested: "Requested",
};

const REVIEW_TEXT: Record<Exclude<PullRequestOverview["reviews"][number]["state"], "dismissed">, { text: string; icon: ReactNode }> = {
  approved: { text: "approved these changes", icon: <Check className="size-3.5 text-success" /> },
  changes_requested: { text: "requested changes", icon: <X className="size-3.5 text-destructive" /> },
  commented: { text: "reviewed", icon: <MessageSquare className="size-3.5" /> },
};

type Entry =
  | { kind: "activity"; key: string; at: number; icon: ReactNode; text: ReactNode }
  | { kind: "thread"; key: string; at: number; thread: TimelineThreadRow }
  /** An issue comment, or a review with a body (`action` says what the review did). */
  | {
      kind: "comment";
      key: string;
      at: number;
      author: string;
      authorAvatarUrl: string | null;
      body: string;
      url: string;
      action?: string;
      /** An inline review comment's file and quoted lines. */
      quote?: { path: string; line: number | null; lines: QuoteLine[] };
    };

type QuoteLine = PullRequestOverview["reviewComments"][number]["quote"][number];
const QUOTE_ROWS: Record<QuoteLine["kind"], { sign: string; className: string }> = {
  add: { sign: "+", className: "bg-success/10" },
  del: { sign: "-", className: "bg-destructive/10" },
  context: { sign: " ", className: "" },
};

function quoteLabel({ line, lines }: { line: number | null; lines: QuoteLine[] }) {
  const numbers = lines.flatMap((quoted) => (quoted.number === null ? [] : [quoted.number]));
  const [first, last] = [numbers[0] ?? line, numbers.at(-1) ?? line];
  if (first === null || last === null) return "";
  return first === last ? `Line ${last}` : `Lines ${first}–${last}`;
}

/** GitHub's inline-comment header: the file, its lines, and the quoted code. */
function CommentQuote({ quote }: { quote: NonNullable<Extract<Entry, { kind: "comment" }>["quote"]> }) {
  return (
    <figure className="my-2 overflow-hidden rounded-lg border">
      <header className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate font-mono">{quote.path}</span>
        <span className="shrink-0 text-muted-foreground">{quoteLabel(quote)}</span>
      </header>
      {quote.lines.length ? (
        <table className="w-full font-mono text-xs">
          <tbody>
            {quote.lines.map((quoted, index) => (
              <tr key={index} className={QUOTE_ROWS[quoted.kind].className}>
                <td className="w-10 px-2 py-0.5 text-right align-top text-muted-foreground select-none">{quoted.number ?? ""}</td>
                <td className="px-2 py-0.5 break-all whitespace-pre-wrap">
                  <span className="select-none">{QUOTE_ROWS[quoted.kind].sign}</span>
                  {quoted.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </figure>
  );
}

/** The task timeline's header over GitHub's conversation, read-only: commits, reviews, and comments. */
function Activity({
  pr,
  overview,
  threads,
  composer,
  organizationSlug,
  projectAlias,
}: {
  pr: PullRequestView;
  overview: PullRequestOverview;
  /** Absent without a connected repository: no Threads source, no composer. */
  threads?: TimelineThreadRow[];
  composer?: ReactNode;
  organizationSlug: string;
  projectAlias: string;
}) {
  const [sources, setSources] = useState<TimelineSources>({ comments: true, threads: true, activity: true });
  const [sort, setSort] = useState<TimelineSortDirection>("desc");
  const entries: Entry[] = [
    ...(sources.activity
      ? [
          {
            kind: "activity" as const,
            key: "opened",
            at: pr.providerCreatedAt,
            icon: <GitPullRequest className="size-3.5 text-success" />,
            text: `${pr.author} opened this pull request`,
          },
          ...overview.commits.map((commit) => ({
            kind: "activity" as const,
            key: `commit:${commit.sha}`,
            at: commit.committedAt,
            icon: <GitCommitHorizontal className="size-3.5" />,
            text: (
              <>
                {commit.author} committed <span className="text-foreground">{commit.message}</span>
              </>
            ),
          })),
          ...overview.reviews.flatMap((review): Entry[] => {
            if (review.state === "dismissed") return [];
            const { icon, text } = REVIEW_TEXT[review.state];
            const key = `review:${review.id}`;
            return review.body.trim()
              ? [
                  {
                    kind: "comment",
                    key,
                    at: review.submittedAt,
                    author: review.author,
                    authorAvatarUrl: review.authorAvatarUrl,
                    body: review.body,
                    url: review.url,
                    action: text,
                  },
                ]
              : [{ kind: "activity", key, at: review.submittedAt, icon, text: `${review.author} ${text}` }];
          }),
        ]
      : []),
    ...(sources.comments
      ? [
          ...overview.comments.map((comment) => ({
            kind: "comment" as const,
            key: `comment:${comment.id}`,
            ...comment,
            at: comment.createdAt,
          })),
          ...overview.reviewComments.map(({ path, line, quote, ...comment }) => ({
            kind: "comment" as const,
            key: `review-comment:${comment.id}`,
            ...comment,
            at: comment.createdAt,
            action: "commented",
            quote: { path, line, lines: quote },
          })),
        ]
      : []),
    ...(sources.threads && threads
      ? threads.map((thread) => ({ kind: "thread" as const, key: `thread:${thread.threadId}`, at: thread.createdAt, thread }))
      : []),
  ].sort((a, b) => (sort === "asc" ? a.at - b.at : b.at - a.at));

  // Consecutive activity rows share one rail, as in the task timeline.
  const blocks: Entry[][] = [];
  for (const entry of entries) {
    const last = blocks.at(-1);
    if (entry.kind === "activity" && last?.[0].kind === "activity") last.push(entry);
    else blocks.push([entry]);
  }

  return (
    <section aria-label="Activity" className="mt-8">
      <div className="-mx-4">
        <TimelineHeader
          sources={sources}
          sortDirection={sort}
          onToggleSource={(source, enabled) => setSources({ ...sources, [source]: enabled })}
          onSortDirectionChange={setSort}
          hasThreadSource={threads !== undefined}
        />
      </div>
      {sort === "desc" ? composer : null}
      {!sources.activity && !sources.comments && !(threads && sources.threads) ? (
        <p className="py-4 text-sm text-muted-foreground">Every source is hidden. Turn one on to see this pull request&apos;s activity.</p>
      ) : null}
      {blocks.map((block) => {
        const first = block[0];
        if (first.kind === "thread") {
          return <TimelineThreadRowCard key={first.key} thread={first.thread} organizationSlug={organizationSlug} projectAlias={projectAlias} />;
        }
        if (first.kind === "comment") {
          return (
            <article key={first.key} className="flex gap-3 py-3">
              <Avatar className="size-8 shrink-0">
                <AvatarImage src={first.authorAvatarUrl ?? undefined} />
                <AvatarFallback className="text-xs">{first.author.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs text-muted-foreground">
                  <span className="text-sm font-medium text-foreground">{first.author}</span>
                  {first.action ? ` ${first.action}` : null} ·{" "}
                  <a href={first.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {ago(first.at)}
                  </a>
                </p>
                {first.quote ? <CommentQuote quote={first.quote} /> : null}
                <GithubMarkdown>{first.body}</GithubMarkdown>
              </div>
            </article>
          );
        }
        return (
          <div key={first.key} className="relative py-1 pl-8">
            <span aria-hidden className="absolute top-4 bottom-4 left-[13px] w-px bg-border" />
            {block.map((entry) =>
              entry.kind === "activity" ? (
                <div key={entry.key} className="flex items-start gap-2 py-1.5">
                  <span className="absolute left-1 flex size-5 items-center justify-center bg-background text-muted-foreground">
                    {entry.icon}
                  </span>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {entry.text}
                    <span className="text-xs whitespace-nowrap"> · {ago(entry.at)}</span>
                  </p>
                </div>
              ) : null
            )}
          </div>
        );
      })}
      {sort === "asc" ? composer : null}
    </section>
  );
}

/** A Fix draft: the ask, then one "- name: note" line per failed row. */
function bulletList(heading: string, rows: [string, string | undefined][]) {
  return [heading, ...rows.map(([name, note]) => (note ? `- ${name}: ${note}` : `- ${name}`))].join("\n");
}

function Property({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="flex h-4 items-center justify-between text-xs text-muted-foreground">
        {label}
        {action}
      </h3>
      {children}
    </div>
  );
}

/** One labelled value in the narrow-pane summary row. */
function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </span>
  );
}

const STATE_WORDS = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" } as const;

/** The Overview's outline before the PR itself has loaded: title, meta, description, cards, properties. */
export function PullRequestOverviewSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 pt-12 pb-6 md:px-8 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="flex h-7 items-center justify-between gap-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-7 w-20 rounded-md @4xl:hidden" />
        </div>
        <div className="mt-2 flex h-4 items-center">
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="mt-3 flex h-5.5 items-center gap-4 @4xl:hidden">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="mt-8 space-y-2">
          <Skeleton className="mb-3 h-3 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="mt-8 space-y-3">
          <CardSkeleton label="Loading checks" />
          <CardSkeleton label="Loading commits" />
        </div>
        <ActivitySkeleton />
      </div>
      <div className="hidden space-y-6 @4xl:block">
        {["Status", "Tasks", "Reviewers"].map((label) => (
          <Property key={label} label={label}>
            <PropertySkeleton />
          </Property>
        ))}
      </div>
    </div>
  );
}

/** Overview: description and cards in the main column, properties beside it (docs/specs/github-integration.md → PR reader). */
export function PullRequestOverviewTab({
  pr,
  summary,
  state,
  onRetry,
  tasks,
  layers,
  hrefFor,
  organizationSlug,
  projectId,
  projectAlias,
  pullRequest,
}: {
  pr: PullRequestView;
  summary: PullRequestView;
  state: OverviewState;
  onRetry: () => void;
  tasks: ReferencedTask[] | undefined;
  layers: PullRequestSummary[];
  hrefFor: (number: number) => RouteTarget;
  organizationSlug: string;
  projectId: Id<"projects">;
  projectAlias: string;
  /** Null when the repository is not connected here: no Threads, composer, or Fix. */
  pullRequest: AttachedPullRequest | null;
}) {
  const overview = state.kind === "loaded" ? state.overview : null;
  const threads = usePullRequestThreads(projectId, pullRequest);
  const composerRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [seed, setSeed] = useState<string>();
  const reveal = () => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const compose = () => {
    setFocusKey((key) => key + 1);
    reveal();
  };
  // Fix drafts a thread in Activity's composer; the member edits and sends it.
  const canFix = pullRequest !== null;
  const composer = pullRequest ? (
    <div ref={composerRef} className="py-3">
      <TaskThreadComposer
        projectId={projectId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
        pullRequest={pullRequest}
        seed={seed}
        onSeeded={() => setSeed(undefined)}
        focusRequestKey={focusKey}
        composerContainerClassName="p-0"
        composerTextareaClassName="min-h-[88px] p-3"
      />
    </div>
  ) : null;
  const fix = (text: string) => {
    setSeed(text);
    reveal();
  };
  const reviewers = overview ? reviewerStates(overview, pr.author) : state.kind === "loading" ? undefined : [];
  const below = layerBelow(layers, pr.number);
  const baseName = below ? `#${below.number}` : pr.baseRef;
  const status = (
    <>
      <PullRequestStateIcon pr={pr} />
      {STATE_WORDS[displayState(pr)]}
    </>
  );
  const branchStatus = !overview ? null : overview.mergeable === "conflicting" ? (
    <span className="flex min-w-0 items-center gap-2">
      <CircleX className="size-4 shrink-0 text-destructive" />
      <span className="truncate">Conflicts with {baseName}</span>
    </span>
  ) : overview.behindBy === null ? (
    <span className="flex items-center gap-2 text-muted-foreground">
      <CircleDashed className="size-4" />
      Couldn&apos;t compare with {overview.baseRef}
    </span>
  ) : overview.behindBy ? (
    <span className="flex items-center gap-2">
      <CircleDashed className="size-4 text-muted-foreground" />
      Behind {overview.baseRef}
    </span>
  ) : (
    <span className="flex items-center gap-2">
      <CircleCheck className="size-4 text-success" />
      Up to date with {overview.baseRef}
    </span>
  );
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 pt-12 pb-6 md:px-8 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        {/* Too narrow for the properties column: Status, the branch state, and the rest move into the header. */}
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
          </h2>
          <Badge variant="outline" className="h-7 shrink-0 gap-1.5 px-2.5 text-sm [&>svg]:size-4! @4xl:hidden">
            {status}
          </Badge>
        </div>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{pr.author}</span>
          <span>·</span>
          <span className="font-mono">{pr.baseRef}</span>
          <span>←</span>
          <span className="min-w-0 truncate font-mono">{pr.headRef}</span>
          {branchStatus ? <span className="flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 @4xl:hidden"><span>·</span>{branchStatus}</span> : null}
        </p>
        <section aria-label="Pull request summary" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs empty:hidden @4xl:hidden">
          {tasks?.length ? (
            <SummaryItem label="Tasks">
              {tasks.map((task) => (
                <AppLink key={task._id} href={appRoute.task(organizationSlug, task.refId)} title={`${task.refId} ${task.name}`} className="rounded-sm hover:text-foreground">
                  <TaskRefWithType refId={task.refId} taskType={task.taskType} refInteractive={false} className="gap-1" refClassName="text-xs" />
                </AppLink>
              ))}
            </SummaryItem>
          ) : null}
          {summary.stack && layers.length ? (
            <SummaryItem label="Stack">
              <Popover>
                <PopoverTrigger className="flex items-center gap-1 rounded-sm text-foreground hover:underline">
                  <Layers className="size-3.5 text-muted-foreground" />
                  {layers.length} PRs
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-1">
                  <StackMap layers={layers} current={pr.number} hrefFor={hrefFor} />
                </PopoverContent>
              </Popover>
            </SummaryItem>
          ) : null}
          {reviewers?.length ? (
            <SummaryItem label="Reviewers">
              {reviewers.map((reviewer) => (
                <span key={reviewer.login} className="text-foreground">
                  {reviewer.login} <span className="text-muted-foreground">{REVIEWER_LABELS[reviewer.state]}</span>
                </span>
              ))}
            </SummaryItem>
          ) : null}
          {overview?.assignees.length ? (
            <SummaryItem label="Assignees">
              {overview.assignees.map((assignee) => (
                <span key={assignee.login} className="text-foreground">
                  {assignee.login}
                </span>
              ))}
            </SummaryItem>
          ) : null}
          {pr.labels.map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
          {overview?.milestone ? (
            <SummaryItem label="Milestone">
              <a href={overview.milestone.url} target="_blank" rel="noreferrer" className="text-foreground hover:underline">
                {overview.milestone.title}
              </a>
            </SummaryItem>
          ) : null}
        </section>
        <section aria-label="Description" className="mt-8">
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">Description</h3>
          {pr.description.trim() ? (
            <GithubMarkdown>{pr.description}</GithubMarkdown>
          ) : (
            <p className="text-sm text-muted-foreground">No description.</p>
          )}
        </section>
        <div className="mt-8 space-y-3">
          {pullRequest ? (
            <section aria-label="Pull request checks" className="empty:hidden">
              <PullRequestChecksCard
                projectId={projectId}
                organizationSlug={organizationSlug}
                projectAlias={projectAlias}
                pullRequest={pullRequest}
                onFix={(failed) => fix(bulletList("Fix the failed pull request checks:", failed.map((row) => [row.label, row.note])))}
              />
            </section>
          ) : null}
          {/* After Pull request checks: these stand in for the GitHub cards below it. */}
          {state.kind === "loading" ? (
            <>
              <CardSkeleton label="Loading checks" />
              <CardSkeleton label="Loading commits" />
            </>
          ) : null}
          {state.kind === "error" ? (
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm text-destructive">
              <span className="flex-1">{state.message}</span>
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCcw />
                Retry
              </Button>
            </div>
          ) : null}
          {overview ? (
            <>
              {overview.mergeable === "conflicting" ? (
                <section aria-label="Conflicts" className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <CircleX className="size-4.5 text-destructive" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">Conflicts with {baseName}</span>
                    <span className="truncate text-xs text-muted-foreground">Resolve them before this can merge.</span>
                  </div>
                  {canFix ? (
                    <Button size="xs" variant="ghost" className="ml-auto shrink-0" onClick={() => fix(`Rebase #${pr.number} on ${baseName}, resolve the conflicts, and push.`)}>
                      Fix
                    </Button>
                  ) : null}
                  <Button size="xs" variant="ghost" className={cn("shrink-0", !canFix && "ml-auto")} asChild>
                    <a href={`${overview.htmlUrl}/conflicts`} target="_blank" rel="noreferrer">
                      Resolve on GitHub
                    </a>
                  </Button>
                </section>
              ) : null}
              <section aria-label="GitHub checks">
                <GithubChecksCard overview={overview} onFix={canFix ? fix : undefined} />
              </section>
            </>
          ) : null}
          {tasks?.map((task) => (
            <section key={task._id} aria-label={`${task.refId} evidence`}>
              <TaskEvidenceCard
                taskId={task._id}
                // A referenced task may live in another project; its threads do too.
                projectRoute={{ organizationSlug, projectAlias: task.refId.slice(0, task.refId.lastIndexOf("-")) }}
                title={
                  <>
                    <AppLink
                      href={appRoute.task(organizationSlug, task.refId)}
                      className="relative z-10 underline-offset-2 hover:underline"
                    >
                      {task.refId}
                    </AppLink>{" "}
                    task checks
                  </>
                }
                onFix={canFix ? (failed) => fix(bulletList(`Fix the failed ${task.refId} task checks:`, failed.map((row) => [row.label, row.note]))) : undefined}
              />
            </section>
          ))}
          {overview ? (
            <section aria-label="Commits">
              <CommitsCard overview={overview} />
            </section>
          ) : null}
        </div>
        {overview ? (
          <Activity
            pr={pr}
            overview={overview}
            organizationSlug={organizationSlug}
            projectAlias={projectAlias}
            threads={pullRequest ? (threads ?? []).map(toTimelineThreadRow) : undefined}
            composer={composer}
          />
        ) : state.kind === "loading" ? (
          // Evidence's Fix and the Threads "+" need the composer before GitHub's overview arrives.
          <ActivitySkeleton composer={composer} />
        ) : (
          composer
        )}
      </div>
      <aside aria-label="Pull request properties" className="hidden space-y-6 text-sm @4xl:block">
        <Property label="Status">
          <span className="flex items-center gap-2">{status}</span>
        </Property>
        {pullRequest ? (
          <Property label="Threads" action={<PullRequestThreadsComposeButton onClick={compose} />}>
            <PullRequestThreadsProperty threads={threads} organizationSlug={organizationSlug} projectAlias={projectAlias} />
          </Property>
        ) : null}
        <Property label="Tasks">
          {tasks?.length ? (
            tasks.map((task) => (
              <AppLink
                key={task._id}
                href={appRoute.task(organizationSlug, task.refId)}
                title={`${task.refId} ${task.name}`}
                className="-mx-1.5 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/50"
              >
                <TaskRefWithType
                  refId={task.refId}
                  taskType={task.taskType}
                  refInteractive={false}
                  className="gap-1"
                  refClassName="text-xs text-muted-foreground"
                />
                <span className="min-w-0 truncate font-medium">{task.name}</span>
              </AppLink>
            ))
          ) : (
            <span className="flex h-7 items-center">{tasks ? <EmptyValue /> : <PropertySkeleton />}</span>
          )}
        </Property>
        {summary.stack && layers.length ? (
          <Property label="Stack">
            <StackMap layers={layers} current={pr.number} hrefFor={hrefFor} />
          </Property>
        ) : null}
        <Property label="Reviewers">
          {reviewers?.length ? (
            reviewers.map((reviewer) => (
              <span key={reviewer.login} className="flex items-center gap-2">
                {reviewer.login}
                <span className="ml-auto text-xs text-muted-foreground">{REVIEWER_LABELS[reviewer.state]}</span>
              </span>
            ))
          ) : (
            <span className="flex h-5 items-center">{reviewers ? <EmptyValue /> : <PropertySkeleton />}</span>
          )}
        </Property>
        {overview?.assignees.length ? (
          <Property label="Assignees">
            {overview.assignees.map((assignee) => (
              <span key={assignee.login} className="flex items-center gap-2">
                <Avatar className="size-5">
                  <AvatarImage src={assignee.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">{assignee.login.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                {assignee.login}
              </span>
            ))}
          </Property>
        ) : null}
        {pr.labels.length ? (
          <Property label="Labels">
            <div className="flex flex-wrap gap-1">
              {pr.labels.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
            </div>
          </Property>
        ) : null}
        {overview?.milestone ? (
          <Property label="Milestone">
            <a href={overview.milestone.url} target="_blank" rel="noreferrer" className="hover:underline">
              {overview.milestone.title}
            </a>
          </Property>
        ) : null}
        <Property label="Branch">
          {below ? (
            <AppLink href={hrefFor(below.number)} className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
              <Layers className="size-4 text-muted-foreground" />
              Based on #{below.number}
            </AppLink>
          ) : null}
          {branchStatus ?? (state.kind === "loading" ? (
            <span className="flex h-5 items-center">
              <PropertySkeleton />
            </span>
          ) : (
            <EmptyValue />
          ))}
        </Property>
      </aside>
    </div>
  );
}
