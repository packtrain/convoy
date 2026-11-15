import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, CircleCheck, CircleDashed, CircleX, GitCommitHorizontal, GitPullRequest, Layers, Plus, Wrench } from "lucide-react";
import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import { Button } from "@/components/ui/button";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import type { TimelineComposerMode } from "@/components/blocks/tasks/task-timeline";
import { ChecksCard, ExpandToggle, PreviewDialog } from "../../evidence/evidence-views";
import { SCENARIOS, type Check as TaskCheck, type EvidenceFile } from "../../evidence/fixtures";
import { CheckList, CommitSha, PrState, StackMap } from "./controls";
import { PullRequestActivity, type ComposerSeed, type Thread } from "./pull-request-activity";
import { displayName, PersonAvatar } from "./people-picker";
import {
  branchFor,
  commitsFor,
  checkedRevision,
  checksSummary,
  mergeStatusFor,
  pullRequestChecksFor,
  reviewsFor,
  taskFor,
  type Commit,
  type PrComment,
  type PullRequest,
} from "./fixtures";

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

// A thread prompt listing the failed rows, or null when nothing failed.
const failedPrompt = (heading: string, lines: string[]) => (lines.length ? `${heading}\n\n${lines.join("\n")}` : null);
const failedLines = (checks: TaskCheck[]) =>
  checks.flatMap((check) => (check.results[0]?.status === "failed" ? [`- ${check.label}: ${check.results[0].note}`] : []));

