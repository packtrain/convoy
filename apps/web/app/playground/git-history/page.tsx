"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Copy, GitCommitHorizontal, GitGraph, GitMerge, List, PanelRightClose, RefreshCw, RotateCcw, X } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/custom/spinner";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { PatchFileSection, usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { AppLink, routeTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { COMMITS, WORKTREE, type Commit } from "./fixtures";
import { GraphCell, graphLanes, graphWidth, layoutGraph } from "./graph";

type Surface = "page" | "thread";
type ListState = "loaded" | "loading" | "empty" | "offline" | "oldCli" | "error";
type DiffStyle = "unified" | "split";
/** History layout: the plain list, or the graph (a table on the full page). */
type Layout = "list" | "graph";

const SURFACES: Record<Surface, string> = { page: "Full page", thread: "Thread Changes tab" };
const LIST_STATES: Record<ListState, string> = {
  loaded: "Loaded",
  loading: "Loading",
  empty: "No commits",
  offline: "CLI offline",
  oldCli: "Old CLI",
  error: "Error",
};
const PAGE_SIZE = 8;
const GRAPH = layoutGraph(COMMITS);
const TABLE_ROW = 28;
const COMPACT_ROW = 52;
const isHead = (commit: Commit) => commit.refs?.some((ref) => ref.startsWith("HEAD -> ")) ?? false;
const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (hash: string) => hash.slice(0, 7);
const byHash = (hash: string) => COMMITS.find((commit) => commit.hash === hash) ?? null;

interface DiffPrefs {
  diffStyle: DiffStyle;
  wordWrap: boolean;
  allCollapsed: boolean;
}

function Counts({ files }: { files: Commit["files"] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success">+{additions}</span> <span className="text-destructive">-{deletions}</span>
    </span>
  );
}

function RefBadge({ name }: { name: string }) {
  const head = name.startsWith("HEAD -> ");
  return (
    <span
      className={cn(
        "max-w-40 shrink-0 truncate rounded-sm border px-1 font-mono text-[11px] leading-4",
        head ? "border-info/40 bg-info/10 text-info" : name.startsWith("origin/") ? "border-border text-muted-foreground" : "border-border text-foreground"
      )}
      title={name}
    >
      {head ? name.slice("HEAD -> ".length) : name}
    </span>
  );
}

type Variant = "table" | "compact";

/** Full page: one fixed-height table row. Graph, Description with refs, Date, Author, Commit. */
const tableColumns = (lanes: number) => `${graphWidth(lanes)}px minmax(0,1fr) 150px 120px 72px`;

function TableRow({ commit, index, lanes, selected, onSelect }: { commit: Commit; index: number; lanes: number; selected: boolean; onSelect: () => void }) {
  const merge = commit.parents.length > 1;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ gridTemplateColumns: tableColumns(lanes), height: TABLE_ROW }}
      className={cn("grid w-full cursor-pointer items-center gap-3 pr-3 text-left text-xs hover:bg-muted/60", selected && "bg-muted")}
    >
      <GraphCell row={GRAPH[index]} hash={commit.hash} lanes={lanes} height={TABLE_ROW} head={isHead(commit)} />
      <span className="flex min-w-0 items-center gap-1.5">
        {commit.refs?.map((ref) => <RefBadge key={ref} name={ref} />)}
        <span className={cn("truncate text-sm", merge && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
      </span>
      <span className="truncate text-muted-foreground tabular-nums" title={new Date(commit.committedAt).toLocaleString()}>
        {formatDate(commit.committedAt)}
      </span>
      <span className="truncate text-muted-foreground">{commit.author}</span>
      <span className="font-mono text-muted-foreground">{short(commit.hash)}</span>
    </button>
  );
}

/** Thread panel: two-line row with the graph column on the left. */
function CompactRow({
  commit,
  index,
  lanes,
  graph,
  selected,
  onSelect,
}: {
  commit: Commit;
  index: number;
  lanes: number;
  graph: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const merge = commit.parents.length > 1;
  const Icon = merge ? GitMerge : GitCommitHorizontal;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ height: COMPACT_ROW }}
      className={cn(
        "flex w-full cursor-pointer items-center pr-3 text-left hover:bg-muted/60",
        graph ? "gap-1" : "gap-2 border-b border-border pl-3",
        selected && "bg-muted"
      )}
    >
      {graph ? (
        <GraphCell row={GRAPH[index]} hash={commit.hash} lanes={lanes} height={COMPACT_ROW} head={isHead(commit)} />
      ) : (
        <Icon className="size-3.5 shrink-0 self-start mt-[11px] text-muted-foreground" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("truncate text-sm", merge && "text-muted-foreground")} title={commit.subject}>
          {commit.subject}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{commit.author}</span>
          <span>·</span>
          <span className="shrink-0" title={new Date(commit.committedAt).toLocaleString()}>
            {formatCompactRelativeTime(commit.committedAt)}
          </span>
          <span className="shrink-0 font-mono">{short(commit.hash)}</span>
          {commit.refs?.map((ref) => <RefBadge key={ref} name={ref} />)}
        </span>
      </span>
      {commit.files.length > 0 && (
        <span className="text-xs">
          <Counts files={commit.files} />
        </span>
      )}
    </button>
  );
}

