"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAction } from "convex/react";
import { ArrowLeft, ArrowUpRight, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { getErrorMessage } from "@/lib/errors";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";
import type { PullRequestCommit } from "./github-patch";
import { PullRequestFileSection } from "./pull-request-file-section";
import type { OverviewState } from "./pull-request-overview";
import type { PullRequestOverview } from "./types";

// The PR's Commits tab (docs/specs/github-integration.md → Commits tab).

type Commit = PullRequestOverview["commits"][number];
type CommitRead = { kind: "loading" } | { kind: "loaded"; commit: PullRequestCommit } | { kind: "error"; message: string };
export type PullRequestCommits = ReturnType<typeof usePullRequestCommits>;

const ROW_HEIGHT = 52;
/** Below this width the list and the commit take turns, as in the worktree History tab. */
const ONE_PANE_BELOW = 600;
const PANES = "grid h-full min-h-0 grid-cols-[clamp(240px,40%,420px)_minmax(0,1fr)]";
const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };
const noop = () => {};

/**
 * The open commit and each commit read so far; held by the reader, so a tab switch keeps both. A commit never
 * changes, so it is read once. Losing access drops the reads and any still in flight, as the reader drops its diff.
 */
export function usePullRequestCommits(args: { projectId: Id<"projects">; repositoryId: string; number: number }, readable: boolean) {
  const readCommit = useAction(api.integrations.github.pullRequests.readCommit);
  const { projectId, repositoryId, number } = args;
  const [selected, select] = useState<string | null>(null);
  const [reads, setReads] = useState<ReadonlyMap<string, CommitRead>>(new Map());
  // Each access session's reads; a read from an earlier one lands nowhere.
  const session = useRef(new Set<string>());
  if (!readable && reads.size > 0) setReads(new Map());
  useEffect(() => {
    if (!readable) session.current = new Set();
  }, [readable]);
  /** Starts a read unless one is loading or loaded; a failed one reads again. */
  const read = useCallback(
    (sha: string) => {
      const started = session.current;
      if (started.has(sha)) return;
      started.add(sha);
      const set = (state: CommitRead) => session.current === started && setReads((current) => new Map(current).set(sha, state));
      set({ kind: "loading" });
      readCommit({ projectId, repositoryId, number, sha }).then(
        (commit) => set({ kind: "loaded", commit }),
        (error: unknown) => {
          started.delete(sha);
          set({ kind: "error", message: getErrorMessage(error, "Could not load the commit") });
        }
      );
    },
    [number, projectId, readCommit, repositoryId]
  );
  return { selected, select, reads, read };
}