// GitHub's conversation as one feed; comments post to GitHub and sync back.
export function PullRequestOverview({
  pr,
  base,
  layers,
  onSelect,
  refreshed,
  comments,
  currentUser,
  onCommentsChange,
  onConnect,
  onExternal,
  onNotice,
}: {
  pr: PullRequest;
  // The open stack layer below; without one the base is main.
  base?: PullRequest;
  layers: PullRequest[];
  onSelect: (pr: PullRequest) => void;
  refreshed: boolean;
  comments: PrComment[];
  currentUser: string | null;
  onCommentsChange: (comments: PrComment[]) => void;
  onConnect: () => void;
  onExternal: () => void;
  onNotice: (message: string) => void;
}) {
  const commits = commitsFor(pr, refreshed);
  const reviews = reviewsFor(pr);
  const task = taskFor(pr);
  // The referenced Task's Checks, from the evidence prototype (docs/specs/task-checks.md).
  const evidence = SCENARIOS.task.state;
  const prChecks = pullRequestChecksFor(pr);
  const [preview, setPreview] = useState<EvidenceFile | null>(null);
  const baseBranch = base ? branchFor(base) : "main";
  const [composerMode, setComposerMode] = useState<TimelineComposerMode>("thread");
  const [seed, setSeed] = useState<ComposerSeed>();
  const [focusKey, setFocusKey] = useState(0);
  // Threads attached to this PR; the Pull request checks run is one of its own.
  const [threads, setThreads] = useState<Thread[]>(() =>
    prChecks.length ? [{ id: "checks", title: `Check #${pr.number}`, status: "completed", cliType: "claude-code", at: Date.now() - 10 * 60_000 }] : [],
  );
  const activity = useRef<HTMLElement>(null);
  const openThreadComposer = () => {
    setComposerMode("thread");
    setFocusKey(Date.now());
    activity.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  // Fix drafts the thread in the Activity composer rather than starting it, so the member can edit it first.
  const fix = (text: string | null) =>
    text ? (
      <Button size="xs" variant="outline" className="cursor-pointer" onClick={() => {
        setSeed({ text, key: Date.now() });
        openThreadComposer();
      }}>
        <Wrench />Fix
      </Button>
    ) : null;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-5 pt-12 pb-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold">{pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span></h2>
        <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <PersonAvatar id={pr.author} compact />
          <span className="font-medium text-foreground">{displayName(pr.author)}</span>
          <span>·</span>
          <span className="font-mono">{baseBranch}</span>
          <span>←</span>
          <span className="min-w-0 truncate font-mono">{branchFor(pr)}</span>
        </p>
        <Section label="Description">
          <p className="text-sm leading-6">{pr.description}</p>
        </Section>
        <div className="mt-8 space-y-3">
          <section aria-label="Commits">
            <CommitsCard commits={commits} onExternal={onExternal} />
          </section>
          {mergeStatusFor(pr).conflicts ? (
            <section aria-label="Conflicts" className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><CircleX className="size-4.5 text-destructive" /></div>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Conflicts with {base ? `#${base.number}` : "main"}</span>
                <span className="truncate text-xs text-muted-foreground">Resolve them before this can merge.</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {fix(`Rebase #${pr.number} on ${baseBranch}, resolve the conflicts, and push.`)}
                <Button size="xs" variant="ghost" className="cursor-pointer" onClick={onExternal}>Resolve on GitHub<ArrowUpRight /></Button>
              </div>
            </section>
          ) : null}
          {prChecks.length ? (
            <section aria-label="Pull request checks">
              <ChecksCard
                title="Pull request checks"
                checks={prChecks}
                checklist={null}
                onOpen={setPreview}
                action={fix(failedPrompt(`Fix what the pull request checks found on #${pr.number}:`, failedLines(prChecks)))}
                summary={refreshed ? <span className="text-amber-600">Outdated: checked {checkedRevision}</span> : `Checked ${checkedRevision}`}
              />
            </section>
          ) : null}
          <section aria-label="GitHub checks">
            <GithubChecks pr={pr} onExternal={onExternal} fix={fix} />
          </section>
          {task ? (
            <section aria-label="Evidence">
              <ChecksCard
                title="Evidence"
                checks={evidence.checks}
                checklist={evidence.checklist}
                onOpen={setPreview}
                action={fix(failedPrompt(`Fix the failing ${task.refId} task checks:`, failedLines(evidence.checks)))}
                summary={
                  <>
                    <button onClick={() => onNotice(`This would open ${task.refId} in the task sidebar.`)} className="relative z-10 cursor-pointer text-foreground underline-offset-2 hover:underline">
                      {task.refId}
                    </button>{" "}
                    task checks
                  </>
                }
              />
            </section>
          ) : null}
        </div>
        <section ref={activity} aria-label="Activity" className="mt-8">
          <PullRequestActivity
            pr={pr}
            refreshed={refreshed}
            comments={comments}
            currentUser={currentUser}
            mode={composerMode}
            onModeChange={setComposerMode}
            seed={seed}
            focusKey={focusKey}
            threads={threads}
            onThreadStarted={(text) => {
              setThreads([...threads, { id: `thread:${Date.now()}`, title: text.split("\n")[0], status: "streaming", cliType: "claude-code", at: Date.now() }]);
              setSeed(undefined);
            }}
            onCommentsChange={onCommentsChange}
            onConnect={onConnect}
            onExternal={onExternal}
            onNotice={onNotice}
          />
        </section>
      </div>
      <aside aria-label="Pull request properties" className="space-y-6 text-sm">
        <Property label="Status">
          <span className="flex items-center gap-2 capitalize"><PrState state={pr.state} />{pr.state}</span>
        </Property>
        <Property label="Task">
          {task ? (
            <button
              title={`${task.refId} ${task.name}`}
              onClick={() => onNotice(`This would open ${task.refId} in the task sidebar.`)}
              className="-mx-1.5 flex h-7 w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/50"
            >
              <TaskRefWithType refId={task.refId} taskType={resolveTaskTypeSummary(task.typeKey)} refInteractive={false} className="gap-1" refClassName="text-xs text-muted-foreground" />
              <span className="min-w-0 truncate font-medium">{task.name}</span>
            </button>
          ) : <span className="flex h-7 items-center text-muted-foreground">No linked task</span>}
        </Property>
        <Property label="Threads">
          <ThreadsProperty threads={threads} onOpen={(thread) => onNotice(`This would open ${thread.title} in a new tab.`)} onNew={openThreadComposer} />
        </Property>
        {layers.length ? (
          <section aria-label="Stack" className="space-y-3">
            <h3 className="text-xs text-muted-foreground">Stack</h3>
            <StackMap pr={pr} layers={layers} onSelect={onSelect} inline />
          </section>
        ) : null}
        <Property label="Reviewers">
          {reviews.map((review) => (
            <span key={review.reviewer} className="flex items-center gap-2">
              <PersonAvatar id={review.reviewer} compact />
              {displayName(review.reviewer)}
              <span className="ml-auto text-xs text-muted-foreground">{review.state === "approved" ? "Approved" : "Requested"}</span>
            </span>
          ))}
        </Property>
        <Property label="Branch">
          {base ? (
            <button onClick={() => onSelect(base)} className="-mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
              <Layers className="size-4 text-muted-foreground" />Based on #{base.number}
            </button>
          ) : null}
          {mergeStatusFor(pr).conflicts ? (
            <span className="flex min-w-0 items-center gap-2"><CircleX className="size-4 shrink-0 text-destructive" /><span className="truncate">Conflicts with {base ? `#${base.number}` : "main"}</span></span>
          ) : pr.behind ? (
            <span className="flex items-center gap-2"><CircleDashed className="size-4 text-muted-foreground" />Behind main</span>
          ) : (
            <span className="flex items-center gap-2"><GitPullRequest className="size-4 text-green-600" />Up to date with main</span>
          )}
        </Property>
      </aside>
      <PreviewDialog file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

const rollupIcons = {
  success: <CircleCheck className="size-4.5 text-green-600" />,
  failure: <CircleX className="size-4.5 text-destructive" />,
  pending: <CircleDashed className="size-4.5 text-muted-foreground" />,
};

// GitHub's checks box: the rollup, then each check run and commit status on the head.
function GithubChecks({ pr, onExternal, fix }: { pr: PullRequest; onExternal: () => void; fix: (text: string | null) => React.ReactNode }) {
  const { checks } = mergeStatusFor(pr);
  const { state, body } = checksSummary(checks);
  const [showPassed, setShowPassed] = useState(false);
  const rows = showPassed ? checks : checks.filter((check) => check.state !== "success");
  const passed = checks.length - checks.filter((check) => check.state !== "success").length;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative flex items-center gap-3 p-3 pr-10">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">{rollupIcons[state]}</div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium tabular-nums">GitHub checks: {passed}/{checks.length}</span>
          <span className="truncate text-xs text-muted-foreground">{body}</span>
        </div>
        <div className="relative z-10 ml-auto">
          {fix(failedPrompt(`Fix the failing GitHub checks on #${pr.number}:`, checks.flatMap((check) => (check.state === "failure" ? [`- ${check.name}: ${check.summary}`] : []))))}
        </div>
        <ExpandToggle count={passed} shown={showPassed} onToggle={() => setShowPassed(!showPassed)} />
      </div>
      {rows.length ? <CheckList checks={rows} onDetails={onExternal} className="rounded-none border-0 border-t text-sm" /> : null}
    </div>
  );
}

// Folded to one line: the count and the latest commit; the header unfolds the list.
function CommitsCard({ commits, onExternal }: { commits: Commit[]; onExternal: () => void }) {
  const [shown, setShown] = useState(false);
  const latest = commits.at(-1);
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative flex items-center gap-3 p-3 pr-10">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"><GitCommitHorizontal className="size-4.5" /></div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium tabular-nums">Commits: {commits.length}</span>
          {latest ? <span className="truncate text-xs text-muted-foreground">Latest: {latest.message} · {ago(latest.committedAt)}</span> : null}
        </div>
        <ExpandToggle count={commits.length} what="commits" shown={shown} onToggle={() => setShown(!shown)} />
      </div>
      {shown ? <CommitList commits={commits} onExternal={onExternal} /> : null}
    </div>
  );
}

