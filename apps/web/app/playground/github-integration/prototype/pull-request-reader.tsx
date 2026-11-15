import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  ArrowLeft,
  ArrowUpRight,
  ListFilter,
  PanelRight,
  X,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThreadWorkspaceSplitPane } from "@/components/blocks/thread/thread-workspace-split-pane";
import { WorktreeFileTree } from "@/components/custom/diff/worktree-file-tree";
import { ChangesViewToggles } from "@/components/custom/diff/changes-view-toggles";
import { FileTabStrip } from "@/components/custom/diff/file-tab-strip";
import { useIsMobile } from "@/hooks/browser/use-mobile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Picker, PrState, StackBadge } from "./controls";
import { PrActions } from "./pull-request-merge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThreadCollapsibleSection } from "@/components/blocks/thread/thread-list-sections";

import { SearchInput } from "@/components/custom/search-input";
import { PersonAvatar, PeopleFilter, SearchPicker } from "./people-picker";
import { PullRequestOverview } from "./pull-request-overview";
import { TaskRefWithType } from "@/components/blocks/tasks/task-ref-with-type";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { GuideLauncher, GuideMenu, GuidePending, PullRequestGuide } from "./pull-request-guide";
import { displayName } from "./people-picker";
import { DiffView, FileUnavailable, ReviewedFileSection } from "./reviewed-file-section";
import { blockedBy, commitsFor, defaultFilters, filesFor, filterPullRequests, isOpen, layersBelow, pageSize, prKey, stackOf, summaryFor, taskFor, type ChangedFile, type GithubAccess, type Guide, type GuideSettings, type PrComment, type PrFilters, type PullRequest } from "./fixtures";

