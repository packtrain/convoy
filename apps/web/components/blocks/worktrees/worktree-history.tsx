"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, GitCommitHorizontal, GitGraph, GitMerge, List, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { PatchDiff } from "@pierre/diffs/react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import type { HistoryLayout } from "@/lib/threads/changes-view-prefs";
import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import { type GraphRow, graphLanes, layoutGraph } from "@/lib/worktrees/commit-graph";
import { WORKTREE_HISTORY_MIN_CLI_VERSION, supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import { type CommitSummary, type WorktreeHistory, useCommitPatch } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ChangesSummary, ErrorWithRetry, Fetching, Message, Truncated, useSectionCollapse } from "./worktree-changes-body";
import { GraphCell, graphWidth } from "./commit-graph";

type DiffOptions = ReturnType<typeof usePatchDiffOptions>;

const ROW_HEIGHT = 52;
const TABLE_ROW_HEIGHT = 28;
/** A screen reader reads the label on every arrow press; the full subject stays in the row. */
const LABEL_SUBJECT_CHARS = 120;
const short = (hash: string) => hash.slice(0, 7);
const noop = () => {};
const isHead = (commit: CommitSummary) => commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "));
/** The table's date: the year only outside the current one; the full date is in the cell's title. */
const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year, hour: "2-digit", minute: "2-digit" });
};
/** Badges to draw: `origin/HEAD` only repeats the default branch's badge. */
const visibleRefs = (commit: CommitSummary) => commit.refs.filter((ref) => ref !== "origin/HEAD");
const refLabel = (ref: string) =>
  ref.startsWith("HEAD -> ")
    ? `HEAD, branch ${ref.slice("HEAD -> ".length)}`
    : ref.startsWith("tag: ")
      ? `tag ${ref.slice("tag: ".length)}`
      : ref === "HEAD"
        ? ref
        : // ponytail: `origin/` is the only remote told apart, as RefBadge's muted style does.
          `${ref.startsWith("origin/") ? "remote branch" : "branch"} ${ref}`;
/** What the graph and badges show, in words: the SVG is hidden from assistive technology. */
const rowLabel = (commit: CommitSummary) =>
  [
    commit.subject.length > LABEL_SUBJECT_CHARS ? `${commit.subject.slice(0, LABEL_SUBJECT_CHARS - 1)}…` : commit.subject,
    ...visibleRefs(commit).map(refLabel),
    commit.parents.length > 1 && "merge",
    commit.authorName,
    new Date(commit.committedAt).toLocaleString(),
    short(commit.hash),
  ]
    .filter(Boolean)
    .join(", ");
const ROW_CLASS = "cursor-pointer text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const SELECTED_CLASS = "bg-muted shadow-[inset_2px_0_0_var(--color-primary)]";

const LAYOUTS = [
  { layout: "list", label: "List", Icon: List },
  { layout: "graph", label: "Graph", Icon: GitGraph },
] as const;