/** Commit list left (newest first), the open commit's files right; one pane at a time when narrow. */
export function PullRequestCommitsTab({
  state,
  commits,
  onRetry,
  pullRequestUrl,
}: {
  state: OverviewState;
  commits: PullRequestCommits;
  onRetry: () => void;
  /** The PR on GitHub, linked when the list stops short. */
  pullRequestUrl: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const onePane = width !== null && width < ONE_PANE_BELOW;
  const isMobile = useIsMobile();
  const overview = state.kind === "loaded" ? state.overview : null;
  const list = overview ? [...overview.commits].reverse() : [];
  const opened = list.find((commit) => commit.sha === commits.selected);
  // Two panes always show a commit: the open one, else the newest.
  const shown = onePane ? opened : (opened ?? list[0]);
  const { read } = commits;
  const shownSha = shown?.sha;
  useEffect(() => {
    if (shownSha) read(shownSha);
  }, [read, shownSha]);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS[event.key];
    const sha = (event.target as HTMLElement).dataset.sha;
    if (!step || !sha || event.metaKey || event.ctrlKey || event.altKey) return;
    const next = list[list.findIndex((commit) => commit.sha === sha) + step];
    if (!next) return;
    event.preventDefault();
    listRef.current?.querySelector<HTMLElement>(`[data-sha="${next.sha}"]`)?.focus();
    if (!onePane) commits.select(next.sha);
  };

  const body = () => {
    if (state.kind === "error") {
      return (
        <div className="m-4 flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{state.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw />
            Retry
          </Button>
        </div>
      );
    }
    if (!overview) return <CommitsSkeleton onePane={onePane} />;
    if (list.length === 0) return <p className="p-4 text-sm text-muted-foreground">This pull request has no commits.</p>;
    const missing = overview.commitCount - overview.commits.length;
    const listPane = (
      <div className={cn("flex min-h-0 flex-col", onePane ? "h-full" : "border-r")}>
        <CommitListBar>
          <h2 className="font-normal">
            {overview.commitCount} {overview.commitCount === 1 ? "commit" : "commits"}
          </h2>
        </CommitListBar>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", isMobile && "pb-(--mobile-nav-clearance)")}>
          {missing > 0 ? (
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              The newest {missing} {missing === 1 ? "commit isn't" : "commits aren't"} shown here.{" "}
              {pullRequestUrl ? (
                <a href={`${pullRequestUrl}/commits`} target="_blank" rel="noreferrer" className="underline">
                  See every commit on GitHub
                </a>
              ) : null}
            </p>
          ) : null}
          <div ref={listRef} role="listbox" aria-label="Commits" onKeyDown={onListKeyDown}>
            {list.map((commit) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                selected={commit.sha === shown?.sha}
                tabbable={commit.sha === (shown ?? list[0]).sha}
                onSelect={() => commits.select(commit.sha)}
              />
            ))}
          </div>
        </div>
      </div>
    );
    const detail = shown ? (
      <CommitDetail key={shown.sha} commit={shown} read={commits.reads.get(shown.sha)} onRetry={() => read(shown.sha)} />
    ) : null;
    if (!onePane) {
      return (
        <div className={PANES}>
          {listPane}
          {detail}
        </div>
      );
    }
    if (!detail) return listPane;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <button
          type="button"
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b px-3 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => commits.select(null)}
        >
          <ArrowLeft className="size-3.5" />
          All commits
        </button>
        {detail}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="min-h-0 flex-1">
      {body()}
    </div>
  );
}

/** The list's top bar, level with the commit pane's files bar. */
function CommitListBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[41px] shrink-0 items-center border-b bg-card px-3 text-xs text-muted-foreground tabular-nums">{children}</div>
  );
}

function CommitRow({
  commit,
  selected,
  tabbable,
  onSelect,
}: {
  commit: Commit;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      data-sha={commit.sha}
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "flex w-full cursor-pointer flex-col justify-center gap-0.5 border-b px-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
        selected && "bg-muted hover:bg-muted"
      )}
    >
      <span className="truncate text-sm" title={commit.message}>
        {commit.message}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="max-w-32 truncate">{commit.author}</span>
        <span>·</span>
        <span className="shrink-0" title={new Date(commit.committedAt).toLocaleString()}>
          {formatCompactRelativeTime(commit.committedAt)}
        </span>
        <span className="shrink-0 font-mono">{commit.sha.slice(0, 7)}</span>
      </span>
    </button>
  );
}