export function PullRequestReader({
  pr,
  records,
  filters,
  onFiltersChange,
  currentUser,
  incoming,
  comments,
  onCommentsChange,
  reviewed,
  onReviewedChange,
  guides,
  guideSettings,
  onGenerateGuide,
  access,
  onConnect,
  onChange,
  onSelect,
  onBack,
  onExternal,
  onNotice,
}: {
  pr: PullRequest;
  records: PullRequest[];
  filters: PrFilters;
  onFiltersChange: (change: Partial<PrFilters>) => void;
  currentUser: string | null;
  incoming: boolean;
  comments: PrComment[];
  onCommentsChange: (comments: PrComment[]) => void;
  reviewed: string[];
  onReviewedChange: (paths: string[]) => void;
  guides: Guide[];
  guideSettings: GuideSettings;
  onGenerateGuide: (settings: GuideSettings, revision: string, base?: Guide) => void;
  access: GithubAccess;
  onConnect: () => void;
  onChange: (change: Partial<PullRequest>, targets?: PullRequest[]) => void;
  onSelect: (pr: PullRequest) => void;
  onBack: () => void;
  onExternal: () => void;
  onNotice: (message: string) => void;
}) {
  const searching = !!filters.query.trim();
  const updateFilter = (key: keyof PrFilters, value: string) => onFiltersChange({ [key]: value });
  // The state tab and page are not filters: Reset keeps the tab, and paging is per view.
  const filtered = Object.entries(defaultFilters).some(([key, value]) => key !== "tab" && key !== "page" && filters[key as keyof PrFilters] !== value);
  const matches = filterPullRequests(records, filters, currentUser);
  const paged = searching || filters.tab === "closed";
  const visible = paged ? matches.slice(0, (filters.page + 1) * pageSize) : matches;
  const groups = [
    { label: "Open", rows: visible.filter((item) => item.state === "open") },
    { label: "Drafts", rows: visible.filter((item) => item.state === "draft") },
    { label: "Closed & merged", rows: visible.filter((item) => !isOpen(item)) },
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
      <aside aria-label="Pull request browser" className="flex max-h-72 shrink-0 flex-col border-b md:max-h-none md:w-72 md:border-r md:border-b-0 lg:w-80">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="icon-sm" aria-label="Pull requests" title="Back to pull requests" onClick={onBack}><ArrowLeft /></Button>
          <span className="text-sm font-medium">Pull requests</span>
        </header>
        <div data-reader-tab-row className="flex h-[41px] shrink-0 items-center justify-between border-b px-3">
          <Tabs value={searching ? "" : filters.tab} onValueChange={(tab) => onFiltersChange({ tab, query: "" })}>
            <TabsList variant="underline" className="w-auto border-b-0" aria-label="Filter pull requests">
              <TabsTrigger value="open">Open <Badge variant="secondary">{records.filter(isOpen).length}</Badge></TabsTrigger>
              <TabsTrigger value="closed">Closed &amp; merged</TabsTrigger>
            </TabsList>
          </Tabs>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Filter sidebar" title="Filter pull requests" className={filtered ? "bg-accent text-foreground" : "text-muted-foreground"}>
                <ListFilter />
                {filtered ? <span className="sr-only">Filters active</span> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label="Sidebar filters">
              <div className="border-b p-3">
                <SearchInput aria-label="Filter sidebar pull requests" placeholder="Search pull requests…" value={filters.query} onChange={(event) => updateFilter("query", event.target.value)} showClearButton={searching} onClear={() => updateFilter("query", "")} />
              </div>
              <div className="space-y-3 border-b p-4">
                <FilterRow label="Sort by">
                  <Picker badge label="Sort by" value={filters.field} onChange={(value) => updateFilter("field", value)} options={[{ value: "createdAt", label: "Created on" }, { value: "updatedAt", label: "Last updated" }]} />
                </FilterRow>
                <FilterRow label="Order">
                  <Picker badge label="Order" value={filters.order} onChange={(value) => updateFilter("order", value)} options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }]} />
                </FilterRow>
              </div>
              <div className="space-y-3 p-4">
                <FilterRow label="Repository">
                  <SearchPicker badge showValue label="Repository" title="Filter by repository" value={filters.repo} onChange={(value) => updateFilter("repo", value)} options={[
                    { value: "all", label: "All repositories" },
                    ...Array.from(new Set(records.map((item) => item.repo))).map((value) => ({ value, label: value })),
                  ]} />
                </FilterRow>
                <FilterRow label="Author">
                  <PeopleFilter badge showValue you={!!currentUser} kind="Author" value={filters.author} onChange={(value) => updateFilter("author", value)} />
                </FilterRow>
                <FilterRow label="Assignee">
                  <PeopleFilter badge showValue you={!!currentUser} kind="Assignee" value={filters.assignee} onChange={(value) => updateFilter("assignee", value)} />
                </FilterRow>
                {searching ? <FilterRow label="State">
                  <Picker badge label="Search state" value={filters.searchState} onChange={(value) => updateFilter("searchState", value)} options={["all", "open", "merged", "closed"].map((value) => ({ value, label: value === "all" ? "All states" : value.charAt(0).toUpperCase() + value.slice(1) }))} />
                </FilterRow> : null}
              </div>
              <div className="flex justify-end border-t px-3 py-2">
                <Button variant="outline" size="sm" onClick={() => onFiltersChange({ ...defaultFilters, tab: filters.tab })} disabled={!filtered}>Reset filters</Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.filter((group) => group.rows.length).map((group) => (
            <ThreadCollapsibleSection key={group.label} label={group.label} storageKey={`playground:github:pr-section:${group.label}`} compactLayout={false}>
              <div className="px-2">
              {group.rows.map((item) => (
                // The title button covers the row, leaving the stack badge clickable on top.
                <div key={prKey(item)} className={`relative mb-1 flex w-full min-w-0 flex-col gap-2 rounded-lg p-3 ${prKey(item) === prKey(pr) ? "bg-accent" : "hover:bg-muted/50"}`}>
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <button aria-current={prKey(item) === prKey(pr) ? "true" : undefined} onClick={() => onSelect(item)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">{item.title}</button>
                    <PrState state={item.state} />
                  </span>
                  <span className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{item.repo} #{item.number}</span><StackBadge records={records} pr={item} onSelect={onSelect} /><PersonAvatar id={item.author} compact /><span className="shrink-0">{item.updated}</span></span>
                </div>
              ))}
              </div>
            </ThreadCollapsibleSection>
          ))}
          {visible.length < matches.length ? (
            <div className="px-2 pb-2">
              <Button variant="ghost" size="sm" className="w-full" onClick={() => onFiltersChange({ page: filters.page + 1 })}>Load more</Button>
            </div>
          ) : null}
          {!matches.length ? <p className="p-3 text-sm text-muted-foreground">No matching pull requests</p> : null}
        </div>
      </aside>
      <ReaderPanel key={prKey(pr)} pr={pr} records={records} onSelect={onSelect} incoming={incoming} comments={comments} currentUser={currentUser} onCommentsChange={onCommentsChange} reviewed={reviewed} onReviewedChange={onReviewedChange} guides={guides} guideSettings={guideSettings} onGenerateGuide={onGenerateGuide} access={access} onConnect={onConnect} onChange={onChange} onExternal={onExternal} onNotice={onNotice} />
    </div>
  );
}

