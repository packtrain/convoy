"use client";

import { Fragment, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, CalendarPlus, CircleX, Clock, GitBranch, ListFilter } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { ThreadCollapsibleSection } from "@/components/blocks/thread/thread-list-sections";
import { ThreadsLoadMoreButton } from "@/components/blocks/thread/threads-load-more-button";
import { DropdownSearchInput } from "@/components/custom/dropdown-search-input";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { formatCompactRelativeTime, formatRelativeTime } from "@/lib/format-relative-time";
import { useUserPreferences } from "@/lib/preferences/use-user-preferences";
import { AppLink, type RouteTarget } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { StackBadge } from "./pull-request-stack";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import type { PullRequestSummary } from "./types";
import type { IntegrationStatus } from "./use-integration-status";
import { coverageNotice, usePullRequestList } from "./use-pull-request-list";
import { usePullRequestSearch, type PullRequestSearchHit } from "./use-pull-request-search";

type Connection = IntegrationStatus["connections"][number];

export type BrowserFilters = {
  repositoryId?: string;
  sort: "updated" | "created";
  order: "asc" | "desc";
  /** The You filters, offered only with a Linked GitHub account. */
  author?: "me";
  assignee?: "me";
  /** Searches GitHub live across all states. */
  query: string;
};

const RESIZE_BOUNDS = { min: 256, max: 560, default: 320, storageKey: "github:pr-browser-width" };
const widthFromPointer = ({ clientX, containerRect }: { clientX: number; containerRect: DOMRect }) => clientX - containerRect.left;

export const repositoryName = (connection: Connection) => `${connection.repository.owner}/${connection.repository.name}`;

export const PEOPLE_FILTERS = [
  { key: "author", label: "Author", all: "All authors" },
  { key: "assignee", label: "Assignee", all: "All assignees" },
] as const;

const SORT_OPTIONS = [
  { value: "updated", label: "Last updated", icon: Clock },
  { value: "created", label: "Created on", icon: CalendarPlus },
] as const;
const ORDER_OPTIONS = [
  { value: "desc", label: "Newest", icon: ArrowDownWideNarrow },
  { value: "asc", label: "Oldest", icon: ArrowUpNarrowWide },
] as const;

/**
 * The reader's left pane: open PRs and drafts, then a collapsed Closed
 * section that imports history as it pages, or live search results while
 * searching. Filtered like the list, with the open PR highlighted.
 */