// The task sidebar's Threads field (task-threads-field.tsx) on prototype threads.
const COLLAPSED_THREADS = 4;
function ThreadsProperty({ threads, onOpen, onNew }: { threads: Thread[]; onOpen: (thread: Thread) => void; onNew: () => void }) {
  const [expanded, setExpanded] = useState(false);
  // Collapse only when it hides 2+ rows, as on the task.
  const collapsed = !expanded && threads.length > COLLAPSED_THREADS + 1;
  const rows = collapsed ? threads.slice(0, COLLAPSED_THREADS) : threads;
  const add = (
    <Button variant="ghost" size="icon-sm" className="cursor-pointer" onClick={onNew} aria-label="Open threads composer" title="Open threads composer">
      <Plus className="size-3.5" />
    </Button>
  );
  if (!threads.length) return <div className="flex items-center gap-2"><span className="text-muted-foreground">No threads</span>{add}</div>;
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((thread, index) => (
        <div key={thread.id} className="flex items-center gap-2">
          <div className="relative -ml-1.5 min-w-0 flex-1 rounded-sm hover:bg-muted dark:hover:bg-muted/50">
            <button type="button" onClick={() => onOpen(thread)} aria-label={`Open thread ${thread.title}`} className="absolute inset-0 cursor-pointer" />
            <CompactThreadRowContent title={thread.title} status={thread.status} cliType={thread.cliType} lastActivityAt={thread.at} className="px-1.5 py-1" />
          </div>
          {index === 0 ? add : null}
        </div>
      ))}
      {collapsed ? (
        <Button variant="ghost" size="sm" className="-ml-1.5 h-7 w-fit cursor-pointer justify-start px-1.5 text-muted-foreground" onClick={() => setExpanded(true)}>
          {`Show ${threads.length - rows.length} more threads`}
        </Button>
      ) : null}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mt-8">
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      {children}
    </div>
  );
}

// One row per commit: message, author, time, and the sha linking to GitHub.
function CommitList({ commits, onExternal }: { commits: Commit[]; onExternal: () => void }) {
  return (
    <ol className="divide-y border-t">
      {commits.map((commit) => (
        <li key={commit.sha} className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate" title={commit.message}>{commit.message}</span>
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <PersonAvatar id={commit.author} compact gitAuthor />
            <span>{displayName(commit.author)}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{ago(commit.committedAt)}</span>
          <CommitSha sha={commit.sha} onExternal={onExternal} />
        </li>
      ))}
    </ol>
  );
}