function ReaderPanel({ pr, records, onSelect, incoming, comments, currentUser, onCommentsChange, reviewed, onReviewedChange, guides, guideSettings, onGenerateGuide, access, onConnect, onChange, onExternal, onNotice }: {
  pr: PullRequest;
  records: PullRequest[];
  onSelect: (pr: PullRequest) => void;
  incoming: boolean;
  comments: PrComment[];
  currentUser: string | null;
  onCommentsChange: (comments: PrComment[]) => void;
  reviewed: string[];
  onReviewedChange: (paths: string[]) => void;
  guides: Guide[];
  guideSettings: GuideSettings;
  onGenerateGuide: (settings: GuideSettings, revision: string, base?: Guide) => void;
  access: GithubAccess;
  onConnect: () => void;
  onChange: (change: Partial<PullRequest>, targets?: PullRequest[]) => void;
  onExternal: () => void;
  onNotice: (message: string) => void;
}) {
  // GitHub keeps Viewed marks per user, so they need the user's own account.
  const reviewBlocked = blockedBy(access, "read");
  const [refreshed, setRefreshed] = useState(false);
  const [tab, setTab] = useState("overview");
  const [diffPath, setDiffPath] = useState<string>();
  // The newest guide shows unless the member picked another one.
  const [guideId, setGuideId] = useState<string>();
  // "new" starts from scratch; "update" builds a follow-up on the newest guide.
  const [launching, setLaunching] = useState<"new" | "update" | null>(null);
  const shownGuide = guides.find((item) => item.id === guideId) ?? guides.at(-1);
  const head = incoming ? "c91f02a" : "8a3e7d1";
  const newer = guides.findLast((item) => item.revision === head && !item.writing);
  const files = useMemo(() => filesFor(pr, refreshed), [pr, refreshed]);
  const task = taskFor(pr);
  const layers = stackOf(records, pr);
  const at = layers.findIndex((item) => prKey(item) === prKey(pr));
  // GitHub's stack shortcuts: Shift+K opens the layer above, Shift+J the one below.
  useHotkey("Shift+K", () => onSelect(layers[at + 1]), { enabled: at >= 0 && at < layers.length - 1 });
  useHotkey("Shift+J", () => onSelect(layers[at - 1]), { enabled: at > 0 });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {task ? (
          <TaskRefWithType
            refId={task.refId}
            taskType={resolveTaskTypeSummary(task.typeKey)}
            refInteractive={false}
            className="hidden gap-1.5 xl:inline-flex"
            refClassName="text-xs font-medium text-muted-foreground"
          />
        ) : null}
        <PrState state={pr.state} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={pr.title}>{pr.title}</h1>
        {pr.archived ? <Badge variant="secondary">Archived</Badge> : null}
        <StackBadge header records={records} pr={pr} onSelect={onSelect} />
        <PrActions pr={pr} layers={layers} onSelect={onSelect} commits={commitsFor(pr, refreshed).length} incoming={incoming} access={access} onConnect={onConnect} onChange={onChange} onExternal={onExternal} />
        <Button variant="ghost" size="icon-sm" aria-label="Open on GitHub" title="Open on GitHub" onClick={onExternal}><ArrowUpRight /></Button>
      </header>
      <Tabs value={tab} onValueChange={(value) => { setTab(value); setDiffPath(undefined); }} className="min-h-0 flex-1 gap-0">
        <div data-reader-tab-row className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b px-4">
          <TabsList variant="underline" className="w-auto border-b-0" aria-label="Pull request content">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="guide">Guide</TabsTrigger>
            <TabsTrigger value="diff">Diff</TabsTrigger>
          </TabsList>
          <div className="flex min-w-0 items-center gap-3">
            {tab === "guide" && shownGuide ? (
              <GuideMenu guides={guides} shown={shownGuide} currentUser={currentUser} onSelect={setGuideId} onNew={() => setLaunching("new")} />
            ) : null}
            <span className="truncate font-mono text-xs text-muted-foreground" aria-label="Displayed revision">
              main → {refreshed ? "c91f02a" : "8a3e7d1"}
            </span>
          </div>
        </div>
      {incoming && !refreshed ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-b bg-accent/50 px-5 py-3 text-sm md:px-8"
        >
          <div>
            <span className="font-medium">New changes available</span>
            <p className="text-xs text-muted-foreground">
              Your current diff stays in place until you refresh.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            // Like GitHub, files the new revision changed lose their reviewed mark.
            const next = filesFor(pr, true);
            onReviewedChange(reviewed.filter((path) => next.find((file) => file.path === path)?.after === files.find((file) => file.path === path)?.after));
            setRefreshed(true);
          }}>
            <RefreshCw />
            Refresh changes
          </Button>
        </div>
      ) : null}
        <TabsContent value="overview" className="overflow-auto">
          <PullRequestOverview
            key={prKey(pr)}
            pr={pr}
            base={layersBelow(layers, pr).at(-1)}
            layers={layers}
            onSelect={onSelect}
            refreshed={refreshed}
            comments={comments}
            currentUser={currentUser}
            onCommentsChange={onCommentsChange}
            onConnect={onConnect}
            onExternal={onExternal}
            onNotice={onNotice}
          />
        </TabsContent>
        <TabsContent value="guide" className="overflow-auto">
          {shownGuide && !shownGuide.writing && shownGuide.revision !== head ? (
            // Amber, not red: nothing is broken, but the guide misses the latest push.
            <div role="status" aria-label="Outdated guide" className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm md:px-8">
              <span className="flex items-center gap-2"><TriangleAlert className="size-4 shrink-0 text-amber-600" />
                {newer ? `A newer guide covers ${head}.` : `This guide was written for ${shownGuide.revision}. The commits since then aren't covered.`}
              </span>
              {newer ? (
                <Button variant="outline" size="sm" onClick={() => setGuideId(newer.id)}>Open it</Button>
              ) : (
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setLaunching("new")}>New guide</Button>
                  <Button size="sm" onClick={() => setLaunching("update")}>Update guide</Button>
                </span>
              )}
            </div>
          ) : null}
          {shownGuide && !shownGuide.writing ?
            <PullRequestGuide pr={pr} guide={shownGuide} currentUser={currentUser} files={files} reviewed={reviewed} reviewBlocked={reviewBlocked} onReviewedChange={onReviewedChange} onExternal={onExternal} /> :
            <GuidePending generating={!!shownGuide} requester={shownGuide && shownGuide.requester !== currentUser ? displayName(shownGuide.requester) : undefined} onGenerate={() => setLaunching("new")} onOpenThread={() => onNotice("This would open the agent's CLI thread that is writing the guide.")} />}
          {launching ? (
            <GuideLauncher title={launching === "update" ? "Update the guide" : "Generate a guide"} initial={guideSettings} onClose={() => setLaunching(null)} onGenerate={(settings) => {
              onGenerateGuide(settings, head, launching === "update" ? guides.findLast((item) => !item.writing) : undefined);
              setGuideId(undefined);
              setLaunching(null);
            }} />
          ) : null}
        </TabsContent>
        <TabsContent value="diff" className="flex min-h-0 flex-1 flex-col gap-0">
          <PullRequestChanges files={files} initialPath={diffPath} reviewed={reviewed} reviewBlocked={reviewBlocked} onReviewedChange={onReviewedChange} onExternal={onExternal} />
        </TabsContent>
      </Tabs>
    </div>
  );
}