export function HistoryLayoutToggle({
  value,
  onChange,
  iconOnly = false,
}: {
  value: HistoryLayout;
  onChange: (layout: HistoryLayout) => void;
  /** A phone toolbar: the labels stay for screen readers only. */
  iconOnly?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md border border-border p-0.5" role="group" aria-label="History layout">
      {LAYOUTS.map(({ layout, label, Icon }) => (
        <button
          key={layout}
          type="button"
          aria-pressed={value === layout}
          className={cn(
            "flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs",
            value === layout ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange(layout)}
        >
          <Icon className="size-3.5" aria-hidden />
          <span className={cn(iconOnly && "sr-only")}>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** The graph column's slice for one row, or null in the List layout. */
type RowGraph = { row: GraphRow; lanes: number } | null;

function RefBadge({ name, className }: { name: string; className?: string }) {
  const head = name.startsWith("HEAD -> ");
  const tag = name.startsWith("tag: ");
  return (
    <span
      className={cn(
        "flex max-w-40 min-w-0 items-center gap-0.5 rounded-sm border px-1 font-mono text-[11px] leading-4",
        className,
        head
          ? "border-info/40 bg-info/10 text-info"
          : name.startsWith("origin/")
            ? "border-border text-muted-foreground"
            : "border-border text-foreground"
      )}
      title={name}
    >
      {tag && <Tag className="size-2.5 shrink-0" aria-hidden />}
      <span className="truncate">{head ? name.slice("HEAD -> ".length) : tag ? name.slice("tag: ".length) : name}</span>
    </span>
  );
}

interface RowProps {
  commit: CommitSummary;
  graph: RowGraph;
  selected: boolean;
  tabbable: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

/** The listbox option both row shapes share. */
function optionProps({ commit, selected, tabbable, onSelect, onFocus }: RowProps) {
  return {
    type: "button",
    role: "option",
    "data-hash": commit.hash,
    onClick: onSelect,
    onFocus,
    "aria-selected": selected,
    "aria-label": rowLabel(commit),
    tabIndex: tabbable ? 0 : -1,
  } as const;
}

/** Two-line row; the Graph layout swaps the commit icon for the graph column and drops the row borders. */
function CommitRow(props: RowProps) {
  const { commit, graph, selected } = props;
  const merge = commit.parents.length > 1;
  const Icon = merge ? GitMerge : GitCommitHorizontal;
  return (
    <button
      {...optionProps(props)}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "group flex w-full items-center pr-3",
        ROW_CLASS,
        // pl-1: lane 0 sits 12px in, where List's icon starts.
        graph ? "gap-1 pl-1" : "gap-2 border-b border-border pl-3",
        selected && SELECTED_CLASS
      )}
    >
      {graph ? (
        <GraphCell row={graph.row} hash={commit.hash} parents={commit.parents} lanes={graph.lanes} height={ROW_HEIGHT} head={isHead(commit)} selected={selected} />
      ) : (
        <Icon className="mt-[11px] size-3.5 shrink-0 self-start text-muted-foreground" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-sm", merge && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
          <span className="max-w-32 shrink-0 truncate" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          <span>·</span>
          <span className="shrink-0" title={new Date(commit.committedAt).toLocaleString()}>
            {formatCompactRelativeTime(commit.committedAt)}
          </span>
          <span className="shrink-0 font-mono">{short(commit.hash)}</span>
          {visibleRefs(commit).map((ref) => (
            <RefBadge key={ref} name={ref} />
          ))}
        </span>
      </span>
    </button>
  );
}

// ponytail: the graph column (table and two-line rows) grows with the widest loaded row; clip past N lanes if busy repos show up.
// At least the "Graph" header's width, so one lane doesn't run it into "Description".
const tableColumns = (lanes: number) => `${Math.max(graphWidth(lanes), 40)}px minmax(0,1fr) 150px 120px 72px`;

/** Full-page Graph layout row (OS-2536): Graph, Description with ref badges, Date, Author, Commit. */
function TableRow(props: RowProps & { graph: NonNullable<RowGraph> }) {
  const { commit, graph, selected } = props;
  return (
    <button
      {...optionProps(props)}
      style={{ gridTemplateColumns: tableColumns(graph.lanes), height: TABLE_ROW_HEIGHT }}
      className={cn("group grid w-full items-center gap-3 pr-3 pl-2 text-xs", ROW_CLASS, selected && SELECTED_CLASS)}
    >
      <GraphCell row={graph.row} hash={commit.hash} parents={commit.parents} lanes={graph.lanes} height={TABLE_ROW_HEIGHT} head={isHead(commit)} selected={selected} />
      <span className="flex min-w-0 items-center gap-1.5">
        {/* The subject truncates first, down to the badges' 60% cap; past it the badges truncate. */}
        {visibleRefs(commit).length > 0 && (
          <span data-ref-badges className="flex max-w-[60%] shrink-0 items-center gap-1.5 overflow-hidden">
            {visibleRefs(commit).map((ref) => (
              <RefBadge key={ref} name={ref} />
            ))}
          </span>
        )}
        <span className={cn("truncate text-sm", commit.parents.length > 1 && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
      </span>
      <span className="truncate text-muted-foreground tabular-nums" title={new Date(commit.committedAt).toLocaleString()}>
        {formatDate(commit.committedAt)}
      </span>
      <span className="truncate text-muted-foreground" title={commit.authorEmail}>
        {commit.authorName}
      </span>
      <span className="font-mono text-muted-foreground">{short(commit.hash)}</span>
    </button>
  );
}

function TableHeader({ lanes }: { lanes: number }) {
  return (
    <div
      aria-hidden
      style={{ gridTemplateColumns: tableColumns(lanes) }}
      className="sticky top-0 z-10 grid h-8 items-center gap-3 border-b border-border bg-background pr-3 pl-2 text-xs font-medium text-muted-foreground"
    >
      <span>Graph</span>
      <span>Description</span>
      <span>Date</span>
      <span>Author</span>
      <span>Commit</span>
    </div>
  );
}

/** The Graph table's header and rows at their loaded height. */
function CommitTableSkeleton() {
  return (
    <div aria-label="Loading commits">
      <TableHeader lanes={1} />
      {Array.from({ length: 14 }, (_, index) => (
        <div key={index} style={{ gridTemplateColumns: tableColumns(1), height: TABLE_ROW_HEIGHT }} className="grid items-center gap-3 pr-3 pl-2">
          <Skeleton className="ml-1 size-2.5 rounded-full" />
          <Skeleton className="h-3.5" style={{ width: `${45 + ((index * 17) % 40)}%` }} />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** `CommitDetail`'s header block and a few file section bars. */
function CommitDetailSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="border-b border-border px-4 py-2">
        <Skeleton className="h-3 w-28" />
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-2 border-b border-border px-2 py-2">
          <Skeleton className="size-3.5" />
          <Skeleton className="h-3" style={{ width: `${30 + index * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Rows at the loaded list's height: icon (Graph: a lane), subject line, meta line. */
function CommitListSkeleton({ graph }: { graph: boolean }) {
  return (
    <div aria-label="Loading commits">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} style={{ height: ROW_HEIGHT }} className={cn("flex items-center pr-3", graph ? "gap-1 pl-1" : "gap-2 border-b border-border pl-3")}>
          {graph ? (
            <span data-lane-stub className="flex h-full shrink-0 justify-center" style={{ width: graphWidth(1) }}>
              <span className="h-full w-px bg-muted" />
            </span>
          ) : (
            <Skeleton className="size-3.5 shrink-0 self-start mt-[11px] rounded-full" />
          )}
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((index * 17) % 40)}%` }} />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    // Without a clipboard the hash stays reachable: selected on mount, ready for Ctrl+C.
    return (
      <input
        ref={(element) => element?.select()}
        readOnly
        aria-label="Full commit hash"
        value={hash}
        size={hash.length}
        onFocus={(event) => event.currentTarget.select()}
        className="h-6 max-w-full rounded-sm border border-border bg-background px-1 font-mono text-xs text-foreground"
      />
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="cursor-pointer gap-1 font-mono text-xs text-muted-foreground"
      title="Copy full hash"
      aria-label={`Copy commit hash ${short(hash)}`}
      onClick={async () => {
        // Throws where `navigator.clipboard` is absent (plain-HTTP self-hosting) or denied.
        try {
          await navigator.clipboard.writeText(hash);
          toast.success("Commit hash copied");
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Failed to copy the hash", { description: "The full hash is selected beside it. Press Ctrl+C." });
          setFailed(true);
        }
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {short(hash)}
    </Button>
  );
}

/** Joins git's hard-wrapped lines into paragraphs; a paragraph with list or indented lines keeps its breaks. */
function CommitBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/);
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap break-words">
          {/^(\s|[-*+] |\d+[.)] )/m.test(paragraph) ? paragraph : paragraph.replace(/\n/g, " ")}
        </p>
      ))}
    </div>
  );
}

/** `git show --cc` section without git's header lines; a line is tinted by its per-parent +/- columns. */
function CombinedSection({ section, wordWrap }: { section: string; wordWrap: boolean }) {
  const lines = section.split("\n");
  const body = lines.slice(
    Math.max(
      0,
      lines.findIndex((line) => line.startsWith("@@"))
    )
  );
  if (body.at(-1) === "") {
    body.pop();
  }
  const columns = Math.max(1, (/^@+/.exec(body[0] ?? "")?.[0].length ?? 2) - 1);
  return (
    <>
      <p className="px-4 pt-2 text-xs text-muted-foreground">Combined diff of the merge resolution, shown unified.</p>
      <pre className={cn("px-4 py-2 font-mono text-xs", wordWrap ? "whitespace-pre-wrap break-all" : "overflow-x-auto")}>
        {body.map((line, index) => {
          const marks = line.slice(0, columns);
          return (
            <span
              key={index}
              className={cn(
                "block",
                line.startsWith("@@")
                  ? "text-muted-foreground"
                  : marks.includes("+")
                    ? "bg-success/10"
                    : marks.includes("-") && "bg-destructive/10"
              )}
            >
              {line}
            </span>
          );
        })}
      </pre>
    </>
  );
}

function CommitFiles({
  patch,
  diffOptions,
  allCollapsed,
  wordWrap,
  merge,
}: {
  patch: string;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
  merge: boolean;
}) {
  const sections = useMemo(() => splitRunPatch(patch), [patch]);
  const files = useMemo(() => parseRunPatchFiles(sections), [sections]);
  const collapse = useSectionCollapse(allCollapsed);
  if (files.length === 0) {
    return <Message>{merge ? "Merge commit with no conflict resolutions to show." : "This commit changes no files."}</Message>;
  }
  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <ChangesSummary files={files} />
      </div>
      {files.map((file) => {
        const section = sections.get(file.path);
        const hasHunks = section !== undefined && /^@@/m.test(section);
        return (
          <PatchFileSection
            key={file.path}
            file={file}
            patch={hasHunks ? section : undefined}
            collapsed={collapse.isCollapsed(file.path)}
            onToggle={collapse.toggle}
            registerSection={noop}
          >
            {!hasHunks ? (
              <p className="px-4 py-2 text-xs text-muted-foreground">No content change.</p>
            ) : section.startsWith("diff --cc ") ? (
              // ponytail: combined diffs render as tinted text; the diff viewer reads two-sided patches only.
              <CombinedSection section={section} wordWrap={wordWrap} />
            ) : (
              <PatchDiff patch={section} options={diffOptions} />
            )}
          </PatchFileSection>
        );
      })}
    </>
  );
}

function CommitDetail({
  profileId,
  pathId,
  commit,
  loadedHashes,
  canLoadMore,
  onOpenParent,
  headingRef,
  diffOptions,
  allCollapsed,
  wordWrap,
  onClose,
}: {
  profileId: Id<"cliProfiles">;
  pathId: string;
  commit: CommitSummary;
  loadedHashes: ReadonlySet<string>;
  canLoadMore: boolean;
  onOpenParent: (hash: string) => void;
  headingRef: React.Ref<HTMLHeadingElement>;
  /** The Graph table's close button; the List layouts have none. */
  onClose?: () => void;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
}) {
  const patch = useCommitPatch(profileId, pathId, commit.hash, true);
  const merge = commit.parents.length > 1;
  return (
    <div>
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 ref={headingRef} tabIndex={-1} data-hash={commit.hash} className="min-w-0 flex-1 text-sm font-medium break-words outline-none">
            {commit.subject}
          </h2>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="-mt-1 -mr-2 cursor-pointer text-muted-foreground"
              aria-label="Close commit"
              title="Close commit"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        {patch.result?.body && <CommitBody body={patch.result.body} />}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground" title={commit.authorEmail}>
            {commit.authorName}
          </span>
          <span>{new Date(commit.committedAt).toLocaleString()}</span>
          <CopyHash hash={commit.hash} />
          {commit.parents.length > 0 && (
            <span className="flex items-center gap-1">
              {merge ? "Parents" : "Parent"}
              {commit.parents.map((parent) => {
                const loaded = loadedHashes.has(parent);
                return (
                  <button
                    key={parent}
                    type="button"
                    className="inline-flex min-h-6 cursor-pointer items-center px-0.5 font-mono underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-default disabled:no-underline"
                    disabled={!loaded && !canLoadMore}
                    // A parent past the loaded pages loads the next page and opens once it arrives.
                    title={loaded ? undefined : canLoadMore ? "Loads more commits to open it" : "Not in this history"}
                    aria-label={`Open parent ${short(parent)}`}
                    onClick={() => onOpenParent(parent)}
                  >
                    {short(parent)}
                  </button>
                );
              })}
            </span>
          )}
        </div>
      </div>
      {patch.result ? (
        <>
          {patch.result.truncated && <Truncated />}
          <CommitFiles patch={patch.result.patch} diffOptions={diffOptions} allCollapsed={allCollapsed} wordWrap={wordWrap} merge={merge} />
        </>
      ) : patch.error ? (
        <ErrorWithRetry error={patch.error} onRetry={patch.retry} />
      ) : (
        <Fetching />
      )}
    </div>
  );
}

interface WorktreeHistoryViewProps {
  profileId: Id<"cliProfiles">;
  pathId: string;
  history: WorktreeHistory;
  /** List, or Graph: a table over the commit in two panes, a graph column in one. */
  layout: HistoryLayout;
  /** False when the path is gone from the CLI's profile. */
  registered: boolean;
  isOnline: boolean;
  appVersion: string | undefined;
  diffOptions: DiffOptions;
  allCollapsed: boolean;
  wordWrap: boolean;
  /** The open commit (the URL's `commit`); null shows the newest, or only the list in one-pane mode and the Graph table. */
  selectedHash: string | null;
  /** `push` when the pane changes in one-pane mode, so Back returns to the list; `back` pops that entry. */
  onSelect: (hash: string | null, mode: "push" | "replace" | "back") => void;
  /** The thread panel's row above the list: the layout toggle (All commits over a one-pane commit), then `actions`. */
  toolbar?: { onLayoutChange: (layout: HistoryLayout) => void; actions: ReactNode };
  /** Whether a commit's diff is on screen, so the host shows its diff toggles only then. */
  onDiffShownChange?: (shown: boolean) => void;
}

/** Below this pane width the list and the commit take turns, as on a phone. */
const ONE_PANE_BELOW = 600;
const PANES = "grid h-full min-h-0 grid-cols-[clamp(240px,40%,420px)_minmax(0,1fr)]";
const NEXT_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };
// ponytail: a linked commit is found by paging, capped at 1,000 rows per seek; a lookup op if links go deeper.
const MAX_SEEK_ROWS = 1000;

type PendingFocus = { kind: "heading"; hash: string } | { kind: "row"; hash: string } | { kind: "rowAt"; index: number };

/** A full hash, or a short one (7+ characters) that starts it. */
const matches = (commit: CommitSummary, hash: string) => commit.hash === hash || (hash.length >= 7 && commit.hash.startsWith(hash));

/**
 * History tab of the worktree page (OS-2534): commit list left, the selected
 * commit right. In a narrow pane or on a phone one pane at a time, the list first.
 */
export function WorktreeHistoryView({
  profileId,
  pathId,
  history,
  layout,
  registered,
  isOnline,
  appVersion,
  diffOptions,
  allCollapsed,
  wordWrap,
  selectedHash,
  onSelect,
  toolbar,
  onDiffShownChange,
}: WorktreeHistoryViewProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const onePane = isMobile || (width !== null && width < ONE_PANE_BELOW);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  const { commits } = history;
  const loadedHashes = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits]);
  // Laid out over every loaded page, so lanes stay continuous across Load more.
  const graphRows = useMemo(() => (layout === "graph" ? layoutGraph(commits) : null), [layout, commits]);
  // The column only widens, so a Refresh back to page 1 doesn't shift every row.
  const [lanes, setLanes] = useState(1);
  const loadedLanes = graphRows ? graphLanes(graphRows) : 1;
  if (loadedLanes > lanes) {
    setLanes(loadedLanes);
  }
  // Two panes in the Graph layout: the table on top, the open commit below it at full width.
  const table = graphRows !== null && !onePane;

  const found = selectedHash === null ? undefined : commits.find((commit) => matches(commit, selectedHash));
  // The last commit opened stays open while the selected hash is off the loaded pages (after a Refresh, or a parent still loading).
  const [kept, setKept] = useState<CommitSummary | null>(null);
  if (found && found !== kept) {
    setKept(found);
  }
  const opened = selectedHash === null ? undefined : (found ?? kept ?? undefined);
  // A selected hash that is not loaded yet is paged to, the way a linked commit or a far parent needs.
  const [seekStart, setSeekStart] = useState({ hash: selectedHash, rows: commits.length });
  if (seekStart.hash !== selectedHash) {
    setSeekStart({ hash: selectedHash, rows: commits.length });
  }
  const canSeek = history.hasMore && commits.length - seekStart.rows < MAX_SEEK_ROWS && !history.error;
  const seeking = selectedHash !== null && !found && !history.initialLoading && (history.loadingMore || canSeek);
  // The default branch's newer tip can fill the first pages (OS-2536): page on to HEAD, which opens with nothing picked.
  const head = commits.find(isHead);
  const seekingHead =
    selectedHash === null &&
    !head &&
    commits.length > 0 &&
    (history.loadingMore || (history.hasMore && commits.length < MAX_SEEK_ROWS && !history.error));
  const shown = opened ?? (seeking || seekingHead || table ? undefined : (head ?? commits[0]));
  const pushedHash = useRef<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  // A hash paging could not find; the note above the list outlives the URL param.
  const missing = selectedHash !== null && !found && !seeking && !history.initialLoading && !history.error && commits.length > 0;
  const [missingHash, setMissingHash] = useState<string | null>(null);
  if (missing && missingHash !== selectedHash) {
    setMissingHash(selectedHash);
  }

  // Back to the commit that was open only while it is still in the history; a rebase or reset may have dropped it.
  const fallbackHash = kept && kept.hash !== selectedHash && loadedHashes.has(kept.hash) ? kept.hash : null;
  useEffect(() => {
    if (missing) {
      onSelect(fallbackHash, "replace");
    }
  }, [missing, fallbackHash, onSelect]);

  useEffect(() => {
    if (((seeking && canSeek) || seekingHead) && !history.loadingMore) {
      history.loadMore();
    }
  });

  // The open row scrolls into view when it changes or arrives by paging; "nearest" leaves a visible row alone.
  // The first commit opened under the table centers its row, which would sit on the shrunk table's edge.
  const foundHash = found?.hash;
  const scrolledHash = useRef<string | null>(null);
  useEffect(() => {
    if (foundHash) {
      const block = table && scrolledHash.current === null ? "center" : "nearest";
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${foundHash}"]`)?.scrollIntoView?.({ block });
    }
    scrolledHash.current = foundHash ?? null;
  }, [foundHash, table]);
  // A Refresh that drops the later pages starts the list from the top, like a fresh first page.
  const loadedRows = useRef(commits.length);
  useEffect(() => {
    if (commits.length < loadedRows.current && selectedHash === null) {
      const scroller = listRef.current?.closest<HTMLElement>(".overflow-y-auto");
      if (scroller) {
        scroller.scrollTop = 0;
      }
    }
    loadedRows.current = commits.length;
  }, [commits.length, selectedHash]);
  // HEAD found by paging past the first page: its row scrolls into view once.
  const headHash = head?.hash;
  const pagedToHead = useRef(false);
  useEffect(() => {
    if (seekingHead) {
      pagedToHead.current = true;
    } else if (headHash && pagedToHead.current && selectedHash === null) {
      pagedToHead.current = false;
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${headHash}"]`)?.scrollIntoView?.({ block: "center" });
    }
  }, [seekingHead, headHash, selectedHash]);

  useEffect(() => {
    // Back to the list in one-pane mode, by the back row or the browser: the row you came from gets focus.
    const now = opened?.hash ?? null;
    if (onePane && lastOpened.current && !now && !pendingFocus.current) {
      pendingFocus.current = { kind: "row", hash: lastOpened.current };
    }
    // Browser Forward (or a link) opens the commit pane without a click: its heading gets focus,
    // unless focus is on something else outside the view (a layout toggle that remounted it).
    const active = document.activeElement;
    const focusFree = !active || active === document.body || rootRef.current?.contains(active);
    if (onePane && !lastOpened.current && now && !pendingFocus.current && focusFree) {
      pendingFocus.current = { kind: "heading", hash: now };
    }
    lastOpened.current = now;

    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    const element =
      target.kind === "heading"
        ? headingRef.current?.dataset.hash === target.hash
          ? headingRef.current
          : null
        : target.kind === "row"
          ? listRef.current?.querySelector<HTMLElement>(`[data-hash="${target.hash}"]`)
          : listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[target.index];
    if (!element || element.closest("[hidden]")) {
      return; // Not rendered yet: the page is still loading.
    }
    element.focus();
    element.scrollIntoView?.({ block: "nearest" });
    pendingFocus.current = null;
  });

  const open = (hash: string) => {
    setMissingHash(null);
    pendingFocus.current = onePane ? { kind: "heading", hash } : { kind: "row", hash };
    if (onePane) {
      pushedHash.current = hash;
    }
    onSelect(hash, onePane ? "push" : "replace");
  };
  const openParent = (hash: string) => {
    pendingFocus.current = onePane ? { kind: "heading", hash } : { kind: "row", hash };
    // The pushed entry now holds the parent, so the back row still pops it.
    if (pushedHash.current !== null && pushedHash.current === selectedHash) {
      pushedHash.current = hash;
    }
    onSelect(hash, "replace");
  };
  const closeCommit = () => {
    if (shown) {
      pendingFocus.current = { kind: "row", hash: shown.hash };
    }
    onSelect(null, "replace");
  };
  const backToList = () => {
    const popsOwnEntry = pushedHash.current !== null && pushedHash.current === selectedHash;
    pushedHash.current = null;
    onSelect(null, popsOwnEntry ? "back" : "replace");
  };
  const loadMore = () => {
    pendingFocus.current = { kind: "rowAt", index: commits.length };
    history.loadMore();
  };
  const onePaneDetail = onePane && (opened !== undefined || seeking);
  const diffShown = shown !== undefined && (!onePane || onePaneDetail);
  useEffect(() => {
    onDiffShownChange?.(diffShown);
  }, [diffShown, onDiffShownChange]);
  // Escape closes the commit under the table, or goes back to the list in one pane.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    if (table && opened) {
      closeCommit();
    } else if (onePaneDetail) {
      backToList();
    } else {
      return;
    }
    event.preventDefault();
  };
  const backButton = (inToolbar: boolean) => (
    <button
      type="button"
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-1.5 text-xs",
        // In the toolbar row it sits beside Refresh, with the same weight.
        inToolbar ? "-ml-1 h-7 rounded-sm px-1 font-medium hover:bg-muted" : "h-9 border-b border-border px-3 text-muted-foreground hover:text-foreground"
      )}
      onClick={backToList}
    >
      <ArrowLeft className="size-3.5" />
      All commits
    </button>
  );
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = NEXT_KEYS[event.key];
    const hash = (event.target as HTMLElement).dataset.hash;
    const edge = event.key === "Home" ? commits[0] : event.key === "End" ? commits.at(-1) : undefined;
    if ((!step && !edge) || !hash || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const next = edge ?? commits[commits.findIndex((commit) => commit.hash === hash) + step];
    if (!next) {
      return;
    }
    event.preventDefault();
    // In the table an arrow only moves focus until a commit is open; Enter or a click opens one.
    if (onePane || (table && !opened)) {
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${next.hash}"]`)?.focus();
    } else {
      open(next.hash);
    }
  };

  const body = () => {
    if (!registered) {
      return <Message>This checkout is no longer registered on the CLI.</Message>;
    }
    if (!isOnline) {
      return <Message>CLI offline. Connect it to fetch history.</Message>;
    }
    if (!supportsWorktreeHistory(appVersion)) {
      return (
        <Message>
          Update @useconvoy/cli to {WORKTREE_HISTORY_MIN_CLI_VERSION} or newer to view history
          {appVersion ? ` (connected: v${appVersion})` : ""}.
        </Message>
      );
    }
    if (history.error && commits.length === 0) {
      return <ErrorWithRetry error={history.error} onRetry={history.retry} />;
    }
    if (history.initialLoading) {
      if (table) {
        return (
          <div className="flex h-full min-h-0 flex-col">
            <div className={cn("min-h-0 overflow-hidden", selectedHash !== null ? "h-2/5 shrink-0 border-b border-border" : "flex-1")}>
              <CommitTableSkeleton />
            </div>
            {selectedHash !== null && <CommitDetailSkeleton />}
          </div>
        );
      }
      return onePane ? (
        <CommitListSkeleton graph={graphRows !== null} />
      ) : (
        <div className={PANES}>
          <div className="min-h-0 overflow-y-auto border-r border-border">
            <CommitListSkeleton graph={false} />
          </div>
          <CommitDetailSkeleton />
        </div>
      );
    }
    if (commits.length === 0) {
      return <Message>No commits on this branch yet.</Message>;
    }

    const detailOpen = (!onePane && !table) || opened !== undefined || seeking;
    // In one-pane mode the row marks the commit you came from.
    const markedHash = onePane ? kept?.hash : shown?.hash;
    const tabbableHash = [focusedHash, shown?.hash, head?.hash, commits[0].hash].find((hash) => hash != null && loadedHashes.has(hash));
    const list = (
      <div
        className={cn(
          "min-h-0 overflow-y-auto",
          // scroll-pt-8: a row moved to by keyboard stops below the sticky header.
          table ? cn("scroll-pt-8", detailOpen ? "h-2/5 shrink-0 border-b border-border" : "flex-1") : onePane ? "h-full" : "border-r border-border",
          isMobile && "pb-(--mobile-nav-clearance)"
        )}
        hidden={onePane && detailOpen}
      >
        {table && <TableHeader lanes={lanes} />}
        {missingHash && <Message>{`Commit ${short(missingHash)} isn't in this checkout's history.`}</Message>}
        <div ref={listRef} role="listbox" aria-label="Commits" onKeyDown={onListKeyDown}>
          {commits.map((commit, index) => {
            const rowProps = {
              commit,
              selected: commit.hash === markedHash,
              tabbable: commit.hash === tabbableHash,
              onSelect: () => open(commit.hash),
              onFocus: () => setFocusedHash(commit.hash),
            };
            const graph = graphRows && { row: graphRows[index], lanes };
            return table && graph ? (
              <TableRow key={commit.hash} {...rowProps} graph={graph} />
            ) : (
              <CommitRow key={commit.hash} {...rowProps} graph={graph} />
            );
          })}
        </div>
        {history.error ? (
          <ErrorWithRetry error={history.error} onRetry={history.retry} />
        ) : (
          (history.hasMore || history.loadingMore) && (
            <div className="p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full cursor-pointer text-xs text-muted-foreground"
                disabled={history.loadingMore}
                onClick={loadMore}
              >
                {history.loadingMore ? (
                  <Spinner className="text-xs" text="Loading…" textPlacement="inline" textClassName="text-current" />
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )
        )}
      </div>
    );
    const detail = detailOpen && (
      <div className={cn("min-h-0 overflow-y-auto", table && "flex-1", isMobile && "pb-(--mobile-nav-clearance)")}>
        {/* The page that would bring the selected commit failed; in one-pane mode the list's own error is hidden. */}
        {onePane && selectedHash !== null && !found && history.error && <ErrorWithRetry error={history.error} onRetry={history.retry} />}
        {shown ? (
          <CommitDetail
            key={shown.hash}
            profileId={profileId}
            pathId={pathId}
            commit={shown}
            loadedHashes={loadedHashes}
            canLoadMore={history.hasMore}
            onOpenParent={openParent}
            headingRef={headingRef}
            diffOptions={diffOptions}
            allCollapsed={allCollapsed}
            wordWrap={wordWrap}
            onClose={table ? closeCommit : undefined}
          />
        ) : (
          <div className="p-4">
            <Spinner
              className="text-sm text-muted-foreground"
              text={`Finding ${selectedHash === null ? "HEAD" : `commit ${short(selectedHash)}`}… ${commits.length} commits searched`}
              textClassName="text-current"
              textPlacement="inline"
            />
          </div>
        )}
      </div>
    );
    if (table) {
      return (
        <div className="flex h-full min-h-0 flex-col">
          {list}
          {detail}
        </div>
      );
    }
    if (!onePane) {
      return (
        <div className={PANES}>
          {list}
          {detail}
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        {list}
        {detailOpen && (
          <>
            {!toolbar && backButton(false)}
            {detail}
          </>
        )}
      </div>
    );
  };

  if (!toolbar) {
    return (
      <div ref={rootRef} className="h-full min-h-0" onKeyDown={onKeyDown}>
        {body()}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
        {onePaneDetail ? backButton(true) : <HistoryLayoutToggle value={layout} onChange={toolbar.onLayoutChange} />}
        <div className="ml-auto flex items-center">{toolbar.actions}</div>
      </div>
      <div className="min-h-0 flex-1">{body()}</div>
    </div>
  );
}