function TableHeader({ lanes }: { lanes: number }) {
  return (
    <div
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

/** Rows at the loaded list's real heights, with a lane dot where the graph sits. */
function CommitListSkeleton({ variant }: { variant: Variant }) {
  const rows = Array.from({ length: variant === "table" ? 14 : 9 }, (_, index) => index);
  const width = (index: number) => `${45 + ((index * 17) % 40)}%`;
  if (variant === "table") {
    return (
      <div>
        <TableHeader lanes={1} />
        {rows.map((index) => (
          <div key={index} style={{ gridTemplateColumns: tableColumns(1), height: TABLE_ROW }} className="grid items-center gap-3 pr-3">
            <Skeleton className="ml-1.5 size-2.5 rounded-full" />
            <Skeleton className="h-3.5" style={{ width: width(index) }} />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {rows.map((index) => (
        <div key={index} style={{ height: COMPACT_ROW }} className="flex items-center gap-3 pr-3 pl-1.5">
          <Skeleton className="size-2.5 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: width(index) }} />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

function CommitList({
  variant,
  graph = true,
  state,
  selectedHash,
  onSelect,
}: {
  variant: Variant;
  /** Compact rows only: draw the graph column, or the plain list's commit icon. */
  graph?: boolean;
  state: ListState;
  selectedHash: string | null;
  onSelect: (commit: Commit) => void;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!loadingMore) return;
    const timer = setTimeout(() => {
      setShown((count) => count + PAGE_SIZE);
      setLoadingMore(false);
    }, 700);
    return () => clearTimeout(timer);
  }, [loadingMore]);

  if (state === "loading") return <CommitListSkeleton variant={variant} />;
  if (state === "offline") return <Message>CLI offline. Connect it to fetch history.</Message>;
  if (state === "oldCli") return <Message>Update @useconvoy/cli to 0.130.0 or newer to view history (connected: v0.128.2).</Message>;
  if (state === "empty") return <Message>No commits on this branch yet.</Message>;
  if (state === "error") {
    return (
      <div className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-destructive">git log failed: fatal: bad default revision &apos;HEAD&apos;</p>
        <Button type="button" variant="outline" size="sm" className="cursor-pointer">
          <RotateCcw className="size-3.5" />
          Retry
        </Button>
      </div>
    );
  }
  const visible = COMMITS.slice(0, shown);
  // Layout runs over the whole list in order, so a page's rows are a prefix of it.
  const lanes = graphLanes(GRAPH.slice(0, shown));
  return (
    <div>
      {variant === "table" && <TableHeader lanes={lanes} />}
      {visible.map((commit, index) =>
        variant === "table" ? (
          <TableRow key={commit.hash} commit={commit} index={index} lanes={lanes} selected={commit.hash === selectedHash} onSelect={() => onSelect(commit)} />
        ) : (
          <CompactRow
            key={commit.hash}
            commit={commit}
            index={index}
            lanes={lanes}
            graph={graph}
            selected={commit.hash === selectedHash}
            onSelect={() => onSelect(commit)}
          />
        )
      )}
      {shown < COMMITS.length && (
        <div className="border-t border-border p-2">
          <Button type="button" variant="ghost" size="sm" className="w-full cursor-pointer text-xs text-muted-foreground" disabled={loadingMore} onClick={() => setLoadingMore(true)}>
            {loadingMore ? <Spinner className="text-xs" text="Loading…" textPlacement="inline" textClassName="text-current" /> : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="cursor-pointer gap-1 font-mono text-xs text-muted-foreground"
      title="Copy full hash"
      onClick={() => {
        void navigator.clipboard?.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {short(hash)}
    </Button>
  );
}

/** Commits never change: a commit's patch is fetched once, then served from the cache. */
const fetched = new Set<string>();

function CommitDetail({ commit, prefs, onSelectParent, onClose }: { commit: Commit; prefs: DiffPrefs; onSelectParent: (hash: string) => void; onClose?: () => void }) {
  const diffOptions = usePatchDiffOptions(prefs.diffStyle, prefs.wordWrap);
  const [loading, setLoading] = useState(!fetched.has(commit.hash));
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (fetched.has(commit.hash)) return;
    const timer = setTimeout(() => {
      fetched.add(commit.hash);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [commit.hash]);
  const isCollapsed = (path: string) => prefs.allCollapsed !== toggled.has(path);
  const toggle = (path: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div>
      <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-medium">{commit.subject}</h2>
          {onClose && (
            <Button type="button" variant="ghost" size="icon-sm" className="-mt-1 -mr-2 cursor-pointer text-muted-foreground" aria-label="Close commit" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
        {commit.body && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{commit.body}</p>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="text-foreground">{commit.author}</span>
          <span>{new Date(commit.committedAt).toLocaleString()}</span>
          <CopyHash hash={commit.hash} />
          <span className="flex items-center gap-1">
            {commit.parents.length > 1 ? "Parents" : "Parent"}
            {commit.parents.map((parent) => (
              <button
                key={parent}
                type="button"
                className="cursor-pointer font-mono enabled:hover:text-foreground enabled:hover:underline disabled:cursor-default"
                disabled={!byHash(parent)}
                title={byHash(parent) ? undefined : "Not loaded yet"}
                onClick={() => onSelectParent(parent)}
              >
                {short(parent)}
              </button>
            ))}
          </span>
        </div>
        {commit.files.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {commit.files.length} {commit.files.length === 1 ? "file" : "files"}
            <Counts files={commit.files} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="p-4">
          <Spinner className="text-sm text-muted-foreground" shimmer text="Fetching from CLI…" textClassName="text-current" textPlacement="inline" />
        </div>
      ) : commit.files.length === 0 ? (
        <Message>Merge commit with no conflict resolutions to show.</Message>
      ) : (
        commit.files.map((file) => {
          const patch = commit.sections.get(file.path);
          return (
            <PatchFileSection key={file.path} file={file} patch={patch} collapsed={isCollapsed(file.path)} onToggle={toggle} registerSection={() => {}}>
              {patch && <PatchDiff patch={patch} options={diffOptions} />}
            </PatchFileSection>
          );
        })
      )}
    </div>
  );
}

function useDiffPrefs() {
  const [prefs, setPrefs] = useState<DiffPrefs>({ diffStyle: "unified", wordWrap: false, allCollapsed: false });
  const toggles = (
    <ChangesViewToggles
      allCollapsed={prefs.allCollapsed}
      onToggleCollapseAll={() => setPrefs((value) => ({ ...value, allCollapsed: !value.allCollapsed }))}
      diffStyle={prefs.diffStyle}
      onToggleDiffStyle={() => setPrefs((value) => ({ ...value, diffStyle: value.diffStyle === "unified" ? "split" : "unified" }))}
      wordWrap={prefs.wordWrap}
      onToggleWordWrap={() => setPrefs((value) => ({ ...value, wordWrap: !value.wordWrap }))}
    />
  );
  return { prefs, toggles };
}

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  const options = [
    { layout: "list", label: "List", Icon: List },
    { layout: "graph", label: "Graph", Icon: GitGraph },
  ] as const;
  return (
    <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="History layout">
      {options.map(({ layout, label, Icon }) => (
        <button
          key={layout}
          type="button"
          aria-pressed={value === layout}
          title={label}
          className={cn(
            "flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs",
            value === layout ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
          onClick={() => onChange(layout)}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** The worktree changes page with a Changes | History switch in its 41px toolbar. */
function FullPage({ state }: { state: ListState }) {
  const [tab, setTab] = useState<"changes" | "history">("history");
  const [layout, setLayout] = useState<Layout>("list");
  const [selected, setSelected] = useState<Commit | null>(COMMITS[0]);
  const { prefs, toggles } = useDiffPrefs();
  const tabClass = (active: boolean) =>
    cn("flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs", active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground");
  const showDetail = state === "loaded" && selected;

  return (
    <div className="flex h-[760px] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="truncate text-sm font-medium">{WORKTREE.branch}</span>
        <Button type="button" variant="ghost" size="sm" className="cursor-pointer gap-1.5 text-xs">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </header>
      <div className="flex h-[41px] shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button type="button" className={tabClass(tab === "changes")} onClick={() => setTab("changes")}>
            Changes
            <span className="rounded-sm bg-background px-1 tabular-nums">{WORKTREE.uncommittedFiles}</span>
          </button>
          <button type="button" className={tabClass(tab === "history")} onClick={() => setTab("history")}>
            History
          </button>
        </div>
        <span className="truncate font-mono" title={WORKTREE.path}>
          {WORKTREE.path}
        </span>
        {tab === "history" && (
          <div className="ml-auto flex items-center gap-2">
            {showDetail && toggles}
            <LayoutToggle value={layout} onChange={setLayout} />
          </div>
        )}
      </div>
      {tab === "changes" ? (
        <Message>The existing uncommitted-changes view, unchanged.</Message>
      ) : layout === "list" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto border-r border-border">
            <CommitList variant="compact" graph={false} state={state} selectedHash={selected?.hash ?? null} onSelect={setSelected} />
          </div>
          <div className="min-h-0 overflow-y-auto">
            {showDetail ? (
              <CommitDetail key={selected.hash} commit={selected} prefs={prefs} onSelectParent={(hash) => setSelected(byHash(hash) ?? selected)} />
            ) : state === "loaded" ? (
              <Message>Select a commit to see its changes.</Message>
            ) : null}
          </div>
        </div>
      ) : (
        // Table on top, the selected commit below it: the graph keeps the full width.
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("min-h-0 overflow-y-auto pl-2", showDetail ? "h-[300px] shrink-0 border-b border-border" : "flex-1")}>
            <CommitList
              variant="table"
              state={state}
              selectedHash={selected?.hash ?? null}
              onSelect={(commit) => setSelected((current) => (current?.hash === commit.hash ? null : commit))}
            />
          </div>
          {showDetail && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CommitDetail
                key={selected.hash}
                commit={selected}
                prefs={prefs}
                onSelectParent={(hash) => setSelected(byHash(hash) ?? selected)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const VIEWS = [
  ["latest", "Latest run"],
  ["all", "All changes"],
  ["worktree", "Working tree"],
  ["history", "History"],
] as const;

/** The thread sidebar's Changes tab: History is a fourth selector item, and a commit opens in place. */
function ThreadPanel({ state }: { state: ListState }) {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("history");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [layout, setLayout] = useState<Layout>("list");
  const { prefs, toggles } = useDiffPrefs();
  const label = VIEWS.find(([kind]) => kind === view)?.[1];

  return (
    <div className="flex h-[760px] w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex h-14 shrink-0 items-stretch border-b border-border pr-4 pl-1">
        {["Changes", "Tasks"].map((tab) => (
          <span key={tab} className={cn("flex items-center px-3 text-sm", tab === "Changes" ? "border-b-2 border-foreground font-medium" : "text-muted-foreground")}>
            {tab}
          </span>
        ))}
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto self-center text-muted-foreground" aria-label="Close sidebar">
          <PanelRightClose />
        </Button>
      </div>
      <div className="flex h-[41px] shrink-0 items-center border-b border-border bg-card px-2">
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted">
              {label}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 gap-0 overflow-hidden p-0">
            {VIEWS.map(([kind, viewLabel]) => (
              <button
                key={kind}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false);
                  setView(kind);
                  setSelected(null);
                }}
              >
                <Check className={cn("size-4", view === kind ? "opacity-100" : "opacity-0")} />
                {viewLabel}
              </button>
            ))}
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Run timeline (unchanged)</p>
          </PopoverContent>
        </Popover>
        {view === "history" && <div className="ml-auto flex items-center gap-2">{selected ? toggles : <LayoutToggle value={layout} onChange={setLayout} />}</div>}
      </div>
      {view !== "history" ? (
        <Message>The existing {label} view, unchanged.</Message>
      ) : selected ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-b border-border px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft className="size-3.5" />
            History
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CommitDetail key={selected.hash} commit={selected} prefs={prefs} onSelectParent={(hash) => setSelected(byHash(hash) ?? selected)} />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CommitList variant="compact" graph={layout === "graph"} state={state} selectedHash={null} onSelect={setSelected} />
        </div>
      )}
    </div>
  );
}

export default function GitHistoryPlayground() {
  const [surface, setSurface] = useState<Surface>("page");
  const [state, setState] = useState<ListState>("loaded");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Git history</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2508 · mockup</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {(Object.keys(SURFACES) as Surface[]).map((key) => (
          <Button key={key} size="xs" variant={key === surface ? "default" : "outline"} onClick={() => setSurface(key)}>
            {SURFACES[key]}
          </Button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        {(Object.keys(LIST_STATES) as ListState[]).map((key) => (
          <Button key={key} size="xs" variant={key === state ? "default" : "outline"} onClick={() => setState(key)}>
            {LIST_STATES[key]}
          </Button>
        ))}
      </div>
      <div className="flex justify-center p-8">
        {/* Remount on surface/state change so selection and paging start fresh. */}
        {surface === "page" ? (
          <div className="w-full max-w-6xl">
            <FullPage key={state} state={state} />
          </div>
        ) : (
          <ThreadPanel key={state} state={state} />
        )}
      </div>
    </main>
  );
}