/** The commit's message and meta, a toolbar, then its files as the Diff tab's sections. */
function CommitDetail({ commit, read, onRetry }: { commit: Commit; read: CommitRead | undefined; onRetry: () => void }) {
  const isMobile = useIsMobile();
  const [diffStyle, setDiffStyle] = useState<"unified" | "split">("unified");
  const [wordWrap, setWordWrap] = useState(true);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const options = usePatchDiffOptions(diffStyle, wordWrap);
  const loaded = read?.kind === "loaded" ? read.commit : null;
  const body = loaded?.message.split("\n").slice(1).join("\n").trim();
  const totals = (loaded?.files ?? []).reduce(
    (sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }),
    {
      additions: 0,
      deletions: 0,
    }
  );
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex h-[41px] shrink-0 items-center gap-3 border-b bg-card px-4 text-xs text-muted-foreground tabular-nums">
        {loaded ? (
          <>
            <span>
              {loaded.files.length} {loaded.files.length === 1 ? "file" : "files"}
            </span>
            <span className="text-success">+{totals.additions}</span>
            <span className="text-destructive">-{totals.deletions}</span>
          </>
        ) : (
          <Skeleton className="h-3 w-24" />
        )}
        <div className="ml-auto flex items-center gap-1">
          <ChangesViewToggles
            allCollapsed={allCollapsed}
            onToggleCollapseAll={() => {
              setAllCollapsed(!allCollapsed);
              setToggled(new Set());
            }}
            diffStyle={diffStyle}
            onToggleDiffStyle={() => setDiffStyle(diffStyle === "unified" ? "split" : "unified")}
            wordWrap={wordWrap}
            onToggleWordWrap={() => setWordWrap(!wordWrap)}
          />
        </div>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", isMobile && "pb-(--mobile-nav-clearance)")}>
        <div className="flex flex-col gap-1.5 border-b px-4 py-3">
          <h2 className="text-sm font-medium break-words">{commit.message}</h2>
          {body ? <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{body}</p> : null}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="text-foreground">{commit.author}</span>
            <span>{new Date(commit.committedAt).toLocaleString()}</span>
            <a
              href={commit.url}
              target="_blank"
              rel="noreferrer"
              title="Open commit on GitHub"
              className="inline-flex items-center gap-0.5 font-mono hover:text-foreground"
            >
              {commit.sha.slice(0, 7)}
              <ArrowUpRight className="size-3" />
            </a>
          </div>
        </div>
        {read?.kind === "error" ? (
          <div className="m-4 flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-destructive">
            <span className="flex-1">{read.message}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw />
              Retry
            </Button>
          </div>
        ) : !loaded ? (
          <FileSectionsSkeleton />
        ) : (
          <>
            {loaded.partial ? (
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                Some changes aren&apos;t shown here.{" "}
                <a href={loaded.htmlUrl} target="_blank" rel="noreferrer" className="underline">
                  See every file on GitHub
                </a>
              </p>
            ) : null}
            {loaded.files.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">This commit changes no files.</p> : null}
            {loaded.files.map((file) => (
              <PullRequestFileSection
                key={file.path}
                file={file}
                filesUrl={loaded.htmlUrl}
                options={options}
                collapsed={allCollapsed !== toggled.has(file.path)}
                onToggle={toggle}
                registerSection={noop}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const SKELETON_LINES = [
  ["w-2/3", "w-1/2"],
  ["w-1/2", "w-3/5", "w-2/3", "w-1/4"],
  ["w-1/2", "w-2/5"],
];

/** File section bars with a few diff lines, as `PullRequestFileSection` lays them out. */
function FileSectionsSkeleton() {
  return (
    <div aria-label="Loading commit">
      {SKELETON_LINES.map((lines, index) => (
        <section key={index}>
          <div className="flex h-[37px] items-center gap-1.5 border-b px-2">
            <Skeleton className="size-3.5" />
            <Skeleton className="h-3" style={{ width: `${25 + index * 10}%` }} />
            <Skeleton className="ml-auto h-3 w-10" />
          </div>
          <div className="py-2">
            {lines.map((line, row) => (
              <div key={row} className="flex h-5 items-center gap-4 px-4">
                <Skeleton className="h-3 w-3" />
                <Skeleton className={`h-3 ${line}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CommitRowsSkeleton() {
  return (
    <div aria-label="Loading commits">
      <CommitListBar>
        <Skeleton className="h-3 w-16" />
      </CommitListBar>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} style={{ height: ROW_HEIGHT }} className="flex flex-col justify-center gap-1.5 border-b px-3">
          <Skeleton className="h-3.5" style={{ width: `${45 + ((index * 17) % 40)}%` }} />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

/** The tab while the Overview's commits load: rows, and in two panes the commit's toolbar, header, and files. */
export function CommitsSkeleton({ onePane = false }: { onePane?: boolean }) {
  if (onePane) return <CommitRowsSkeleton />;
  return (
    <div className={PANES}>
      <div className="min-h-0 overflow-hidden border-r">
        <CommitRowsSkeleton />
      </div>
      <div className="min-h-0 overflow-hidden">
        <div className="flex h-[41px] items-center gap-3 border-b bg-card px-4">
          <Skeleton className="h-3 w-24" />
          <div className="ml-auto flex items-center gap-1">
            <Skeleton className="size-6" />
            <Skeleton className="size-6" />
            <Skeleton className="size-6" />
          </div>
        </div>
        <div className="flex flex-col gap-2 border-b px-4 py-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-80" />
        </div>
        <FileSectionsSkeleton />
      </div>
    </div>
  );
}
