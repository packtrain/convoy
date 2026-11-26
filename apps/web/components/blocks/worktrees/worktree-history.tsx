"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, GitBranch, GitCommitHorizontal, GitGraph, GitMerge, List, Tag } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { useElementWidth } from "@/hooks/browser/use-element-width";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import type { HistoryLayout } from "@/lib/threads/changes-view-prefs";
import { type GraphRow, graphLanes, layoutGraph } from "@/lib/worktrees/commit-graph";
import { WORKTREE_HISTORY_MIN_CLI_VERSION, supportsWorktreeHistory } from "@/lib/worktrees/cli-version";
import type { CommitSummary, ForkPoint, WorktreeHistory } from "@/lib/worktrees/hooks/use-worktree-history";
import { cn } from "@/lib/utils";
import { ErrorWithRetry, Message } from "./worktree-changes-body";
import { GraphCell, graphWidth } from "./commit-graph";
import { CommitDetail, CommitDetailSkeleton, type DiffOptions, RefBadge, refName, short, visibleRefs } from "./commit-detail";
import { COMMIT_SIDEBAR_RESIZE_BOUNDS, CommitDiffPane, CommitSidebar, CommitSidebarHeader, CommitSidebarSkeleton } from "./commit-sidebar";

const ROW_HEIGHT = 52;
const TABLE_ROW_HEIGHT = 28;
/** A screen reader reads the label on every arrow press; the full subject stays in the row. */
const LABEL_SUBJECT_CHARS = 120;
const noop = () => {};
const isHead = (commit: CommitSummary) => commit.refs.some((ref) => ref === "HEAD" || ref.startsWith("HEAD -> "));
/** The table's date: the year only outside the current one; the full date is in the cell's title. */
const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year, hour: "2-digit", minute: "2-digit" });
};
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

/** Icon buttons in the style of the project header's List | Board switch. */
export function HistoryLayoutToggle({ value, onChange }: { value: HistoryLayout; onChange: (layout: HistoryLayout) => void }) {
  return (
    <div className="flex w-fit shrink-0 items-center gap-0.5" role="group" aria-label="History layout">
      {LAYOUTS.map(({ layout, label, Icon }) => (
        <TooltipExt key={layout} content={label} delayDuration={500}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={value === layout}
            className={cn("size-7 cursor-pointer rounded-md text-muted-foreground", value === layout && "bg-muted text-foreground hover:bg-muted")}
            onClick={() => onChange(layout)}
          >
            <Icon className="size-3.5" />
          </Button>
        </TooltipExt>
      ))}
    </div>
  );
}

export type HistoryScope = "branch" | "all";
const SCOPES = [
  { scope: "branch", label: "This branch" },
  { scope: "all", label: "All" },
] as const;