// Reuse the worktree presentation with fixture content and read-only actions.
function PullRequestChanges({ files, initialPath, reviewed, reviewBlocked, onReviewedChange, onExternal }: {
  files: ChangedFile[];
  initialPath?: string;
  reviewed: string[];
  reviewBlocked?: string;
  onReviewedChange: (paths: string[]) => void;
  onExternal: () => void;
}) {
  const [style, setStyle] = useState<"split" | "unified">("unified");
  const [wrap, setWrap] = useState(true);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const isMobile = useIsMobile();
  const sections = useRef(new Map<string, HTMLElement>());
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) sections.current.set(path, element);
    else sections.current.delete(path);
  }, []);
  useEffect(() => {
    if (initialPath) requestAnimationFrame(() => sections.current.get(initialPath)?.scrollIntoView({ block: "start" }));
  }, [initialPath]);
  const summaries = useMemo(() => files.map(summaryFor), [files]);
  const toggleFile = (path: string) => setToggled((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });
  const isCollapsed = (path: string) => allCollapsed !== toggled.has(path);
  // Reviewing collapses the file and un-reviewing expands it, as on GitHub.
  const toggleReviewed = (path: string, checked: boolean) => {
    onReviewedChange(checked ? [...reviewed, path] : reviewed.filter((value) => value !== path));
    if (isCollapsed(path) !== checked) toggleFile(path);
  };
  const openFile = (path: string) => {
    setOpenPaths((current) => current.includes(path) ? current : [...current, path]);
    setActiveTab(path);
  };
  const activeFile = files.find((file) => file.path === activeTab);
  const totals = summaries.reduce((sum, file) => ({
    additions: sum.additions + file.additions,
    deletions: sum.deletions + file.deletions,
  }), { additions: 0, deletions: 0 });

  return (
    <ThreadWorkspaceSplitPane
      isSidebarOpen={sidebarOpen && !isMobile}
      onCloseSidebar={() => setSidebarOpen(false)}
      sidebarTitle="Files"
      sidebarHeader={<div className="flex h-[41px] items-center justify-between border-b px-3 text-xs font-medium">
        Files
        <Button variant="ghost" size="icon-sm" aria-label="Close files" onClick={() => setSidebarOpen(false)}><X /></Button>
      </div>}
      sidebarContent={<WorktreeFileTree
        files={summaries}
        selectedPath={selectedPath}
        onSelectFile={(path) => {
          setSelectedPath(path);
          setActiveTab(null);
          if (isCollapsed(path)) toggleFile(path);
          requestAnimationFrame(() => sections.current.get(path)?.scrollIntoView({ block: "start" }));
        }}
        onOpenFile={openFile}
      />}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[41px] shrink-0 items-center gap-3 border-b bg-card px-4 text-xs text-muted-foreground">
          <span>{files.length} files</span>
          <span className="text-green-600">+{totals.additions}</span>
          <span className="text-destructive">-{totals.deletions}</span>
          <span>{reviewed.length} / {files.length} reviewed</span>
          <div className="ml-auto flex items-center gap-1">
            <ChangesViewToggles
              allCollapsed={allCollapsed}
              onToggleCollapseAll={() => { setAllCollapsed(!allCollapsed); setToggled(new Set()); }}
              diffStyle={style}
              onToggleDiffStyle={() => setStyle(style === "unified" ? "split" : "unified")}
              wordWrap={wrap}
              onToggleWordWrap={() => setWrap(!wrap)}
            />
            {!sidebarOpen && !isMobile ? <Button variant="ghost" size="icon-sm" aria-label="Show files" onClick={() => setSidebarOpen(true)}><PanelRight /></Button> : null}
          </div>
        </div>
        <FileTabStrip activeTab={activeTab} openPaths={openPaths} onSelect={setActiveTab} onClose={(path) => {
          setOpenPaths((current) => current.filter((item) => item !== path));
          if (activeTab === path) setActiveTab(null);
        }} />
        <div className="min-h-0 flex-1 overflow-auto">
          {activeFile ? (
            activeFile.kind === "large" ? <FileUnavailable onExternal={onExternal} /> :
            <DiffView file={activeFile} style={style} wrap={wrap} whole />
          ) : files.map((file) => (
            <ReviewedFileSection
              key={file.path}
              file={file}
              collapsed={isCollapsed(file.path)}
              onToggle={toggleFile}
              registerSection={registerSection}
              reviewed={reviewed.includes(file.path)}
              reviewBlocked={reviewBlocked}
              onReviewed={(checked) => toggleReviewed(file.path, checked)}
              onOpen={() => openFile(file.path)}
              onExternal={onExternal}
              style={style}
              wrap={wrap}
            />
          ))}
        </div>
      </div>
    </ThreadWorkspaceSplitPane>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}