export function PullRequestBrowser({
  projectId,
  active,
  you,
  filters,
  onFiltersChange,
  current,
  hrefFor,
  backHref,
}: {
  projectId: Id<"projects">;
  active: Connection[];
  /** The Linked GitHub user ID; the You filters show only with one. */
  you: number | undefined;
  filters: BrowserFilters;
  onFiltersChange: (change: Partial<BrowserFilters>) => void;
  current: { repositoryId: string; number: number };
  hrefFor: (repositoryId: string, number: number) => RouteTarget;
  backHref: RouteTarget;
}) {
  const asideRef = useRef<HTMLDivElement>(null);
  const compactId = useId();
  const { pullRequestCompactLayout: compact, setPullRequestCompactLayout: setCompact } = useUserPreferences();
  const resize = useResizePanel(asideRef, { bounds: RESIZE_BOUNDS, getWidthFromPointer: widthFromPointer });
  const repository = active.find((connection) => connection.repositoryId === filters.repositoryId);
  const scope = repository ? [repository] : active;
  const options = { sort: filters.sort, order: filters.order, repositoryId: repository?.repositoryId, author: filters.author, assignee: filters.assignee };
  const search = usePullRequestSearch(projectId, filters.query, { ...options, viewer: you });
  const filtered = Boolean(repository || filters.author || filters.assignee) || filters.sort !== "updated" || filters.order !== "desc";
  const row = (pr: PullRequestSummary | PullRequestSearchHit, rowCompact: boolean) => (
    <BrowserRow
      key={`${pr.repositoryId}#${pr.number}`}
      pr={pr}
      compact={rowCompact}
      selected={pr.repositoryId === current.repositoryId && pr.number === current.number}
      repository={active.length > 1 ? repositoryNames(active).get(pr.repositoryId) : undefined}
      projectId={projectId}
      hrefFor={hrefFor}
    />
  );

  return (
    <aside
      ref={asideRef}
      aria-label="Pull request browser"
      style={{ "--browser-width": `${resize.width}px` } as CSSProperties}
      className="relative flex max-h-72 shrink-0 flex-col border-b md:max-h-none md:w-(--browser-width) md:border-r md:border-b-0"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon-sm" aria-label="Back to pull requests" title="Back to pull requests" asChild>
          <AppLink href={backHref}>
            <ArrowLeft />
          </AppLink>
        </Button>
        <span className="flex-1 text-sm font-medium">Pull requests</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Filter pull requests"
              title="Filter pull requests"
              className={filtered ? "bg-accent text-foreground" : "text-muted-foreground"}
            >
              <ListFilter />
              {filtered ? <span className="sr-only">Filters active</span> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="flex items-center justify-between px-2 py-1.5 text-sm">
              <label htmlFor={compactId} className="cursor-pointer">
                Compact layout
              </label>
              <Switch id={compactId} size="sm" checked={compact} onCheckedChange={setCompact} />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.sort}
              onValueChange={(value) => onFiltersChange({ sort: value === "created" ? "created" : "updated" })}
            >
              {SORT_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon className="size-4" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Order</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filters.order}
              onValueChange={(value) => onFiltersChange({ order: value === "asc" ? "asc" : "desc" })}
            >
              {ORDER_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon className="size-4" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {active.length > 1 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">Repository</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={repository?.repositoryId ?? "all"}
                  onValueChange={(value) => onFiltersChange({ repositoryId: value === "all" ? undefined : value })}
                >
                  <DropdownMenuRadioItem value="all">All repositories</DropdownMenuRadioItem>
                  {active.map((connection) => (
                    <DropdownMenuRadioItem key={connection.repositoryId} value={connection.repositoryId}>
                      <span className="truncate">{repositoryName(connection)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
            {you !== undefined
              ? PEOPLE_FILTERS.map(({ key, label, all }) => (
                  <Fragment key={key}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={filters[key] ?? "all"}
                      onValueChange={(value) => onFiltersChange({ [key]: value === "me" ? "me" : undefined })}
                    >
                      <DropdownMenuRadioItem value="all">{all}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="me">You</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </Fragment>
                ))
              : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {/* h-[41px] with its border matches the reader's tab row, so the two lines meet. */}
      <div
        data-search-bar
        className="flex h-[41px] shrink-0 items-center border-b px-1 [&_[data-slot=dropdown-search-input-wrapper]]:w-full [&_[data-slot=dropdown-search-input-wrapper]]:p-0"
      >
        <DropdownSearchInput
          aria-label="Search pull requests"
          placeholder="Search pull requests…"
          value={filters.query}
          onChange={(event) => onFiltersChange({ query: event.target.value })}
          showClearButton={filters.query !== ""}
          onClear={() => onFiltersChange({ query: "" })}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.active ? (
          <SearchResults search={search} renderRow={row} />
        ) : (
          <>
            <OpenPullRequests projectId={projectId} options={options} scope={scope} compact={compact} renderRow={row} />
            {/* Closed is a put-away pile like the thread list's Done: collapsed, compact, paged on its own. */}
            <ThreadCollapsibleSection label="Closed" storageKey="github:pr-browser-section:Closed" defaultCollapsed compactLayout={compact}>
              <ClosedPullRequests projectId={projectId} options={options} scope={scope} renderRow={row} />
            </ThreadCollapsibleSection>
          </>
        )}
      </div>
      <SidebarResizeHandle
        ariaLabel="Resize pull request list"
        currentWidth={resize.width}
        bounds={RESIZE_BOUNDS}
        expandDirection="right"
        onResizeMouseDown={resize.handleMouseDown}
        onResizeByStep={resize.adjustWidthBy}
        className="absolute inset-y-0 right-0 hidden md:block"
      />
    </aside>
  );
}

type RenderRow = (pr: PullRequestSummary | PullRequestSearchHit, compact: boolean) => ReactNode;
type ListScope = { projectId: Id<"projects">; options: Omit<BrowserFilters, "query">; scope: Connection[] };

const repositoryNames = (active: Connection[]) => new Map(active.map((connection) => [connection.repositoryId, repositoryName(connection)]));

/** Rows shaped like BrowserRow in the same layout, card or compact. */
function RowsSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className={compact ? undefined : "px-2 pt-2"} aria-label="Loading pull requests">
      {[0, 1, 2, 3].map((index) =>
        compact ? (
          <div key={index} data-pr-row-skeleton="compact" className="flex h-9 items-center gap-2 px-3">
            <Skeleton className="h-3 w-7" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-5" />
          </div>
        ) : (
          <div key={index} data-pr-row-skeleton="card" className="mb-1 rounded-lg bg-muted/50 px-3 py-2.5">
            <div className="flex h-5 items-center gap-2">
              <Skeleton className="h-3 w-7" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="mt-1.5 flex h-4 items-center">
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** The pane's outline while the project and its connections load. */
export function PullRequestBrowserSkeleton() {
  const asideRef = useRef<HTMLDivElement>(null);
  const { pullRequestCompactLayout: compact } = useUserPreferences();
  const resize = useResizePanel(asideRef, { bounds: RESIZE_BOUNDS, getWidthFromPointer: widthFromPointer });
  return (
    <aside
      ref={asideRef}
      aria-label="Pull request browser"
      style={{ "--browser-width": `${resize.width}px` } as CSSProperties}
      className="relative flex max-h-72 shrink-0 flex-col border-b md:max-h-none md:w-(--browser-width) md:border-r md:border-b-0"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Skeleton className="size-7" />
        <span className="flex-1 text-sm font-medium">Pull requests</span>
      </header>
      <div className="flex h-[41px] shrink-0 items-center border-b px-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <RowsSkeleton compact={compact} />
    </aside>
  );
}

function OpenPullRequests({ projectId, options, scope, compact, renderRow }: ListScope & { compact: boolean; renderRow: RenderRow }) {
  const list = usePullRequestList(projectId, { tab: "open", ...options }, scope);
  const groups = [
    { label: "Open", rows: list.results.filter((pr) => !pr.draft) },
    { label: "Drafts", rows: list.results.filter((pr) => pr.draft) },
  ];
  if (list.status === "LoadingFirstPage") return <RowsSkeleton compact={compact} />;
  return (
    <>
      {groups
        .filter((group) => group.rows.length)
        .map((group) => (
          <ThreadCollapsibleSection key={group.label} label={group.label} storageKey={`github:pr-browser-section:${group.label}`} compactLayout={compact}>
            <div className={compact ? undefined : "px-2"}>{group.rows.map((pr) => renderRow(pr, compact))}</div>
          </ThreadCollapsibleSection>
        ))}
      {list.hasMore ? <ThreadsLoadMoreButton isLoadingMore={list.isLoadingMore} onClick={list.loadMore} /> : null}
      {list.results.length ? null : <p className="p-3 text-sm text-muted-foreground">No open pull requests</p>}
    </>
  );
}

/** Mounted only while the section is open, so a collapsed Closed reads and imports nothing. */
function ClosedPullRequests({ projectId, options, scope, renderRow }: ListScope & { renderRow: RenderRow }) {
  const list = usePullRequestList(projectId, { tab: "closed", ...options }, scope);
  if (list.status === "LoadingFirstPage" || (list.importing && !list.results.length)) return <RowsSkeleton compact />;
  const notice = coverageNotice(list.coveredSince, options);
  return (
    <>
      {notice ? <p className="px-3 py-2 text-xs text-muted-foreground">{notice}</p> : null}
      {list.results.map((pr) => renderRow(pr, true))}
      {list.hasMore ? <ThreadsLoadMoreButton isLoadingMore={list.isLoadingMore} onClick={list.loadMore} /> : null}
      {list.results.length || list.hasMore ? null : <p className="p-3 text-sm text-muted-foreground">No closed pull requests</p>}
    </>
  );
}

function SearchResults({ search, renderRow }: { search: ReturnType<typeof usePullRequestSearch>; renderRow: RenderRow }) {
  const notices = [
    ...search.failures.map((failure) => `${failure.repositories.join(", ")}: ${failure.message}`),
    ...(search.omittedRepositories ? [`${search.omittedRepositories} more repositories weren't searched. Filter by repository to search them.`] : []),
    ...(search.incomplete ? ["GitHub returned partial results. Filter by repository or add words to narrow the search."] : []),
  ];
  return (
    <>
      {notices.map((notice) => (
        <p key={notice} role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      ))}
      {search.loading && !search.results.length ? <RowsSkeleton compact /> : search.results.map((pr) => renderRow(pr, true))}
      {search.retryable ? (
        <div className="flex items-center gap-2 p-3 text-sm text-destructive">
          <span className="flex-1">{search.error ?? "Some repositories weren't searched."}</span>
          <Button variant="outline" size="sm" disabled={search.loading} onClick={search.loadMore}>
            Retry
          </Button>
        </div>
      ) : search.hasMore ? (
        <ThreadsLoadMoreButton isLoadingMore={search.loading} onClick={search.loadMore} />
      ) : null}
      {!search.loading && !search.retryable && !search.results.length ? (
        <p className="p-3 text-sm text-muted-foreground">No matching pull requests</p>
      ) : null}
    </>
  );
}

/**
 * A PR drawn like a thread card, or flat on one line like a compact thread
 * row. Compact rows carry the state icon, since Closed and search results mix states.
 */
function BrowserRow({
  pr,
  compact,
  selected,
  repository,
  projectId,
  hrefFor,
}: {
  pr: PullRequestSummary | PullRequestSearchHit;
  compact: boolean;
  selected: boolean;
  /** Shown when more than one repository is connected. */
  repository: string | undefined;
  projectId: Id<"projects">;
  hrefFor: (repositoryId: string, number: number) => RouteTarget;
}) {
  const stored = "headRef" in pr ? pr : null;
  const link = (
    <AppLink
      href={hrefFor(pr.repositoryId, pr.number)}
      aria-current={selected ? "page" : undefined}
      title={pr.title}
      className={cn(
        "min-w-0 flex-1 truncate text-sm leading-5 font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring",
        !compact && "after:rounded-lg"
      )}
    >
      {pr.title}
    </AppLink>
  );
  const number = <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">#{pr.number}</span>;
  const badges = stored ? (
    <>
      {stored.conflicts ? <CircleX className="size-3.5 shrink-0 text-destructive" aria-label="Has conflicts" role="img" /> : null}
      <StackBadge pr={stored} projectId={projectId} hrefFor={(layer) => hrefFor(pr.repositoryId, layer)} />
    </>
  ) : null;
  if (compact) {
    const tooltip = [repository, stored?.headRef].filter(Boolean).join(" · ");
    return (
      <div
        data-pr-row
        title={tooltip || undefined}
        className={cn("relative flex min-w-0 items-center gap-2 px-3 py-2 transition-colors hover:bg-muted", selected && "bg-primary/10 hover:bg-primary/10")}
      >
        {pr.state === "open" && stored ? null : <PullRequestStateIcon pr={pr} className="size-3.5" />}
        {number}
        {link}
        {badges}
        <span className="shrink-0 text-xs text-muted-foreground/70">{formatCompactRelativeTime(pr.providerUpdatedAt)}</span>
      </div>
    );
  }
  return (
    // Thread-card layout; the title link covers the row, leaving the stack badge clickable on top.
    <div
      data-pr-row
      className={cn(
        "relative mb-1 rounded-lg bg-muted/50 transition-colors hover:bg-muted",
        selected && "bg-primary/10 ring-1 ring-primary/20 ring-inset hover:bg-primary/10"
      )}
    >
      <div className="px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {number}
          {link}
          <span className="shrink-0 text-xs text-muted-foreground/70">{formatRelativeTime(pr.providerUpdatedAt)}</span>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/70">
          {repository ? <span className="max-w-[40%] shrink-0 truncate">{repository}</span> : null}
          {stored ? (
            <span className="flex min-w-0 flex-1 items-center gap-1" title={`Branch: ${stored.headRef}`}>
              <GitBranch className="size-3.5 shrink-0" />
              <span className="truncate font-mono">{stored.headRef}</span>
            </span>
          ) : null}
          {badges}
        </div>
      </div>
    </div>
  );
}