/** This branch | All, beside List | Graph (OS-2595). */
export function HistoryScopeToggle({ value, onChange }: { value: HistoryScope; onChange: (scope: HistoryScope) => void }) {
  return (
    <div className="flex w-fit shrink-0 items-center gap-0.5" role="group" aria-label="History scope">
      {SCOPES.map(({ scope, label }) => (
        <Button
          key={scope}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === scope}
          className={cn("h-7 cursor-pointer rounded-md px-2 text-xs text-muted-foreground", value === scope && "bg-muted text-foreground hover:bg-muted")}
          onClick={() => onChange(scope)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** The branch scope's last row: where the branch left the default branch, and the way to the rest. */
function ForkRow({ fork, onShowAll }: { fork?: ForkPoint; onShowAll: () => void }) {
  const newer = fork && fork.behind > 0 ? ` · ${fork.behind} newer ${fork.behind === 1 ? "commit" : "commits"} on ${fork.ref}` : "";
  return (
    <div className="flex min-h-9 items-center gap-2 border-t border-border px-3 py-1 text-xs text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" aria-hidden />
      {fork && <span className="min-w-0 truncate">{`Branched from ${fork.ref} at ${short(fork.hash)}${newer}`}</span>}
      <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 shrink-0 cursor-pointer px-2 text-xs" onClick={onShowAll}>
        Show full history
      </Button>
    </div>
  );
}

/** The graph column's slice for one row, or null in the List layout. */
type RowGraph = { row: GraphRow; lanes: number } | null;

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

const copyRef = async (name: string) => {
  // Throws where `navigator.clipboard` is absent (plain-HTTP self-hosting) or denied.
  try {
    await navigator.clipboard.writeText(name);
    toast.success(`${name} copied to clipboard`);
  } catch {
    toast.error(`Failed to copy ${name}`);
  }
};

/**
 * A row's badges open a menu of all its refs; picking one copies it (OS-2586).
 * A span, not a button: it sits inside the row's option button, so it stops the click that would open the commit.
 */
function RefsMenu({ commit, className, children }: { commit: CommitSummary; className?: string; children: ReactNode }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          ref={triggerRef}
          role="button"
          tabIndex={-1}
          aria-label={`Copy a ref of ${short(commit.hash)}`}
          className={cn("cursor-pointer rounded-sm hover:bg-background", className)}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </span>
      </DropdownMenuTrigger>
      {/* React bubbles portal events to the row: a pick must not open the commit. Focus goes back to the row for arrow keys. */}
      <DropdownMenuContent
        align="start"
        className="w-auto max-w-80"
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.closest<HTMLElement>("[role=option]")?.focus();
        }}
      >
        <DropdownMenuLabel>Branches and tags at {short(commit.hash)}</DropdownMenuLabel>
        {visibleRefs(commit).map((ref) => {
          const Icon = ref.startsWith("tag: ") ? Tag : GitBranch;
          return (
            <DropdownMenuItem key={ref} onSelect={() => void copyRef(refName(ref))}>
              <Icon className="text-muted-foreground" />
              <span className="truncate">{refName(ref)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
          {visibleRefs(commit).length > 0 && (
            <RefsMenu commit={commit} className="flex min-w-0 items-center gap-1.5">
              {visibleRefs(commit).map((ref) => (
                <RefBadge key={ref} name={ref} />
              ))}
            </RefsMenu>
          )}
        </span>
      </span>
    </button>
  );
}

// ponytail: the graph column (table and two-line rows) grows with the widest loaded row; clip past N lanes if busy repos show up.
// At least the "Graph" header's width, so one lane doesn't run it into "Description".
// Description keeps 160px; Refs, Date and Author give way before it does.
const tableColumns = (lanes: number) => `minmax(0,180px) ${Math.max(graphWidth(lanes), 40)}px minmax(160px,1fr) minmax(0,150px) minmax(0,120px) 72px`;

/** Full-page Graph layout row (OS-2536): Refs, Graph, Description, Date, Author, Commit. */
function TableRow(props: RowProps & { graph: NonNullable<RowGraph> }) {
  const { commit, graph, selected } = props;
  const [first, ...rest] = visibleRefs(commit);
  return (
    <button
      {...optionProps(props)}
      style={{ gridTemplateColumns: tableColumns(graph.lanes), height: TABLE_ROW_HEIGHT }}
      className={cn("group grid w-full items-center gap-3 pr-3 pl-2 text-xs", ROW_CLASS, selected && SELECTED_CLASS)}
    >
      {/* One badge fits, the rest a count whose title names them; right-aligned against the graph. */}
      <span data-refs className="flex min-w-0 items-center justify-end">
        {first && (
          <RefsMenu commit={commit} className="flex min-w-0 items-center gap-1">
            <RefBadge name={first} className="max-w-full" />
            {rest.length > 0 && (
              <span className="shrink-0 text-[11px] text-muted-foreground" title={rest.join(", ")}>
                +{rest.length}
              </span>
            )}
          </RefsMenu>
        )}
      </span>
      <GraphCell row={graph.row} hash={commit.hash} parents={commit.parents} lanes={graph.lanes} height={TABLE_ROW_HEIGHT} head={isHead(commit)} selected={selected} />
      <span className={cn("truncate text-sm", commit.parents.length > 1 && "text-muted-foreground")} title={commit.subject}>
        {commit.subject}
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
      data-table-header
      style={{ gridTemplateColumns: tableColumns(lanes) }}
      className="sticky top-0 z-10 grid h-8 items-center gap-3 border-b border-border bg-background pr-3 pl-2 text-xs font-medium text-muted-foreground"
    >
      <span>Refs</span>
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
          {index % 5 === 0 ? <Skeleton className="h-4 w-24" /> : <span />}
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

interface WorktreeHistoryViewProps {
  profileId: Id<"cliProfiles">;
  pathId: string;
  history: WorktreeHistory;
  /** List, or Graph: a table with the commit in a right sidebar in two panes, a graph column in one. */
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
  /** Set in the branch scope: the list ends with the fork point (OS-2595). */
  branch?: { fork?: ForkPoint; onShowAll: () => void };
  /** Whether a commit's diff is on screen, so the host shows its diff toggles only then. */
  onDiffShownChange?: (shown: boolean) => void;
}

/** Below this pane width the list and the commit take turns, as on a phone. */
const ONE_PANE_BELOW = 600;
/** Graph's table and its sidebar need this much; below it Graph keeps one pane's two-line rows. */
const GRAPH_TABLE_BELOW = 900;
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
  branch,
}: WorktreeHistoryViewProps) {
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const onePane = isMobile || (width !== null && width < (layout === "graph" ? GRAPH_TABLE_BELOW : ONE_PANE_BELOW));
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
  // Two panes in the Graph layout: the table fills the pane, the open commit is a right sidebar.
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
  // A file picked in the Graph sidebar: the commit's diff takes the table's place. Another commit drops it.
  const [diff, setDiff] = useState<{ hash: string; path: string } | null>(null);
  if (diff && (!table || diff.hash !== shown?.hash)) {
    setDiff(null);
  }
  const diffFile = table ? diff : null;
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
  // A linked commit centers its row in the table once, which "nearest" would leave on the bottom edge.
  const foundHash = found?.hash;
  const linkedAtMount = useRef(selectedHash !== null);
  useEffect(() => {
    if (foundHash) {
      const block = table && linkedAtMount.current ? "center" : "nearest";
      linkedAtMount.current = false;
      listRef.current?.querySelector<HTMLElement>(`[data-hash="${foundHash}"]`)?.scrollIntoView?.({ block });
    }
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
    setDiff(null);
    onSelect(null, "replace");
  };
  const backToGraph = () => {
    if (shown) {
      pendingFocus.current = { kind: "row", hash: shown.hash };
    }
    setDiff(null);
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
  const diffShown = table ? diffFile !== null : shown !== undefined && (!onePane || onePaneDetail);
  useEffect(() => {
    onDiffShownChange?.(diffShown);
  }, [diffShown, onDiffShownChange]);
  // Escape leaves a diff for the graph, then closes the sidebar, or goes back to the list in one pane.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) {
      return;
    }
    if (diffFile) {
      backToGraph();
    } else if (table && opened) {
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
          <ThreadWorkspaceSplitPane
            isSidebarOpen={selectedHash !== null}
            onCloseSidebar={noop}
            sidebarTitle="Commit"
            bounds={COMMIT_SIDEBAR_RESIZE_BOUNDS}
            sidebarHeader={<CommitSidebarHeader />}
            sidebarContent={<CommitSidebarSkeleton />}
          >
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <CommitTableSkeleton />
            </div>
          </ThreadWorkspaceSplitPane>
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
      return (
        <>
          <Message>No commits on this branch yet.</Message>
          {branch && <ForkRow fork={branch.fork} onShowAll={branch.onShowAll} />}
        </>
      );
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
          table ? "flex-1 scroll-pt-8" : onePane ? "h-full" : "border-r border-border",
          isMobile && "pb-(--mobile-nav-clearance)"
        )}
        // Hidden, not unmounted, behind a one-pane commit or a Graph diff, so it keeps its scroll position.
        hidden={(onePane && detailOpen) || diffFile !== null}
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
        {branch && !history.hasMore && !history.loadingMore && !history.error && <ForkRow fork={branch.fork} onShowAll={branch.onShowAll} />}
      </div>
    );
    const finding = (
      <div className="p-4">
        <Spinner
          className="text-sm text-muted-foreground"
          text={`Finding ${selectedHash === null ? "HEAD" : `commit ${short(selectedHash)}`}… ${commits.length} commits searched`}
          textClassName="text-current"
          textPlacement="inline"
        />
      </div>
    );
    if (table) {
      return (
        <ThreadWorkspaceSplitPane
          isSidebarOpen={detailOpen}
          onCloseSidebar={closeCommit}
          sidebarTitle="Commit"
          bounds={COMMIT_SIDEBAR_RESIZE_BOUNDS}
          sidebarHeader={<CommitSidebarHeader onClose={closeCommit} />}
          sidebarContent={
            shown ? (
              <CommitSidebar
                key={shown.hash}
                profileId={profileId}
                pathId={pathId}
                commit={shown}
                selectedPath={diffFile?.path}
                onOpenFile={(path) => setDiff({ hash: shown.hash, path })}
              />
            ) : (
              finding
            )
          }
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            {list}
            {diffFile && shown && (
              <CommitDiffPane
                profileId={profileId}
                pathId={pathId}
                commit={shown}
                scrollTo={diffFile}
                onBack={backToGraph}
                diffOptions={diffOptions}
                allCollapsed={allCollapsed}
                wordWrap={wordWrap}
              />
            )}
          </div>
        </ThreadWorkspaceSplitPane>
      );
    }
    const detail = detailOpen && (
      <div className={cn("min-h-0 overflow-y-auto", isMobile && "pb-(--mobile-nav-clearance)")}>
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
          />
        ) : (
          finding
        )}
      </div>
    );
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
